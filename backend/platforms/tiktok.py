import time
from typing import Any

import httpx
from loguru import logger

from config import config
from platforms.base import PlatformAdapter
from platforms.external import fetch_hybrid_work_profile


class TikTokAdapter(PlatformAdapter):
    slug = "tiktok"
    display_name = "TikTok"
    domains = ("tiktok.com",)

    def extract_user_id(self, url: str) -> str:
        try:
            with httpx.Client(timeout=10) as client:
                response = client.get(config.TIKTOK_SEC_USER_ID_API, params={"url": url})
                response.raise_for_status()
                data = response.json()
                if data.get("code") == 200 and data.get("data"):
                    return str(data["data"])
        except Exception as error:
            logger.error(f"获取 TikTok sec_user_id 失败: {error}")
        raise ValueError("无法获取 TikTok sec_user_id")

    def fetch_user_profile(self, target: str) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=30) as client:
                response = client.get(
                    config.TIKTOK_USER_POST_API,
                    params={"secUid": target, "cursor": "0", "count": 1, "coverFormat": 2},
                    headers={"accept": "application/json"},
                )
                response.raise_for_status()
                item_list = response.json().get("data", {}).get("itemList", [])
                if item_list:
                    author = item_list[0].get("author", {})
                    return {
                        "user": {
                            "uid": author.get("id"),
                            "nickname": author.get("nickname"),
                            "avatar_thumb": {"url_list": [author.get("avatarThumb")]},
                            "signature": author.get("signature"),
                            "unique_id": author.get("uniqueId"),
                        }
                    }
        except httpx.TimeoutException as error:
            logger.error(f"获取 TikTok 用户信息超时 (sec_user_id: {target})")
            raise ValueError("获取 TikTok 用户信息超时，请稍后重试") from error
        except Exception as error:
            logger.error(f"获取 TikTok 用户信息失败: {error}")
            raise ValueError(f"获取 TikTok 用户信息失败: {error}") from error
        raise ValueError("无法从 TikTok 作品列表获取作者信息")

    def fetch_all_awemes(
        self,
        user_ref: str,
        latest_create_time: int = 0,
        count: int = 35,
        max_fetch: int = 0,
        **kwargs: Any,
    ) -> dict[str, Any]:
        cursor = "0"
        all_awemes: list[dict[str, Any]] = []
        author_profile: dict[str, Any] = {}

        with httpx.Client(timeout=60) as client:
            while True:
                response = client.get(
                    config.TIKTOK_USER_POST_API,
                    params={"secUid": user_ref, "cursor": cursor, "count": count, "coverFormat": 2},
                    headers={"accept": "application/json"},
                )
                response.raise_for_status()
                data = response.json().get("data", {})
                item_list = data.get("itemList", [])
                if not item_list:
                    break

                for item in item_list:
                    if item.get("createTime", 0) <= latest_create_time:
                        continue
                    author = item.get("author", {})
                    aweme_id = item.get("id")
                    unique_id = author.get("uniqueId", "")
                    all_awemes.append({
                        "aweme_id": aweme_id,
                        "desc": item.get("desc", ""),
                        "share_url": f"https://www.tiktok.com/@{unique_id}/video/{aweme_id}",
                        "nickname": author.get("nickname", ""),
                        "uid": author.get("id"),
                        "unique_id": unique_id,
                        "create_time": item.get("createTime", 0),
                        "aweme_type": item.get("aweme_type", 0),
                    })

                if max_fetch > 0 and len(all_awemes) >= max_fetch:
                    all_awemes = all_awemes[:max_fetch]
                    break
                if any(item.get("createTime", 0) <= latest_create_time for item in item_list):
                    break

                if not author_profile:
                    author = item_list[0].get("author", {})
                    author_profile = {
                        "uid": author.get("id"),
                        "nickname": author.get("nickname"),
                        "avatar_thumb": {"url_list": [author.get("avatarThumb")]},
                        "signature": author.get("signature"),
                        "unique_id": author.get("uniqueId"),
                    }
                if not data.get("hasMore"):
                    break

                cursor = str(data.get("cursor") or "0")
                time.sleep(0.5)

        return {"awemes": all_awemes, "author": author_profile}

    def fetch_work_profile(
        self,
        share_url: str,
        minimal: bool = True,
        timeout: int = 30,
    ) -> dict[str, Any]:
        return fetch_hybrid_work_profile(share_url, minimal=minimal, timeout=timeout)
