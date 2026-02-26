import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from api import router, sync_user_videos
from db import get_session, get_auto_update_users
import os
import asyncio
from loguru import logger
import sys

# 配置 Loguru
logger.remove()
logger.add(sys.stderr, format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>")

app = FastAPI(title="Douyin 视频抓取与下载")

app.include_router(router, prefix="/api")


async def auto_update_task():
    """
    后台定时任务：每 2 小时检查一次需要自动更新的用户
    """
    logger.info("后台自动更新任务已启动")
    while True:
        try:
            with next(get_session()) as session:
                # 这里的间隔从数据库获取
                from db import get_config
                interval_mins = int(get_config(session, "auto_update_interval", "120"))
                interval = interval_mins * 60
                
                users = get_auto_update_users(session)
                if users:
                    logger.info(f"开始自动更新 {len(users)} 个用户的视频...")
                    for user in users:
                        try:
                            logger.info(f"正在自动更新用户: {user.nickname} ({user.uid})")
                            sync_user_videos(session, user.sec_user_id)
                        except Exception as e:
                            logger.error(f"更新用户 {user.uid} 失败: {e}")
                else:
                    logger.info("没有需要自动更新的用户")
            
            await asyncio.sleep(interval)
        except Exception as e:
            logger.error(f"自动更新任务循环出错: {e}")
            await asyncio.sleep(60)


@app.on_event("startup")
async def startup_event():
    # 启动后台任务
    asyncio.create_task(auto_update_task())


# --- 前端服务逻辑 ---
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")

@app.exception_handler(404)
async def spa_handler(request: Request, exc):
    """
    处理 404 异常：
    1. 如果是常规文件（并在 dist 中存在），则返回该文件
    2. 如果不是 API/Docs 路径，则返回 index.html 以支持 SPA
    3. 否则返回 404 JSON
    """
    path = request.url.path
    
    # 排除系统级路径和 API，避免它们被 SPA 逻辑捕获
    if path.startswith("/api") or path.startswith(("/docs", "/openapi.json", "/redoc")):
        return JSONResponse(status_code=404, content={"detail": f"Not Found: {path}"})

    if os.path.exists(FRONTEND_DIST):
        # 尝试查找磁盘上的静态文件
        file_path = path.lstrip("/")
        full_path = os.path.join(FRONTEND_DIST, file_path)
        if os.path.exists(full_path) and os.path.isfile(full_path):
            return FileResponse(full_path)
        
        # 对于 SPA，未知路径返回 index.html
        index_path = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)

    return JSONResponse(status_code=404, content={"detail": "Not Found"})


@app.get("/", include_in_schema=False)
async def read_index():
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    # 兼容没有 dist 的情况（开发环境）
    static_index = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(static_index):
        return FileResponse(static_index)
    return JSONResponse(status_code=404, content={"detail": "Frontend not found"})


# 挂载 assets 资源
assets_path = os.path.join(FRONTEND_DIST, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")
# --- End ---


if __name__ == "__main__":
    from config import config
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=True)
