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
        self.DOWNLOAD_API = "http://10.1.1.6/api/download"
        self.FETCH_USER_POST_API = "http://10.1.1.6/api/douyin/web/fetch_user_post_videos"
        self.USER_PROFILE_API = "http://10.1.1.6/api/douyin/web/handler_user_profile"
        self.VIDEO_DATA_API = "http://10.1.1.6/api/hybrid/video_data"

        # 1. 从 YAML 加载
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    yaml_config = yaml.safe_load(f)
                    if yaml_config:
                        self.SAVE_DIR = yaml_config.get("save_dir", self.SAVE_DIR)
                        self.DOWNLOAD_API = yaml_config.get("download_api", self.DOWNLOAD_API)
                        self.FETCH_USER_POST_API = yaml_config.get("fetch_user_post_api", self.FETCH_USER_POST_API)
                        self.USER_PROFILE_API = yaml_config.get("user_profile_api", self.USER_PROFILE_API)
                        self.VIDEO_DATA_API = yaml_config.get("video_data_api", self.VIDEO_DATA_API)
            except Exception as e:
                print(f"警告: 无法加载配置文件 {CONFIG_PATH}: {e}")

        # 2. 从环境变量加载 (覆盖)
        self.SAVE_DIR = os.getenv("SAVE_DIR", self.SAVE_DIR)
        self.DOWNLOAD_API = os.getenv("DOWNLOAD_API", self.DOWNLOAD_API)
        self.FETCH_USER_POST_API = os.getenv("FETCH_USER_POST_API", self.FETCH_USER_POST_API)
        self.USER_PROFILE_API = os.getenv("USER_PROFILE_API", self.USER_PROFILE_API)
        self.VIDEO_DATA_API = os.getenv("VIDEO_DATA_API", self.VIDEO_DATA_API)

# 全局单例
config = Config()
