import html
import json
import os
import re
from typing import Any

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


def _best_video_candidate(states: list[Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for state in states:
        for item in _walk(state):
            if _extract_video_url(item):
                candidates.append(item)

    if not candidates:
        return None

    return max(candidates, key=_score_video_candidate)


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

    create_time = int(candidate.get("timestamp") or candidate.get("createTime") or 0)
    if create_time > 10_000_000_000:
        create_time //= 1000

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


def fetch_kuaishou_video_profile(share_url: str) -> dict[str, Any]:
    with httpx.Client(headers=get_kuaishou_headers(), follow_redirects=True, timeout=30) as client:
        response = client.get(share_url)
        response.raise_for_status()
        final_url = str(response.url)
        page = response.text

    states = _extract_state_objects(page)
    candidate = _best_video_candidate(states)

    if not candidate:
        regex_profile = _extract_regex_profile(page, final_url)
        if regex_profile:
            return regex_profile
        logger.warning(f"无法从快手页面提取视频数据: {final_url}")
        raise ValueError("无法解析快手视频，请确认链接是公开的单个作品分享链接")

    video_url = _extract_video_url(candidate)
    if not video_url:
        raise ValueError("无法提取快手视频直链")

    author = candidate.get("author") if isinstance(candidate.get("author"), dict) else {}
    user = candidate.get("user") if isinstance(candidate.get("user"), dict) else {}
    author_data = {**author, **user}

    aweme_id = (
        _first_string(candidate, ("photoId", "photo_id", "workId", "id"))
        or re.sub(r"\W+", "_", final_url).strip("_")[-48:]
        or "kuaishou_video"
    )
    nickname = (
        _first_string(author_data, ("userName", "name", "nickname", "authorName"))
        or _first_string(candidate, ("userName", "name", "nickname", "authorName"))
        or "快手作者"
    )
    uid = (
        _first_string(author_data, ("userId", "id", "eid"))
        or _first_string(candidate, ("userId", "authorId", "uid"))
        or f"kuaishou_{aweme_id}"
    )
    create_time = int(candidate.get("timestamp") or candidate.get("createTime") or 0)
    if create_time > 10_000_000_000:
        create_time //= 1000

    return {
        "aweme_id": aweme_id,
        "aweme_type": 0,
        "desc": _first_string(candidate, ("caption", "desc", "title")) or "",
        "share_url": final_url,
        "video": {
            "play_addr": {"url_list": [video_url]},
            "origin_cover": {"url_list": [_extract_cover_url(candidate)]},
        },
        "author": {
            "uid": uid,
            "sec_uid": uid,
            "nickname": nickname,
            "avatar_thumb": {"url_list": [_first_string(author_data, ("headUrl", "avatar", "avatarUrl"))]},
            "signature": _first_string(author_data, ("userText", "profile", "signature")),
        },
        "create_time": create_time,
    }


def download_kuaishou_video(share_url: str) -> tuple[bytes, str]:
    profile = fetch_kuaishou_video_profile(share_url)
    video_url = profile.get("video", {}).get("play_addr", {}).get("url_list", [None])[0]
    if not video_url:
        raise ValueError("无法提取快手视频直链")

    headers = {
        **get_kuaishou_headers(),
        "Referer": profile.get("share_url") or share_url,
    }
    with httpx.Client(headers=headers, follow_redirects=True, timeout=60) as client:
        response = client.get(video_url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "video/mp4")
        return response.content, content_type
