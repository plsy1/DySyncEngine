from __future__ import annotations

import re

from platforms.base import PlatformAdapter
from platforms.douyin import DouyinAdapter
from platforms.kuaishou import KuaishouAdapter
from platforms.tiktok import TikTokAdapter
from platforms.xiaohongshu import XiaohongshuAdapter


_ADAPTERS: dict[str, PlatformAdapter] = {
    adapter.slug: adapter
    for adapter in (
        DouyinAdapter(),
        TikTokAdapter(),
        KuaishouAdapter(),
        XiaohongshuAdapter(),
    )
}


def get_adapter(platform: str) -> PlatformAdapter:
    try:
        return _ADAPTERS[platform]
    except KeyError as error:
        raise ValueError(f"不支持的平台: {platform}") from error


def iter_adapters() -> tuple[PlatformAdapter, ...]:
    return tuple(_ADAPTERS.values())


def detect_platform(url: str) -> str:
    for adapter in _ADAPTERS.values():
        if adapter.slug != "douyin" and adapter.matches_url(url):
            return adapter.slug
    return "douyin"


def get_adapter_for_url(url: str) -> PlatformAdapter:
    return get_adapter(detect_platform(url))


def extract_supported_url(text: str) -> str:
    domains = sorted(
        {domain for adapter in _ADAPTERS.values() for domain in adapter.domains},
        key=len,
        reverse=True,
    )
    domain_pattern = "|".join(re.escape(domain) for domain in domains)
    pattern = re.compile(
        rf"(?:https?://)?(?:[a-zA-Z0-9-]+\.)?(?:{domain_pattern})/[^\s<>\"，。；！？、【】《》]+",
        re.IGNORECASE,
    )
    match = pattern.search(text)
    if not match:
        return text
    url = match.group(0).rstrip(".,;:!?)]}'\"")
    return url if url.startswith(("http://", "https://")) else f"https://{url}"
