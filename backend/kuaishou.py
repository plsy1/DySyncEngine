import html
import json
import os
import re
import threading
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from loguru import logger


KUAISHOU_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
        "Mobile/15E148 Safari/604.1"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

_feed_request_lock = threading.Lock()
_last_feed_request_at = 0.0


def _wait_for_feed_slot(min_interval: float) -> None:
    global _last_feed_request_at
    with _feed_request_lock:
        now = time.monotonic()
        wait_seconds = max(0.0, min_interval - (now - _last_feed_request_at))
        if wait_seconds > 0:
            time.sleep(wait_seconds)
        _last_feed_request_at = time.monotonic()


def read_kuaishou_cookie() -> str:
    project_root = os.path.dirname(os.path.dirname(__file__))
    config_base = os.getenv("CONFIG_BASE", os.path.join(project_root, "config"))
    path = os.getenv("KUAISHOU_WEB_CONFIG_PATH", os.path.join(config_base, "kuaishou_web", "config.yaml"))
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as file:
            content = file.read()
        match = re.search(r"^\s+Cookie:\s*(.+)$", content, re.MULTILINE)
        return match.group(1).strip() if match else ""
    except Exception as error:
        logger.warning(f"读取快手 Cookie 失败: {error}")
        return ""


def get_kuaishou_headers() -> dict[str, str]:
    headers = dict(KUAISHOU_HEADERS)
    cookie = read_kuaishou_cookie()
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _get_runtime_config(key: str, default: str) -> str:
    try:
        from db import SessionLocal, get_config
        with SessionLocal() as session:
            return get_config(session, key, default) or default
    except Exception:
        return default


def _extract_balanced_object(text: str, start: int) -> str | None:
    depth = 0
    in_string = False
    escape = False

    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]

    return None


def _json_loads_maybe_escaped(raw: str) -> Any | None:
    raw = html.unescape(raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        pass

    try:
        unescaped = bytes(raw, "utf-8").decode("unicode_escape")
        return json.loads(unescaped)
    except Exception:
        return None


def _extract_state_objects(page: str) -> list[Any]:
    states: list[Any] = []

    for marker in (
        "window.__APOLLO_STATE__",
        "__APOLLO_STATE__",
        "window.__INITIAL_STATE__",
        "__INITIAL_STATE__",
        "window.INIT_STATE",
        "INIT_STATE",
    ):
        marker_index = page.find(marker)
        if marker_index < 0:
            continue
        object_start = page.find("{", marker_index)
        if object_start < 0:
            continue
        raw_object = _extract_balanced_object(page, object_start)
        if not raw_object:
            continue
        loaded = _json_loads_maybe_escaped(raw_object)
        if loaded is not None:
            states.append(loaded)

    next_data = re.search(
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        page,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if next_data:
        loaded = _json_loads_maybe_escaped(next_data.group(1))
        if loaded is not None:
            states.append(loaded)

    return states


def _walk(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _first_string(data: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _pick_url_from_list(value: Any) -> str | None:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.startswith("http"):
                return item
            if isinstance(item, dict):
                url = _first_string(item, ("url", "src", "cdn", "qualityUrl"))
                if url and url.startswith("http"):
                    return url
    return None


def _get_nested(data: dict[str, Any], path: tuple[str, ...]) -> Any:
    value: Any = data
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _extract_atlas_urls(data: dict[str, Any]) -> list[str]:
    for atlas in (
        _get_nested(data, ("ext_params", "atlas")),
        data.get("atlas"),
    ):
        if not isinstance(atlas, dict):
            continue

        cdn_list = atlas.get("cdn")
        image_paths = atlas.get("list")
        if not isinstance(cdn_list, list) or not cdn_list or not isinstance(image_paths, list):
            continue

        cdn = next((item for item in cdn_list if isinstance(item, str) and item.strip()), "")
        if not cdn:
            continue

        urls = []
        for image_path in image_paths:
            if not isinstance(image_path, str) or not image_path.strip():
                continue
            if image_path.startswith("http"):
                urls.append(image_path)
            else:
                urls.append(f"https://{cdn}{image_path}")
        if urls:
            return urls

    return []


def _extract_image_urls(data: dict[str, Any]) -> list[str]:
    atlas_urls = _extract_atlas_urls(data)
    if atlas_urls:
        return atlas_urls

    is_single_picture = bool(data.get("singlePicture") or data.get("photoType") == "SINGLE_PICTURE")
    if not (is_single_picture or data.get("photoType") in ("VERTICAL_ATLAS", "HORIZONTAL_ATLAS")):
        return []

    urls: list[str] = []
    for key in ("webpCoverUrls", "coverUrls"):
        value = data.get(key)
        if not isinstance(value, list):
            continue
        for item in value:
            url = None
            if isinstance(item, dict):
                url = _first_string(item, ("url",))
            elif isinstance(item, str):
                url = item
            if url and url.startswith("http") and url not in urls:
                urls.append(url)
    cover_url = _extract_cover_url(data)
    if cover_url and cover_url not in urls:
        urls.append(cover_url)
    if is_single_picture and urls:
        return [urls[0]]
    return urls


def _extract_video_url(data: dict[str, Any]) -> str | None:
    for key in ("photoUrl", "playUrl", "videoUrl", "mp4Url", "srcNoMark", "src"):
        value = data.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return value

    for key in ("mainMvUrls", "videoUrls", "playUrls", "urls", "urlList"):
        url = _pick_url_from_list(data.get(key))
        if url:
            return url

    manifest = data.get("manifest")
    if isinstance(manifest, dict):
        adaptation_sets = manifest.get("adaptationSet")
        if isinstance(adaptation_sets, list):
            for adaptation_set in adaptation_sets:
                if not isinstance(adaptation_set, dict):
                    continue
                representations = adaptation_set.get("representation")
                if not isinstance(representations, list):
                    continue
                for representation in representations:
                    if not isinstance(representation, dict):
                        continue
                    url = _first_string(representation, ("url",))
                    if url and url.startswith("http"):
                        return url
                    url = _pick_url_from_list(representation.get("backupUrl"))
                    if url:
                        return url

    return None


def _extract_cover_url(data: dict[str, Any]) -> str | None:
    for key in ("coverUrl", "poster", "thumbnailUrl", "photoCoverUrl", "cover"):
        value = data.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return value
    return _pick_url_from_list(data.get("coverUrls"))


def _first_url_from_list(value: Any) -> str | None:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                url = _first_string(item, ("url",))
                if url:
                    return url
            elif isinstance(item, str) and item.startswith("http"):
                return item
    return None


def _score_video_candidate(data: dict[str, Any]) -> int:
    score = 0
    if _extract_video_url(data):
        score += 10
    if _first_string(data, ("photoId", "id", "photo_id", "workId")):
        score += 3
    if _first_string(data, ("caption", "desc", "title")):
        score += 2
    if _first_string(data, ("userName", "name", "authorName", "nickname")):
        score += 1
    return score


def _score_media_candidate(data: dict[str, Any]) -> int:
    score = _score_video_candidate(data)
    if _extract_image_urls(data):
        score += 10
    if data.get("singlePicture") or data.get("photoType") in ("SINGLE_PICTURE", "VERTICAL_ATLAS", "HORIZONTAL_ATLAS"):
        score += 5
    return score


def _best_media_candidate(states: list[Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for state in states:
        for item in _walk(state):
            if _extract_video_url(item) or _extract_image_urls(item):
                candidates.append(item)

    if not candidates:
        return None

    return max(candidates, key=_score_media_candidate)


def _photo_data(candidate: dict[str, Any]) -> dict[str, Any]:
    photo = candidate.get("photo")
    return photo if isinstance(photo, dict) else candidate


def _extract_aweme_id(data: dict[str, Any], final_url: str) -> str:
    share_info = data.get("share_info")
    if isinstance(share_info, str):
        photo_id = parse_qs(share_info).get("photoId", [""])[0]
        if photo_id:
            return photo_id
    return (
        _first_string(data, ("photoId", "photo_id", "workId", "id"))
        or re.sub(r"\W+", "_", final_url).strip("_")[-48:]
        or "kuaishou_video"
    )


def _state_user_profile(states: list[Any], final_url: str = "") -> dict[str, Any] | None:
    parsed = urlparse(final_url) if final_url else None
    path_kwai_id = ""
    if parsed:
        match = re.search(r"/fw/user/([^/?]+)", parsed.path)
        path_kwai_id = match.group(1) if match else ""
        query_share_object_id = parse_qs(parsed.query).get("shareObjectId", [""])[0]
    else:
        query_share_object_id = ""

    profiles: list[dict[str, Any]] = []
    for state in states:
        for item in _walk(state):
            if not isinstance(item, dict):
                continue
            user_profile = item.get("userProfile")
            if not isinstance(user_profile, dict):
                continue
            profile = user_profile.get("profile")
            if isinstance(profile, dict):
                profiles.append(profile)

    if path_kwai_id:
        for profile in profiles:
            if _first_string(profile, ("kwaiId",)) == path_kwai_id:
                return profile

    if query_share_object_id:
        for profile in profiles:
            if str(profile.get("user_id") or "") == query_share_object_id:
                return profile

    return profiles[0] if profiles else None


def _state_feeds(states: list[Any]) -> list[dict[str, Any]]:
    for state in states:
        for item in _walk(state):
            if isinstance(item, dict) and isinstance(item.get("feeds"), list):
                return [feed for feed in item["feeds"] if isinstance(feed, dict)]
    return []


def _fetch_page(url: str) -> tuple[str, str]:
    with httpx.Client(headers=get_kuaishou_headers(), follow_redirects=True, timeout=30) as client:
        response = client.get(url)
        response.raise_for_status()
        return str(response.url), response.text


def _item_to_aweme(item: dict[str, Any], fallback_user_id: str = "") -> dict[str, Any] | None:
    photo = _photo_data(item)
    aweme_id = _extract_aweme_id(photo, "")
    if not aweme_id or aweme_id == "kuaishou_video":
        return None

    video_url = _extract_video_url(photo) or _extract_video_url(item)
    image_urls = _extract_image_urls(photo) or _extract_image_urls(item)
    create_time = int(photo.get("timestamp") or photo.get("createTime") or item.get("timestamp") or item.get("createTime") or 0)
    if create_time > 10_000_000_000:
        create_time //= 1000

    uid = _first_string(photo, ("userEid", "userId", "authorId", "uid")) or fallback_user_id
    return {
        "aweme_id": aweme_id,
        "desc": _first_string(photo, ("caption", "desc", "title")) or "",
        "share_url": f"https://www.kuaishou.com/short-video/{aweme_id}",
        "nickname": _first_string(photo, ("userName", "name", "nickname", "authorName")) or "",
        "uid": uid,
        "create_time": create_time,
        "aweme_type": 68 if image_urls and not video_url else 0,
    }


def _extract_regex_profile(page: str, final_url: str) -> dict[str, Any] | None:
    video_match = re.search(
        r'"(?:photoUrl|playUrl|videoUrl|mp4Url|srcNoMark)"\s*:\s*"([^"]+)"',
        page,
    )
    if not video_match:
        return None

    def pick(pattern: str) -> str | None:
        match = re.search(pattern, page)
        return match.group(1) if match else None

    video_url = bytes(video_match.group(1), "utf-8").decode("unicode_escape")
    aweme_id = pick(r'"(?:photoId|photo_id|workId|id)"\s*:\s*"([^"]+)"') or re.sub(r"\W+", "_", final_url).strip("_")[-48:]
    desc = pick(r'"(?:caption|desc|title)"\s*:\s*"([^"]*)"') or ""
    nickname = pick(r'"(?:userName|nickname|authorName)"\s*:\s*"([^"]+)"') or "快手作者"
    uid = pick(r'"(?:userId|authorId|uid)"\s*:\s*"([^"]+)"') or f"kuaishou_{aweme_id}"
    cover = pick(r'"(?:coverUrl|poster|thumbnailUrl|photoCoverUrl)"\s*:\s*"([^"]+)"')

    return {
        "aweme_id": aweme_id,
        "aweme_type": 0,
        "desc": bytes(desc, "utf-8").decode("unicode_escape"),
        "share_url": final_url,
        "video": {
            "play_addr": {"url_list": [video_url]},
            "origin_cover": {"url_list": [bytes(cover, "utf-8").decode("unicode_escape") if cover else None]},
        },
        "author": {
            "uid": uid,
            "sec_uid": uid,
            "nickname": bytes(nickname, "utf-8").decode("unicode_escape"),
            "avatar_thumb": {"url_list": [None]},
            "signature": None,
        },
        "create_time": 0,
    }


def fetch_kuaishou_user_profile(target: str) -> dict[str, Any]:
    if target.startswith("http"):
        final_url, page = _fetch_page(target)
        states = _extract_state_objects(page)
        profile = _state_user_profile(states, final_url)
        if not profile:
            raise ValueError("无法解析快手主页用户信息")

        eid = _first_string(profile, ("eid",))
        if not eid:
            raise ValueError("无法解析快手主页用户 ID")

        return {
            "user": {
                "uid": eid,
                "sec_uid": eid,
                "nickname": _first_string(profile, ("user_name", "name", "nickname")) or eid,
                "avatar_thumb": {"url_list": [_first_string(profile, ("headurl", "headUrl")) or _first_url_from_list(profile.get("headurls"))]},
                "signature": _first_string(profile, ("user_text", "userText", "profile", "signature")),
            }
        }

    return {
        "user": {
            "uid": target,
            "sec_uid": target,
            "nickname": target,
            "avatar_thumb": {"url_list": [None]},
            "signature": None,
        }
    }


def extract_kuaishou_user_id(url: str) -> str:
    profile = fetch_kuaishou_user_profile(url)
    user = profile.get("user", {})
    uid = user.get("uid") or user.get("sec_uid")
    if not uid:
        raise ValueError("无法从快手主页提取用户 ID")
    return uid


def _fetch_kuaishou_profile_feeds(user_ref: str) -> list[dict[str, Any]]:
    profile_url = user_ref if user_ref.startswith("http") else f"https://c.kuaishou.com/fw/user/{user_ref}"
    try:
        _, page = _fetch_page(profile_url)
    except Exception:
        return []
    return _state_feeds(_extract_state_objects(page))


def fetch_kuaishou_all_awemes(
    user_ref: str,
    latest_create_time: int = 0,
    count: int = 20,
    max_fetch: int = 0,
    initial_cursor: str = "",
    max_pages: int = 0,
    stop_on_rate_limit: bool = False,
    preferred_user_id: str = "",
) -> dict[str, Any]:
    fallback_profile_url = user_ref if user_ref.startswith("http") else ""
    user_id = preferred_user_id or user_ref
    if fallback_profile_url and not preferred_user_id:
        profile = fetch_kuaishou_user_profile(fallback_profile_url).get("user", {})
        user_id = profile.get("uid") or profile.get("sec_uid") or user_id
    if max_fetch <= 0 and max_pages <= 0:
        max_fetch = int(os.getenv("KUAISHOU_DEFAULT_MAX_FETCH", "20"))

    all_awemes: list[dict[str, Any]] = []
    author_profile: dict[str, Any] = {}
    pcursor = initial_cursor or ""
    seen_cursors: set[str] = set()
    pages_fetched = 0
    min_request_interval = float(_get_runtime_config("kuaishou_feed_min_interval", os.getenv("KUAISHOU_FEED_MIN_INTERVAL", "20")))
    rate_limit_waits = [30, 60, 120]
    headers = {
        **get_kuaishou_headers(),
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://www.kuaishou.com",
        "Referer": f"https://www.kuaishou.com/profile/{user_id}",
        "kpn": "KUAISHOU_VISION",
        "kpf": "PC_WEB",
    }

    with httpx.Client(headers=headers, follow_redirects=True, timeout=30) as client:
        while True:
            data = None
            for retry_index in range(len(rate_limit_waits) + 1):
                _wait_for_feed_slot(min_request_interval)
                request_body = {"user_id": user_id, "pcursor": pcursor, "page": "profile"}
                response = client.post(
                    "https://www.kuaishou.com/rest/v/profile/feed",
                    json=request_body,
                )
                if response.status_code in (429, 503):
                    wait_seconds = rate_limit_waits[min(retry_index, len(rate_limit_waits) - 1)]
                    logger.warning(f"快手作品列表触发 HTTP {response.status_code} 限流，等待 {wait_seconds}s 后重试")
                    time.sleep(wait_seconds)
                    continue

                response.raise_for_status()
                data = response.json()
                if data.get("result") == 2:
                    if stop_on_rate_limit:
                        error_msg = data.get("error_msg") or "操作频繁"
                        logger.warning(f"快手作品列表触发限流: {error_msg}，保存游标后结束本轮")
                        return {
                            "awemes": all_awemes,
                            "author": author_profile,
                            "next_cursor": pcursor,
                            "has_more": bool(pcursor),
                            "rate_limited": True,
                        }
                    if retry_index >= len(rate_limit_waits) and fallback_profile_url:
                        logger.warning("快手作品列表触发限流，改用主页首屏作品降级抓取")
                        feeds = _fetch_kuaishou_profile_feeds(fallback_profile_url)
                        data = {"feeds": feeds, "pcursor": "no_more"}
                        break
                    wait_seconds = rate_limit_waits[min(retry_index, len(rate_limit_waits) - 1)]
                    error_msg = data.get("error_msg") or "操作频繁"
                    logger.warning(f"快手作品列表触发限流: {error_msg}，等待 {wait_seconds}s 后重试")
                    time.sleep(wait_seconds)
                    continue
                break

            if data is None or data.get("result") == 2:
                raise ValueError("快手作品列表请求被限流，请稍后重试；如需降级抓取，请重新添加快手主页链接")

            if data.get("result") == 109:
                if all_awemes:
                    break
                feeds = _fetch_kuaishou_profile_feeds(fallback_profile_url or user_id)
                if not feeds:
                    raise ValueError("快手 Cookie 无效或已过期，无法抓取作者作品列表")
                data = {"feeds": feeds, "pcursor": "no_more"}

            feeds = data.get("feeds")
            if not isinstance(feeds, list) or not feeds:
                return {
                    "awemes": all_awemes,
                    "author": author_profile,
                    "next_cursor": "",
                    "has_more": False,
                    "rate_limited": False,
                }

            page_awemes: list[dict[str, Any]] = []
            for feed in feeds:
                if not isinstance(feed, dict):
                    continue
                aweme = _item_to_aweme(feed, fallback_user_id=user_id)
                if aweme:
                    page_awemes.append(aweme)

            if page_awemes and not author_profile:
                first = _photo_data(feeds[0])
                nickname = _first_string(first, ("userName", "name", "nickname"))
                author_profile = {
                    "uid": _first_string(first, ("userEid", "userId")) or user_id,
                    "nickname": nickname,
                    "avatar_thumb": {"url_list": [_first_string(first, ("headUrl",)) or _first_url_from_list(first.get("headUrls"))]},
                    "signature": None,
                } if nickname else {}

            new_awemes = [item for item in page_awemes if item.get("create_time", 0) > latest_create_time]
            all_awemes.extend(new_awemes)
            pages_fetched += 1

            if max_fetch > 0 and len(all_awemes) >= max_fetch:
                all_awemes = all_awemes[:max_fetch]
                return {
                    "awemes": all_awemes,
                    "author": author_profile,
                    "next_cursor": "",
                    "has_more": False,
                    "rate_limited": False,
                }

            if any(item.get("create_time", 0) <= latest_create_time for item in page_awemes):
                return {
                    "awemes": all_awemes,
                    "author": author_profile,
                    "next_cursor": "",
                    "has_more": False,
                    "rate_limited": False,
                }

            next_cursor = data.get("pcursor")
            if not next_cursor or next_cursor == "no_more" or next_cursor in seen_cursors:
                return {
                    "awemes": all_awemes,
                    "author": author_profile,
                    "next_cursor": "",
                    "has_more": False,
                    "rate_limited": False,
                }
            if max_pages > 0 and pages_fetched >= max_pages:
                return {
                    "awemes": all_awemes,
                    "author": author_profile,
                    "next_cursor": next_cursor,
                    "has_more": True,
                    "rate_limited": False,
                }
            seen_cursors.add(next_cursor)
            pcursor = next_cursor

    return {
        "awemes": all_awemes,
        "author": author_profile,
        "next_cursor": "",
        "has_more": False,
        "rate_limited": False,
    }


def fetch_kuaishou_video_profile(share_url: str) -> dict[str, Any]:
    with httpx.Client(headers=get_kuaishou_headers(), follow_redirects=True, timeout=30) as client:
        response = client.get(share_url)
        response.raise_for_status()
        final_url = str(response.url)
        page = response.text

    states = _extract_state_objects(page)
    candidate = _best_media_candidate(states)

    if not candidate:
        regex_profile = _extract_regex_profile(page, final_url)
        if regex_profile:
            return regex_profile
        logger.warning(f"无法从快手页面提取视频数据: {final_url}")
        raise ValueError("无法解析快手视频，请确认链接是公开的单个作品分享链接")

    photo = _photo_data(candidate)
    video_url = _extract_video_url(candidate)
    image_urls = _extract_image_urls(photo) or _extract_image_urls(candidate)
    if not video_url and not image_urls:
        raise ValueError("无法提取快手作品直链")

    author = candidate.get("author") if isinstance(candidate.get("author"), dict) else {}
    user = candidate.get("user") if isinstance(candidate.get("user"), dict) else {}
    author_data = {**photo, **author, **user}

    aweme_id = _extract_aweme_id(photo, final_url)
    nickname = (
        _first_string(author_data, ("userName", "name", "nickname", "authorName"))
        or _first_string(photo, ("userName", "name", "nickname", "authorName"))
        or "快手作者"
    )
    uid = (
        _first_string(author_data, ("userEid", "userId", "id", "eid"))
        or _first_string(photo, ("userEid", "userId", "authorId", "uid"))
        or f"kuaishou_{aweme_id}"
    )
    create_time = int(photo.get("timestamp") or photo.get("createTime") or candidate.get("timestamp") or candidate.get("createTime") or 0)
    if create_time > 10_000_000_000:
        create_time //= 1000

    return {
        "aweme_id": aweme_id,
        "aweme_type": 68 if image_urls and not video_url else 0,
        "desc": _first_string(photo, ("caption", "desc", "title")) or _first_string(candidate, ("caption", "desc", "title")) or "",
        "share_url": final_url,
        "video": {
            "play_addr": {"url_list": [video_url]},
            "origin_cover": {"url_list": [_extract_cover_url(photo) or _extract_cover_url(candidate)]},
        },
        "images": {"url_list": image_urls},
        "author": {
            "uid": uid,
            "sec_uid": uid,
            "nickname": nickname,
            "avatar_thumb": {"url_list": [_first_string(author_data, ("headUrl", "headurl", "avatar", "avatarUrl"))]},
            "signature": _first_string(author_data, ("userText", "profile", "signature")),
        },
        "create_time": create_time,
    }


def download_kuaishou_video(share_url: str) -> tuple[bytes, str]:
    profile = fetch_kuaishou_video_profile(share_url)
    return download_kuaishou_video_from_profile(profile, share_url)


def download_kuaishou_video_from_profile(profile: dict[str, Any], fallback_url: str = "") -> tuple[bytes, str]:
    video_url = profile.get("video", {}).get("play_addr", {}).get("url_list", [None])[0]
    if not video_url:
        raise ValueError("无法提取快手视频直链")

    headers = {
        **get_kuaishou_headers(),
        "Referer": profile.get("share_url") or fallback_url,
    }
    with httpx.Client(headers=headers, follow_redirects=True, timeout=60) as client:
        response = client.get(video_url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "video/mp4")
        return response.content, content_type


def download_kuaishou_video_from_profile_to_file(profile: dict[str, Any], output_path: str, fallback_url: str = "") -> str:
    video_url = profile.get("video", {}).get("play_addr", {}).get("url_list", [None])[0]
    if not video_url:
        raise ValueError("无法提取快手视频直链")

    headers = {
        **get_kuaishou_headers(),
        "Referer": profile.get("share_url") or fallback_url,
    }
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    try:
        with httpx.Client(headers=headers, follow_redirects=True, timeout=60) as client:
            with client.stream("GET", video_url) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "video/mp4")
                with open(output_path, "wb") as file:
                    for chunk in response.iter_bytes():
                        if chunk:
                            file.write(chunk)
                return content_type
    except Exception:
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except Exception as cleanup_error:
            logger.warning(f"清理失败的快手临时视频文件失败: {output_path} | {cleanup_error}")
        raise


def download_kuaishou_images(share_url: str) -> tuple[list[tuple[str, bytes, str]], dict[str, Any]]:
    profile = fetch_kuaishou_video_profile(share_url)
    image_urls = profile.get("images", {}).get("url_list", [])
    if not image_urls:
        raise ValueError("无法提取快手图文图片直链")

    headers = {
        **get_kuaishou_headers(),
        "Referer": profile.get("share_url") or share_url,
    }
    images: list[tuple[str, bytes, str]] = []
    with httpx.Client(headers=headers, follow_redirects=True, timeout=60) as client:
        for index, image_url in enumerate(image_urls, start=1):
            response = client.get(image_url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/jpeg")
            extension = "webp" if "webp" in content_type else "jpg"
            images.append((f"{index:02d}.{extension}", response.content, content_type))
    return images, profile
