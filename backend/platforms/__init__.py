from typing import Any

from platforms.base import PlatformAdapter, PlatformCapabilities
from platforms.registry import (
    detect_platform,
    extract_supported_url,
    get_adapter,
    get_adapter_for_url,
    iter_adapters,
)


def fetch_user_profile(target: str, platform: str = "douyin") -> dict[str, Any]:
    return get_adapter(platform).fetch_user_profile(target)


def fetch_all_awemes(
    user_ref: str,
    platform: str = "douyin",
    latest_create_time: int = 0,
    count: int = 20,
    max_fetch: int = 0,
    **kwargs: Any,
) -> dict[str, Any]:
    return get_adapter(platform).fetch_all_awemes(
        user_ref,
        latest_create_time=latest_create_time,
        count=count,
        max_fetch=max_fetch,
        **kwargs,
    )


def fetch_work_profile(
    share_url: str,
    minimal: bool = True,
    timeout: int = 30,
) -> dict[str, Any]:
    return get_adapter_for_url(share_url).fetch_work_profile(
        share_url,
        minimal=minimal,
        timeout=timeout,
    )


__all__ = [
    "PlatformAdapter",
    "PlatformCapabilities",
    "detect_platform",
    "extract_supported_url",
    "fetch_all_awemes",
    "fetch_user_profile",
    "fetch_work_profile",
    "get_adapter",
    "get_adapter_for_url",
    "iter_adapters",
]
