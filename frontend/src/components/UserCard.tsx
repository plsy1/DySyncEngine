import { motion } from 'framer-motion';
import type { User, Task } from '../types';
import { RefreshCw, Trash2, Video, FileText, ChevronDown } from 'lucide-react';
import dayjs from 'dayjs';
import { ProgressBar } from './ProgressBar';
import { useState } from 'react';

interface UserCardProps {
    user: User;
    task?: Task;
    onRefresh: (secUserId: string) => void;
    onDelete: (user: User) => void;
    onToggleAutoUpdate: (uid: string, enabled: boolean) => void;
    onPreferenceChange?: (uid: string, video: boolean | null, note: boolean | null) => void;
}

export const UserCard = ({ user, task, onRefresh, onDelete, onToggleAutoUpdate, onPreferenceChange }: UserCardProps) => {
    const isSyncing = task?.status === 'running' || task?.status === 'pending';
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="glass-card relative group"
        >
            <button
                onClick={() => onDelete(user)}
                className="absolute top-4 right-4 p-2 text-white/20 hover:text-primary transition-colors hover:bg-primary/10 rounded-lg opacity-0 group-hover:opacity-100"
            >
                <Trash2 size={18} />
            </button>

            <div className="flex items-center gap-4 mb-6">
                <a
                    href={user.platform === 'tiktok' ? `https://www.tiktok.com/@${user.uid}` : `https://www.douyin.com/user/${user.sec_user_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block h-16 w-16"
                >
                    <img
                        src={user.avatar_url || ''}
                        alt={user.nickname || ''}
                        className="w-16 h-16 rounded-full border-2 border-primary/30 object-cover hover:border-primary transition-all"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${user.nickname}`;
                        }}
                    />
                    {user.auto_update && (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-bg shadow-sm" title="自动同步已开启" />
                    )}
                </a>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold truncate pr-2">{user.nickname || '未命名'}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${user.platform === 'tiktok' ? 'bg-black text-white border border-white/20' : 'bg-red-500/20 text-red-500'}`}>
                            {user.platform === 'tiktok' ? 'TikTok' : 'Douyin'}
                        </span>
                    </div>
                    <p className="text-sm text-white/40 truncate">UID: {user.uid}</p>
                </div>
            </div>

            <div className="space-y-4">
                <p className="text-sm text-white/60 line-clamp-2 min-h-[2.5rem]">
                    {user.signature || '暂无签名'}
                </p>

                <div className="flex items-center justify-between py-3 border-t border-white/5">
                    <span className="text-xs text-white/30">
                        上次同步: {dayjs(user.updated_at * 1000).format('YY-MM-DD HH:mm')}
                    </span>
                    <div className="flex items-center gap-2">
                        <PreferenceToggle
                            label="视频"
                            value={user.download_video_override}
                            icon={<Video size={14} />}
                            onChange={(v) => onPreferenceChange?.(user.uid, v, user.download_note_override)}
                        />
                        <PreferenceToggle
                            label="图文"
                            value={user.download_note_override}
                            icon={<FileText size={14} />}
                            onChange={(v) => onPreferenceChange?.(user.uid, user.download_video_override, v)}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between py-3 border-t border-white/5">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white/40">自动更新</span>
                        <button
                            onClick={() => onToggleAutoUpdate(user.uid, !user.auto_update)}
                            disabled={isSyncing}
                            className={`w-10 h-6 rounded-full transition-colors relative ${user.auto_update ? 'bg-primary' : 'bg-white/10'} ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${user.auto_update ? 'translate-x-4' : ''}`} />
                        </button>
                    </div>
                </div>

                {isSyncing ? (
                    <div className="py-2">
                        <ProgressBar progress={task.progress} message={task.message} status={task.status} />
                    </div>
                ) : (
                    <button
                        onClick={() => onRefresh(user.sec_user_id || '')}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-white/5 border border-white/10 hover:bg-primary hover:border-primary transition-all font-semibold active:scale-[0.98]"
                    >
                        <RefreshCw size={16} />
                        同步视频
                    </button>
                )}
            </div>
        </motion.div>
    );
};
const PreferenceToggle = ({ label, value, icon, onChange }: { label: string, value: boolean | null, icon: React.ReactNode, onChange: (v: boolean | null) => void }) => {
    const [isOpen, setIsOpen] = useState(false);

    const getStateColor = () => {
        if (value === true) return 'text-green-400 bg-green-400/10 border-green-400/20';
        if (value === false) return 'text-red-400 bg-red-400/10 border-red-400/20';
        return 'text-white/40 bg-white/5 border-white/10';
    };

    const getStateLabel = () => {
        if (value === true) return '开启';
        if (value === false) return '关闭';
        return '默认';
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold transition-all hover:bg-white/10 ${getStateColor()}`}
            >
                {icon}
                <span>{label}: {getStateLabel()}</span>
                <ChevronDown size={10} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 5 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 5 }}
                            className="absolute bottom-full mb-2 right-0 z-[70] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[80px]"
                        >
                            {[
                                { l: '跟随默认', v: null },
                                { l: '强制开启', v: true },
                                { l: '强制关闭', v: false },
                            ].map((opt) => (
                                <button
                                    key={opt.l}
                                    onClick={() => {
                                        onChange(opt.v);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-[10px] hover:bg-white/5 transition-colors ${value === opt.v ? 'text-primary' : 'text-white/60'}`}
                                >
                                    {opt.l}
                                </button>
                            ))}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

import { AnimatePresence } from 'framer-motion';
