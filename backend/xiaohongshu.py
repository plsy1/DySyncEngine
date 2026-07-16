import html
import json
import os
import re
import zipfile
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse

import httpx
import yaml
from loguru import logger


XIAOHONGSHU_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 "
    "Safari/537.36"
)


def read_xiaohongshu_cookie() -> str:
    project_root = os.path.dirname(os.path.dirname(__file__))
    config_base = os.getenv("CONFIG_BASE", os.path.join(project_root, "config"))
    path = os.getenv(
        "XIAOHONGSHU_WEB_CONFIG_PATH",
        os.path.join(config_base, "xiaohongshu_web", "config.yaml"),
    )
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as file:
            content = file.read()
        match = re.search(r"^\s+Cookie:\s*(.*)$", content, re.MULTILINE)
        return match.group(1).strip() if match else ""
    except Exception as error:
        logger.warning(f"读取小红书 Cookie 失败: {error}")
        return ""


def get_xiaohongshu_headers(referer: str = "https://www.xiaohongshu.com/explore") -> dict[str, str]:
    headers = {
        "User-Agent": XIAOHONGSHU_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": referer,
    }
    cookie = read_xiaohongshu_cookie()
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _deep_get(value: Any, *keys: str) -> Any:
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _extract_initial_state(page: str) -> dict[str, Any]:
    marker = re.search(r"window\.__INITIAL_STATE__\s*=\s*", page)
    if not marker:
        return {}

    script_end = page.find("</script>", marker.end())
    if script_end == -1:
        return {}
    raw_state = html.unescape(page[marker.end():script_end]).strip().rstrip(";")

    try:
        state = json.loads(raw_state)
    except json.JSONDecodeError:
        try:
            state = yaml.safe_load(raw_state)
        except yaml.YAMLError:
            return {}
    return state if isinstance(state, dict) else {}


def _iter_note_candidates(value: Any, depth: int = 0) -> Iterator[dict[str, Any]]:
    if depth > 10:
        return
    if isinstance(value, dict):
        if value.get("noteId") and (value.get("imageList") or value.get("video")):
            yield value
        for child in value.values():
            yield from _iter_note_candidates(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_note_candidates(child, depth + 1)


def _extract_note_id(url: str) -> str:
    for pattern in (
        r"/(?:explore|discovery/item)/([a-zA-Z0-9]+)",
        r"/user/profile/[a-zA-Z0-9]+/([a-zA-Z0-9]+)",
    ):
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return ""


def _select_note(state: dict[str, Any], note_id: str) -> dict[str, Any]:
    phone_note = _deep_get(state, "noteData", "data", "noteData")
    if isinstance(phone_note, dict) and (not note_id or phone_note.get("noteId") == note_id):
        return phone_note

    detail_map = _deep_get(state, "note", "noteDetailMap")
    if isinstance(detail_map, dict):
        preferred = detail_map.get(note_id) if note_id else None
        if isinstance(preferred, dict):
            preferred_note = preferred.get("note", preferred)
            if isinstance(preferred_note, dict):
                return preferred_note
        for item in detail_map.values():
            if not isinstance(item, dict):
                continue
            note = item.get("note", item)
            if isinstance(note, dict) and (not note_id or note.get("noteId") == note_id):
                return note

    candidates = list(_iter_note_candidates(state))
    if note_id:
        matched = next((item for item in candidates if item.get("noteId") == note_id), None)
        if matched:
            return matched
    return candidates[0] if candidates else {}


def _clean_url(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return html.unescape(value).replace("\\u002F", "/").replace("\\/", "/").strip()


def _first_url(value: Any) -> str:
    if isinstance(value, str):
        return _clean_url(value)
    if isinstance(value, list):
        return next((_clean_url(item) for item in value if _clean_url(item)), "")
    return ""


def _extract_image_urls(note: dict[str, Any]) -> list[str]:
    result: list[str] = []
    for image in note.get("imageList") or []:
        if not isinstance(image, dict):
            continue
        url = _first_url(
            image.get("urlDefault")
            or image.get("urlPre")
            or image.get("url")
            or image.get("urlList")
        )
        if url and url not in result:
            result.append(url)
    return result


def _stream_score(item: dict[str, Any]) -> tuple[int, int, int]:
    def as_int(value: Any) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0

    return as_int(item.get("height")), as_int(item.get("videoBitrate")), as_int(item.get("size"))


def _extract_video_url(note: dict[str, Any]) -> str:
    origin_key = _deep_get(note, "video", "consumer", "originVideoKey")
    if isinstance(origin_key, str) and origin_key:
        return f"https://sns-video-bd.xhscdn.com/{origin_key.lstrip('/')}"

    streams = _deep_get(note, "video", "media", "stream") or {}
    candidates: list[dict[str, Any]] = []
    if isinstance(streams, dict):
        for codec in ("h264", "h265", "av1"):
            items = streams.get(codec)
            if isinstance(items, list):
                candidates.extend(item for item in items if isinstance(item, dict))
    if not candidates:
        return ""

    best = max(candidates, key=_stream_score)
    return _first_url(best.get("backupUrls")) or _first_url(best.get("masterUrl"))


def _avatar_url(user: dict[str, Any]) -> str:
    return _first_url(
        user.get("avatar")
        or user.get("avatarUrl")
        or user.get("image")
        or user.get("images")
    )


def fetch_xiaohongshu_video_profile(share_url: str) -> dict[str, Any]:
    if not share_url.startswith(("http://", "https://")):
        share_url = f"https://{share_url}"

    try:
        with httpx.Client(
            headers=get_xiaohongshu_headers(),
            follow_redirects=True,
            timeout=30,
        ) as client:
            response = client.get(share_url)
            response.raise_for_status()
            final_url = str(response.url)
            page = response.text
    except httpx.HTTPError as error:
        raise ValueError(f"请求小红书作品页失败: {error}") from error

    state = _extract_initial_state(page)
    note_id = _extract_note_id(final_url) or _extract_note_id(share_url)
    note = _select_note(state, note_id)
    if not note:
        raise ValueError("无法解析小红书作品，请使用包含 xsec_token 的最新公开分享链接")

    note_id = str(note.get("noteId") or note_id)
    image_urls = _extract_image_urls(note)
    video_url = _extract_video_url(note)
    note_type = str(note.get("type") or "").lower()
    is_video = note_type == "video" and bool(video_url)
    if not video_url and not image_urls:
        raise ValueError("无法提取小红书作品文件地址")

    user = note.get("user") if isinstance(note.get("user"), dict) else {}
    uid = str(user.get("userId") or user.get("userid") or f"xiaohongshu_{note_id}")
    nickname = str(user.get("nickname") or user.get("nickName") or uid)
    create_time = int(note.get("time") or note.get("createTime") or 0)
    if create_time > 10_000_000_000:
        create_time //= 1000

    cover_url = image_urls[0] if image_urls else ""
    title = str(note.get("title") or "").strip()
    description = str(note.get("desc") or "").strip()
    return {
        "aweme_id": note_id,
        "aweme_type": 0 if is_video else 68,
        "desc": title or description,
        "share_url": final_url,
        "video": {
            "play_addr": {"url_list": [video_url] if is_video else []},
            "origin_cover": {"url_list": [cover_url] if cover_url else []},
        },
        "images": {"url_list": [] if is_video else image_urls},
        "author": {
            "uid": uid,
            "sec_uid": uid,
            "nickname": nickname,
            "avatar_thumb": {"url_list": [_avatar_url(user)]},
            "signature": str(user.get("desc") or user.get("signature") or ""),
        },
        "create_time": create_time,
    }


def _media_headers(profile: dict[str, Any], fallback_url: str) -> dict[str, str]:
    headers = get_xiaohongshu_headers(profile.get("share_url") or fallback_url)
    headers["Accept"] = "*/*"
    return headers


def _content_extension(content_type: str, url: str, default: str = "jpg") -> str:
    normalized = content_type.split(";", 1)[0].strip().lower()
    mapping = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/avif": "avif",
        "image/heic": "heic",
        "image/heif": "heif",
    }
    if normalized in mapping:
        return mapping[normalized]
    suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
    return suffix if suffix in set(mapping.values()) else default


def download_xiaohongshu_video_from_profile_to_file(
    profile: dict[str, Any],
    output_path: str,
    fallback_url: str = "",
) -> str:
    video_url = _first_url(profile.get("video", {}).get("play_addr", {}).get("url_list", []))
    if not video_url:
        raise ValueError("无法提取小红书视频直链")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    try:
        with httpx.Client(
            headers=_media_headers(profile, fallback_url),
            follow_redirects=True,
            timeout=60,
        ) as client:
            with client.stream("GET", video_url) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "video/mp4")
                with open(output_path, "wb") as file:
                    for chunk in response.iter_bytes():
                        if chunk:
                            file.write(chunk)
        if os.path.getsize(output_path) < 1024:
            raise ValueError("小红书视频文件内容异常")
        return content_type
    except Exception:
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except Exception as cleanup_error:
            logger.warning(f"清理失败的小红书临时视频失败: {output_path} | {cleanup_error}")
        raise


def download_xiaohongshu_images_from_profile_to_zip(
    profile: dict[str, Any],
    output_path: str,
    fallback_url: str = "",
) -> str:
    image_urls = profile.get("images", {}).get("url_list", [])
    if not image_urls:
        raise ValueError("无法提取小红书图文图片直链")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    try:
        with httpx.Client(
            headers=_media_headers(profile, fallback_url),
            follow_redirects=True,
            timeout=60,
        ) as client:
            with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as archive:
                for index, image_url in enumerate(image_urls, start=1):
                    with client.stream("GET", image_url) as response:
                        response.raise_for_status()
                        content_type = response.headers.get("content-type", "image/jpeg")
                        extension = _content_extension(content_type, image_url)
                        image_name = f"{index:02d}.{extension}"
                        image_size = 0
                        with archive.open(image_name, "w") as image_file:
                            for chunk in response.iter_bytes():
                                if chunk:
                                    image_file.write(chunk)
                                    image_size += len(chunk)
                        if image_size < 1024:
                            raise ValueError(f"小红书图文图片内容异常: {image_name}")
        return "application/zip"
    except Exception:
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except Exception as cleanup_error:
            logger.warning(f"清理失败的小红书临时图文失败: {output_path} | {cleanup_error}")
        raise


def download_xiaohongshu_images(
    share_url: str,
    profile: dict[str, Any] | None = None,
) -> tuple[list[tuple[str, bytes, str]], dict[str, Any]]:
    profile = profile or fetch_xiaohongshu_video_profile(share_url)
    image_urls = profile.get("images", {}).get("url_list", [])
    if not image_urls:
        raise ValueError("无法提取小红书图文图片直链")

    images: list[tuple[str, bytes, str]] = []
    with httpx.Client(
        headers=_media_headers(profile, share_url),
        follow_redirects=True,
        timeout=60,
    ) as client:
        for index, image_url in enumerate(image_urls, start=1):
            response = client.get(image_url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/jpeg")
            extension = _content_extension(content_type, image_url)
            images.append((f"{index:02d}.{extension}", response.content, content_type))
    return images, profile
