import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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

app.include_router(router)


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


# 挂载现代前端
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    # 兼容开发环境或旧静态目录
    static_path = os.path.join(os.path.dirname(__file__), "static")
    os.makedirs(static_path, exist_ok=True)
    app.mount("/static", StaticFiles(directory=static_path), name="static")
    @app.get("/")
    async def read_index():
        return FileResponse(os.path.join(static_path, "index.html"))


if __name__ == "__main__":
    from config import config
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=True)
