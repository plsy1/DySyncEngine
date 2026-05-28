import { useState, useEffect } from 'react';
import { Send, Save, ArrowLeft, Loader2, MessageSquare, ShieldCheck, Settings as SettingsIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import * as api from '../api';

interface TelegramProps {
    onBack?: () => void;
    onNotify: (msg: string, type: 'success' | 'error') => void;
    isTab?: boolean;
}

export const Telegram = ({ onBack, onNotify, isTab = false }: TelegramProps) => {
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
    
    // Searchable dropdown state
    const [chatSearch, setChatSearch] = useState('');
    const [showChatDropdown, setShowChatDropdown] = useState(false);

    useEffect(() => {
        fetchStatus();
    }, []);

    const filteredChats = chats.filter(c => 
        c.name.toLowerCase().includes(chatSearch.toLowerCase()) || 
        c.id.toString().includes(chatSearch)
    );

    const fetchStatus = async () => {
        try {
            const data = await api.getTgStatus();
            setStatus(data);
            setApiId(data.api_id || '');
            setTargetChat(data.target_chat || '');
            setAutoUpload(data.auto_upload || false);
            
            if (data.is_authorized) {
                const fetched = await fetchChats();
                // 如果已有目标 ID，尝试回显名称
                if (data.target_chat && fetched) {
                    const current = fetched.find((c: any) => c.id.toString() === data.target_chat.toString());
                    if (current) setChatSearch(current.name);
                }
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
            if (data.chats) {
                setChats(data.chats);
                return data.chats;
            }
        } catch (err) {}
        return null;
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
        <div className={isTab ? 'space-y-6' : 'space-y-10 pb-20'}>
            {!isTab && (
                <header className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-white/60"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h2 className="text-3xl font-black tracking-tight text-white">Telegram 同步</h2>
                            <p className="text-white/50 text-base mt-1">即时推送、自动化审计与云端投递</p>
                        </div>
                    </div>
                </header>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Auth Panel */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${status?.is_authorized ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500"}`}>
                                <ShieldCheck size={20} />
                            </div>
                            <h3 className="font-bold text-lg text-white">账号授权</h3>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${status?.is_authorized ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                            {status?.is_authorized ? 'Active' : 'Missing'}
                        </span>
                    </div>

                    {!status?.is_authorized ? (
                        step === 'info' ? (
                            <form onSubmit={handleSetup} className="space-y-4 flex-1 pt-2">
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">API ID</label>
                                        <input type="number" value={apiId} onChange={e => setApiId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm" placeholder="12345" required />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">API Hash</label>
                                        <input type="text" value={apiHash} onChange={e => setApiHash(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm" placeholder="hash" required />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">手机号</label>
                                        <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm" placeholder="+86..." required />
                                    </div>
                                </div>
                                <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/20 text-primary transition-all rounded-xl font-black text-xs border border-primary/20 mt-2">
                                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    发送登入请求
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleVerify} className="space-y-4 flex-1 pt-2">
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">验证码</label>
                                        <input type="text" value={code} onChange={e => setCode(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm text-center font-bold tracking-widest" placeholder="-----" required />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">二步验证 (若有)</label>
                                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-sm" placeholder="Optional" />
                                    </div>
                                </div>
                                <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/20 text-primary transition-all rounded-xl font-black text-xs border border-primary/20 mt-2">
                                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                                    确认并登入
                                </button>
                                <button type="button" onClick={() => setStep('info')} className="w-full py-2 text-white/50 text-[10px] font-bold hover:text-white/80 underline decoration-white/20">修改配置信息</button>
                            </form>
                        )
                    ) : (
                        <div className="py-10 flex flex-col items-center justify-center text-center space-y-5 flex-1 pt-2">
                            <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center animate-pulse">
                                <ShieldCheck className="text-green-500" size={32} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-white">授权已就绪</h3>
                                <p className="text-white/60 text-[11px] mt-1 max-w-[180px] mx-auto leading-relaxed">系统已成功通过 Telegram 官方验证，可随时执行同步任务。</p>
                            </div>
                            <button 
                                onClick={() => { fetchStatus(); }} 
                                className="px-6 py-2 rounded-lg bg-white/10 border border-white/20 hover:bg-white/20 text-white/70 hover:text-white text-[10px] font-black transition-all uppercase tracking-widest"
                            >
                                强制刷新状态
                            </button>
                        </div>
                    )}
                </motion.div>

                {/* Settings Panel */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                            <SettingsIcon size={20} />
                        </div>
                        <h3 className="font-bold text-lg text-white">推送配置</h3>
                    </div>

                    <div className="space-y-6 flex-1 pt-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white font-semibold text-base">自动同步</p>
                                <p className="text-white/50 text-xs">任务完成即刻上传</p>
                            </div>
                            <button
                                onClick={() => setAutoUpload(!autoUpload)}
                                className={`w-10 h-6 rounded-full transition-all relative ${autoUpload ? 'bg-primary' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${autoUpload ? 'left-4.5' : 'left-0.5'}`} />
                            </button>
                        </div>

                        <div className="space-y-2">
                            <label className="text-white/50 text-xs font-black uppercase tracking-widest pl-1">目标会话 / 频道 ID</label>
                            
                            {status?.is_authorized ? (
                                <div className="relative">
                                    <input 
                                        type="text"
                                        placeholder="搜索或输入..."
                                        value={chatSearch}
                                        onChange={(e) => {
                                            setChatSearch(e.target.value);
                                            setShowChatDropdown(true);
                                        }}
                                        onFocus={() => setShowChatDropdown(true)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-xs"
                                    />

                                    <AnimatePresence>
                                        {showChatDropdown && (
                                            <>
                                                <div className="fixed inset-0 z-10" onClick={() => setShowChatDropdown(false)} />
                                                <motion.div
                                                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                                    className="absolute top-full left-0 right-0 mt-2 z-20 bg-[#161616] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[250px]"
                                                >
                                                    <div className="overflow-y-auto p-1.5 gap-1 flex flex-col custom-scrollbar">
                                                        {filteredChats.length > 0 ? (
                                                            filteredChats.map(chat => (
                                                                <button
                                                                    key={chat.id}
                                                                    onClick={() => {
                                                                        setTargetChat(chat.id);
                                                                        setChatSearch(chat.name);
                                                                        setShowChatDropdown(false);
                                                                    }}
                                                                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center justify-between group ${targetChat === chat.id ? 'bg-primary/20 text-primary' : 'hover:bg-white/5 text-white/50'}`}
                                                                >
                                                                    <div className="flex flex-col min-w-0">
                                                                        <span className="text-xs font-bold truncate pr-2">{chat.name}</span>
                                                                        <span className="text-[9px] opacity-20 font-mono truncate">{chat.id}</span>
                                                                    </div>
                                                                    <span className="text-[8px] font-black uppercase opacity-20 group-hover:opacity-40">{chat.type}</span>
                                                                </button>
                                                            ))
                                                        ) : (
                                                            <div className="p-4 text-center text-white/10 text-[10px] italic">无搜索结果</div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            </>
                                        )}
                                    </AnimatePresence>
                                </div>
                            ) : (
                                <input 
                                    type="text" 
                                    value={targetChat} 
                                    onChange={(e) => setTargetChat(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 outline-none focus:border-primary/50 text-xs"
                                    placeholder="Peer ID or Username"
                                />
                            )}
                            <p className="text-xs text-white/50 pl-1 font-mono">{targetChat || 'Wait setting...'}</p>
                        </div>
                    </div>

                    <button
                        onClick={handleSaveSettings}
                        disabled={saving}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-blue-500/10 hover:bg-blue-600/20 text-blue-400 transition-all rounded-xl font-black text-xs border border-blue-500/20 mt-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        应用推送配置
                    </button>
                </motion.div>

                {/* Audit & Info Panel */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400">
                            <MessageSquare size={20} />
                        </div>
                        <h3 className="font-bold text-lg text-white">推送说明</h3>
                    </div>

                    <div className="flex-1 pt-2 space-y-4">
                        <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                            <p className="text-xs font-bold text-white/70 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                自动流转机制
                            </p>
                            <p className="text-xs text-white/60 leading-relaxed">
                                开启后，每位作者的下载任务完成后，系统会自动遍历未同步文件并投递，图文内容将自动按序分段。
                            </p>
                        </div>
                        <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                            <p className="text-xs font-bold text-white/70 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                全量审计提示
                            </p>
                            <p className="text-xs text-white/60 leading-relaxed">
                                如需对历史存量作品进行追溯推送，请前往「任务控制台」执行「TG 同步审计」任务。
                            </p>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};
