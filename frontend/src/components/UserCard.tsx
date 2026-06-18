import { motion, AnimatePresence } from 'framer-motion';
import type { User, Task } from '../types';
import { RefreshCw, Trash2, Video, FileText, ChevronDown, Send, Settings2, ShieldCheck, X } from 'lucide-react';
import dayjs from 'dayjs';
import { ProgressBar } from './ProgressBar';
import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { createPortal } from 'react-dom';

interface UserCardProps {
    user: User;
    task?: Task;
    onRefresh: (secUserId: string, maxFetch?: number, forceFull?: boolean) => void;
    onDelete: (user: User) => void;
    onToggleAutoUpdate: (uid: string, enabled: boolean) => void;
    onPreferenceChange?: (uid: string, video: boolean | null, note: boolean | null, tgSync: boolean | null, tgChat: string | null) => void;
    onTgSync?: (uid: string) => void;
    onMarkTgExported?: (uid: string) => void;
}

const getPlatformLabel = (platform: string) => {
    if (platform === 'tiktok') return 'TikTok';
    if (platform === 'kuaishou') return '快手';
    return '抖音';
};

export const UserCard = ({ user, task, onRefresh, onDelete, onToggleAutoUpdate, onPreferenceChange, onTgSync, onMarkTgExported }: UserCardProps) => {
    const [isPending, setIsPending] = useState(false);
    const [isMarking, setIsMarking] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [tgModalOpen, setTgModalOpen] = useState(false);
    const isSyncing = task?.status === 'running' || task?.status === 'pending';

    useEffect(() => {
        if (isSyncing) setIsPending(false);
    }, [isSyncing]);

    const profileUrl = user.platform === 'tiktok'
        ? (user.uid ? `https://www.tiktok.com/@${user.uid}` : null)
        : user.platform === 'kuaishou'
            ? null
            : (user.sec_user_id ? `https://www.douyin.com/user/${user.sec_user_id}` : null);

    const handleRefresh = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPending(true);
        onRefresh(user.sec_user_id || '');
    };

    const handleTgSync = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPending(true);
        onTgSync?.(user.uid);
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card overflow-hidden flex flex-col group border border-white/5 hover:border-white/10 transition-all duration-300"
        >
            {/* Background Accent */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

            {/* Header Section */}
            <div className="p-4 flex items-start gap-3">
                <div className="relative shrink-0">
                    {profileUrl ? (
                        <a 
                            href={profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block group/avatar active:scale-95 transition-transform"
                            title="在浏览器中打开主页"
                        >
                            <img
                                src={user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${user.nickname}`}
                                alt={user.nickname || ''}
                                className="w-12 h-12 rounded-xl object-cover ring-2 ring-white/5 group-hover:ring-primary/40 transition-all duration-500 shadow-xl"
                            />
                        </a>
                    ) : (
                        <img
                            src={user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${user.nickname}`}
                            alt={user.nickname || ''}
                            className="w-12 h-12 rounded-xl object-cover ring-2 ring-white/5 group-hover:ring-primary/40 transition-all duration-500 shadow-xl"
                        />
                    )}
                    
                    {/* Status Indicator: 4 States */}
                    {(user.auto_update || user.tg_sync_enabled) && (
                        <div className={`absolute -top-1.5 -right-1.5 z-10 w-4.5 h-4.5 rounded-full backdrop-blur-md border flex items-center justify-center transition-all duration-500 ${
                            user.auto_update && user.tg_sync_enabled 
                                ? 'bg-primary/10 border-primary/40' 
                                : user.tg_sync_enabled 
                                    ? 'bg-blue-500/10 border-blue-500/40' 
                                    : 'bg-emerald-500/10 border-emerald-500/40'
                        }`}>
                            <div className={`w-2 h-2 rounded-full animate-pulse shadow-lg ${
                                user.auto_update && user.tg_sync_enabled 
                                    ? 'bg-primary shadow-primary/50' 
                                    : user.tg_sync_enabled 
                                        ? 'bg-blue-400 shadow-blue-500/50' 
                                        : 'bg-emerald-500 shadow-emerald-500/50'
                            }`} />
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                        <h3 className="text-sm font-bold text-white truncate group-hover:text-primary transition-colors">
                            {profileUrl ? (
                                <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                    {user.nickname || '未命名'}
                                </a>
                            ) : (
                                user.nickname || '未命名'
                            )}
                        </h3>
                        <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowSettings(true);
                                }}
                                className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-primary/20 text-primary' : 'hover:bg-white/5 text-white/40'}`}
                                title="偏好设置"
                            >
                                <Settings2 size={16} />
                            </button>
                            <button
                                onClick={() => onDelete(user)}
                                className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors"
                                title="删除用户"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-medium font-mono text-white/30 uppercase tracking-wider">
                        <span>{getPlatformLabel(user.platform)}</span>
                        <span>•</span>
                        <span className="truncate">{user.uid}</span>
                    </div>
                </div>
            </div>

            {/* Content Body */}
            <div className="px-4 pb-4 flex-1 flex flex-col gap-3">
                <p className="text-[11px] text-white/50 leading-relaxed line-clamp-2 italic">
                    {user.signature || '该作者很懒，什么都没写...'}
                </p>

                {/* Progress / Actions */}
                <div className="mt-auto">
                    {isSyncing || isPending ? (
                        <ProgressBar 
                            progress={task?.progress || 0} 
                            message={isPending ? "正在准备队列..." : task?.message || ""} 
                            status={isPending ? "running" : task?.status || "running"} 
                        />
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={handleRefresh}
                                className="flex-1 h-9 flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/5 hover:bg-primary/20 hover:border-primary/30 text-white/90 text-xs font-bold transition-all active:scale-[0.97]"
                            >
                                <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
                                同步内容
                            </button>
                            <button
                                onClick={handleTgSync}
                                title="手动推送至 Telegram"
                                className="w-9 h-9 flex items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/10 hover:bg-blue-500/20 hover:border-blue-500/30 text-blue-400 transition-all active:scale-[0.97]"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <Modal 
                isOpen={tgModalOpen}
                onClose={() => setTgModalOpen(false)}
                title="标记为已同步"
                description={`确定要将作者 "${user.nickname}" 的所有已有作品标记为已同步到 Telegram 吗？这会阻止现有内容再次被自动上传，但不会影响未来的新作品。`}
                confirmText="立即标记"
                onConfirm={async () => {
                    setIsMarking(true);
                    try {
                        await onMarkTgExported?.(user.uid);
                    } finally {
                        setIsMarking(false);
                    }
                }}
            />

            {/* Footer Status */}
            <div className="px-4 py-2.5 bg-white/2 border-t border-white/5 flex items-center justify-between text-[10px] font-medium text-white/20 tracking-tighter uppercase">
                <span>Last Activity</span>
                <span className="font-mono">{dayjs(user.updated_at * 1000).format('MM-DD HH:mm')}</span>
            </div>

            {/* Settings Modal Dialog Overlay */}
            {createPortal(
                <AnimatePresence>
                    {showSettings && (
                        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setShowSettings(false)}
                                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            />
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                className="relative bg-card border border-white/10 w-full max-w-md rounded-3xl shadow-2xl overflow-visible backdrop-blur-2xl bg-[#060608]/95 p-6 text-left"
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="text-lg font-bold text-white truncate pr-4">
                                        {user.nickname || '未命名'} - 偏好设置
                                    </h3>
                                    <button 
                                        onClick={() => setShowSettings(false)} 
                                        className="text-white/40 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-all"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-medium font-mono text-white/30 uppercase tracking-wider mb-6">
                                    <span>{getPlatformLabel(user.platform)}</span>
                                    <span>•</span>
                                    <span className="truncate">{user.uid}</span>
                                </div>

                                <div className="space-y-5">
                                    {/* Row 1: Content Overrides */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-white/20 uppercase tracking-widest pl-1">视频下载</label>
                                            <PreferenceToggle
                                                value={user.download_video_override}
                                                icon={<Video size={12} />}
                                                onChange={(v) => onPreferenceChange?.(user.uid, v, user.download_note_override, user.tg_sync_enabled, user.tg_target_chat)}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-white/20 uppercase tracking-widest pl-1">图文同步</label>
                                            <PreferenceToggle
                                                value={user.download_note_override}
                                                icon={<FileText size={12} />}
                                                onChange={(v) => onPreferenceChange?.(user.uid, user.download_video_override, v, user.tg_sync_enabled, user.tg_target_chat)}
                                            />
                                        </div>
                                    </div>

                                    {/* Row 2: Automation */}
                                    <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                                        <div className="flex items-center gap-2">
                                            <RefreshCw size={14} className={`text-primary ${user.auto_update ? 'animate-spin-slow' : ''}`} />
                                            <span className="text-xs font-bold text-white/60">后台自动更新</span>
                                        </div>
                                        <button
                                            onClick={() => onToggleAutoUpdate(user.uid, !user.auto_update)}
                                            className={`w-9 h-5 rounded-full transition-all relative ${user.auto_update ? 'bg-primary' : 'bg-white/10'}`}
                                        >
                                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${user.auto_update ? 'left-5' : 'left-1'}`} />
                                        </button>
                                    </div>

                                    {/* Row 3: TG Advanced */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between px-1">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck size={14} className="text-blue-400" />
                                                <span className="text-xs font-bold text-white/60">Telegram 推送服务</span>
                                            </div>
                                             <PreferenceToggle
                                                value={user.tg_sync_enabled}
                                                onChange={(v) => onPreferenceChange?.(user.uid, user.download_video_override, user.download_note_override, v, user.tg_target_chat)}
                                                compact
                                                position="top"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <input
                                                    type="text"
                                                    placeholder="目标 ID (例如: -100xxx 或 me)"
                                                    defaultValue={user.tg_target_chat || ''}
                                                    onBlur={(e) => {
                                                        if (e.target.value !== (user.tg_target_chat || '')) {
                                                            onPreferenceChange?.(user.uid, user.download_video_override, user.download_note_override, user.tg_sync_enabled, e.target.value);
                                                        }
                                                    }}
                                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-xs text-white/70 outline-none focus:border-primary/30 transition-all placeholder:text-white/10 font-bold"
                                                />
                                            </div>
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    setTgModalOpen(true);
                                                }}
                                                disabled={isMarking}
                                                className="px-3 rounded-xl bg-blue-500/10 border border-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold transition-all whitespace-nowrap"
                                                title="一键标记所有作品为已上传"
                                            >
                                                {isMarking ? <RefreshCw size={12} className="animate-spin" /> : "标记已传"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Row 4: Historical Sync */}
                                    <div className="pt-2 border-t border-white/5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest pl-1">回溯抓取 (全量/补漏)</span>
                                        </div>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <div className="relative flex-1">
                                                <input
                                                    id={`max-fetch-modal-${user.uid}`}
                                                    type="number"
                                                    placeholder="同步数量 (0=全量)"
                                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-xs text-white/70 outline-none focus:border-primary/40 transition-all placeholder:text-white/10 font-bold"
                                                />
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const input = document.getElementById(`max-fetch-modal-${user.uid}`) as HTMLInputElement;
                                                    const count = parseInt(input?.value) || 0;
                                                    onRefresh(user.sec_user_id || '', count, true);
                                                    if (input) input.value = '';
                                                    setShowSettings(false);
                                                }}
                                                className="py-3 px-6 rounded-xl bg-primary/20 border border-primary/30 text-primary text-[10px] font-black hover:bg-primary/30 transition-all active:scale-95 whitespace-nowrap uppercase tracking-widest"
                                            >
                                                立即执行
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex gap-3 justify-end mt-8 pt-4 border-t border-white/5">
                                    <button
                                        onClick={() => setShowSettings(false)}
                                        className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-xl text-xs transition-all active:scale-[0.97]"
                                    >
                                        完成设置
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </motion.div>
    );
};

const PreferenceToggle = ({ 
    value, 
    icon, 
    onChange, 
    compact = false, 
    position = 'bottom' 
}: { 
    value: boolean | null, 
    icon?: React.ReactNode, 
    onChange: (v: boolean | null) => void, 
    compact?: boolean,
    position?: 'top' | 'bottom'
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const states = [
        { label: '默认', value: null, color: 'text-white/40 bg-white/5' },
        { label: '开启', value: true, color: 'text-primary bg-primary/10' },
        { label: '禁用', value: false, color: 'text-red-400 bg-red-400/10' },
    ];

    const current = states.find(s => s.value === value) || states[0];

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-between gap-2 px-3 h-8 rounded-lg border border-white/5 text-[10px] font-bold transition-all hover:bg-white/10 ${current.color} ${compact ? 'min-w-[60px]' : 'w-full'}`}
            >
                <div className="flex items-center gap-1.5 capitalize">
                    {icon}
                    <span>{current.label}</span>
                </div>
                <ChevronDown size={10} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                        <motion.div
                            initial={{ opacity: 0, y: position === 'bottom' ? -10 : 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: position === 'bottom' ? -10 : 10 }}
                            className={`absolute ${position === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1'} right-0 ${compact ? 'w-24' : 'left-0'} z-20 bg-[#121212] border border-white/10 rounded-xl shadow-2xl overflow-hidden p-1 gap-1 flex flex-col`}
                        >
                            {states.map((s) => (
                                <button
                                    key={s.label}
                                    onClick={() => {
                                        onChange(s.value);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-[10px] font-bold transition-colors ${value === s.value ? 'bg-primary/20 text-primary' : 'text-white/40 hover:bg-white/5 hover:text-white/60'}`}
                                >
                                    {s.label}模式
                                </button>
                            ))}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};
