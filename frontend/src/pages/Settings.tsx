import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings as SettingsIcon, Save, Lock, ArrowLeft, Loader2, AlertCircle, Cookie, CheckCircle2, XCircle, RefreshCw, Send, X } from 'lucide-react';
import * as api from '../api';
import type { FolderMigrationPreview, GlobalSettings, Task } from '../types';
import axios from 'axios';
import { Telegram } from './Telegram';

interface SettingsProps {
    onBack: () => void;
    onNotify: (msg: string, type: 'success' | 'error') => void;
}

type CookieStatus = 'valid' | 'invalid' | 'empty' | 'loading' | 'unknown';

interface CookiesState {
    douyin_status: CookieStatus;
    tiktok_status: CookieStatus;
    douyin_cookie_preview: string;
    tiktok_cookie_preview: string;
}

export const Settings = ({ onBack, onNotify }: SettingsProps) => {
    const [settings, setSettings] = useState<GlobalSettings>({
        download_video: true,
        download_note: true,
        auto_update_interval: 120,
        max_initial_fetch: 0,
        emby_server_url: '',
        emby_api_key: '',
        emby_default_library: '',
        folder_name_pattern: '{nickname}_{uid}',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'cookie' | 'download' | 'emby' | 'telegram' | 'security'>('cookie');

    // Password change state
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPwd, setChangingPwd] = useState(false);

    // Emby library selection
    const [libraries, setLibraries] = useState<{ id: string, name: string }[]>([]);
    const [fetchingLibraries, setFetchingLibraries] = useState(false);

    // Cookie state
    const [cookiesState, setCookiesState] = useState<CookiesState>({
        douyin_status: 'loading',
        tiktok_status: 'loading',
        douyin_cookie_preview: '',
        tiktok_cookie_preview: '',
    });
    const [douyinCookie, setDouyinCookie] = useState('');
    const [tiktokCookie, setTiktokCookie] = useState('');
    const [savingDouyinCookie, setSavingDouyinCookie] = useState(false);
    const [savingTiktokCookie, setSavingTiktokCookie] = useState(false);
    const [checkingCookies, setCheckingCookies] = useState(false);
    const [migrationPreview, setMigrationPreview] = useState<FolderMigrationPreview | null>(null);
    const [previewingMigration, setPreviewingMigration] = useState(false);
    const [startingMigration, setStartingMigration] = useState(false);
    const [migrationTask, setMigrationTask] = useState<Task | null>(null);
    const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);

    useEffect(() => {
        if (settings.emby_server_url && settings.emby_api_key) {
            handleFetchLibraries();
        }
    }, [settings.emby_server_url, settings.emby_api_key]);

    const handleFetchLibraries = async () => {
        if (!settings.emby_server_url || !settings.emby_api_key) return;
        setFetchingLibraries(true);
        try {
            const resp = await axios.get(`${settings.emby_server_url}/emby/Items`, {
                params: {
                    api_key: settings.emby_api_key,
                    Recursive: false,
                    IsFolder: true,
                    SortBy: 'SortName'
                }
            });
            if (resp.data?.Items) {
                setLibraries(resp.data.Items.map((i: any) => ({ id: i.Id, name: i.Name })));
            }
        } catch (err) {
            console.error('Fetch libraries failed', err);
        } finally {
            setFetchingLibraries(false);
        }
    };

    useEffect(() => {
        fetchSettings();
        fetchCookiesStatus(false);
    }, []);

    useEffect(() => {
        if (!migrationTask) return;

        const timer = window.setInterval(async () => {
            try {
                const tasks = await api.getActiveTasks();
                const activeMigration = tasks.find(task => task.id === migrationTask.id || task.target_id === 'folder_migration');
                if (activeMigration) {
                    setMigrationTask(activeMigration);
                } else {
                    setMigrationTask(null);
                    fetchMigrationPreview();
                }
            } catch (err) {
                console.error('Failed to poll folder migration task', err);
            }
        }, 2000);

        return () => window.clearInterval(timer);
    }, [migrationTask]);

    const fetchSettings = async () => {
        try {
            const data = await api.getSettings();
            setSettings(data);
        } catch (err) {
            onNotify('获取配置失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    const fetchCookiesStatus = async (check: boolean = false) => {
        setCheckingCookies(check);
        try {
            const data = await api.getCookiesStatus(check);
            setCookiesState({
                douyin_status: data.douyin_status as CookieStatus,
                tiktok_status: data.tiktok_status as CookieStatus,
                douyin_cookie_preview: data.douyin_cookie_preview,
                tiktok_cookie_preview: data.tiktok_cookie_preview,
            });
        } catch (err) {
            setCookiesState(s => ({ ...s, douyin_status: 'unknown', tiktok_status: 'unknown' }));
        } finally {
            setCheckingCookies(false);
        }
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await api.updateSettings(settings);
            onNotify('配置已更新', 'success');
        } catch (err) {
            onNotify('更新配置失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    const fetchMigrationPreview = async () => {
        setPreviewingMigration(true);
        try {
            const data = await api.previewFolderMigration(settings.folder_name_pattern || '{nickname}_{uid}');
            setMigrationPreview(data);
            if (data.total === 0) {
                onNotify('没有需要迁移的目录', 'success');
            } else {
                setIsMigrationModalOpen(true);
            }
        } catch (err) {
            onNotify('生成迁移预览失败', 'error');
        } finally {
            setPreviewingMigration(false);
        }
    };

    const handleRunFolderMigration = async () => {
        if (!migrationPreview) {
            onNotify('请先生成迁移预览', 'error');
            return;
        }

        if (migrationPreview.total === 0) {
            onNotify('没有需要迁移的目录', 'success');
            return;
        }

        if (migrationPreview.conflicts > 0) {
            onNotify('存在目标目录冲突，请先处理后再迁移', 'error');
            return;
        }

        const confirmed = window.confirm(`即将重命名 ${migrationPreview.total} 个作者目录并更新数据库路径。此操作会移动 videos 目录下的文件夹，是否继续？`);
        if (!confirmed) return;

        setStartingMigration(true);
        try {
            await api.updateSettings(settings);
            const result = await api.runFolderMigration();
            setMigrationTask({
                id: result.task_id,
                target_id: 'folder_migration',
                status: 'running',
                progress: 0,
                message: '目录迁移已启动',
                updated_at: Math.floor(Date.now() / 1000),
            });
            onNotify('目录迁移已启动', 'success');
        } catch (err: any) {
            onNotify(err.response?.data?.detail || '启动目录迁移失败', 'error');
        } finally {
            setStartingMigration(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            onNotify('两次输入密码不一致', 'error');
            return;
        }

        setChangingPwd(true);
        try {
            await api.changePassword(oldPassword, newPassword);
            onNotify('密码修改成功', 'success');
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            onNotify(err.response?.data?.detail || '密码修改失败', 'error');
        } finally {
            setChangingPwd(false);
        }
    };

    const handleSaveCookie = async (platform: 'douyin' | 'tiktok') => {
        const cookie = platform === 'douyin' ? douyinCookie : tiktokCookie;
        if (!cookie.trim()) {
            onNotify('Cookie 不能为空', 'error');
            return;
        }
        const setSaving = platform === 'douyin' ? setSavingDouyinCookie : setSavingTiktokCookie;
        setSaving(true);
        try {
            await api.updateCookie(platform, cookie.trim());
            onNotify(`${platform === 'douyin' ? '抖音' : 'TikTok'} Cookie 已保存，正在验证...`, 'success');
            if (platform === 'douyin') setDouyinCookie('');
            else setTiktokCookie('');
            // 重新检测状态
            await fetchCookiesStatus(true);
        } catch (err: any) {
            onNotify(err.response?.data?.detail || '保存 Cookie 失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    const CookieStatusBadge = ({ status }: { status: CookieStatus }) => {
        if (status === 'loading') {
            return <span className="flex items-center gap-1 text-xs text-white/40"><Loader2 size={12} className="animate-spin" />检测中</span>;
        }
        if (status === 'unknown') {
            return <span className="flex items-center gap-1 text-xs text-white/40">未检测</span>;
        }
        if (status === 'valid') {
            return <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400"><CheckCircle2 size={13} />有效</span>;
        }
        if (status === 'invalid') {
            return <span className="flex items-center gap-1.5 text-xs font-bold text-red-400"><XCircle size={13} />已失效</span>;
        }
        return <span className="flex items-center gap-1.5 text-xs font-bold text-white/30"><AlertCircle size={13} />未配置</span>;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-20">
                <Loader2 className="animate-spin text-primary" size={40} />
            </div>
        );
    }

    const hasInvalidCookie = cookiesState.douyin_status === 'invalid' || cookiesState.tiktok_status === 'invalid';

    return (
        <div className="space-y-10 pb-20">
            <header className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-white/60"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-3xl font-black tracking-tight text-white">系统设置</h2>
                        <p className="text-white/50 text-base mt-1">全局下载策略、Cookie 管理与安全验证</p>
                    </div>
                </div>
            </header>

            {/* 顶部 Tab 切换器 */}
            <div className="flex flex-wrap gap-2 border-b border-white/5 pb-4">
                {[
                    { id: 'cookie', label: 'Cookie 配置', icon: <Cookie size={16} /> },
                    { id: 'download', label: '下载与目录', icon: <Save size={16} /> },
                    { id: 'emby', label: 'Emby 集成', icon: <SettingsIcon size={16} /> },
                    { id: 'telegram', label: 'Telegram 同步', icon: <Send size={16} /> },
                    { id: 'security', label: '管理员安全', icon: <Lock size={16} /> }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all duration-200 active:scale-95 cursor-pointer ${
                            activeTab === tab.id
                                ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-8"
            >
                {activeTab === 'cookie' && (
                    <div className="space-y-6">
                        {/* Cookie 失效警告横幅 */}
                        {hasInvalidCookie && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30"
                            >
                                <XCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                                <div className="text-sm">
                                    <p className="font-bold text-red-300 mb-0.5">Cookie 已失效，视频抓取将无法正常工作</p>
                                    <p className="text-red-400/70">请在下方 Cookie 配置区域重新填写最新的 Cookie，保存后立即生效（无需重启容器）。</p>
                                </div>
                            </motion.div>
                        )}

                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-white/60 text-xs font-black uppercase tracking-widest">Cookie 配置</h3>
                                <button
                                    onClick={() => fetchCookiesStatus(true)}
                                    disabled={checkingCookies}
                                    className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    <RefreshCw size={12} className={checkingCookies ? 'animate-spin' : ''} />
                                    重新检测
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* 抖音 Cookie */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`p-6 border rounded-3xl space-y-4 flex flex-col backdrop-blur-sm ${
                                        cookiesState.douyin_status === 'invalid'
                                            ? 'border-red-500/30 bg-red-500/5'
                                            : cookiesState.douyin_status === 'valid'
                                            ? 'border-emerald-500/20 bg-emerald-500/5'
                                            : 'border-white/5 bg-white/2'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                                cookiesState.douyin_status === 'invalid' ? 'bg-red-500/15 text-red-400'
                                                : cookiesState.douyin_status === 'valid' ? 'bg-emerald-500/15 text-emerald-400'
                                                : 'bg-white/8 text-white/40'
                                            }`}>
                                                <Cookie size={18} />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white">抖音 Cookie</h4>
                                                {cookiesState.douyin_cookie_preview && (
                                                    <p className="text-white/30 text-xs font-mono mt-0.5 truncate max-w-[140px]">{cookiesState.douyin_cookie_preview}</p>
                                                )}
                                            </div>
                                        </div>
                                        <CookieStatusBadge status={cookiesState.douyin_status} />
                                    </div>

                                    <div className="space-y-2 flex-1">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">粘贴新 Cookie</label>
                                        <textarea
                                            value={douyinCookie}
                                            onChange={(e) => setDouyinCookie(e.target.value)}
                                            rows={4}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-xs font-mono resize-none text-white"
                                            placeholder={cookiesState.douyin_cookie_preview ? `当前已配置: ${cookiesState.douyin_cookie_preview}` : "从浏览器开发者工具复制完整的 Cookie 字符串粘贴到此处..."}
                                        />
                                        <p className="text-white/30 text-xs pl-1">在抖音网页版登录后，F12 → Network → 任意请求 → Request Headers → Cookie</p>
                                    </div>

                                    <button
                                        onClick={() => handleSaveCookie('douyin')}
                                        disabled={savingDouyinCookie || !douyinCookie.trim()}
                                        className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-40 transition-all rounded-xl font-black text-xs border border-primary/20 cursor-pointer"
                                    >
                                        {savingDouyinCookie ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        保存抖音 Cookie
                                    </button>
                                </motion.div>

                                {/* TikTok Cookie */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.05 }}
                                    className={`p-6 border rounded-3xl space-y-4 flex flex-col backdrop-blur-sm ${
                                        cookiesState.tiktok_status === 'invalid'
                                            ? 'border-red-500/30 bg-red-500/5'
                                            : cookiesState.tiktok_status === 'valid'
                                            ? 'border-emerald-500/20 bg-emerald-500/5'
                                            : 'border-white/5 bg-white/2'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                                cookiesState.tiktok_status === 'invalid' ? 'bg-red-500/15 text-red-400'
                                                : cookiesState.tiktok_status === 'valid' ? 'bg-emerald-500/15 text-emerald-400'
                                                : 'bg-white/8 text-white/40'
                                            }`}>
                                                <Cookie size={18} />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white">TikTok Cookie</h4>
                                                {cookiesState.tiktok_cookie_preview && (
                                                    <p className="text-white/30 text-xs font-mono mt-0.5 truncate max-w-[140px]">{cookiesState.tiktok_cookie_preview}</p>
                                                )}
                                            </div>
                                        </div>
                                        <CookieStatusBadge status={cookiesState.tiktok_status} />
                                    </div>

                                    <div className="space-y-2 flex-1">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">粘贴新 Cookie</label>
                                        <textarea
                                            value={tiktokCookie}
                                            onChange={(e) => setTiktokCookie(e.target.value)}
                                            rows={4}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-xs font-mono resize-none text-white"
                                            placeholder={cookiesState.tiktok_cookie_preview ? `当前已配置: ${cookiesState.tiktok_cookie_preview}` : "从浏览器开发者工具复制完整的 TikTok Cookie 字符串粘贴到此处..."}
                                        />
                                        <p className="text-white/30 text-xs pl-1">在 TikTok 网页版登录后，F12 → Network → 任意请求 → Request Headers → Cookie</p>
                                    </div>

                                    <button
                                        onClick={() => handleSaveCookie('tiktok')}
                                        disabled={savingTiktokCookie || !tiktokCookie.trim()}
                                        className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 disabled:opacity-40 transition-all rounded-xl font-black text-xs border border-cyan-500/20 cursor-pointer"
                                    >
                                        {savingTiktokCookie ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        保存 TikTok Cookie
                                    </button>
                                </motion.div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'download' && (
                    <div className="max-w-3xl mx-auto w-full">
                        {/* Global Download Settings */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                    <Save size={20} />
                                </div>
                                <h3 className="font-bold text-lg text-white">默认下载</h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1 pt-2">
                                {/* Left Column: Toggles and Cycle inputs */}
                                <div className="space-y-5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-white font-semibold text-base">自动下载视频</p>
                                            <p className="text-white/40 text-xs">同步获取到的视频</p>
                                        </div>
                                        <button
                                            onClick={() => setSettings(s => ({ ...s, download_video: !s.download_video }))}
                                            className={`w-10 h-6 rounded-full transition-all relative cursor-pointer ${settings.download_video ? 'bg-primary' : 'bg-white/10'}`}
                                        >
                                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${settings.download_video ? 'left-4.5' : 'left-0.5'}`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-white font-semibold text-base">自动下载图文</p>
                                            <p className="text-white/40 text-xs">获取 ZIP 并解压</p>
                                        </div>
                                        <button
                                            onClick={() => setSettings(s => ({ ...s, download_note: !s.download_note }))}
                                            className={`w-10 h-6 rounded-full transition-all relative cursor-pointer ${settings.download_note ? 'bg-primary' : 'bg-white/10'}`}
                                        >
                                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${settings.download_note ? 'left-4.5' : 'left-0.5'}`} />
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">监测周期 (分钟)</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={settings.auto_update_interval}
                                            onChange={(e) => setSettings(s => ({ ...s, auto_update_interval: parseInt(e.target.value) || 1 }))}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all font-bold text-base text-white"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">默认初始抓取数量 (0=全量)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={settings.max_initial_fetch || 0}
                                            onChange={(e) => setSettings(s => ({ ...s, max_initial_fetch: parseInt(e.target.value) || 0 }))}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all font-bold text-base text-white"
                                        />
                                    </div>
                                </div>

                                {/* Right Column: Folder Rule and Directory Migration */}
                                <div className="space-y-5">
                                    <div className="space-y-2">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">文件夹命名规则</label>
                                        <input
                                            type="text"
                                            value={settings.folder_name_pattern || ''}
                                            onChange={(e) => setSettings(s => ({ ...s, folder_name_pattern: e.target.value }))}
                                            placeholder="{nickname}_{uid}"
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all font-bold text-sm font-mono text-white"
                                        />
                                        <p className="text-[10px] text-white/30 pl-1 leading-normal">
                                            支持替换标签：<code className="text-primary/70">{`{nickname}`}</code>（昵称）、
                                            <code className="text-primary/70">{`{uid}`}</code>（用户ID）、
                                            <code className="text-primary/70">{`{platform}`}</code>（所属平台）。<br />
                                            默认示例：<code className="text-white/50">{`{nickname}_{uid}`}</code>
                                        </p>
                                    </div>

                                    <div className="space-y-3 rounded-2xl border border-white/5 bg-black/20 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-white font-bold text-sm">已有目录迁移</p>
                                                <p className="text-white/35 text-xs mt-1 leading-normal">先预览，再按当前命名规则重命名已有作者目录并更新数据库路径。</p>
                                            </div>
                                            {migrationTask && (
                                                <span className="shrink-0 text-[10px] font-black text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
                                                    {migrationTask.progress}%
                                                </span>
                                            )}
                                        </div>

                                        {migrationTask && (
                                            <div className="space-y-2">
                                                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full bg-primary transition-all" style={{ width: `${migrationTask.progress}%` }} />
                                                </div>
                                                <p className="text-[10px] text-white/40 truncate">{migrationTask.message || '正在迁移目录...'}</p>
                                            </div>
                                        )}

                                        {migrationPreview && (
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-xs bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-white/50">待迁移 {migrationPreview.total} 个</span>
                                                        {migrationPreview.conflicts > 0 && <span className="text-red-400 font-bold">冲突 {migrationPreview.conflicts} 个</span>}
                                                    </div>
                                                    <button 
                                                        type="button"
                                                        onClick={() => setIsMigrationModalOpen(true)}
                                                        className="text-primary hover:underline font-bold text-xs cursor-pointer bg-transparent border-none p-0 outline-none"
                                                    >
                                                        查看全部清单
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={fetchMigrationPreview}
                                                disabled={previewingMigration || !!migrationTask}
                                                className="flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 disabled:opacity-40 transition-all rounded-xl font-black text-xs border border-white/10 cursor-pointer"
                                            >
                                                {previewingMigration ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                                预览
                                            </button>
                                            <button
                                                onClick={handleRunFolderMigration}
                                                disabled={startingMigration || !!migrationTask || !migrationPreview || migrationPreview.total === 0 || migrationPreview.conflicts > 0}
                                                className="flex items-center justify-center gap-2 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-40 transition-all rounded-xl font-black text-xs border border-primary/20 cursor-pointer"
                                            >
                                                {startingMigration ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                执行迁移
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleSaveSettings}
                                disabled={saving}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50 transition-all rounded-xl font-black text-xs border border-primary/20 mt-2 cursor-pointer"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                保存下载配置
                            </button>
                        </motion.div>
                    </div>
                )}

                {activeTab === 'emby' && (
                    <div className="max-w-3xl mx-auto w-full">
                        {/* Emby Integration Settings */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                                    <SettingsIcon size={20} />
                                </div>
                                <h3 className="font-bold text-lg text-white">Emby 媒体集成</h3>
                            </div>

                            <div className="space-y-4 flex-1 pt-2">
                                <div className="space-y-2">
                                    <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">服务器 URL</label>
                                    <input
                                        type="text"
                                        value={settings.emby_server_url || ''}
                                        onChange={(e) => setSettings(s => ({ ...s, emby_server_url: e.target.value }))}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-sm text-white"
                                        placeholder="http://ip:port"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">API Key</label>
                                    <input
                                        type="password"
                                        value={settings.emby_api_key || ''}
                                        onChange={(e) => setSettings(s => ({ ...s, emby_api_key: e.target.value }))}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-sm text-white"
                                        placeholder="Emby API Key"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">默认库</label>
                                    <div className="relative">
                                        <select
                                            value={settings.emby_default_library || ''}
                                            onChange={(e) => setSettings(s => ({ ...s, emby_default_library: e.target.value }))}
                                            className="w-full appearance-none bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-sm cursor-pointer text-white"
                                        >
                                            <option value="" className="bg-[#1a1a1a]">-- 所有媒体库 --</option>
                                            {libraries.map(lib => (
                                                <option key={lib.id} value={lib.id} className="bg-[#1a1a1a]">
                                                    {lib.name}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                                            <ArrowLeft size={16} className="-rotate-90" />
                                        </div>
                                    </div>
                                    <p className="text-xs text-white/50 pl-1 mt-1 font-medium min-h-[15px]">
                                        {fetchingLibraries ? '正在获取媒体库...' : libraries.length === 0 ? '填写凭据后自动加载' : '播放器将优先检索此库'}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={handleSaveSettings}
                                disabled={saving}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 disabled:opacity-50 transition-all rounded-xl font-black text-xs border border-blue-500/20 mt-2 cursor-pointer"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                更新集成配置
                            </button>
                        </motion.div>
                    </div>
                )}

                {activeTab === 'telegram' && (
                    <Telegram isTab={true} onNotify={onNotify} />
                )}

                {activeTab === 'security' && (
                    <div className="max-w-3xl mx-auto w-full">
                        {/* Password Security */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                                    <Lock size={20} />
                                </div>
                                <h3 className="font-bold text-lg text-white">管理员安全</h3>
                            </div>

                            <form onSubmit={handleChangePassword} className="space-y-4 flex-1 pt-2">
                                <div className="space-y-2">
                                    <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">当前密码</label>
                                    <input
                                        type="password"
                                        value={oldPassword}
                                        onChange={(e) => setOldPassword(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm text-white"
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">新密码</label>
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm text-white"
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">重复新密码</label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm text-white"
                                        required
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={changingPwd}
                                    className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 disabled:opacity-50 transition-all rounded-xl font-black text-xs border border-amber-500/20 mt-2 cursor-pointer"
                                >
                                    {changingPwd ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                                    更新验证凭据
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </motion.div>

            {/* 迁移预览弹窗 */}
            <AnimatePresence>
                {isMigrationModalOpen && migrationPreview && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                        {/* Background Overlay */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsMigrationModalOpen(false)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-md"
                        />
                        {/* Modal Container */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative bg-[#0d0d0f] border border-white/10 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
                        >
                            {/* Modal Header */}
                            <div className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
                                <div>
                                    <h3 className="text-xl font-black text-white">已有目录迁移预览</h3>
                                    <p className="text-white/40 text-xs mt-1">
                                        基于命名规则: <code className="text-primary font-mono">{settings.folder_name_pattern || '{nickname}_{uid}'}</code>
                                    </p>
                                </div>
                                <button 
                                    onClick={() => setIsMigrationModalOpen(false)} 
                                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all active:scale-95 cursor-pointer"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 overflow-y-auto custom-scrollbar space-y-4 flex-1">
                                <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-xs text-white/60 leading-relaxed shrink-0">
                                    <AlertCircle size={16} className="text-primary shrink-0" />
                                    <div>
                                        总计待迁移 <span className="font-bold text-white">{migrationPreview.total}</span> 个目录。
                                        {migrationPreview.conflicts > 0 ? (
                                            <span className="text-red-400 font-bold ml-1">其中存在 {migrationPreview.conflicts} 个目标路径冲突，需修改规则或清理冲突文件夹后再执行迁移。</span>
                                        ) : (
                                            <span className="text-emerald-400 font-bold ml-1">无冲突，可安全执行。</span>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2.5">
                                    {migrationPreview.items.map((item, index) => (
                                        <div 
                                            key={item.uid || index} 
                                            className={`p-4 border rounded-2xl flex flex-col gap-2 transition-all ${
                                                item.conflict 
                                                    ? 'border-red-500/20 bg-red-500/5' 
                                                    : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-sm text-white">{item.nickname}</span>
                                                    <span className="text-[10px] text-white/30 font-mono px-1.5 py-0.5 rounded bg-white/5">{item.platform}</span>
                                                </div>
                                                {item.conflict && (
                                                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                                                        路径冲突
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                                                <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                                                    <p className="text-white/30 text-[9px] uppercase tracking-wider mb-1">当前目录</p>
                                                    <p className="text-white/60 truncate" title={item.from_folder}>{item.from_folder}</p>
                                                </div>
                                                <div className={`p-2.5 rounded-xl border ${item.conflict ? 'bg-red-500/5 border-red-500/10' : 'bg-primary/5 border-primary/10'}`}>
                                                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${item.conflict ? 'text-red-400/40' : 'text-primary/40'}`}>目标目录</p>
                                                    <p className={`truncate font-bold ${item.conflict ? 'text-red-300' : 'text-primary'}`} title={item.to_folder}>{item.to_folder}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="p-6 border-t border-white/5 flex gap-3 justify-end shrink-0 bg-[#0a0a0c]">
                                <button
                                    onClick={() => setIsMigrationModalOpen(false)}
                                    className="px-6 py-3 rounded-xl font-black text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 active:scale-95 transition-all cursor-pointer"
                                >
                                    关闭预览
                                </button>
                                <button
                                    onClick={() => {
                                        setIsMigrationModalOpen(false);
                                        handleRunFolderMigration();
                                    }}
                                    disabled={startingMigration || !!migrationTask || migrationPreview.total === 0 || migrationPreview.conflicts > 0}
                                    className="px-6 py-3 rounded-xl font-black text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all cursor-pointer flex items-center gap-2"
                                >
                                    {startingMigration ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    执行迁移
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 flex gap-4 items-start">
                <AlertCircle size={18} className="text-primary shrink-0 mt-0.5" />
                <div className="text-xs text-white/50 leading-relaxed">
                    <p className="font-black text-white/60 mb-1 uppercase tracking-tighter text-sm">Priority Note</p>
                    <p>全局设置仅作为默认行为。若在"发现 & 下载"中为特定账号设置了独立偏好，则以该账号的专项配置为准，系统将自动覆盖全局设定。</p>
                </div>
            </div>
        </div>
    );
};
