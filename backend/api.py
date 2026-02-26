from fastapi import APIRouter, Query, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Any
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
    User,
)
from fetch import fetch_all_awemes, fetch_user_profile, fetch_video_profile
from downloader import download_video, DOWNLOAD_API
from auth import create_access_token, verify_password, get_password_hash, get_current_user
from utils import extract_share_url, get_url_platform, resolve_redirect, extract_sec_user_id, sanitize_filename
import re
import httpx
import uuid
import io
import os
from loguru import logger

router = APIRouter()


class DownloadResult(BaseModel):
    aweme_id: str
    desc: str
    filename: str
    downloaded: bool



def sync_user_videos(session, sec_user_id: str, platform: str = "douyin", task_id: str = None):
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
    last_create_time = get_latest_create_time(session, uid) if uid else 0
    
    if task_id:
        update_task_progress(session, task_id, 20, message="正在抓取视频列表...")

    # 执行抓取
    result = fetch_all_awemes(sec_user_id, platform=platform, latest_create_time=last_create_time, count=20)
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

    # 写入数据库 (已在上方循环中处理)

    # 获取未下载作品
    undownloaded_awemes = get_undownloaded_awemes_by_uid(session, uid)
    total_new = len(undownloaded_awemes)

    if total_new == 0:
        if task_id:
            update_task_progress(session, task_id, 100, status="completed", message="已是最新，无需下载")
        return

    logger.info(f"开始同步用户 {uid}，发现 {total_new} 个新作品")
    
    # 获取用户信息以检查偏好设置
    user = session.query(User).filter_by(uid=uid).first()
    global_download_video = get_config(session, "download_video", "true") == "true"
    global_download_note = get_config(session, "download_note", "true") == "true"

    for i, aweme in enumerate(undownloaded_awemes):
        # 此时 aweme 可能因为之前的 commit 而失效，虽然 enumerate 保持了引用，但属性访问可能触发 fetch
        msg = f"正在下载第 {i+1}/{total_new}: {aweme.desc[:20] if aweme.desc else aweme.aweme_id}"
        logger.info(msg)
        
        progress = 30 + int((i / total_new) * 60)
        if task_id:
            update_task_progress(session, task_id, progress, message=msg)
            
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
            aweme.downloaded = True # 标记为已处理以避免下次再扫到（视需求而定，或者不标记）
            session.commit()
            continue

        filename = aweme.desc if aweme.desc else aweme.aweme_id
        type_folder = "notes" if aweme.aweme_type == 68 else "videos"
        author_folder = os.path.join(f"{aweme.nickname}_{aweme.uid}", type_folder)
        
        try:
            success = download_video(
                aweme.share_url, author_folder, filename, aweme.aweme_id
            )
            if success:
                aweme.downloaded = True
                logger.info(f"下载成功: {aweme.aweme_id}")
            else:
                logger.error(f"下载失败: {aweme.aweme_id}")
        except Exception as e:
            logger.error(f"同步循环中遇到错误: {e}")
            
        session.commit()

    if task_id:
        update_task_progress(session, task_id, 100, status="completed", message="同步完成")


def download_user_videos_task(url: str, task_id: str):
    try:
        with next(get_session()) as session:
            update_task_progress(session, task_id, 2, message="解析 URL 中...")
            final_url = resolve_redirect(url)
            platform = get_url_platform(final_url)
            sec_user_id = extract_sec_user_id(final_url)
            sync_user_videos(session, sec_user_id, platform=platform, task_id=task_id)
    except Exception as e:
        with next(get_session()) as session:
            update_task_progress(session, task_id, 100, status="failed", message=str(e))


@router.post("/download_user_videos")
def download_user_videos_api(
    url: str = Query(..., description="抖音用户主页URL"),
    background_tasks: BackgroundTasks = None,
) -> dict[str, Any]:
    """
    触发后台下载用户所有视频（通过 URL）
    """
    task_id = str(uuid.uuid4())
    # 我们暂时不知道 uid，所以 target_id 传 url 或空
    with next(get_session()) as session:
        create_task(session, task_id, target_id=url)
        
    url = extract_share_url(url)
    background_tasks.add_task(download_user_videos_task, url, task_id)
    return {"started": True, "task_id": task_id}


@router.post("/refresh_user_videos")
def refresh_user_videos_api(
    sec_user_id: str = Query(..., description="用户的 sec_user_id"),
    background_tasks: BackgroundTasks = None,
) -> dict[str, Any]:
    """
    通过 sec_user_id 触发后台增量同步用户视频
    """
    task_id = str(uuid.uuid4())
    
    def task_wrapper(sec_user_id: str, platform: str, task_id: str):
        with next(get_session()) as session:
            sync_user_videos(session, sec_user_id, platform=platform, task_id=task_id)

    with next(get_session()) as session:
        # 获取 uid (从 db 查，如果查不到就用 sec_user_id 占位)
        user = session.query(User).filter_by(sec_user_id=sec_user_id).first()
        target_id = user.uid if user else sec_user_id
        platform = user.platform if user else "douyin"
        create_task(session, task_id, target_id=target_id)

    background_tasks.add_task(task_wrapper, sec_user_id, platform, task_id)
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
        platform=platform
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
    直接下载单个抖音分享链接视频
    """

    share_url = extract_share_url(share_url)
    share_url = resolve_redirect(share_url)
    video_data = fetch_video_profile(share_url)

    aweme_id = video_data.get("aweme_id")
    aweme_type = video_data.get("aweme_type", 0)
    desc = video_data.get("desc", "") or ""
    filename = desc if desc else aweme_id

    nickname = video_data.get("author", {}).get("nickname")
    uid = video_data.get("author", {}).get("uid")

    # 抓取完整 Profile 以获取最新的 nickname 用于文件夹名
    author_info = video_data.get("author", {})
    sec_user_id = author_info.get("sec_uid")
    if sec_user_id:
        try:
            profile = fetch_user_profile(sec_user_id)
            full_user_info = profile.get("user", {})
            if full_user_info:
                author_info.update(full_user_info)
        except Exception as e:
            logger.error(f"enrichment 失败: {e}")

    # 重新获取最新的 nickname 以构建文件夹名（如果 enrichment 更新了它）
    final_nickname = author_info.get("nickname", nickname)
    type_folder = "notes" if aweme_type == 68 else "videos"
    author_folder = os.path.join(f"{final_nickname}_{uid}", type_folder)

    success = download_video(share_url, author_folder, filename, aweme_id)

    return ShareDownloadResult(filename=filename, downloaded=success)


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

class UserPreferenceRequest(BaseModel):
    uid: str
    video_pref: bool | None = None
    note_pref: bool | None = None

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
        auto_update_interval=int(get_config(session, "auto_update_interval", "120"))
    )

@router.post("/settings")
def update_settings_api(req: GlobalSettings, session: Session = Depends(get_session), _ = Depends(get_current_user)):
    set_config(session, "download_video", "true" if req.download_video else "false")
    set_config(session, "download_note", "true" if req.download_note else "false")
    set_config(session, "auto_update_interval", str(req.auto_update_interval))
    return {"success": True}

@router.post("/change_password")
def change_password_api(req: PasswordChangeRequest, session: Session = Depends(get_session), current_user: Any = Depends(get_current_user)):
    if not verify_password(req.old_password, current_user.password_hash):
        throw_auth_error("旧密码错误")
    
    new_hash = get_password_hash(req.new_password)
    update_account_password(session, current_user.username, new_hash)
    return {"success": True}

@router.post("/user/preference")
def update_user_pref_api(req: UserPreferenceRequest, session: Session = Depends(get_session), _ = Depends(get_current_user)):
    success = update_user_preference(session, req.uid, req.video_pref, req.note_pref)
    return {"success": success}

def throw_auth_error(detail="用户名或密码错误"):
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


