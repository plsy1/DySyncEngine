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
from db import get_config, set_config, get_session

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

    async def upload_folder(self, chat_id, folder_path, caption_info=None):
        """
        上传指定文件夹到 Telegram
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
                    except Exception as e:
                        logger.error(f"TG Upload batch fail: {e}")
                    
                    await asyncio.sleep(1)

            # Cleanup
            for tmp_f in temp_files:
                try: os.remove(tmp_f)
                except: pass
            
            return True

        except Exception as e:
            logger.error(f"TG Upload runtime error: {e}")
            return False

tg_uploader = TelegramUploader()
