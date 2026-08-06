"""平台抓取兼容入口。

新代码应直接从 ``platforms`` 导入；保留本模块避免现有扩展脚本立即失效。
"""

from platforms import fetch_all_awemes, fetch_user_profile, fetch_work_profile


fetch_video_profile = fetch_work_profile


__all__ = ["fetch_all_awemes", "fetch_user_profile", "fetch_video_profile"]
