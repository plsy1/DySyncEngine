from fastapi import APIRouter, Query, BackgroundTasks, Depends, HTTPException, status, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Any, Optional
from db import (
    get_session,
    add_aweme,
    get_undownloaded_awemes_by_uid,
    get_latest_create_time,
    add_or_update_user,
    get_all_users,
    toggle_user_auto_update,
    get_auto_update_users,
    create_task,
    update_task_progress,
    get_all_active_tasks,
    get_config,
    set_config,
    update_account_password,
    update_user_preference,
    delete_user_data,
    mark_all_tg_exported,
    User,
)
from fetch import fetch_all_awemes, fetch_user_profile, fetch_video_profile
from downloader import download_video, DOWNLOAD_API
from auth import create_access_token, verify_password, get_password_hash, get_current_user
from utils import extract_share_url, get_url_platform, resolve_redirect, extract_sec_user_id, sanitize_filename, run_coro_safe
from telegram_uploader import tg_uploader
import re
import httpx
import uuid
import io
import os
import unicodedata
from loguru import logger
import asyncio
from telethon.errors import SessionPasswordNeededError

router = APIRouter()


class DownloadResult(BaseModel):
    aweme_id: str
    desc: str
    filename: str
    downloaded: bool



def process_single_aweme_download(session: Session, aweme: Any) -> bool:
    """
    处理单个 Aweme 的下载逻辑，包括检查偏好设置和执行下载。
    """
    # 获取用户信息以检查偏好设置
    from db import User
    user = session.query(User).filter_by(uid=aweme.uid).first()
    global_download_video = get_config(session, "download_video", "true") == "true"
    global_download_note = get_config(session, "download_note", "true") == "true"

    should_download = True
    if aweme.aweme_type == 68: # 图文
        # 优先级：个人覆盖 > 全局设定
        override = user.download_note_override if user else None
        should_download = override if override is not None else global_download_note
    else: # 视频
        override = user.download_video_override if user else None
        should_download = override if override is not None else global_download_video

    if not should_download:
        logger.info(f"根据设置跳过下载: {aweme.aweme_id} (Type: {aweme.aweme_type})")
        return False

    filename = aweme.desc if aweme.desc else aweme.aweme_id
    type_folder = "notes" if aweme.aweme_type == 68 else "videos"
    from utils import get_author_folder_name
    author_folder_name = get_author_folder_name(aweme.nickname, aweme.uid, aweme.platform, session)
    author_folder = os.path.join(author_folder_name, type_folder)
    
    try:
        saved_path = download_video(
            aweme.share_url, author_folder, filename, aweme.aweme_id
        )
        if saved_path:
            aweme.downloaded = True
            aweme.local_path = saved_path
            logger.info(f"下载成功: {aweme.aweme_id} -> {saved_path}")
            session.commit()
            return True
        else:
            logger.error(f"下载失败: {aweme.aweme_id}")
            return False
    except Exception as e:
        logger.error(f"下载过程中遇到错误: {e}")
        return False


def sync_user_videos(session, sec_user_id: str, platform: str = "douyin", task_id: str = None, max_fetch: int = 0, force_full: bool = False):
    """
    同步指定用户的视频：拉取 Profile、增量抓取 Awemes、下载未下载的视频
    """
    if task_id:
        update_task_progress(session, task_id, 5, message="正在获取用户信息...")
        
    # 尝试从数据库获取已存在的 UID，以支持增量同步
    from db import User
    user = session.query(User).filter_by(sec_user_id=sec_user_id).first()
    uid = user.uid if user else None
        
    # 获取作者最新作品时间
    last_create_time = 0 if force_full else (get_latest_create_time(session, uid) if uid else 0)
    
    if task_id:
        update_task_progress(session, task_id, 20, message="正在抓取视频列表...")

    # 执行抓取
    result = fetch_all_awemes(sec_user_id, platform=platform, latest_create_time=last_create_time, count=20, max_fetch=max_fetch)
    new_data = result.get("awemes", [])
    author_info = result.get("author", {})

    # 如果抓取到了作者信息（特别是 TikTok），更新/初始化用户信息
    if author_info:
        uid = author_info.get("uid") or uid
        add_or_update_user(session, {
            "uid": uid,
            "sec_user_id": sec_user_id,
            "nickname": author_info.get("nickname"),
            "avatar_url": author_info.get("avatar_thumb", {}).get("url_list", [None])[0] if isinstance(author_info.get("avatar_thumb"), dict) else author_info.get("avatar_thumb"),
            "signature": author_info.get("signature"),
            "platform": platform
        })

    if not uid:
        if task_id:
            update_task_progress(session, task_id, 100, status="failed", message="无法获取 UID")
        logger.error(f"无法获取 UID: {sec_user_id}")
        return

    if task_id:
        # 更新 target_id 为 uid 以便前端展示
        update_task_progress(session, task_id, 30, message="正在处理抓取结果...", target_id=uid)

    # 为每条作品打上平台标记并保存
    for item in new_data:
        item["platform"] = platform
        add_aweme(session, item)

    # 获取未下载作品
    undownloaded_awemes = get_undownloaded_awemes_by_uid(session, uid)
    total_new = len(undownloaded_awemes)

    if total_new == 0:
        if task_id:
            update_task_progress(session, task_id, 100, status="completed", message="已是最新，无需下载")
        return

    logger.info(f"开始同步用户 {uid}，发现 {total_new} 个新作品")
    
    for i, aweme in enumerate(undownloaded_awemes):
        msg = f"正在下载第 {i+1}/{total_new}: {aweme.desc[:20] if aweme.desc else aweme.aweme_id}"
        logger.info(msg)
        
        progress = 30 + int((i / total_new) * 60)
        if task_id:
            update_task_progress(session, task_id, progress, message=msg)
            
        process_single_aweme_download(session, aweme)

    # --- Telegram Auto Upload ---
    user = session.query(User).filter_by(uid=uid).first()
    if not user:
        if task_id:
            update_task_progress(session, task_id, 100, status="completed", message="同步完成")
        return

    # 优先级：个人覆盖 > 全局设定
    global_tg_enabled = get_config(session, "tg_auto_upload", "false") == "true"
    global_tg_chat = get_config(session, "tg_target_chat")
    
    tg_enabled = user.tg_sync_enabled if user.tg_sync_enabled is not None else global_tg_enabled
    tg_chat = user.tg_target_chat if user.tg_target_chat else global_tg_chat
    if tg_enabled and tg_chat:
        # 异步启动同步到 TG，不阻塞同步流程，并传递 task_id 以接管进度显示
        run_coro_safe(tg_uploader.sync_user_content(tg_chat, uid, task_id=task_id))
    else:
        if task_id:
            update_task_progress(session, task_id, 100, status="completed", message="同步完成")


def download_user_videos_task(sec_user_id: str, platform: str, task_id: str, max_fetch: int = 0):
    """
    后台抓取用户视频任务
    """
    try:
        with next(get_session()) as session:
            sync_user_videos(session, sec_user_id, platform=platform, task_id=task_id, max_fetch=max_fetch)
    except Exception as e:
        with next(get_session()) as session:
            update_task_progress(session, task_id, 100, status="failed", message=str(e))


def download_undownloaded_task(task_id: str):
    """
    检查数据库中未标记为下载的内容并尝试下载
    """
    try:
        from db import get_undownloaded_awemes
        with next(get_session()) as session:
            update_task_progress(session, task_id, 10, message="正在查询未下载作品...")
            undownloaded_awemes = get_undownloaded_awemes(session)
            total = len(undownloaded_awemes)
            
            if total == 0:
                update_task_progress(session, task_id, 100, status="completed", message="没有未下载的作品")
                return

            logger.info(f"开启全局补漏下载，发现 {total} 个作品")
            for i, aweme in enumerate(undownloaded_awemes):
                msg = f"正在补漏下载 {i+1}/{total}: {aweme.desc[:20] if aweme.desc else aweme.aweme_id}"
                progress = 10 + int((i / total) * 90)
                update_task_progress(session, task_id, progress, message=msg)
                
                process_single_aweme_download(session, aweme)
            
            update_task_progress(session, task_id, 100, status="completed", message=f"补漏完成，共处理 {total} 个作品")
    except Exception as e:
        logger.error(f"补漏任务失败: {e}")
        with next(get_session()) as session:
            update_task_progress(session, task_id, 100, status="failed", message=str(e))


@router.post("/tasks/check_undownloaded")
def check_undownloaded_api(background_tasks: BackgroundTasks):
    """
    触发后台任务：检查并下载数据库中所有未下载的作品
    """
    task_id = str(uuid.uuid4())
    with next(get_session()) as session:
        create_task(session, task_id, target_id="global_check")
    
    background_tasks.add_task(download_undownloaded_task, task_id)
    return {"started": True, "task_id": task_id}


@router.post("/download_user_videos")
def download_user_videos_api(
    url: str = Query(..., description="抖音用户主页URL"),
    max_fetch: int = Query(0, description="最大抓取作品数，0表示不限制"),
    background_tasks: BackgroundTasks = None,
) -> dict[str, Any]:
    """
    触发后台下载用户所有视频（通过 URL）
    """
    task_id = str(uuid.uuid4())
    
    # 如果用户没传，先看全局设置
    if max_fetch <= 0:
        with next(get_session()) as session:
            max_fetch = int(get_config(session, "max_initial_fetch", "0"))
    
    # 为了让前端立即看到卡片，我们在同步请求里先完成基础信息的解析和 User 记录创建
    try:
        url = extract_share_url(url)
        final_url = resolve_redirect(url)
        platform = get_url_platform(final_url)
        sec_user_id = extract_sec_user_id(final_url)
        
        # 尝试抓取基本资料
        profile = fetch_user_profile(sec_user_id, platform=platform)
        author_info = profile.get("user", {})
        
        uid = author_info.get("uid") or sec_user_id
        
        with next(get_session()) as session:
            # 创建用户记录
            add_or_update_user(session, {
                "uid": uid,
                "sec_user_id": sec_user_id,
                "nickname": author_info.get("nickname"),
                "avatar_url": author_info.get("avatar_thumb", {}).get("url_list", [None])[0] if isinstance(author_info.get("avatar_thumb"), dict) else author_info.get("avatar_thumb"),
                "signature": author_info.get("signature"),
                "platform": platform
            })
            # 创建任务记录
            create_task(session, task_id, target_id=uid)
            
        background_tasks.add_task(download_user_videos_task, sec_user_id, platform, task_id, max_fetch)
        return {"started": True, "task_id": task_id}
        
    except Exception as e:
        logger.error(f"即时解析用户失败: {e}")
        # 如果解析失败，可能是网络问题，直接返回错误，不开启后台任务
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/refresh_user_videos")
def refresh_user_videos_api(
    sec_user_id: str = Query(..., description="用户的 sec_user_id"),
    max_fetch: int = Query(0, description="本次抓取的最大数量"),
    force_full: bool = Query(False, description="是否忽略增量时间检查（全量/回溯同步）"),
    background_tasks: BackgroundTasks = None,
) -> dict[str, Any]:
    """
    通过 sec_user_id 触发后台增量同步用户视频
    """
    task_id = str(uuid.uuid4())
    
    def task_wrapper(sec_user_id: str, platform: str, task_id: str, max_fetch: int, force_full: bool):
        with next(get_session()) as session:
            sync_user_videos(session, sec_user_id, platform=platform, task_id=task_id, max_fetch=max_fetch, force_full=force_full)

    with next(get_session()) as session:
        # 检查是否已有该用户的任务正在运行
        from db import Task as DbTask
        # 获取 uid (从 db 查，如果查不到就用 sec_user_id 占位)
        user = session.query(User).filter_by(sec_user_id=sec_user_id).first()
        target_id = user.uid if user else sec_user_id
        
        existing = session.query(DbTask).filter_by(target_id=target_id, status="running").first()
        if existing:
            return {"started": True, "task_id": existing.id, "message": "任务已在运行中"}

        platform = user.platform if user else "douyin"
        create_task(session, task_id, target_id=target_id)

    background_tasks.add_task(task_wrapper, sec_user_id, platform, task_id, max_fetch, force_full)
    return {"started": True, "task_id": task_id}


@router.post("/toggle_auto_update")
def toggle_auto_update_api(
    uid: str = Query(..., description="用户的 uid"),
    enabled: bool = Query(..., description="是否开启自动更新")
) -> dict[str, Any]:
    """
    开启或关闭指定用户的自动更新
    """
    with next(get_session()) as session:
        success = toggle_user_auto_update(session, uid, enabled)
        return {"success": success}


@router.delete("/delete_user")
def delete_user_api(
    uid: str = Query(..., description="用户的 uid")
) -> dict[str, Any]:
    """
    删除指定用户及其所有视频记录
    """
    with next(get_session()) as session:
        success = delete_user_data(session, uid)
        return {"success": success}


class TaskInfo(BaseModel):
    id: str
    target_id: str
    status: str
    progress: int
    message: str | None
    updated_at: int


@router.get("/tasks/active", response_model=list[TaskInfo])
def get_active_tasks_api():
    """
    获取所有正在运行的任务
    """
    with next(get_session()) as session:
        return get_all_active_tasks(session)


class UserInfo(BaseModel):
    uid: str
    sec_user_id: str | None
    nickname: str | None
    avatar_url: str | None
    signature: str | None
    auto_update: bool
    download_video_override: bool | None
    download_note_override: bool | None
    tg_sync_enabled: bool | None
    tg_target_chat: str | None
    updated_at: int
    platform: str = "douyin"


@router.get("/users", response_model=list[UserInfo])
def get_users_api():
    """
    获取所有已存储的用户列表
    """
    with next(get_session()) as session:
        return get_all_users(session)



class ShareDownloadResult(BaseModel):
    filename: str
    downloaded: bool


class VideoParseInfo(BaseModel):
    aweme_id: str
    aweme_type: int
    desc: str | None
    video_url: str | None
    cover_url: str | None
    author_name: str | None
    author_avatar: str | None
    platform: str = "douyin"
    create_time: int = 0


@router.post("/parse_video", response_model=VideoParseInfo)
def parse_video_api(share_url: str = Query(..., description="分享链接")):
    """
    解析单个视频信息，返回直链及元数据
    """
    share_url = extract_share_url(share_url)
    share_url = resolve_redirect(share_url)
    platform = get_url_platform(share_url)
    video_data = fetch_video_profile(share_url, minimal=False)
    
    author = video_data.get("author", {})
    video = video_data.get("video", {})
    
    
    return VideoParseInfo(
        aweme_id=video_data.get("aweme_id", ""),
        aweme_type=video_data.get("aweme_type", 0),
        desc=video_data.get("desc"),
        video_url=video.get("play_addr", {}).get("url_list", [None])[0],
        cover_url=video.get("origin_cover", {}).get("url_list", [None])[0],
        author_name=author.get("nickname"),
        author_avatar=author.get("avatar_thumb", {}).get("url_list", [None])[0],
        platform=platform,
        create_time=video_data.get("create_time", 0)
    )


@router.get("/download_proxy")
async def download_proxy_api(share_url: str = Query(..., description="抖音分享链接"), filename: str = Query("video", description="保存的文件名")):
    """
    代理下载：通过服务器请求 DOWNLOAD_API 并直接流式返回给客户端，实现浏览器本地下载
    """
    share_url = extract_share_url(share_url)
    share_url = resolve_redirect(share_url)
    
    params = {
        "url": share_url,
        "prefix": "false",
        "with_watermark": "false"
    }
    
    from urllib.parse import quote
    
    # 鉴于我们需要提前知道 Content-Type 以设置正确的扩展名
    # 我们先发起请求
    async with httpx.AsyncClient(timeout=60) as client:
        # 使用 GET 对应 Downloader 的逻辑
        resp = await client.get(DOWNLOAD_API, params=params)
        resp.raise_for_status()
    
    content_type = resp.headers.get("content-type", "video/mp4")
    disposition = resp.headers.get("content-disposition", "")
    
    # 决定扩展名
    ext = ".mp4"
    if "application/zip" in content_type or ".zip" in disposition.lower():
        ext = ".zip"
        
    # 清理文件名防止 header 报错
    clean_filename = sanitize_filename(filename)
    encoded_filename = quote(clean_filename)
    
    return StreamingResponse(
        io.BytesIO(resp.content),
        media_type=content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}{ext}"}
    )


@router.post("/download_share_url", response_model=ShareDownloadResult)
def download_from_share_url(share_url: str = Query(..., description="抖音分享链接")):
    """
    直接下载单个抖音分享链接视频，并同步存储用户信息与视频记录到数据库
    """

    share_url = extract_share_url(share_url)
    share_url = resolve_redirect(share_url)
    platform = get_url_platform(share_url)
    video_data = fetch_video_profile(share_url, minimal=False)

    aweme_id = video_data.get("aweme_id")
    aweme_type = video_data.get("aweme_type", 0)
    desc = video_data.get("desc", "") or ""
    filename = desc if desc else aweme_id

    author_info = video_data.get("author", {})
    nickname = author_info.get("nickname")
    uid = author_info.get("uid")
    sec_user_id = author_info.get("sec_uid")

    # 1. 抓取/补充完整 Profile 以确保数据库信息的完整性
    if sec_user_id:
        try:
            profile = fetch_user_profile(sec_user_id, platform=platform)
            full_user_info = profile.get("user", {})
            if full_user_info:
                author_info.update(full_user_info)
        except Exception as e:
            logger.error(f"Enrichment author info failed: {e}")

    final_nickname = author_info.get("nickname", nickname)
    
    # 2. 同步到数据库
    with next(get_session()) as session:
        # 存储/更新用户
        add_or_update_user(session, {
            "uid": uid,
            "sec_user_id": sec_user_id,
            "nickname": final_nickname,
            "avatar_url": author_info.get("avatar_thumb", {}).get("url_list", [None])[0] if isinstance(author_info.get("avatar_thumb"), dict) else author_info.get("avatar_thumb"),
            "signature": author_info.get("signature"),
            "platform": platform
        })
        
        # 存储/更新 Aweme 记录
        add_aweme(session, {
            "aweme_id": aweme_id,
            "desc": desc,
            "share_url": share_url,
            "nickname": final_nickname,
            "uid": uid,
            "create_time": video_data.get("create_time", 0),
            "aweme_type": aweme_type,
            "platform": platform
        })
        
        # 3. 执行下载
        type_folder = "notes" if aweme_type == 68 else "videos"
        from utils import get_author_folder_name
        author_folder_name = get_author_folder_name(final_nickname, uid, platform, session)
        author_folder = os.path.join(author_folder_name, type_folder)
        saved_path = download_video(share_url, author_folder, filename, aweme_id)
        
        if saved_path:
            # 更新下载状态 and 路径
            from db import Aweme
            aweme = session.query(Aweme).filter_by(aweme_id=aweme_id).first()
            if aweme:
                aweme.downloaded = True
                aweme.local_path = saved_path
                session.commit()
            return ShareDownloadResult(filename=filename, downloaded=True)

    return ShareDownloadResult(filename=filename, downloaded=bool(saved_path))


# ----------------------------
# 鉴权与配置 API
# ----------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str

class GlobalSettings(BaseModel):
    download_video: bool
    download_note: bool
    auto_update_interval: int
    max_initial_fetch: int = 0
    emby_server_url: str | None = None
    emby_api_key: str | None = None
    emby_default_library: str | None = None
    folder_name_pattern: str | None = None

class FolderMigrationItem(BaseModel):
    uid: str
    nickname: str
    platform: str
    from_folder: str
    to_folder: str
    from_path: str
    to_path: str
    aweme_count: int
    conflict: bool
    reason: str | None = None

class FolderMigrationPreview(BaseModel):
    save_dir: str
    total: int
    conflicts: int
    items: list[FolderMigrationItem]

class VideoLookupRequest(BaseModel):
    paths: list[str]

class UserPreferenceRequest(BaseModel):
    uid: str
    video_pref: bool | None = None
    note_pref: bool | None = None
    tg_sync_pref: bool | None = None
    tg_chat_pref: str | None = None

@router.post("/login")
def login(req: LoginRequest, session: Session = Depends(get_session)):
    from db import get_account
    account = get_account(session, req.username)
    if not account or not verify_password(req.password, account.password_hash):
        throw_auth_error()
    
    from auth import ACCESS_TOKEN_EXPIRE_MINUTES, create_access_token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": account.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/login/status")
def login_status(current_user: Any = Depends(get_current_user)):
    return {"logged_in": True, "username": current_user.username}

@router.get("/settings", response_model=GlobalSettings)
def get_settings_api(session: Session = Depends(get_session), _ = Depends(get_current_user)):
    return GlobalSettings(
        download_video=get_config(session, "download_video", "true") == "true",
        download_note=get_config(session, "download_note", "true") == "true",
        auto_update_interval=int(get_config(session, "auto_update_interval", "120")),
        max_initial_fetch=int(get_config(session, "max_initial_fetch", "0")),
        emby_server_url=get_config(session, "emby_server_url", ""),
        emby_api_key=get_config(session, "emby_api_key", ""),
        emby_default_library=get_config(session, "emby_default_library", ""),
        folder_name_pattern=get_config(session, "folder_name_pattern", "{nickname}_{uid}")
    )

@router.post("/settings")
def update_settings_api(req: GlobalSettings, session: Session = Depends(get_session), _ = Depends(get_current_user)):
    set_config(session, "download_video", "true" if req.download_video else "false")
    set_config(session, "download_note", "true" if req.download_note else "false")
    set_config(session, "auto_update_interval", str(req.auto_update_interval))
    set_config(session, "max_initial_fetch", str(req.max_initial_fetch))
    if req.emby_server_url is not None:
        set_config(session, "emby_server_url", req.emby_server_url)
    if req.emby_api_key is not None:
        set_config(session, "emby_api_key", req.emby_api_key)
    if req.emby_default_library is not None:
        set_config(session, "emby_default_library", req.emby_default_library)
    if req.folder_name_pattern is not None:
        set_config(session, "folder_name_pattern", req.folder_name_pattern.strip())
    return {"success": True}

@router.get("/settings/folder-migration/preview", response_model=FolderMigrationPreview)
def preview_folder_migration(pattern: str | None = Query(None), session: Session = Depends(get_session), _ = Depends(get_current_user)):
    from utils import build_folder_migration_plan
    return build_folder_migration_plan(session, pattern=pattern.strip() if pattern else None)

def folder_migration_task(task_id: str):
    try:
        with next(get_session()) as session:
            from utils import run_folder_migration
            run_folder_migration(session, task_id=task_id)
    except Exception as e:
        with next(get_session()) as session:
            update_task_progress(session, task_id, 100, status="failed", message=f"目录迁移失败: {e}")

@router.post("/settings/folder-migration/run")
def start_folder_migration(background_tasks: BackgroundTasks, session: Session = Depends(get_session), _ = Depends(get_current_user)):
    task_id = str(uuid.uuid4())
    create_task(session, task_id, "folder_migration")
    background_tasks.add_task(folder_migration_task, task_id)
    return {"started": True, "task_id": task_id}

@router.post("/change_password")
def change_password_api(req: PasswordChangeRequest, session: Session = Depends(get_session), current_user: Any = Depends(get_current_user)):
    if not verify_password(req.old_password, current_user.password_hash):
        throw_auth_error("旧密码错误")
    
    new_hash = get_password_hash(req.new_password)
    update_account_password(session, current_user.username, new_hash)
    return {"success": True}

@router.post("/user/preference")
def update_user_pref_api(req: UserPreferenceRequest, session: Session = Depends(get_session), _ = Depends(get_current_user)):
    update_data = req.model_dump(exclude_unset=True)
    uid = update_data.pop("uid")
    success = update_user_preference(session, uid, **update_data)
    return {"success": success}

@router.post("/videos/lookup")
def lookup_videos_by_path(req: VideoLookupRequest, session: Session = Depends(get_session)):
    from db import Aweme
    import unicodedata

    def normalize_p(p: str):
        if not p: return ""
        return unicodedata.normalize('NFC', p).lower().replace("\\", "/")

    # 1. 第一轮扫描：搜集路径信息并尝试从文件名提取 ID
    mapping = {}
    remaining_paths = []
    extracted_ids = []
    
    for p in req.paths:
        norm_p = normalize_p(p)
        filename = norm_p.split("/")[-1]
        
        # Try to extract ID from the full path: ".../Folder [7123451234123123]/1.jpg"
        id_match = re.search(r'\[(\d+)\]', norm_p)
        if id_match:
            aweme_id = id_match.group(1)
            remaining_paths.append({"original": p, "norm": norm_p, "aweme_id": aweme_id, "filename": filename})
            extracted_ids.append(aweme_id)
        else:
            remaining_paths.append({"original": p, "norm": norm_p, "aweme_id": None, "filename": filename})

    # 2. 如果存在 ID，直接通过 ID 批量查询数据库（这是最精准的）
    if extracted_ids:
        # 连表查询 User 以获取 sec_user_id (用于跳转主页)
        from db import User
        id_results = session.query(Aweme, User).join(User, Aweme.uid == User.uid).filter(Aweme.aweme_id.in_(extracted_ids)).all()
        
        # id_results 是 (Aweme, User) 元组列表
        for aweme, user in id_results:
            mapping[aweme.aweme_id] = {
                "nickname": aweme.nickname,
                "desc": aweme.desc,
                "aweme_id": aweme.aweme_id,
                "uid": aweme.uid,
                "sec_user_id": user.sec_user_id,
                "avatar_url": user.avatar_url,
                "platform": aweme.platform,
                "share_url": aweme.share_url,
                "create_time": aweme.create_time
            }
        
        # 填充结果并移除已匹配的路径
        still_remaining = []
        for item in remaining_paths:
            if item["aweme_id"] and item["aweme_id"] in mapping:
                data = mapping[item["aweme_id"]]
                mapping[item["original"]] = data
            else:
                still_remaining.append(item)
        remaining_paths = still_remaining

    # 3. 回退逻辑：针对没有 ID 的老文件，使用原有的模糊匹配
    if remaining_paths:
        from db import User
        # 获取 UID 集合搜寻范围
        uids = set()
        for item in remaining_paths:
            uid_match = re.search(r'_(\d+)/', item["norm"])
            if uid_match: uids.add(uid_match.group(1))

        if uids:
            potential_matches = session.query(Aweme, User).join(User, Aweme.uid == User.uid).filter(Aweme.uid.in_(list(uids)), Aweme.downloaded == True).all()
        else:
            potential_matches = session.query(Aweme, User).join(User, Aweme.uid == User.uid).filter(Aweme.downloaded == True).order_by(Aweme.id.desc()).limit(2000).all()

        for info in remaining_paths:
            for aweme, user in potential_matches:
                if not aweme.local_path: continue
                l_path = normalize_p(aweme.local_path)
                l_filename = l_path.split("/")[-1]
                
                # Check filename OR if the parent directory matches (common for photos)
                matched = False
                if info["filename"] == l_filename:
                    matched = True
                else:
                    # For notes, local_path might be the folder. Check if info["norm"] contains it.
                    if l_path in info["norm"]:
                        matched = True

                if matched:
                    mapping[info["original"]] = {
                        "nickname": aweme.nickname,
                        "desc": aweme.desc,
                        "aweme_id": aweme.aweme_id,
                        "uid": aweme.uid,
                        "sec_user_id": user.sec_user_id,
                        "avatar_url": user.avatar_url,
                        "platform": aweme.platform,
                        "share_url": aweme.share_url,
                        "create_time": aweme.create_time
                    }
                    break
                    
    return mapping


@router.get("/scheduler/status")
def get_scheduler_status():
    """
    获取后台调度器的运行状态
    """
    from scheduler import scheduler_manager
    return scheduler_manager.get_status()


@router.post("/scheduler/run_now")
def run_scheduler_now():
    """
    立即触发一次后台自动更新
    """
    from scheduler import scheduler_manager
    scheduler_manager.trigger_now()
    return {"success": True}


@router.get("/logs")
def get_logs_api(lines: int = Query(1000, description="读取日志的行数")):
    """
    读取后端日志文件内容
    """
    log_path = os.path.join(os.path.dirname(__file__), "data", "app.log")
    if not os.path.exists(log_path):
        return {"logs": ["日志文件尚未生成"]}
    
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            all_lines = f.readlines()
            return {"logs": all_lines[-lines:] if len(all_lines) > lines else all_lines}
    except Exception as e:
        return {"logs": [f"读取日志失败: {str(e)}"]}


# ----------------------------
# Cookie 管理 API
# ----------------------------

# config 文件路径
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
CONFIG_BASE = os.getenv("CONFIG_BASE", os.path.join(PROJECT_ROOT, "config"))
COOKIE_CONFIG_PATHS = {
    "douyin": os.getenv(
        "DOUYIN_WEB_CONFIG_PATH",
        os.path.join(CONFIG_BASE, "douyin_web", "config.yaml"),
    ),
    "tiktok": os.getenv(
        "TIKTOK_WEB_CONFIG_PATH",
        os.path.join(CONFIG_BASE, "tiktok_web", "config.yaml"),
    ),
}
RUNTIME_COOKIE_CONFIG_PATHS = {
    "douyin": os.getenv(
        "DOUYIN_WEB_RUNTIME_CONFIG_PATH",
        os.path.join(PROJECT_ROOT, "3rd", "douyin_api", "crawlers", "douyin", "web", "config.yaml"),
    ),
    "tiktok": os.getenv(
        "TIKTOK_WEB_RUNTIME_CONFIG_PATH",
        os.path.join(PROJECT_ROOT, "3rd", "douyin_api", "crawlers", "tiktok", "web", "config.yaml"),
    ),
}

def _read_cookie_from_yaml(platform: str) -> str:
    """从 config.yaml 中提取 Cookie 字段值"""
    path = COOKIE_CONFIG_PATHS.get(platform)
    if not path or not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        import re
        # 匹配 "      Cookie: <value>" 这一行（允许前置空格）
        m = re.search(r"^\s+Cookie:\s*(.+)$", content, re.MULTILINE)
        return m.group(1).strip() if m else ""
    except Exception as e:
        logger.error(f"读取 {platform} Cookie 失败: {e}")
        return ""

def _write_cookie_to_yaml(platform: str, cookie: str) -> bool:
    """用正则替换 config.yaml 中的 Cookie 字段，避免破坏其他内容"""
    path = COOKIE_CONFIG_PATHS.get(platform)
    if not path:
        return False
    try:
        # 如果文件不存在（新用户且 entrypoint 尚未运行），先确保目录存在
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            return False
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        import re
        # 替换 Cookie 行，保留原有缩进格式
        new_content, n = re.subn(
            r"^(\s+Cookie:\s*)(.+)$",
            lambda m: m.group(1) + cookie,
            content,
            flags=re.MULTILINE
        )
        if n == 0:
            logger.warning(f"未找到 {platform} config.yaml 中的 Cookie 字段")
            return False
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        runtime_path = RUNTIME_COOKIE_CONFIG_PATHS.get(platform)
        if runtime_path and runtime_path != path:
            with open(runtime_path, "w", encoding="utf-8") as f:
                f.write(new_content)
        return True
    except Exception as e:
        logger.error(f"写入 {platform} Cookie 失败: {e}")
        return False

async def _check_cookie_validity(platform: str) -> str:
    """
    检测 Cookie 有效性：
    - "valid"    Cookie 有效
    - "invalid"  Cookie 失效或请求失败
    - "empty"    Cookie 未配置
    """
    cookie = _read_cookie_from_yaml(platform)
    if not cookie:
        return "empty"
    try:
        if platform == "douyin":
            # 优先从数据库中获取已存在用户的 sec_user_id，如果没有则使用已知有效的 Lucy🐑 用户
            test_sec_user_id = "MS4wLjABAAAAbxl_HCzauLCqtyV_ny7VET-q8WXMBJ4lHaPIP58AeIIQHmVyLXzVa1RnHOg0NbBV"
            try:
                from db import SessionLocal, User
                with SessionLocal() as db_session:
                    db_users = db_session.query(User).all()
                    if db_users:
                        test_sec_user_id = db_users[0].sec_user_id
            except Exception as db_err:
                logger.warning(f"获取测试 sec_user_id 失败，使用 fallback: {db_err}")

            from crawlers.douyin.web.web_crawler import DouyinWebCrawler
            crawler = DouyinWebCrawler()
            data = await crawler.handler_user_profile(test_sec_user_id)
            
            # 直接调用 crawler 得到的返回结果是 dict
            status_code = data.get("status_code", -1)
            # status_code 0 表示正常；2 表示 UserId 不合法（但能走到这一步说明 Cookie 本身是有效的，签名生成也成功了）
            if status_code not in (0, 2):
                return "invalid"
        else:
            from crawlers.tiktok.web.web_crawler import TikTokWebCrawler
            crawler = TikTokWebCrawler()
            data = await crawler.fetch_user_post(
                secUid="MS4wLjABAAAAv7iSs7LeDe9rtyFi5ArbNhTLSoqgM1wXXFqWPFMECB5Glf8sXRPB1WF8ViDzRqxp",
                cursor=0,
                count=1,
                coverFormat=2
            )
            # 直接调用 crawler 得到的返回结果包含 statusCode 和 status_code
            status_code = data.get("statusCode", data.get("status_code", 0))
            if status_code != 0:
                return "invalid"
        return "valid"
    except Exception as e:
        logger.warning(f"检测 {platform} Cookie 有效性时出错: {e}")
        return "invalid"


class CookieStatusResponse(BaseModel):
    douyin_status: str   # "valid" | "invalid" | "empty"
    tiktok_status: str
    douyin_cookie_preview: str  # 前20字符预览，确认是否已填写
    tiktok_cookie_preview: str

class UpdateCookieRequest(BaseModel):
    platform: str  # "douyin" | "tiktok"
    cookie: str


@router.get("/cookies/status", response_model=CookieStatusResponse)
async def get_cookies_status(_ = Depends(get_current_user)):
    """
    获取各平台 Cookie 的有效性状态
    """
    douyin_cookie = _read_cookie_from_yaml("douyin")
    tiktok_cookie = _read_cookie_from_yaml("tiktok")
    
    douyin_status = await _check_cookie_validity("douyin")
    tiktok_status = await _check_cookie_validity("tiktok")
    
    return CookieStatusResponse(
        douyin_status=douyin_status,
        tiktok_status=tiktok_status,
        douyin_cookie_preview=douyin_cookie[:30] + "..." if len(douyin_cookie) > 30 else douyin_cookie,
        tiktok_cookie_preview=tiktok_cookie[:30] + "..." if len(tiktok_cookie) > 30 else tiktok_cookie,
    )


@router.post("/cookies")
def update_cookie(req: UpdateCookieRequest, _ = Depends(get_current_user)):
    """
    更新指定平台的 Cookie（写入对应 config.yaml）
    """
    if req.platform not in ("douyin", "tiktok"):
        raise HTTPException(status_code=400, detail="platform 必须为 douyin 或 tiktok")
    success = _write_cookie_to_yaml(req.platform, req.cookie.strip())
    if not success:
        raise HTTPException(status_code=500, detail=f"写入 {req.platform} config.yaml 失败，请检查文件是否存在")
    logger.info(f"已更新 {req.platform} Cookie")
    return {"success": True}


# ----------------------------
# Telegram 认证与配置 API
# ----------------------------

@router.post("/tg/setup")
async def tg_setup(api_id: int = Form(...), api_hash: str = Form(...), phone: str = Form(...), session: Session = Depends(get_session)):
    set_config(session, "tg_api_id", str(api_id))
    set_config(session, "tg_api_hash", api_hash)
    set_config(session, "tg_phone", phone)
    
    client = await tg_uploader.get_client()
    if not client:
        raise HTTPException(status_code=500, detail="Failed to initialize TG client")
        
    if not await client.is_user_authorized():
        await client.send_code_request(phone)
        return {"status": "needs_code"}
    
    return {"status": "authorized"}

@router.post("/tg/verify")
async def tg_verify(code: str = Form(...), password: Optional[str] = Form(None), session: Session = Depends(get_session)):
    client = await tg_uploader.get_client()
    if not client:
        raise HTTPException(status_code=500, detail="TG client not initialized")
    
    phone = get_config(session, "tg_phone")
    try:
        try:
            await client.sign_in(phone, code)
        except SessionPasswordNeededError:
            if not password:
                return {"status": "error", "message": "Password required"}
            await client.sign_in(password=password)
        return {"status": "authorized"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/tg/status")
async def get_tg_status(session: Session = Depends(get_session)):
    client = await tg_uploader.get_client()
    is_auth = False
    if client:
        is_auth = await client.is_user_authorized()
    
    return {
        "is_authorized": is_auth,
        "api_id": get_config(session, "tg_api_id"),
        "target_chat": get_config(session, "tg_target_chat"),
        "auto_upload": get_config(session, "tg_auto_upload", "false") == "true"
    }

@router.get("/tg/chats")
async def get_tg_chats():
    client = await tg_uploader.get_client()
    if not client or not await client.is_user_authorized():
        return {"status": "unauthorized"}
    
    chats = []
    chats.append({"id": "me", "name": "⭐ Saved Messages (收藏夹)", "type": "user"})
    
    async for dialog in client.iter_dialogs(limit=100):
        entity = dialog.entity
        type_str = "user"
        if dialog.is_channel: type_str = "channel"
        elif dialog.is_group: type_str = "group"
        
        display_name = dialog.name
        if getattr(entity, 'bot', False):
            display_name = f"🤖 {display_name}"
            type_str = "bot"
            
        username = getattr(entity, 'username', '')
        if username:
            display_name = f"{display_name} (@{username})"

        chats.append({
            "id": dialog.id,
            "name": display_name,
            "type": type_str
        })
    return {"chats": chats}

@router.post("/tg/sync_user")
async def tg_sync_user_api(uid: str = Query(..., description="用户的 uid"), background_tasks: BackgroundTasks = None, session: Session = Depends(get_session)):
    user = session.query(User).filter_by(uid=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    global_tg_chat = get_config(session, "tg_target_chat")
    tg_chat = user.tg_target_chat if user.tg_target_chat else global_tg_chat
    
    if not tg_chat:
        raise HTTPException(status_code=400, detail="TG target chat not configured")
        
    from db import Task as DbTask
    existing = session.query(DbTask).filter_by(target_id=uid, status="running").first()
    if existing:
        return {"started": True, "task_id": existing.id, "message": "任务已在运行中"}
        
    task_id = str(uuid.uuid4())
    create_task(session, task_id, target_id=uid)
    
    run_coro_safe(tg_uploader.sync_user_content(tg_chat, uid, task_id=task_id))
    return {"started": True, "task_id": task_id}

@router.post("/tg/mark_all_exported")
def mark_all_tg_exported_api(uid: str = Query(..., description="用户的 uid"), session: Session = Depends(get_session), _ = Depends(get_current_user)):
    """
    一键将指定用户的所有作品标记为已上传到 Telegram
    """
    success = mark_all_tg_exported(session, uid)
    return {"success": success}

@router.post("/tg/sync_all")
async def tg_sync_all_api(session: Session = Depends(get_session)):
    task_id = str(uuid.uuid4())
    create_task(session, task_id, target_id="tg_global_audit")
    
    run_coro_safe(tg_uploader.sync_all_tg_content(task_id=task_id))
    return {"started": True, "task_id": task_id}

@router.post("/tg/settings")
async def update_tg_settings(target_chat: str = Form(...), auto_upload: bool = Form(...), session: Session = Depends(get_session)):
    set_config(session, "tg_target_chat", target_chat)
    set_config(session, "tg_auto_upload", "true" if auto_upload else "false")
    return {"status": "success"}

def throw_auth_error(detail="用户名或密码错误"):
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )
