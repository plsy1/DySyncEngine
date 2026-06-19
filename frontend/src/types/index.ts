export type ToastType = 'success' | 'error';

export interface User {
  uid: string;
  sec_user_id: string | null;
  nickname: string | null;
  avatar_url: string | null;
  signature: string | null;
  auto_update: boolean;
  download_video_override: boolean | null;
  download_note_override: boolean | null;
  tg_sync_enabled: boolean | null;
  tg_target_chat: string | null;
  updated_at: number;
  created_at: number;
  sort_order: number;
  platform: string;
}

export interface GlobalSettings {
  download_video: boolean;
  download_note: boolean;
  auto_update_interval: number;
  max_initial_fetch?: number;
  kuaishou_sync_max_pages?: number;
  kuaishou_feed_min_interval?: number;
  emby_server_url?: string;
  emby_api_key?: string;
  emby_default_library?: string;
  folder_name_pattern?: string;
}

export interface FolderMigrationItem {
  uid: string;
  nickname: string;
  platform: string;
  from_folder: string;
  to_folder: string;
  from_path: string;
  to_path: string;
  aweme_count: number;
  conflict: boolean;
  reason: string | null;
}

export interface FolderMigrationPreview {
  save_dir: string;
  total: number;
  conflicts: number;
  items: FolderMigrationItem[];
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface DownloadResult {
  aweme_id: string;
  desc: string;
  filename: string;
  downloaded: boolean;
}

export interface ShareDownloadResult {
  filename: string;
  downloaded: boolean;
}

export interface Task {
  id: string;
  target_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string | null;
  updated_at: number;
}

export interface SchedulerStatus {
  last_run: number | null;
  next_run: number | null;
  is_running: boolean;
  repair_last_run: number | null;
  repair_next_run: number | null;
  repair_is_running: boolean;
}

export interface VideoParseInfo {
  aweme_id: string;
  aweme_type: number;
  desc: string | null;
  video_url: string | null;
  cover_url: string | null;
  author_name: string | null;
  author_avatar: string | null;
  platform: string;
  create_time: number;
}

export interface ApiResponse<T = any> {
  success?: boolean;
  started?: boolean;
  message?: string;
  data?: T;
}
