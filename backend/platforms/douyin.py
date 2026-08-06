import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from loguru import logger

from config import config
from platforms.base import PlatformAdapter, PlatformCapabilities
from platforms.external import fetch_hybrid_work_profile


class DouyinAdapter(PlatformAdapter):
    slug = "douyin"
    display_name = "抖音"
    domains = ("douyin.com",)
    capabilities = PlatformCapabilities(animated_image_media=True)

    def extract_user_id(self, url: str) -> str:
        match = re.search(r"/user/([^/?]+)", url)
        if match:
            return match.group(1)
        raise ValueError("无法从 URL 提取抖音 sec_user_id")

    def fetch_user_profile(self, target: str) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.get(
                config.USER_PROFILE_API,
                params={"sec_user_id": target},
                headers={"accept": "application/json"},
            )
            response.raise_for_status()
            return response.json().get("data", {})

    def fetch_all_awemes(
        self,
        user_ref: str,
        latest_create_time: int = 0,
        count: int = 20,
        max_fetch: int = 0,
        **kwargs: Any,
    ) -> dict[str, Any]:
        max_cursor = 0
        all_awemes: list[dict[str, Any]] = []
        author_profile: dict[str, Any] = {}

        with httpx.Client(timeout=30) as client:
            while True:
                response = client.get(
                    config.FETCH_USER_POST_API,
                    params={"sec_user_id": user_ref, "max_cursor": max_cursor, "count": count},
                    headers={"accept": "application/json"},
                )
                response.raise_for_status()
                data = response.json().get("data", {})
                aweme_list = data.get("aweme_list", [])
                if not aweme_list:
                    break

                for item in aweme_list:
                    if item.get("create_time", 0) <= latest_create_time:
                        continue
                    author = item.get("author", {})
                    aweme_id = item.get("aweme_id")
                    all_awemes.append({
                        "aweme_id": aweme_id,
                        "desc": item.get("desc", ""),
                        "share_url": f"https://www.iesdouyin.com/share/video/{aweme_id}",
                        "nickname": author.get("nickname", ""),
                        "uid": author.get("uid", ""),
                        "create_time": item.get("create_time", 0),
                        "aweme_type": item.get("aweme_type", 0),
                    })

                if max_fetch > 0 and len(all_awemes) >= max_fetch:
                    all_awemes = all_awemes[:max_fetch]
                    break
                if any(item.get("create_time", 0) <= latest_create_time for item in aweme_list):
                    break

                if not author_profile:
                    author = aweme_list[0].get("author", {})
                    author_profile = {
                        "uid": author.get("uid"),
                        "nickname": author.get("nickname"),
                        "avatar_thumb": author.get("avatar_thumb"),
                        "signature": author.get("signature"),
                    }

                next_cursor = data.get("max_cursor")
                if not next_cursor or next_cursor == max_cursor:
                    break
                max_cursor = next_cursor
                time.sleep(0.3)

        return {"awemes": all_awemes, "author": author_profile}

    def fetch_work_profile(
        self,
        share_url: str,
        minimal: bool = True,
        timeout: int = 30,
    ) -> dict[str, Any]:
        return fetch_hybrid_work_profile(share_url, minimal=minimal, timeout=timeout)

    @staticmethod
    def _first_url(value: Any) -> str | None:
        if isinstance(value, dict):
            value = value.get("url_list")
        if isinstance(value, list):
            return next((item for item in value if isinstance(item, str) and item), None)
        return value if isinstance(value, str) and value else None

    @classmethod
    def _image_video_url(cls, image: dict[str, Any]) -> str | None:
        video = image.get("video")
        if not isinstance(video, dict):
            return None
        direct_url = cls._first_url(video.get("play_addr")) or cls._first_url(video.get("download_addr"))
        if direct_url:
            return direct_url
        for bitrate in video.get("bit_rate") or []:
            if isinstance(bitrate, dict):
                direct_url = cls._first_url(bitrate.get("play_addr"))
                if direct_url:
                    return direct_url
        return None

    @staticmethod
    def _media_extension(content_type: str, source_url: str, is_video: bool) -> str:
        normalized_type = content_type.split(";", 1)[0].strip().lower()
        if is_video or normalized_type.startswith("video/"):
            return "mp4"
        if normalized_type == "image/webp":
            return "webp"
        if normalized_type == "image/png":
            return "png"
        if normalized_type == "image/gif":
            return "gif"
        suffix = urlparse(source_url).path.rsplit(".", 1)[-1].lower()
        return suffix if suffix in {"jpg", "jpeg", "png", "webp", "gif"} else "jpg"

    def has_animated_image_media(self, profile: dict[str, Any]) -> bool:
        images = profile.get("images")
        return isinstance(images, list) and any(
            self._image_video_url(image)
            for image in images
            if isinstance(image, dict)
        )

    def download_images(
        self,
        share_url: str,
        profile: dict[str, Any] | None = None,
    ) -> tuple[list[tuple[str, bytes, str]], dict[str, Any]]:
        profile = profile or self.fetch_work_profile(share_url, minimal=False)
        images = profile.get("images")
        if not isinstance(images, list) or not images:
            raise ValueError("无法提取抖音图文媒体")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
            "Referer": profile.get("share_url") or share_url,
        }
        media: list[tuple[str, bytes, str]] = []
        with httpx.Client(headers=headers, follow_redirects=True, timeout=60) as client:
            for index, image in enumerate(images, start=1):
                if not isinstance(image, dict):
                    continue
                video_url = self._image_video_url(image)
                image_url = self._first_url(image.get("url_list")) or self._first_url(
                    image.get("download_url_list")
                )
                if not video_url and not image_url:
                    raise ValueError(f"抖音图文第 {index} 项缺少媒体地址")

                if video_url:
                    video_response = client.get(video_url)
                    video_response.raise_for_status()
                    video_content_type = video_response.headers.get("content-type", "video/mp4")
                    # 动态图直接保留运动视频，避免在服务端封装成只有 Apple
                    # 设备和特定导入流程才能识别的 Live Photo。
                    video_extension = self._media_extension(video_content_type, video_url, True)
                    media.append(
                        (f"{index:02d}.{video_extension}", video_response.content, video_content_type)
                    )
                    continue

                response = client.get(image_url)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "image/jpeg")
                extension = self._media_extension(content_type, image_url, False)
                media.append((f"{index:02d}.{extension}", response.content, content_type))

        if not media:
            raise ValueError("抖音图文没有可下载的媒体")
        return media, profile
