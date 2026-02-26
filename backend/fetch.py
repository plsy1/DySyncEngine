import httpx
import time
from loguru import logger

from config import config

API_URL = config.FETCH_USER_POST_API
PROFILE_API = config.USER_PROFILE_API
HYBRID_VIDEO_API = config.VIDEO_DATA_API

def fetch_user_profile(sec_user_id: str, platform: str = "douyin") -> dict:
    """
    获取用户信息，支持 Douyin 和 TikTok
    """
    headers = {"accept": "application/json"}
    
    if platform == "tiktok":
        # 对于 TikTok，如果没有专门的 profile 接口，可以从 fetch_user_post 中获取第一个作品的作者信息
        try:
            params = {
                "secUid": sec_user_id,
                "cursor": "0",
                "count": 1,
                "coverFormat": 2
            }
            with httpx.Client(timeout=30) as client:
                resp = client.get(config.TIKTOK_USER_POST_API, params=params, headers=headers)
                resp.raise_for_status()
                data = resp.json().get("data", {})
                item_list = data.get("itemList", [])
                if item_list:
                    author = item_list[0].get("author", {})
                    # 构造与抖音类似的结构供下游使用
                    return {
                        "user": {
                            "uid": author.get("id"), # 使用数字 ID 确保唯一性
                            "nickname": author.get("nickname"),
                            "avatar_thumb": {"url_list": [author.get("avatarThumb")]},
                            "signature": author.get("signature"),
                            "unique_id": author.get("uniqueId"), # 保存 username 备用
                        }
                    }
        except httpx.TimeoutException:
            logger.error(f"获取 TikTok 用户信息超时 (sec_user_id: {sec_user_id})")
            raise Exception("获取 TikTok 用户信息超时，请稍后重试")
        except Exception as e:
            logger.error(f"获取 TikTok 用户信息失败: {e}")
            raise Exception(f"获取 TikTok 用户信息失败: {str(e)}")
    
    # 抖音逻辑
    params = {"sec_user_id": sec_user_id}
    with httpx.Client(timeout=10) as client:
        resp = client.get(PROFILE_API, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json().get("data", {})
        return data

def fetch_all_awemes(sec_user_id: str, platform: str = "douyin", latest_create_time: int = 0, count: int = 20):
    """
    抓取用户作品，支持 Douyin 和 TikTok
    """
    if platform == "tiktok":
        return fetch_tiktok_all_awemes(sec_user_id, latest_create_time, count)
    
    # 以下为 Douyin 逻辑 (原逻辑)
    max_cursor = 0
    all_awemes = []
    author_profile = {}
    headers = {"accept": "application/json"}

    with httpx.Client(timeout=10) as client:
        while True:
            params = {
                "sec_user_id": sec_user_id,
                "max_cursor": max_cursor,
                "count": count,
            }
            resp = client.get(API_URL, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json().get("data", {})
            aweme_list = data.get("aweme_list", [])
            if not aweme_list:
                break
            
            page_new_awemes = [item for item in aweme_list if item.get("create_time", 0) > latest_create_time]
            for item in page_new_awemes:
                aweme_id = item.get("aweme_id")
                author = item.get("author", {})
                all_awemes.append({
                    "aweme_id": aweme_id,
                    "desc": item.get("desc", ""),
                    "share_url": f"https://www.iesdouyin.com/share/video/{aweme_id}",
                    "nickname": author.get("nickname", ""),
                    "uid": author.get("uid", ""),
                    "create_time": item.get("create_time", 0),
                    "aweme_type": item.get("aweme_type", 0)
                })
            
            if any(item.get("create_time", 0) <= latest_create_time for item in aweme_list):
                break
            
            # 记录作者信息（通过第一页的第一个作品）
            if not author_profile and aweme_list:
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

def fetch_tiktok_all_awemes(sec_user_id: str, latest_create_time: int = 0, count: int = 35):
    """
    抓取 TikTok 用户作品
    """
    cursor = "0"
    all_awemes = []
    author_profile = {}
    headers = {"accept": "application/json"}

    with httpx.Client(timeout=60) as client:
        while True:
            params = {
                "secUid": sec_user_id,
                "cursor": cursor,
                "count": count,
                "coverFormat": 2
            }
            resp = client.get(config.TIKTOK_USER_POST_API, params=params, headers=headers)
            resp.raise_for_status()
            
            data = resp.json().get("data", {})
            item_list = data.get("itemList", [])
            if not item_list:
                break
            
            page_new_awemes = [item for item in item_list if item.get("createTime", 0) > latest_create_time]
            for item in page_new_awemes:
                aweme_id = item.get("id")
                author = item.get("author", {})
                unique_id = author.get("uniqueId", "")
                all_awemes.append({
                    "aweme_id": aweme_id,
                    "desc": item.get("desc", ""),
                    "share_url": f"https://www.tiktok.com/@{unique_id}/video/{aweme_id}",
                    "nickname": author.get("nickname", ""),
                    "uid": author.get("id"), # 使用数字 ID 确保唯一性
                    "unique_id": unique_id,
                    "create_time": item.get("createTime", 0),
                    "aweme_type": item.get("aweme_type", 0)
                })
            
            if any(item.get("createTime", 0) <= latest_create_time for item in item_list):
                break
            
            # 记录作者信息（通过第一页的第一个作品）
            if not author_profile and item_list:
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
                
            cursor = data.get("cursor")
            time.sleep(0.5)
            
    return {"awemes": all_awemes, "author": author_profile}


def fetch_video_profile(share_url: str, minimal: bool = True) -> dict:
    """
    根据抖音分享链接获取单个视频的 profile 数据
    :param share_url: 例如 https://www.iesdouyin.com/share/video/7596608527918652852
    :param minimal: 是否只返回 minimal 数据
    :return: dict，视频 profile 数据
    """
    params = {
        "url": share_url,
        "minimal": "true" if minimal else "false"
    }

    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(HYBRID_VIDEO_API, params=params)
            resp.raise_for_status()
            data = resp.json().get("data", {})
            return data
    except Exception as e:
        logger.error(f"获取视频 profile 失败: {e}")
        return {}