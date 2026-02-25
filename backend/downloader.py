import httpx
import os
import re
import time
from pathlib import Path
from loguru import logger

from config import config

SAVE_DIR = config.SAVE_DIR
DOWNLOAD_API = config.DOWNLOAD_API

Path(SAVE_DIR).mkdir(parents=True, exist_ok=True)


def sanitize_filename(name: str) -> str:
    """去除非法文件名字符"""
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = name.strip()
    if len(name) > 100:
        name = name[:100]
    return name


import zipfile
import io

def download_video(share_url: str, author_folder: str, filename: str, aweme_id: str) -> bool:
    """
    下载视频并保存到作者文件夹
    如果返回的是 ZIP (图文)，则自动解压到以 filename 命名的文件夹中
    支持多级目录 (如 Author/video)
    """
    # 将路径按分隔符拆分，分别过滤非法字符后再合并，以保留层级结构
    path_parts = [sanitize_filename(p) for p in author_folder.replace("\\", "/").split("/") if p]
    parent_path = os.path.join(SAVE_DIR, *path_parts)
    Path(parent_path).mkdir(parents=True, exist_ok=True)

    params = {
        "url": share_url,
        "prefix": "false",
        "with_watermark": "false"
    }

    try:
        with httpx.Client(timeout=60) as client:
            logger.info(f"发起下载请求: {aweme_id} | URL: {DOWNLOAD_API}")
            resp = client.get(DOWNLOAD_API, params=params)
            resp.raise_for_status()
            logger.info(f"收到响应: {aweme_id} | Status: {resp.status_code}")
            
            content_type = resp.headers.get("content-type", "")
            
            if "application/zip" in content_type or "zip" in resp.headers.get("content-disposition", "").lower():
                # 处理 ZIP 压缩包 (图文)
                zip_folder = os.path.join(parent_path, sanitize_filename(filename))
                Path(zip_folder).mkdir(parents=True, exist_ok=True)
                
                with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
                    z.extractall(zip_folder)
                logger.info(f"解压完成: {zip_folder}")
            else:
                # 处理普通视频
                base_filename = sanitize_filename(filename)
                file_path = os.path.join(parent_path, f"{base_filename}.mp4")
                if os.path.exists(file_path):
                    file_path = os.path.join(parent_path, f"{base_filename}_{aweme_id}.mp4")
                
                with open(file_path, "wb") as f:
                    f.write(resp.content)
                logger.info(f"下载完成: {file_path}")
                
        time.sleep(0.3)
        return True
    except Exception as e:
        logger.error(f"处理下载失败: {share_url} | 错误: {e}")
        time.sleep(0.3)
        return False