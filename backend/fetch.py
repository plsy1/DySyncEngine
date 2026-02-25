import httpx
import time
from loguru import logger

from config import config

API_URL = config.FETCH_USER_POST_API
PROFILE_API = config.USER_PROFILE_API
HYBRID_VIDEO_API = config.VIDEO_DATA_API

def fetch_user_profile(sec_user_id: str) -> dict:
    """
    获取用户信息
    """
    headers = {"accept": "application/json"}
    params = {"sec_user_id": sec_user_id}

    with httpx.Client(timeout=10) as client:
        resp = client.get(PROFILE_API, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json().get("data", {})
        return data

def fetch_all_awemes(sec_user_id: str, latest_create_time: int = 0, count: int = 20):
    """
    抓取用户作品，增量抓取优化：
    - 只返回 create_time > latest_create_time 的作品
    - 如果本页存在 create_time <= latest_create_time 的作品，则停止抓取
    """
    max_cursor = 0
    all_awemes = []

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
                logger.info("aweme_list 为空，已拉取完毕")
                break

            # 本页筛选出最新作品
            page_new_awemes = [item for item in aweme_list if item.get("create_time", 0) > latest_create_time]

            # 将筛选后的作品格式化
            formatted_new_awemes = []
            for item in page_new_awemes:
                aweme_id = item.get("aweme_id")
                desc = item.get("desc", "")
                share_url = f"https://www.iesdouyin.com/share/video/{aweme_id}"
                author = item.get("author", {})
                nickname = author.get("nickname", "")
                uid = author.get("uid", "")
                create_time = item.get("create_time", 0)

                formatted_new_awemes.append({
                    "aweme_id": aweme_id,
                    "desc": desc,
                    "share_url": share_url,
                    "nickname": nickname,
                    "uid": uid,
                    "create_time": create_time,
                    "aweme_type": item.get("aweme_type", 0)
                })

            all_awemes.extend(formatted_new_awemes)

            logger.info(
                f"本页抓取 {len(aweme_list)} 条作品 | "
                f"筛选出 {len(formatted_new_awemes)} 条新作品 | "
                f"max_cursor={data.get('max_cursor')} | "
                f"has_more={data.get('has_more')}"
            )

            # 如果本页存在任何历史作品，则停止分页
            if any(item.get("create_time", 0) <= latest_create_time for item in aweme_list):
                logger.info("本页存在历史作品，停止抓取后续分页")
                break

            # 翻页
            next_cursor = data.get("max_cursor")
            if not next_cursor or next_cursor == max_cursor:
                logger.info("max_cursor 无效或未变化，停止翻页")
                break

            max_cursor = next_cursor
            time.sleep(0.3)

    return all_awemes


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