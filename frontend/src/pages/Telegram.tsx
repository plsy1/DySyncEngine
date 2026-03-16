import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Save, ArrowLeft, Loader2, MessageSquare, ShieldCheck, Key, Phone, Settings as SettingsIcon } from 'lucide-react';
import * as api from '../api';

interface TelegramProps {
    onBack: () => void;
    onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const Telegram = ({ onBack, onNotify }: TelegramProps) => {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [chats, setChats] = useState<any[]>([]);
    
    // Auth flow
    const [step, setStep] = useState<'info' | 'code'>('info');
    const [apiId, setApiId] = useState('');
    const [apiHash, setApiHash] = useState('');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Settings
    const [targetChat, setTargetChat] = useState('');
    const [autoUpload, setAutoUpload] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchStatus();
    }, []);

    const fetchStatus = async () => {
        try {
            const data = await api.getTgStatus();
            setStatus(data);
            setApiId(data.api_id || '');
            setTargetChat(data.target_chat || '');
            setAutoUpload(data.auto_upload || false);
            
            if (data.is_authorized) {
                fetchChats();
            }
        } catch (err) {
            onNotify('获取 TG 状态失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    const fetchChats = async () => {
        try {
            const data = await api.getTgChats(); 
            if (data.chats) setChats(data.chats);
        } catch (err) {}
    };

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const res = await api.tgSetup(parseInt(apiId), apiHash, phone);
            if (res.status === 'needs_code') {
                setStep('code');
                onNotify('验证码已发送', 'success');
            } else if (res.status === 'authorized') {
                onNotify('已成功授权', 'success');
                fetchStatus();
            }
        } catch (err: any) {
            onNotify(err.response?.data?.detail || '设置失败', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const res = await api.tgVerify(code, password);
            if (res.status === 'authorized') {
                onNotify('登录成功', 'success');
                fetchStatus();
                setStep('info');
            } else {
                onNotify(res.message || '验证失败', 'error');
            }
        } catch (err) {
            onNotify('验证过程出错', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await api.updateTgSettings(targetChat, autoUpload);
            onNotify('TG 配置已更新', 'success');
            fetchStatus();
        } catch (err) {
            onNotify('更新失败', 'error');
        } finally {
            setSaving(false);
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
                        <Send className="text-primary" size={28} />
                        <h1 className="text-3xl font-bold text-white">Telegram 同步</h1>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Auth Panel */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card p-8 space-y-6"
                >
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center gap-3">
                            <ShieldCheck className={status?.is_authorized ? "text-green-500" : "text-amber-500"} size={20} />
                            <h2 className="text-xl font-bold text-white">账号状态</h2>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${status?.is_authorized ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                            {status?.is_authorized ? '已连接' : '未连接'}
                        </span>
                    </div>

                    {!status?.is_authorized ? (
                        step === 'info' ? (
                            <form onSubmit={handleSetup} className="space-y-4">
                                <p className="text-white/40 text-sm">连接到 Telegram 以启用自动上传功能。您需要从 my.telegram.org 获取 API 凭据。</p>
                                <div>
                                    <label className="block text-xs font-medium text-white/40 mb-1">API ID</label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                                        <input type="number" value={apiId} onChange={e => setApiId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 outline-none focus:border-primary/50 text-sm" placeholder="1234567" required />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-white/40 mb-1">API Hash</label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                                        <input type="text" value={apiHash} onChange={e => setApiHash(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 outline-none focus:border-primary/50 text-sm" placeholder="abcdef..." required />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-white/40 mb-1">手机号 (带区号)</label>
                                    <div className="relative">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                                        <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 outline-none focus:border-primary/50 text-sm" placeholder="+86138..." required />
                                    </div>
                                </div>
                                <button type="submit" disabled={submitting} className="w-full btn-primary py-4 mt-2 flex items-center justify-center gap-2">
                                    {submitting ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                                    发送验证码
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleVerify} className="space-y-4">
                                <p className="text-white/40 text-sm">请输入收到的验证码。如果开启了两步验证，还需输入二步验证密码。</p>
                                <div>
                                    <label className="block text-xs font-medium text-white/40 mb-1">验证码</label>
                                    <input type="text" value={code} onChange={e => setCode(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 text-sm" placeholder="Code" required />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-white/40 mb-1">2FA 密码 (可选)</label>
                                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 text-sm" placeholder="Password" />
                                </div>
                                <button type="submit" disabled={submitting} className="w-full btn-primary py-4 mt-2 flex items-center justify-center gap-2">
                                    {submitting ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
                                    完成验证
                                </button>
                                <button type="button" onClick={() => setStep('info')} className="w-full py-2 text-white/20 text-xs hover:text-white/40">返回修改信息</button>
                            </form>
                        )
                    ) : (
                        <div className="py-10 text-center space-y-4">
                            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                                <ShieldCheck className="text-green-500" size={32} />
                            </div>
                            <div>
                                <h3 className="text-white font-bold">同步引擎就绪</h3>
                                <p className="text-white/40 text-sm mt-1">当前已成功连接 Telegram 账号</p>
                            </div>
                            <button 
                                onClick={() => { /* Logout/Reset logic could go here */ }} 
                                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/10 text-white/20 hover:text-red-400 text-xs transition-all"
                            >
                                重新连接
                            </button>
                        </div>
                    )}
                </motion.div>

                {/* Settings Panel */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card p-8 space-y-6"
                >
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <SettingsIcon className="text-primary" size={20} />
                        <h2 className="text-xl font-bold text-white">推送配置</h2>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white font-medium">自动同步到 TG</p>
                                <p className="text-white/40 text-sm">下载完成后自动将文件上传</p>
                            </div>
                            <button
                                onClick={() => setAutoUpload(!autoUpload)}
                                className={`w-14 h-8 rounded-full transition-all relative ${autoUpload ? 'bg-primary' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${autoUpload ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-white/40 mb-2">目标对话/频道</label>
                            {status?.is_authorized && chats.length > 0 ? (
                                <select 
                                    value={targetChat}
                                    onChange={(e) => setTargetChat(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 text-sm text-white appearance-none"
                                >
                                    <option value="">-- 请选择目标 --</option>
                                    {chats.map(chat => (
                                        <option key={chat.id} value={chat.id}>{chat.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <input 
                                    type="text" 
                                    value={targetChat} 
                                    onChange={(e) => setTargetChat(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 text-sm"
                                    placeholder="用户ID, 频道ID或用户名"
                                />
                            )}
                            <p className="text-[10px] text-white/20 mt-2 italic">提示: 确保您的账号已经加入了该频道或对话。</p>
                        </div>

                        <button
                            onClick={handleSaveSettings}
                            disabled={saving}
                            className="w-full btn-primary py-4 mt-2 flex items-center justify-center gap-2"
                        >
                            {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                            保存同步设置
                        </button>
                    </div>
                </motion.div>
            </div>
            
            <div className="mt-8 p-6 rounded-2xl bg-primary/5 border border-primary/10 text-primary/80 text-sm">
                <div className="flex gap-3">
                    <MessageSquare size={20} className="shrink-0" />
                    <p>
                        自动同步启用后，DySyncEngine 将在每次成功拉取作者更新并下载到本地后，自动将文件队列推送到您指定的 Telegram 目標。图文内容将自动分段发送。
                    </p>
                </div>
            </div>
        </div>
    );
};
