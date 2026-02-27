
import asyncio
import time
from typing import Optional
from loguru import logger
from db import get_session, get_auto_update_users, get_config

class SchedulerManager:
    def __init__(self):
        self.last_run: Optional[int] = None
        self.next_run: Optional[int] = None
        self.is_running: bool = False
        self._trigger_event = asyncio.Event()

    async def run(self):
        """
        后台定时任务主循环
        """
        logger.info("后台自动更新调度器已启动")
        while True:
            try:
                with next(get_session()) as session:
                    # 这里的间隔从数据库获取
                    interval_mins = int(get_config(session, "auto_update_interval", "120"))
                    interval_seconds = interval_mins * 60
                
                # 决定下次运行时间
                now = int(time.time())
                if self.last_run is None:
                    self.next_run = now
                else:
                    self.next_run = self.last_run + interval_seconds
                
                wait_time = max(0, self.next_run - now)
                
                # 等待间隔到达或点击了“立即执行”
                if wait_time > 0:
                    try:
                        await asyncio.wait_for(self._trigger_event.wait(), timeout=wait_time)
                        logger.info("收到手动触发，提前开始自动更新...")
                    except asyncio.TimeoutError:
                        # 正常的定时触发
                        pass
                
                self._trigger_event.clear()
                self.is_running = True
                self.last_run = int(time.time())
                # 预估下下次运行时间以供 UI 显示
                self.next_run = self.last_run + interval_seconds
                
                await self._execute_update()
                
                self.is_running = False
                
            except Exception as e:
                logger.error(f"定时任务循环出错: {e}")
                self.is_running = False
                await asyncio.sleep(60)

    async def _execute_update(self):
        """
        执行具体的更新逻辑
        """
        try:
            from api import sync_user_videos
            with next(get_session()) as session:
                users = get_auto_update_users(session)
                if users:
                    logger.info(f"开始自动更新 {len(users)} 个用户的视频...")
                    for user in users:
                        try:
                            logger.info(f"正在自动更新用户: {user.nickname} ({user.uid})")
                            # 这里运行在协程中，如果 sync_user_videos 是阻塞的，可能需要 run_in_executor
                            # 但目前 main.py 中也是直接调用的，所以我们维持原样
                            sync_user_videos(session, user.sec_user_id)
                        except Exception as e:
                            logger.error(f"更新用户 {user.uid} 失败: {e}")
                else:
                    logger.info("没有需要自动更新的用户")
        except Exception as e:
            logger.error(f"执行更新逻辑时出错: {e}")

    def trigger_now(self):
        """
        手动触发一次运行
        """
        self._trigger_event.set()

    def get_status(self):
        return {
            "last_run": self.last_run,
            "next_run": self.next_run,
            "is_running": self.is_running
        }

# 单例
scheduler_manager = SchedulerManager()
