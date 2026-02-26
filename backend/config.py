import os
import yaml
from pathlib import Path

# 获取项目根目录
BASE_DIR = Path(__file__).parent.parent
CONFIG_PATH = BASE_DIR / "config.yaml"

class Config:
    def __init__(self):
        # 默认值
        self.SAVE_DIR = "videos"
        self.PORT = 8000
        self.BASE_API_URL = "http://10.1.1.6"

        # 1. 从 YAML 加载
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    yaml_config = yaml.safe_load(f)
                    if yaml_config:
                        self.SAVE_DIR = yaml_config.get("save_dir", self.SAVE_DIR)
                        self.PORT = int(yaml_config.get("port", self.PORT))
                        self.BASE_API_URL = yaml_config.get("base_api_url", self.BASE_API_URL)
            except Exception as e:
                print(f"警告: 无法加载配置文件 {CONFIG_PATH}: {e}")

        # 2. 从环境变量加载 (覆盖)
        self.SAVE_DIR = os.getenv("SAVE_DIR", self.SAVE_DIR)
        self.PORT = int(os.getenv("PORT", self.PORT))
        self.BASE_API_URL = os.getenv("BASE_API_URL", self.BASE_API_URL)

        # 3. 派生具体 API 地址
        # 去除末尾斜杠
        base = self.BASE_API_URL.rstrip("/")
        self.DOWNLOAD_API = f"{base}/api/download"
        self.FETCH_USER_POST_API = f"{base}/api/douyin/web/fetch_user_post_videos"
        self.USER_PROFILE_API = f"{base}/api/douyin/web/handler_user_profile"
        self.VIDEO_DATA_API = f"{base}/api/hybrid/video_data"
        self.TIKTOK_SEC_USER_ID_API = f"{base}/api/tiktok/web/get_sec_user_id"
        self.TIKTOK_USER_POST_API = f"{base}/api/tiktok/web/fetch_user_post"

# 全局单例
config = Config()
