import re
import httpx
from loguru import logger
from config import config
import asyncio

_main_loop = None

def set_main_loop(loop: asyncio.AbstractEventLoop):
    global _main_loop
    _main_loop = loop

def run_coro_safe(coro):
    """
    在主线程的事件循环中安全地运行协程（从后台线程触发）
    """
    if _main_loop:
        return asyncio.run_coroutine_threadsafe(coro, _main_loop)
    else:
        # 如果还没初始化 loop，尝试用 create_task (仅当在主线程时有效)
        try:
            return asyncio.create_task(coro)
        except RuntimeError:
            logger.error("无法启动异步任务: 尚未配置主事件循环且当前位于非事件循环线程")
            return None

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

def get_author_folder_name(nickname: str, uid: str, platform: str, session=None) -> str:
    """
    根据配置的文件夹命名规则生成作者的文件夹名称
    """
    # 默认命名规则为 "{nickname}_{uid}"
    pattern = "{nickname}_{uid}"
    
    # 2. 从数据库中拉取自定义命名规则
    if session:
        try:
            from db import get_config
            pattern = get_config(session, "folder_name_pattern", "{nickname}_{uid}")
        except Exception:
            pass
    else:
        # 如果没有传入 session，尝试获取一个临时的 db session
        try:
            from db import SessionLocal, get_config
            with SessionLocal() as db_session:
                pattern = get_config(db_session, "folder_name_pattern", "{nickname}_{uid}")
        except Exception:
            pass

    # 3. 替换支持的标签
    sanitized_nickname = sanitize_filename(nickname)
    folder_name = pattern.replace("{nickname}", sanitized_nickname)\
                         .replace("{uid}", uid)\
                         .replace("{platform}", platform)
                         
    # 限制文件夹名称的合法性
    return sanitize_filename(folder_name)

def handle_nickname_change(session, uid: str, old_nickname: str, new_nickname: str, platform: str = "douyin"):
    """
    当作者更改昵称时，处理本地存储目录及数据库文件路径的同步更新
    """
    if not old_nickname or not new_nickname or old_nickname == new_nickname:
        return

    import os
    from config import config

    # 1. 首先同步更新数据库中该作者所有已存在 Aweme 作品的 nickname 字段
    try:
        from db import Aweme
        # 批量更新该作者所有作品的昵称
        session.query(Aweme).filter_by(uid=uid).update({Aweme.nickname: new_nickname})
        session.commit()
        logger.info(f"已同步更新数据库中 UID: {uid} 所有作品的昵称为: {new_nickname}")
    except Exception as e:
        logger.error(f"批量更新作品 nickname 失败: {e}")

    # 2. 检查本地文件夹并执行重命名迁移
    save_dir = config.SAVE_DIR or "videos"
    if not os.path.exists(save_dir):
        return

    # 根据当前配置的 pattern，解析 old_folder_name 和 new_folder_name
    old_folder_name = get_author_folder_name(old_nickname, uid, platform, session)
    new_folder_name = get_author_folder_name(new_nickname, uid, platform, session)

    if old_folder_name == new_folder_name:
        return

    old_folder_path = os.path.join(save_dir, old_folder_name)
    new_folder_path = os.path.join(save_dir, new_folder_name)

    found_old_folder = None
    if os.path.isdir(old_folder_path):
        found_old_folder = old_folder_name
    else:
        # Fallback: 遍历目录寻找与 uid 相关的可能目录 (例如以 _uid 结尾，或以 uid_ 开头，或者等于 uid)
        # 这样即使在更改命名规则后修改了昵称，也能找到旧目录
        possible_suffixes = [f"_{uid}", f"-{uid}"]
        possible_prefixes = [f"{uid}_", f"{uid}-"]
        try:
            for entry in os.scandir(save_dir):
                if entry.is_dir() and entry.name != new_folder_name:
                    is_match = False
                    for suff in possible_suffixes:
                        if entry.name.endswith(suff):
                            is_match = True
                            break
                    for pref in possible_prefixes:
                        if entry.name.startswith(pref):
                            is_match = True
                            break
                    if entry.name == uid:
                        is_match = True
                    
                    if is_match:
                        found_old_folder = entry.name
                        old_folder_path = os.path.join(save_dir, found_old_folder)
                        break
        except Exception as e:
            logger.error(f"扫描目录 {save_dir} 寻找旧目录失败: {e}")

    if not found_old_folder:
        logger.info(f"未找到 UID: {uid} 的旧作者目录，跳过本地文件夹重命名")
        return

    try:
        logger.info(f"检测到本地存在旧作者目录，正在迁移: {found_old_folder} -> {new_folder_name} ...")
        os.rename(old_folder_path, new_folder_path)
        logger.info(f"本地文件夹迁移重命名成功!")
    except Exception as e:
        logger.error(f"重命名本地文件夹失败: {e}")
        return

    # 3. 如果文件夹重命名成功，再替换数据库中 local_path 内包含的旧文件夹名称
    try:
        awemes = session.query(Aweme).filter_by(uid=uid).all()
        updated_count = 0
        old_segment = f"{found_old_folder}/"
        new_segment = f"{new_folder_name}/"
        for aweme in awemes:
            if aweme.local_path and old_segment in aweme.local_path:
                aweme.local_path = aweme.local_path.replace(old_segment, new_segment)
                updated_count += 1
        if updated_count > 0:
            session.commit()
            logger.info(f"成功同步更新数据库中 {updated_count} 条作品的本地存储路径")
    except Exception as e:
        logger.error(f"更新数据库作品 local_path 失败: {e}")

