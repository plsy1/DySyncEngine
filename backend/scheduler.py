
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
                    # 首次启动时，不要立即运行，而是等待一个完整的间隔
                    self.last_run = now
                    self.next_run = now + interval_seconds
                    logger.info(f"首次启动，调度器将在 {interval_mins} 分钟后开始第一次任务")
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
            # 1. 临时获取需要更新的用户清单 (避免长连接占用和跨线程共享 session)
            with next(get_session()) as session:
                users = get_auto_update_users(session)
                update_list = []
                for u in users:
                    update_list.append({
                        "sec_user_id": u.sec_user_id, 
                        "platform": u.platform, 
                        "nickname": u.nickname, 
                        "uid": u.uid
                    })
                    
            if update_list:
                logger.info(f"开始自动更新 {len(update_list)} 个用户的视频...")
                for item in update_list:
                    try:
                        logger.info(f"正在自动更新用户: {item['nickname']} ({item['uid']})")
                        
                        # 定义在后台线程执行的任务，为其分配独立的会话
                        def sync_in_thread():
                            with next(get_session()) as session:
                                sync_user_videos(session, item['sec_user_id'], platform=item['platform'])
                        
                        # 使用 to_thread 避免阻塞事件循环，特别是处理 13+ 用户时
                        await asyncio.to_thread(sync_in_thread)
                        
                    except Exception as e:
                        logger.error(f"更新用户 {item['uid']} 失败: {e}")
            else:
                logger.info("没有需要自动更新的用户")

            # 定时自动修复损坏的已下载文件 (大小小于 1KB)
            def repair_in_thread():
                try:
                    from api import repair_corrupted_files
                    with next(get_session()) as session:
                        repair_corrupted_files(session)
                except Exception as repair_err:
                    logger.error(f"定时损坏修复任务执行出错: {repair_err}")

            await asyncio.to_thread(repair_in_thread)
            
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
