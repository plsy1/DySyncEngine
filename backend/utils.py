import re
import httpx
from loguru import logger
from config import config

def extract_share_url(text: str) -> str:
    """
    从一段文字中提取出抖音或 TikTok 的 URL
    支持 douyin.com, tiktok.com 相关的域名
    """
    # 匹配 douyin.com 或 tiktok.com 相关的域名及其路径
    pattern = r'https?://(?:[a-zA-Z0-9-]+\.)?(?:douyin\.com|tiktok\.com)/[^\s#?]+'
    match = re.search(pattern, text)
    if match:
        return match.group(0)
    return text

def get_url_platform(url: str) -> str:
    """
    识别链接所属平台
    """
    if "tiktok.com" in url:
        return "tiktok"
    return "douyin"

def resolve_redirect(url: str, max_redirects=5, timeout=10) -> str:
    """
    处理 302/301 跳转，获取最终 URL
    """
    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    try:
        with httpx.Client(
            follow_redirects=False,
            timeout=timeout,
            headers=headers
        ) as client:
            current_url = url

            for _ in range(max_redirects):
                resp = client.get(current_url)

                if resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get("Location")
                    if not location:
                        break # 虽然是跳转但没 Location，就返回当前 URL

                    # 处理相对跳转
                    current_url = str(resp.url.join(location))
                    continue

                # 已经不是跳转
                return str(resp.url)
    except Exception:
        # 即使报错也回退到使用原 URL
        return url

    return url

def extract_sec_user_id(url: str) -> str:
    """
    从跳转后的主页 URL 中提取 sec_user_id
    支持抖音 (正则) 和 TikTok (API 接口)
    """
    platform = get_url_platform(url)
    
    if platform == "tiktok":
        # 对于 TikTok，调用专用 API 获取 sec_user_id
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(config.TIKTOK_SEC_USER_ID_API, params={"url": url})
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 200:
                    return data.get("data")
        except Exception as e:
            logger.error(f"获取 TikTok sec_user_id 失败: {e}")
        raise ValueError("无法获取 TikTok sec_user_id")
    else:
        # 对于抖音，使用常规正则提取
        match = re.search(r"/user/([^/?]+)", url)
        if match:
            return match.group(1)
        raise ValueError("无法从 URL 提取抖音 sec_user_id")

def sanitize_filename(name: str) -> str:
    """去除非法文件名字符并限制长度"""
    # [\\/:*?"<>|] 是 Windows/Unix 非法字符的集合
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = name.replace("\n", " ").replace("\r", " ")
    name = name.strip()
    if len(name) > 50:
        name = name[:50]
    return name or "downloaded_video"
