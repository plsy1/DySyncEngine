import axios from 'axios';
import type { User, ApiResponse, ShareDownloadResult, Task, GlobalSettings, AuthResponse, VideoParseInfo, SchedulerStatus } from '../types';

const api = axios.create({
  baseURL: '/api/', // Standard API prefix with trailing slash
});

// Add interceptor to include token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth endpoints
export const login = async (username: string, password: string): Promise<AuthResponse> => {
  const { data } = await api.post<AuthResponse>('login', { username, password });
  localStorage.setItem('token', data.access_token);
  return data;
};

export const logout = () => {
  localStorage.removeItem('token');
};

export const checkLoginStatus = async () => {
  try {
    const { data } = await api.get('login/status');
    return data.logged_in;
  } catch {
    return false;
  }
};

export const changePassword = async (old_password: string, new_password: string) => {
  const { data } = await api.post('change_password', { old_password, new_password });
  return data;
};

// Settings endpoints
export const getSettings = async (): Promise<GlobalSettings> => {
  const { data } = await api.get<GlobalSettings>('settings');
  return data;
};

export const updateSettings = async (settings: GlobalSettings) => {
  const { data } = await api.post('settings', settings);
  return data;
};

export const updateUserPreference = async (uid: string, video_pref: boolean | null, note_pref: boolean | null, tg_sync_pref: boolean | null, tg_chat_pref: string | null) => {
  const { data } = await api.post('user/preference', { uid, video_pref, note_pref, tg_sync_pref, tg_chat_pref });
  return data;
};

export const getUsers = async (): Promise<User[]> => {
  const { data } = await api.get<User[]>('users');
  return data;
};

export const downloadUserVideos = async (url: string): Promise<ApiResponse> => {
  const { data } = await api.post<ApiResponse>(`download_user_videos?url=${encodeURIComponent(url)}`);
  return data;
};

export const refreshUserVideos = async (secUserId: string): Promise<ApiResponse> => {
  const { data } = await api.post<ApiResponse>(`refresh_user_videos?sec_user_id=${encodeURIComponent(secUserId)}`);
  return data;
};

export const toggleAutoUpdate = async (uid: string, enabled: boolean): Promise<ApiResponse<{ success: boolean }>> => {
  const { data } = await api.post<ApiResponse>(`toggle_auto_update?uid=${uid}&enabled=${enabled}`);
  return data;
};

export const deleteUser = async (uid: string): Promise<ApiResponse<{ success: boolean }>> => {
  const { data } = await api.delete<ApiResponse>(`delete_user?uid=${uid}`);
  return data;
};

export const downloadShareUrl = async (shareUrl: string): Promise<ShareDownloadResult> => {
  const { data } = await api.post<ShareDownloadResult>(`download_share_url?share_url=${encodeURIComponent(shareUrl)}`);
  return data;
};

export const getActiveTasks = async (): Promise<Task[]> => {
  const { data } = await api.get<Task[]>('tasks/active');
  return data;
};

export const getSchedulerStatus = async (): Promise<SchedulerStatus> => {
  const { data } = await api.get<SchedulerStatus>('scheduler/status');
  return data;
};

export const runSchedulerNow = async (): Promise<ApiResponse> => {
  const { data } = await api.post<ApiResponse>('scheduler/run_now');
  return data;
};

export const checkUndownloaded = async (): Promise<ApiResponse> => {
  const { data } = await api.post<ApiResponse>('tasks/check_undownloaded');
  return data;
};

export const parseVideo = async (shareUrl: string): Promise<VideoParseInfo> => {
  const { data } = await api.post<VideoParseInfo>(`parse_video?share_url=${encodeURIComponent(shareUrl)}`);
  return data;
};

export const getLogs = async (): Promise<{ logs: string[] }> => {
  const { data } = await api.get<{ logs: string[] }>('logs');
  return data;
};

// Telegram endpoints
export const tgSetup = async (apiId: number, apiHash: string, phone: string) => {
  const formData = new FormData();
  formData.append('api_id', apiId.toString());
  formData.append('api_hash', apiHash);
  formData.append('phone', phone);
  const { data } = await api.post('tg/setup', formData);
  return data;
};

export const tgVerify = async (code: string, password?: string) => {
  const formData = new FormData();
  formData.append('code', code);
  if (password) formData.append('password', password);
  const { data } = await api.post('tg/verify', formData);
  return data;
};

export const getTgStatus = async () => {
  const { data } = await api.get('tg/status');
  return data;
};

export const getTgChats = async () => {
  const { data } = await api.get('tg/chats');
  return data;
};

export const updateTgSettings = async (targetChat: string, autoUpload: boolean) => {
  const formData = new FormData();
  formData.append('target_chat', targetChat);
  formData.append('auto_upload', autoUpload ? 'true' : 'false');
  const { data } = await api.post('tg/settings', formData);
  return data;
};
export const tgSyncUser = async (uid: string): Promise<ApiResponse> => {
  const { data } = await api.post<ApiResponse>(`tg/sync_user?uid=${uid}`);
  return data;
};
export const tgSyncAll = async (): Promise<ApiResponse> => {
  const { data } = await api.post<ApiResponse>('tg/sync_all');
  return data;
};

export const tgMarkAllExported = async (uid: string): Promise<{ success: boolean }> => {
  const { data } = await api.post<{ success: boolean }>(`tg/mark_all_exported?uid=${uid}`);
  return data;
};

export const lookupVideos = async (paths: string[]): Promise<Record<string, any>> => {
  const { data } = await api.post('videos/lookup', { paths });
  return data;
};
