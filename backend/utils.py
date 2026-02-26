import re
import httpx

def extract_douyin_url(text: str) -> str:
    """
    从一段文字中提取出抖音的 URL
    支持 v.douyin.com, www.douyin.com, iesdouyin.com 等
    """
    # 匹配 http/https 开头，后面跟着 douyin.com 相关的域名及其路径
    # [^\s]+ 匹配非空字符，直到遇到空格或结尾
    pattern = r'https?://(?:[a-zA-Z0-9-]+\.)?douyin\.com/[^\s#?]+'
    match = re.search(pattern, text)
    if match:
        return match.group(0)
    return text  # 如果没找到，原样返回，由后续逻辑进一步处理或报错

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
    """
    match = re.search(r"/user/([^/?]+)", url)
    if match:
        return match.group(1)
    raise ValueError("无法从 URL 提取 sec_user_id")

def sanitize_filename(name: str) -> str:
    """去除非法文件名字符并限制长度"""
    # [\\/:*?"<>|] 是 Windows/Unix 非法字符的集合
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = name.replace("\n", " ").replace("\r", " ")
    name = name.strip()
    if len(name) > 100:
        name = name[:100]
    return name or "downloaded_video"
