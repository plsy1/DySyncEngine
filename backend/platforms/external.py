from typing import Any

import httpx
from loguru import logger

from config import config


def fetch_hybrid_work_profile(
    share_url: str,
    minimal: bool = True,
    timeout: int = 30,
) -> dict[str, Any]:
    params = {
        "url": share_url,
        "minimal": "true" if minimal else "false",
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(config.VIDEO_DATA_API, params=params)
            response.raise_for_status()
            return response.json().get("data", {})
    except Exception as error:
        logger.error(f"获取作品 profile 失败: {error}")
        return {}
