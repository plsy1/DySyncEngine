import os
import asyncio
import re
import time
import json
import logging
import tempfile
from pathlib import Path
from typing import List, Optional, Dict, Any
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from PIL import Image
from loguru import logger
from db import get_config, set_config, get_session, update_task_progress
from utils import sanitize_filename
from config import config

# --- Background Task Management ---
class TelegramUploader:
    def __init__(self):
        self.client: Optional[TelegramClient] = None
        self.session_file = os.path.join(os.path.dirname(__file__), "data", "tg_session")
        self.active_tasks: Dict[str, Any] = {}
        self._lock = asyncio.Lock()

    async def get_client(self) -> Optional[TelegramClient]:
        if self.client:
            return self.client
        
        with next(get_session()) as session:
            api_id = get_config(session, "tg_api_id")
            api_hash = get_config(session, "tg_api_hash")
            
        if api_id and api_hash:
            try:
                self.client = TelegramClient(self.session_file, int(api_id), api_hash)
                await self.client.connect()
                return self.client
            except Exception as e:
                logger.error(f"Failed to initialize Telegram client: {e}")
        return None

    def natural_sort_key(self, s):
        return [int(text) if text.isdigit() else text.lower()
                for text in re.split('([0-9]+)', str(s))]

    def convert_webp_to_jpg(self, file_path, temp_list):
        if not file_path.lower().endswith('.webp'):
            return file_path
        try:
            with Image.open(file_path) as img:
                rgb_img = img.convert('RGB')
                tmp = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
                tmp_path = tmp.name
                tmp.close()
                rgb_img.save(tmp_path, 'JPEG', quality=95)
                temp_list.append(tmp_path)
                return tmp_path
        except Exception as e:
            logger.error(f"Failed to convert {file_path}: {e}")
            return file_path

    async def upload_path(self, chat_id, path, caption=None):
        """
        上传单个文件或文件夹到 Telegram
        """
        client = await self.get_client()
        if not client or not await client.is_user_authorized():
            return False

        try:
            try:
                try: peer = int(chat_id)
                except: peer = chat_id
                resolved_id = await client.get_entity(peer)
            except Exception as e:
                logger.error(f"Could not resolve TG entity {chat_id}: {e}")
                return False

            temp_files = []
            if os.path.isdir(path):
                # 文件夹逻辑 (多用于图文)
                files = [os.path.join(path, f) for f in os.listdir(path) if not f.startswith('.')]
                if not files: return True
                files.sort(key=self.natural_sort_key)
                
                # 依然按 10 个一组分批发送
                for i in range(0, len(files), 10):
                    batch = files[i:i+10]
                    processed_batch = [self.convert_webp_to_jpg(f, temp_files) for f in batch]
                    await client.send_file(resolved_id, processed_batch, caption=caption, force_document=False)
            else:
                # 单个文件 (视频)
                processed = self.convert_webp_to_jpg(path, temp_files)
                await client.send_file(resolved_id, processed, caption=caption, force_document=False)
            
            # Cleanup
            for tmp_f in temp_files:
                try: os.remove(tmp_f)
                except: pass
            return True
        except Exception as e:
            logger.error(f"Upload path failed: {path} | error: {e}")
            return False
    async def upload_folder(self, chat_id, folder_path, caption_info=None, task_id: str = None):
        """
        上传整个作者文件夹到 Telegram (全量同步模式)
        """
        client = await self.get_client()
        if not client or not await client.is_user_authorized():
            logger.error("Telegram not authorized for upload")
            return False

        try:
            # Resolve Entity
            try:
                try: peer = int(chat_id)
                except: peer = chat_id
                resolved_id = await client.get_entity(peer)
            except Exception as e:
                logger.error(f"Could not resolve TG entity {chat_id}: {e}")
                return False

            # Group files
            folder_groups = {}
            for root, _, filenames in os.walk(folder_path):
                valid_files = [os.path.join(root, f) for f in filenames if not f.startswith('.')]
                if valid_files:
                    folder_groups[root] = sorted(valid_files, key=self.natural_sort_key)
            
            total_files = sum(len(files) for files in folder_groups.values())
            logger.info(f"TG Upload: Found {total_files} files in {folder_path}")
            
            if task_id:
                with next(get_session()) as session:
                    update_task_progress(session, task_id, 0, message=f"准备上传 {total_files} 个文件到 TG...")

            files_uploaded = 0
            temp_files = []
            for root_dir, file_paths in folder_groups.items():
                # Generate caption
                if caption_info:
                    base_parts = [f"#{caption_info.get('nickname')} #id_{caption_info.get('uid')}"]
                    if caption_info.get('desc'): base_parts.append(caption_info.get('desc'))
                else:
                    folder_display = os.path.basename(root_dir)
                    base_parts = [f"📁 文件夹: {folder_display}"]
                
                total_batches = (len(file_paths) + 9) // 10
                for batch_idx, i in enumerate(range(0, len(file_paths), 10)):
                    batch = file_paths[i:i+10]
                    processed_batch = [self.convert_webp_to_jpg(f, temp_files) for f in batch]
                    
                    curr_parts = base_parts.copy()
                    if total_batches > 1: curr_parts.insert(1, f"📦 Part {batch_idx + 1}/{total_batches}")
                    display_caption = "\n".join(curr_parts)
                    
                    try:
                        if len(processed_batch) > 1:
                            await client.send_file(resolved_id, processed_batch, caption=display_caption, force_document=False)
                        else:
                            await client.send_file(resolved_id, processed_batch[0], caption=display_caption, force_document=False)
                        
                        files_uploaded += len(batch)
                        if task_id:
                            progress = int((files_uploaded / total_files) * 100)
                            with next(get_session()) as session:
                                update_task_progress(session, task_id, progress, message=f"TG 上传中: {files_uploaded}/{total_files}")
                    except Exception as e:
                        logger.error(f"TG Upload batch fail: {e}")
                    
                    await asyncio.sleep(1)

            if task_id:
                with next(get_session()) as session:
                    update_task_progress(session, task_id, 100, status="completed", message="同步与 TG 上传均已完成")

            # Cleanup
            for tmp_f in temp_files:
                try: os.remove(tmp_f)
                except: pass
            
            return True

        except Exception as e:
            logger.error(f"TG Upload runtime error: {e}")
            if task_id:
                with next(get_session()) as session:
                    update_task_progress(session, task_id, 100, status="failed", message=f"TG 上传失败: {str(e)}")
            return False

    async def sync_user_content(self, chat_id, uid, task_id=None):
        """
        同步指定用户所有“已下载但未导出到 TG”的作品
        """
        from db import Aweme
        client = await self.get_client()
        if not client or not await client.is_user_authorized():
            return False

        with next(get_session()) as session:
            # 查找未导出的作品
            awemes = session.query(Aweme).filter_by(uid=uid, downloaded=True, tg_exported=False).all()
            if not awemes:
                if task_id:
                    update_task_progress(session, task_id, 100, status="completed", message="没有新内容需要同步到 TG")
                return True

            total = len(awemes)
            logger.info(f"开始同步用户 {uid} 的内容到 TG, 共 {total} 个作品")
            
            for i, aweme in enumerate(awemes):
                if task_id:
                    progress = int((i / total) * 100)
                    update_task_progress(session, task_id, progress, message=f"正在同步到 TG: {i+1}/{total}")
                
                target_path = aweme.local_path
                
                # --- Fallback logic for old records ---
                if not target_path or not os.path.exists(target_path):
                    # 尝试重新构造可能的文件路径
                    type_folder = "videos" if aweme.aweme_type == 0 else "notes"
                    filename_base = f"{aweme.desc[:30] if aweme.desc else aweme.aweme_id}_{aweme.aweme_id}"
                    author_folder_name = f"{aweme.nickname}_{aweme.uid}"
                    
                    # 按照 downloader.py 的逻辑构造路径
                    path_parts = [sanitize_filename(p) for p in [author_folder_name, type_folder] if p]
                    parent_path = os.path.join(config.SAVE_DIR, *path_parts)
                    
                    if aweme.aweme_type == 0:
                        potential_path = os.path.join(parent_path, f"{sanitize_filename(filename_base)}.mp4")
                    else:
                        potential_path = os.path.join(parent_path, sanitize_filename(filename_base))
                        
                    if os.path.exists(potential_path):
                        target_path = potential_path
                        aweme.local_path = target_path # 顺便修复数据库
                        session.commit()
                    else:
                        logger.warning(f"本地文件不存在，且无法找回，跳过: {aweme.aweme_id} (Path: {potential_path})")
                        continue

                caption = f"#{aweme.nickname} #id_{aweme.uid}\n{aweme.desc}"
                success = await self.upload_path(chat_id, target_path, caption=caption)
                if success:
                    aweme.tg_exported = True
                    session.commit()
                
                await asyncio.sleep(1)

            if task_id:
                update_task_progress(session, task_id, 100, status="completed", message=f"成功同步 {total} 个作品到 TG")
            return True

    async def sync_all_tg_content(self, task_id=None):
        """
        全量扫描：同步所有用户未导出的内容到各自指定的 TG
        """
        from db import User, get_config
        with next(get_session()) as session:
            global_tg_enabled = get_config(session, "tg_auto_upload", "false") == "true"
            global_tg_chat = get_config(session, "tg_target_chat")
            
            # 找到所有可能需要同步的用户
            users = session.query(User).all()
            total_users = len(users)
            
            if task_id:
                update_task_progress(session, task_id, 0, message="正在准备全量 TG 同步审计...")

            for idx, user in enumerate(users):
                tg_enabled = user.tg_sync_enabled if user.tg_sync_enabled is not None else global_tg_enabled
                tg_chat = user.tg_target_chat if user.tg_target_chat else global_tg_chat
                
                if tg_enabled and tg_chat:
                    if task_id:
                        progress = int((idx / total_users) * 100)
                        update_task_progress(session, task_id, progress, message=f"正在审计用户: {user.nickname}")
                    
                    # 执行具体同步 (await)
                    await self.sync_user_content(tg_chat, user.uid)
                
            if task_id:
                update_task_progress(session, task_id, 100, status="completed", message="全量 TG 同步审计完成")
            return True

tg_uploader = TelegramUploader()
