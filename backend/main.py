import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from api import router, sync_user_videos
from db import get_session, get_auto_update_users
import sys
import os
import asyncio
from loguru import logger
import logging

# ==============================================================================
# 集成外部 Douyin_TikTok_Download_API 项目
# ==============================================================================
# 将其所在目录加入到 Python 模块搜索路径中
EXTERNAL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "3rd", "douyin_api")
if EXTERNAL_DIR not in sys.path:
    # 使用 insert(0, ...) 确保引用它的模块时它拥有最高优先级 (防止与其他 app 命名的包冲突)
    sys.path.insert(0, EXTERNAL_DIR)

# 这时候可以从外部项目加载其路由和应用
# 注意：由于外部项目内部使用了绝对导入 (例如 from app.xxx)，
# 且由于它自己的 main.py 里会初始化一些全局配置，我们这里导入其路由。
try:
    from app.api.router import router as external_api_router
    HAS_EXTERNAL_API = True
    logger.info("成功加载外部 Douyin_TikTok_Download_API 路由器")
except ImportError as e:
    logger.error(f"无法加载外部 Douyin_TikTok_Download_API 项目: {e}")
    HAS_EXTERNAL_API = False
# ==============================================================================

# 配置 Loguru 拦截标准库日志
class InterceptHandler(logging.Handler):
    def emit(self, record):
        # 过滤掉高频轮询的 API 日志，减少干扰
        msg = record.getMessage()
        skip_paths = ['"GET /api/tasks/active', '"GET /api/logs', '"GET /api/login/status', '"GET /api/users', '"GET /api/scheduler/status']
        if any(path in msg for path in skip_paths):
            return

        # Get corresponding Loguru level if it exists
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message
        frame, depth = sys._getframe(6), 6
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, msg)

# 基础输出配置
logger.remove()
# 终端输出 (带颜色)
logger.add(sys.stderr, format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>", level="INFO")

# 文件持久化输出 (位于 /app/backend/data，确保 Volume 映射能看到)
log_path = os.path.join(os.path.dirname(__file__), "data", "app.log")
logger.add(log_path, rotation="10 MB", retention="1 week", enqueue=True, format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}", level="INFO")

# 拦截 uvicorn 等日志
logging.basicConfig(handlers=[InterceptHandler()], level=logging.INFO, force=True)
for _log in ["uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"]:
    _logger = logging.getLogger(_log)
    _logger.handlers = [InterceptHandler()]
    _logger.propagate = False

app = FastAPI(title="Douyin 视频抓取与下载")

app.include_router(router, prefix="/api")

# 挂载外部 API 路由，前置路径为 /api/external
if HAS_EXTERNAL_API:
    app.include_router(external_api_router, prefix="/api/external")
    logger.info("外部 API 已挂载到 /api/external")

from scheduler import scheduler_manager


@app.on_event("startup")
async def startup_event():
    # 获取并存储主线程的事件循环，供后台线程触发异步任务
    loop = asyncio.get_running_loop()
    from utils import set_main_loop
    set_main_loop(loop)

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
