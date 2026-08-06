from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
import os
import zipfile
from typing import Any


MediaFile = tuple[str, bytes, str]


@dataclass(frozen=True)
class PlatformCapabilities:
    subscriptions: bool = True
    direct_media_download: bool = False
    animated_image_media: bool = False
    cursor_backfill: bool = False
    resolve_work_redirects: bool = True
    feed_author_authoritative: bool = True
    single_work_author_complete: bool = False
    reclassify_directory_as_note: bool = False


class PlatformAdapter(ABC):
    slug: str
    display_name: str
    domains: tuple[str, ...]
    capabilities = PlatformCapabilities()

    def matches_url(self, url: str) -> bool:
        normalized = url.lower()
        return any(domain in normalized for domain in self.domains)

    def require_subscriptions(self) -> None:
        if not self.capabilities.subscriptions:
            raise ValueError(f"{self.display_name}目前支持单作品解析与下载，暂不支持作者订阅")

    @abstractmethod
    def extract_user_id(self, url: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def fetch_user_profile(self, target: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fetch_all_awemes(
        self,
        user_ref: str,
        latest_create_time: int = 0,
        count: int = 20,
        max_fetch: int = 0,
        **kwargs: Any,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fetch_work_profile(
        self,
        share_url: str,
        minimal: bool = True,
        timeout: int = 30,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def subscription_profile_target(self, original_url: str, final_url: str) -> str:
        return self.extract_user_id(final_url)

    def subscription_reference(
        self,
        original_url: str,
        final_url: str,
        author: dict[str, Any],
    ) -> str:
        return str(author.get("sec_uid") or author.get("uid") or self.extract_user_id(final_url))

    def download_video_to_file(
        self,
        profile: dict[str, Any],
        output_path: str,
        fallback_url: str = "",
    ) -> str:
        raise NotImplementedError(f"{self.display_name}不支持适配器直连视频下载")

    def download_images(
        self,
        share_url: str,
        profile: dict[str, Any] | None = None,
    ) -> tuple[list[MediaFile], dict[str, Any]]:
        raise NotImplementedError(f"{self.display_name}不支持适配器直连图文下载")

    def has_animated_image_media(self, profile: dict[str, Any]) -> bool:
        return False

    def download_images_to_zip(
        self,
        profile: dict[str, Any],
        output_path: str,
        fallback_url: str = "",
    ) -> str:
        images, _ = self.download_images(
            profile.get("share_url") or fallback_url,
            profile=profile,
        )
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for image_name, content, _ in images:
                archive.writestr(image_name, content)
        return "application/zip"
