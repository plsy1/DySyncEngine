import os
from pathlib import Path

# 获取项目根目录
BASE_DIR = Path(__file__).parent.parent

class Config:
    def __init__(self):
        # 优先从环境变量加载，提供硬编码默认值作为最后防线
        self.SAVE_DIR = os.getenv("SAVE_DIR", "videos")
        self.PORT = int(os.getenv("PORT", 8000))

        # 3. 派生具体 API 地址
        # 统一使用集成模式的接口，默认请求本地 127.0.0.1
        internal_base = f"http://127.0.0.1:{self.PORT}/api/external"
        
        self.DOWNLOAD_API = f"{internal_base}/download"
        self.FETCH_USER_POST_API = f"{internal_base}/douyin/web/fetch_user_post_videos"
        self.USER_PROFILE_API = f"{internal_base}/douyin/web/handler_user_profile"
        self.VIDEO_DATA_API = f"{internal_base}/hybrid/video_data"
        self.TIKTOK_SEC_USER_ID_API = f"{internal_base}/tiktok/web/get_sec_user_id"
        self.TIKTOK_USER_POST_API = f"{internal_base}/tiktok/web/fetch_user_post"

# 全局单例
config = Config()
