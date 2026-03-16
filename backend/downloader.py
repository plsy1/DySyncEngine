import httpx
import os
import re
import time
from pathlib import Path
from loguru import logger
from utils import sanitize_filename

from config import config

SAVE_DIR = config.SAVE_DIR
DOWNLOAD_API = config.DOWNLOAD_API

Path(SAVE_DIR).mkdir(parents=True, exist_ok=True)





import zipfile
import io

def download_video(share_url: str, author_folder: str, filename: str, aweme_id: str) -> str | None:
    """
    下载视频并保存到作者文件夹
    如果返回的是 ZIP (图文)，则自动解压到以 filename 命名的文件夹中
    返回保存的绝对路径，失败返回 None
    """
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
            
            content_type = resp.headers.get("content-type", "")
            
            if "application/zip" in content_type or "zip" in resp.headers.get("content-disposition", "").lower():
                zip_folder = os.path.join(parent_path, sanitize_filename(filename))
                Path(zip_folder).mkdir(parents=True, exist_ok=True)
                
                with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
                    z.extractall(zip_folder)
                logger.info(f"解压完成: {zip_folder}")
                return zip_folder
            else:
                base_filename = sanitize_filename(filename)
                file_path = os.path.join(parent_path, f"{base_filename}.mp4")
                if os.path.exists(file_path):
                    file_path = os.path.join(parent_path, f"{base_filename}_{aweme_id}.mp4")
                
                with open(file_path, "wb") as f:
                    f.write(resp.content)
                logger.info(f"下载完成: {file_path}")
                return file_path
                
    except Exception as e:
        logger.error(f"处理下载失败: {share_url} | 错误: {e}")
        return None
    finally:
        time.sleep(0.3)