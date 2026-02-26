import re

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
