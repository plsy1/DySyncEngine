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
  updated_at: number;
  created_at: number;
}

export interface GlobalSettings {
  download_video: boolean;
  download_note: boolean;
  auto_update_interval: number;
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

export interface VideoParseInfo {
  aweme_id: string;
  aweme_type: number;
  desc: string | null;
  video_url: string | null;
  cover_url: string | null;
  author_name: string | null;
  author_avatar: string | null;
}

export interface ApiResponse<T = any> {
  success?: boolean;
  started?: boolean;
  message?: string;
  data?: T;
}
