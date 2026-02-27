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


from scheduler import scheduler_manager


@app.on_event("startup")
async def startup_event():
    # 清理遗留任务
    from db import mark_interrupted_tasks_as_failed
    with next(get_session()) as session:
        mark_interrupted_tasks_as_failed(session)
        
    # 启动后台任务调度器
    asyncio.create_task(scheduler_manager.run())


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
