import httpx
import os
import re
import time
from pathlib import Path
from loguru import logger
from utils import sanitize_filename, get_url_platform
from kuaishou import download_kuaishou_video

from config import config

SAVE_DIR = config.SAVE_DIR
DOWNLOAD_API = config.DOWNLOAD_API

Path(SAVE_DIR).mkdir(parents=True, exist_ok=True)





import zipfile
import io
import shutil

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
        if get_url_platform(share_url) == "kuaishou":
            content, _ = download_kuaishou_video(share_url)
            if len(content) < 1024:
                logger.warning(f"下载的快手视频文件内容小于1KB，判定为损坏，跳过保存: {aweme_id}")
                return None

            base_name = sanitize_filename(filename)
            file_path = os.path.join(parent_path, f"{base_name} [{aweme_id}].mp4")
            with open(file_path, "wb") as f:
                f.write(content)
            logger.info(f"快手视频下载完成: {file_path}")
            return file_path

        with httpx.Client(timeout=60) as client:
            logger.info(f"发起下载请求: {aweme_id} | URL: {DOWNLOAD_API}")
            resp = client.get(DOWNLOAD_API, params=params)
            resp.raise_for_status()
            
            content_type = resp.headers.get("content-type", "")
            
            if "application/zip" in content_type or "zip" in resp.headers.get("content-disposition", "").lower():
                # 统一命名规范：视频描述 [作品ID]
                # 这种带中括号的 ID 极大方便了跨系统后的精准识别
                base_name = sanitize_filename(filename)
                zip_folder = os.path.join(parent_path, f"{base_name} [{aweme_id}]")

                Path(zip_folder).mkdir(parents=True, exist_ok=True)
                
                with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
                    z.extractall(zip_folder)
                
                # 验证解压出来的图片大小
                corrupt = False
                files = []
                for root, dirs, filenames in os.walk(zip_folder):
                    for f in filenames:
                        files.append(os.path.join(root, f))
                
                if not files:
                    corrupt = True
                else:
                    for f_path in files:
                        try:
                            if os.path.getsize(f_path) < 1024:
                                corrupt = True
                                break
                        except Exception:
                            corrupt = True
                            break
                
                if corrupt:
                    logger.warning(f"解压的文件中存在小于1KB的文件或目录为空，判定为损坏并删除: {zip_folder}")
                    try:
                        shutil.rmtree(zip_folder)
                    except Exception as e:
                        logger.error(f"删除损坏目录失败: {zip_folder} | {e}")
                    return None
                    
                logger.info(f"解压完成: {zip_folder}")
                return zip_folder
            else:
                # 验证响应内容大小 (在写入文件之前验证，更安全更高效)
                if len(resp.content) < 1024:
                    logger.warning(f"下载的视频文件内容小于1KB，判定为损坏，跳过保存: {aweme_id} (Size: {len(resp.content)} bytes)")
                    return None

                base_name = sanitize_filename(filename)
                # 统一在文件名末尾包含 [aweme_id]，不再依赖冲突才加
                file_path = os.path.join(parent_path, f"{base_name} [{aweme_id}].mp4")
                
                with open(file_path, "wb") as f:
                    f.write(resp.content)
                logger.info(f"下载完成: {file_path}")
                return file_path
                
    except Exception as e:
        logger.error(f"处理下载失败: {share_url} | 错误: {e}")
        return None
    finally:
        time.sleep(0.3)
