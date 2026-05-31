import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", message=".*example.*has been deprecated.*")

import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from api import router, public_router, sync_user_videos
from db import get_session, get_auto_update_users
import sys
import os
import asyncio
from loguru import logger
import logging
from contextlib import asynccontextmanager

EXTERNAL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "3rd", "douyin_api")
if EXTERNAL_DIR not in sys.path:
    sys.path.insert(0, EXTERNAL_DIR)

try:
    from app.api.router import router as external_api_router
    HAS_EXTERNAL_API = True
    logger.info("成功加载外部 Douyin_TikTok_Download_API 路由器")
except ImportError as e:
    logger.error(f"无法加载外部 Douyin_TikTok_Download_API 项目: {e}")
    HAS_EXTERNAL_API = False


class InterceptHandler(logging.Handler):
    def emit(self, record):
        msg = record.getMessage()
        skip_paths = ['"GET /api/tasks/active', '"GET /api/logs', '"GET /api/login/status', '"GET /api/users', '"GET /api/scheduler/status']
        if any(path in msg for path in skip_paths):
            return

        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = sys._getframe(6), 6
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, msg)


logger.remove()
logger.add(sys.stderr, format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>", level="INFO")

log_path = os.path.join(os.path.dirname(__file__), "data", "app.log")
logger.add(log_path, rotation="10 MB", retention="1 week", enqueue=True, format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}", level="INFO")

logging.basicConfig(handlers=[InterceptHandler()], level=logging.INFO, force=True)
for _log in ["uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"]:
    _logger = logging.getLogger(_log)
    _logger.handlers = [InterceptHandler()]
    _logger.propagate = False

from scheduler import scheduler_manager


def clean_old_cache_files():
    import time
    from api import IMAGE_CACHE_DIR
    if not os.path.exists(IMAGE_CACHE_DIR):
        return
    try:
        now = time.time()
        limit = now - (30 * 24 * 3600)
        count = 0
        for filename in os.listdir(IMAGE_CACHE_DIR):
            file_path = os.path.join(IMAGE_CACHE_DIR, filename)
            if os.path.isfile(file_path):
                if os.path.getmtime(file_path) < limit:
                    os.remove(file_path)
                    count += 1
        if count > 0:
            logger.info(f"成功清理 {count} 个超过 30 天未更新的 Emby 图片缓存文件")
    except Exception as e:
        logger.error(f"清理旧图片缓存失败: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    from utils import set_main_loop
    set_main_loop(loop)

    from db import mark_interrupted_tasks_as_failed
    with next(get_session()) as session:
        mark_interrupted_tasks_as_failed(session)
        
    asyncio.create_task(scheduler_manager.run())
    asyncio.create_task(asyncio.to_thread(clean_old_cache_files))
    yield


app = FastAPI(title="Douyin 视频抓取与下载", lifespan=lifespan)

app.include_router(public_router, prefix="/api")
app.include_router(router, prefix="/api")

if HAS_EXTERNAL_API:
    app.include_router(external_api_router, prefix="/api/external")
    logger.info("外部 API 已挂载到 /api/external")


FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")


@app.exception_handler(404)
async def spa_handler(request: Request, exc):
    path = request.url.path
    if path.startswith("/api") or path.startswith(("/docs", "/openapi.json", "/redoc")):
        return JSONResponse(status_code=404, content={"detail": f"Not Found: {path}"})

    if os.path.exists(FRONTEND_DIST):
        file_path = path.lstrip("/")
        full_path = os.path.join(FRONTEND_DIST, file_path)
        if os.path.exists(full_path) and os.path.isfile(full_path):
            return FileResponse(full_path)
        
        index_path = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)

    return JSONResponse(status_code=404, content={"detail": "Not Found"})


@app.get("/", include_in_schema=False)
async def read_index():
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    static_index = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(static_index):
        return FileResponse(static_index)
    return JSONResponse(status_code=404, content={"detail": "Frontend not found"})


assets_path = os.path.join(FRONTEND_DIST, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


if __name__ == "__main__":
    from config import config
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=True)
