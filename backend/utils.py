import re
import httpx
from loguru import logger
from config import config
import asyncio
import os
from collections import Counter

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
    从一段文字中提取出支持平台的 URL
    支持 douyin.com, tiktok.com, kuaishou.com, kuaishou.cn, kwai.com, gifshow.com, ksurl.cn, chenzhongtech.com, kuaishouzt.com, kwai.net 相关的域名
    """
    pattern = r'https?://(?:[a-zA-Z0-9-]+\.)?(?:douyin\.com|tiktok\.com|kuaishou\.com|kuaishou\.cn|kwai\.com|gifshow\.com|ksurl\.cn|chenzhongtech\.com|kuaishouzt\.com|kwai\.net)/[^\s#?]+'
    match = re.search(pattern, text)
    if match:
        return match.group(0)
    return text

def get_url_platform(url: str) -> str:
    """
    识别链接所属平台
    """
    normalized_url = url.lower()
    if "tiktok.com" in normalized_url:
        return "tiktok"
    if any(domain in normalized_url for domain in ("kuaishou.com", "kuaishou.cn", "kwai.com", "gifshow.com", "ksurl.cn", "chenzhongtech.com", "kuaishouzt.com", "kwai.net")):
        return "kuaishou"
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
    
    if platform == "kuaishou":
        raise NotImplementedError("快手作者订阅暂未接入：已能识别快手链接，但还缺少快手用户主页解析和作品列表抓取实现")

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
    # 默认命名规则为 "{platform}/{nickname}_{uid}"
    pattern = "{platform}/{nickname}_{uid}"
    
    # 2. 从数据库中拉取自定义命名规则
    if session:
        try:
            from db import get_config
            pattern = get_config(session, "folder_name_pattern", "{platform}/{nickname}_{uid}")
        except Exception:
            pass
    else:
        # 如果没有传入 session，尝试获取一个临时的 db session
        try:
            from db import SessionLocal, get_config
            with SessionLocal() as db_session:
                pattern = get_config(db_session, "folder_name_pattern", "{platform}/{nickname}_{uid}")
        except Exception:
            pass

    # 3. 替换支持的标签
    sanitized_nickname = sanitize_filename(nickname)
    clean_uid = uid[len(platform) + 1:] if uid.startswith(f"{platform}_") else uid
    folder_name = pattern.replace("{nickname}", sanitized_nickname)\
                         .replace("{uid}", clean_uid)\
                         .replace("{platform}", platform)
                         
    # 允许使用斜杠创建子目录，对每一级子目录单独进行合法性限制
    parts = [sanitize_filename(part) for part in folder_name.replace("\\", "/").split("/") if part]
    return os.path.join(*parts) if parts else "unknown"

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
        os.makedirs(os.path.dirname(new_folder_path), exist_ok=True)
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


def _extract_author_folder_from_path(local_path: str, save_dir: str) -> str | None:
    if not local_path:
        return None

    normalized_path = os.path.normpath(local_path)
    normalized_save_dir = os.path.normpath(save_dir)

    try:
        absolute_path = os.path.abspath(normalized_path)
        absolute_save_dir = os.path.abspath(normalized_save_dir)
        if os.path.commonpath([absolute_path, absolute_save_dir]) == absolute_save_dir:
            relative_path = os.path.relpath(absolute_path, absolute_save_dir)
        elif normalized_path.startswith(normalized_save_dir + os.sep):
            relative_path = normalized_path[len(normalized_save_dir + os.sep):]
        else:
            return None
    except ValueError:
        return None

    # relative_path 示例:
    #   旧格式: "张三_12345/videos/xxx.mp4"  -> 作者目录 = "张三_12345"
    #   新格式: "douyin/张三_12345/videos/xxx.mp4" -> 作者目录 = "douyin/张三_12345"
    # 策略: 找到第一个名为 "videos" 或 "notes" 的段，取其之前的所有段作为作者目录
    LEAF_DIRS = {"videos", "notes"}
    parts = relative_path.split(os.sep)
    for i, part in enumerate(parts):
        if part.lower() in LEAF_DIRS:
            author_parts = parts[:i]
            if author_parts:
                return os.path.join(*author_parts)
            return None

    # 没有找到 videos/notes（可能是较早的数据，路径就是文件本身或单层目录）
    # 退回到原来的行为：只取第一段
    first_segment = parts[0]
    return first_segment or None

def _find_author_folder(session, user, save_dir: str) -> str | None:
    from db import Aweme

    folders = Counter()
    awemes = session.query(Aweme).filter_by(uid=user.uid).all()
    for aweme in awemes:
        folder = _extract_author_folder_from_path(aweme.local_path, save_dir)
        if folder and os.path.isdir(os.path.join(save_dir, folder)):
            folders[folder] += 1

    if folders:
        return folders.most_common(1)[0][0]

    possible_suffixes = [f"_{user.uid}", f"-{user.uid}"]
    possible_prefixes = [f"{user.uid}_", f"{user.uid}-"]

    def _matches(name: str) -> bool:
        if name == user.uid:
            return True
        if any(name.endswith(s) for s in possible_suffixes):
            return True
        if any(name.startswith(p) for p in possible_prefixes):
            return True
        return False

    try:
        for entry in os.scandir(save_dir):
            if not entry.is_dir():
                continue
            # 直接匹配（旧格式 {nickname}_{uid}）
            if _matches(entry.name):
                return entry.name
            # 子目录匹配（新格式 {platform}/{nickname}_{uid}）
            try:
                for sub in os.scandir(entry.path):
                    if sub.is_dir() and _matches(sub.name):
                        return os.path.join(entry.name, sub.name)
            except Exception:
                pass
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.error(f"扫描目录 {save_dir} 寻找作者目录失败: {e}")

    return None



def build_folder_migration_plan(session, pattern: str | None = None) -> dict:
    """
    根据当前文件夹命名规则预览已有作者目录迁移计划。
    """
    from db import User, Aweme

    save_dir = config.SAVE_DIR or "videos"
    users = session.query(User).all()
    items = []

    for user in users:
        if not user.uid or not user.nickname:
            continue

        current_folder = _find_author_folder(session, user, save_dir)
        if pattern:
            sanitized_nickname = sanitize_filename(user.nickname)
            user_platform = user.platform or "douyin"
            clean_uid = user.uid[len(user_platform) + 1:] if user.uid.startswith(f"{user_platform}_") else user.uid
            target_folder = pattern.replace("{nickname}", sanitized_nickname)\
                                   .replace("{uid}", clean_uid)\
                                   .replace("{platform}", user_platform)
            parts = [sanitize_filename(part) for part in target_folder.replace("\\", "/").split("/") if part]
            target_folder = os.path.join(*parts) if parts else "unknown"
        else:
            target_folder = get_author_folder_name(user.nickname, user.uid, user.platform or "douyin", session)

        if not current_folder or current_folder == target_folder:
            continue

        current_path = os.path.join(save_dir, current_folder)
        target_path = os.path.join(save_dir, target_folder)
        aweme_count = session.query(Aweme).filter_by(uid=user.uid).count()
        conflict = os.path.exists(target_path)

        items.append({
            "uid": user.uid,
            "nickname": user.nickname,
            "platform": user.platform or "douyin",
            "from_folder": current_folder,
            "to_folder": target_folder,
            "from_path": current_path,
            "to_path": target_path,
            "aweme_count": aweme_count,
            "conflict": conflict,
            "reason": "目标目录已存在" if conflict else None,
        })

    return {
        "save_dir": save_dir,
        "total": len(items),
        "conflicts": sum(1 for item in items if item["conflict"]),
        "items": items,
    }


def run_folder_migration(session, task_id: str | None = None) -> dict:
    """
    执行已有作者目录迁移，并同步更新数据库 local_path。
    冲突项会被跳过，避免覆盖已有目录。
    """
    from db import Aweme, update_task_progress

    plan = build_folder_migration_plan(session)
    items = plan["items"]
    total = len(items)
    migrated = 0
    skipped = 0
    failed = 0

    if task_id:
        update_task_progress(session, task_id, 5, message=f"发现 {total} 个待迁移目录")

    if total == 0:
        if task_id:
            update_task_progress(session, task_id, 100, status="completed", message="没有需要迁移的目录")
        return {"migrated": 0, "skipped": 0, "failed": 0}

    for index, item in enumerate(items):
        progress = 5 + int((index / total) * 90)
        if task_id:
            update_task_progress(
                session,
                task_id,
                progress,
                message=f"正在迁移 {index + 1}/{total}: {item['from_folder']} -> {item['to_folder']}",
            )

        if item["conflict"]:
            logger.warning(f"跳过目录迁移，目标已存在: {item['to_path']}")
            skipped += 1
            continue

        try:
            os.makedirs(os.path.dirname(item["to_path"]), exist_ok=True)
            os.rename(item["from_path"], item["to_path"])
            awemes = session.query(Aweme).filter_by(uid=item["uid"]).all()
            old_prefix = os.path.normpath(item["from_path"])
            new_prefix = os.path.normpath(item["to_path"])
            updated_count = 0

            for aweme in awemes:
                if not aweme.local_path:
                    continue
                normalized_local_path = os.path.normpath(aweme.local_path)
                if normalized_local_path == old_prefix or normalized_local_path.startswith(old_prefix + os.sep):
                    suffix = normalized_local_path[len(old_prefix):].lstrip(os.sep)
                    aweme.local_path = os.path.join(new_prefix, suffix) if suffix else new_prefix
                    updated_count += 1

            session.commit()
            migrated += 1
            logger.info(f"目录迁移完成: {item['from_path']} -> {item['to_path']}，更新 {updated_count} 条路径")
        except Exception as e:
            session.rollback()
            failed += 1
            logger.error(f"目录迁移失败: {item['from_path']} -> {item['to_path']} | {e}")

    message = f"迁移完成: 成功 {migrated}，跳过 {skipped}，失败 {failed}"
    if task_id:
        update_task_progress(
            session,
            task_id,
            100,
            status="completed" if failed == 0 else "failed",
            message=message,
        )

    return {"migrated": migrated, "skipped": skipped, "failed": failed}
