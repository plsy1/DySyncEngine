import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Save, Lock, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import * as api from '../api';
import type { GlobalSettings } from '../types';
import axios from 'axios';

interface SettingsProps {
    onBack: () => void;
    onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const Settings = ({ onBack, onNotify }: SettingsProps) => {
    const [settings, setSettings] = useState<GlobalSettings>({
        download_video: true,
        download_note: true,
        auto_update_interval: 120,
        emby_server_url: '',
        emby_api_key: '',
        emby_default_library: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Password change state
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPwd, setChangingPwd] = useState(false);

    // Emby library selection
    const [libraries, setLibraries] = useState<{ id: string, name: string }[]>([]);
    const [fetchingLibraries, setFetchingLibraries] = useState(false);

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
    }, []);

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

    if (loading) {
        return (
            <div className="flex items-center justify-center p-20">
                <Loader2 className="animate-spin text-primary" size={40} />
            </div>
        );
    }

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
                        <p className="text-white/50 text-base mt-1">全局下载策略、媒体中心集成与安全验证</p>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

                    <div className="space-y-5 flex-1 pt-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white font-semibold text-base">自动下载视频</p>
                                <p className="text-white/40 text-xs">同步获取到的视频</p>
                            </div>
                            <button
                                onClick={() => setSettings(s => ({ ...s, download_video: !s.download_video }))}
                                className={`w-10 h-6 rounded-full transition-all relative ${settings.download_video ? 'bg-primary' : 'bg-white/10'}`}
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
                                className={`w-10 h-6 rounded-full transition-all relative ${settings.download_note ? 'bg-primary' : 'bg-white/10'}`}
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
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all font-bold text-base"
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleSaveSettings}
                        disabled={saving}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50 transition-all rounded-xl font-black text-xs border border-primary/20 mt-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        保存下载配置
                    </button>
                </motion.div>

                {/* Password Security */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
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
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">新密码</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">重复新密码</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={changingPwd}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 disabled:opacity-50 transition-all rounded-xl font-black text-xs border border-amber-500/20 mt-2"
                        >
                            {changingPwd ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                            更新验证凭据
                        </button>
                    </form>
                </motion.div>

                {/* Emby Integration Settings */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
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
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-sm"
                                placeholder="http://ip:port"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">API Key</label>
                            <input
                                type="password"
                                value={settings.emby_api_key || ''}
                                onChange={(e) => setSettings(s => ({ ...s, emby_api_key: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-sm"
                                placeholder="Emby API Key"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">默认库</label>
                            <div className="relative">
                                <select
                                    value={settings.emby_default_library || ''}
                                    onChange={(e) => setSettings(s => ({ ...s, emby_default_library: e.target.value }))}
                                    className="w-full appearance-none bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 transition-all text-sm cursor-pointer"
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
                        className="w-full flex items-center justify-center gap-2 py-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 disabled:opacity-50 transition-all rounded-xl font-black text-xs border border-blue-500/20 mt-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        更新集成配置
                    </button>
                </motion.div>
            </div>

            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 flex gap-4 items-start">
                <AlertCircle size={18} className="text-primary shrink-0 mt-0.5" />
                <div className="text-xs text-white/50 leading-relaxed">
                    <p className="font-black text-white/60 mb-1 uppercase tracking-tighter text-sm">Priority Note</p>
                    <p>全局设置仅作为默认行为。若在“发现 & 下载”中为特定账号设置了独立偏好，则以该账号的专项配置为准，系统将自动覆盖全局设定。</p>
                </div>
            </div>
        </div>
    );
};
