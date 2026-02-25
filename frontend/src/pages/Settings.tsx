import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Save, Lock, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import * as api from '../api';
import type { GlobalSettings } from '../types';

interface SettingsProps {
    onBack: () => void;
    onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const Settings = ({ onBack, onNotify }: SettingsProps) => {
    const [settings, setSettings] = useState<GlobalSettings>({
        download_video: true,
        download_note: true,
        auto_update_interval: 120,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Password change state
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPwd, setChangingPwd] = useState(false);

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
        <div className="max-w-4xl mx-auto p-6">
            <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-white/60"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex items-center gap-3">
                        <SettingsIcon className="text-primary" size={28} />
                        <h1 className="text-3xl font-bold text-white">系统设置</h1>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Global Download Settings */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="glass-card p-8 space-y-8"
                >
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Save className="text-primary" size={20} />
                        <h2 className="text-xl font-bold text-white">默认下载配置</h2>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white font-medium">自动下载视频</p>
                                <p className="text-white/40 text-sm">默认同步获取到的视频文件</p>
                            </div>
                            <button
                                onClick={() => setSettings(s => ({ ...s, download_video: !s.download_video }))}
                                className={`w-14 h-8 rounded-full transition-all relative ${settings.download_video ? 'bg-primary' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${settings.download_video ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white font-medium">自动下载图文</p>
                                <p className="text-white/40 text-sm">默认同步获取到的图文 ZIP 包并解压</p>
                            </div>
                            <button
                                onClick={() => setSettings(s => ({ ...s, download_note: !s.download_note }))}
                                className={`w-14 h-8 rounded-full transition-all relative ${settings.download_note ? 'bg-primary' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${settings.download_note ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white font-medium">自动更新间隔 (分钟)</p>
                                <p className="text-white/40 text-sm">每隔多久自动检查一次作者视频更新</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="1"
                                    value={settings.auto_update_interval}
                                    onChange={(e) => setSettings(s => ({ ...s, auto_update_interval: parseInt(e.target.value) || 1 }))}
                                    className="w-24 bg-white/5 border border-white/10 rounded-xl py-2 px-3 outline-none focus:border-primary/50 transition-all text-white text-center text-sm"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleSaveSettings}
                            disabled={saving}
                            className="w-full btn-primary py-4 mt-4 flex items-center justify-center gap-2"
                        >
                            {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                            保存默认设置
                        </button>
                    </div>
                </motion.div>

                {/* Password Security */}
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="glass-card p-8 space-y-8"
                >
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Lock className="text-primary" size={20} />
                        <h2 className="text-xl font-bold text-white">安全与账户</h2>
                    </div>

                    <form onSubmit={handleChangePassword} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">当前密码</label>
                            <input
                                type="password"
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 transition-all text-white text-sm"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">新密码</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 transition-all text-white text-sm"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">确认新密码</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 transition-all text-white text-sm"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={changingPwd}
                            className="w-full btn-primary bg-white/10 hover:bg-white/20 text-white border-white/10 py-4 mt-2 flex items-center justify-center gap-2"
                        >
                            {changingPwd ? <Loader2 className="animate-spin" size={20} /> : <Lock size={20} />}
                            修改管理员密码
                        </button>
                    </form>
                </motion.div>
            </div>

            <div className="mt-8 p-6 rounded-2xl bg-amber-500/5 border border-amber-500/10 text-amber-500/80 text-sm">
                <div className="flex gap-3">
                    <AlertCircle size={20} className="shrink-0" />
                    <p>
                        注意：此处设置的是全局默认行为。如果您为特定用户单独设置了下载偏好，则该用户的偏好将优先于此处设置。
                    </p>
                </div>
            </div>
        </div>
    );
};
