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

        # 1. 从 YAML 加载
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    yaml_config = yaml.safe_load(f)
                    if yaml_config:
                        self.SAVE_DIR = yaml_config.get("save_dir", self.SAVE_DIR)
                        self.PORT = int(yaml_config.get("port", self.PORT))
            except Exception as e:
                print(f"警告: 无法加载配置文件 {CONFIG_PATH}: {e}")

        # 2. 从环境变量加载 (覆盖)
        self.SAVE_DIR = os.getenv("SAVE_DIR", self.SAVE_DIR)
        self.PORT = int(os.getenv("PORT", self.PORT))

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
