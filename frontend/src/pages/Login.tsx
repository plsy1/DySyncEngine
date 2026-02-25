import { useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';
import * as api from '../api';

interface LoginProps {
    onLoginSuccess: () => void;
}

export const Login = ({ onLoginSuccess }: LoginProps) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await api.login(username, password);
            onLoginSuccess();
        } catch (err: any) {
            setError(err.response?.data?.detail || '登录失败，请检查用户名和密码');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#060606]">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md"
            >
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-black border border-white/5 shadow-2xl mb-4 overflow-hidden">
                        <img src="/logo.svg" alt="DySyncEngine" className="w-full h-full object-cover p-2" />
                    </div>
                    <h1 className="text-3xl font-bold text-white">DySyncEngine</h1>
                    <p className="text-white/40 mt-2">请登录以管理您的视频库</p>
                </div>

                <div className="glass-card p-8 border border-white/10">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">用户名</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 transition-all text-white"
                                placeholder="请输入用户名"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">密码</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 transition-all text-white"
                                placeholder="请输入密码"
                                required
                            />
                        </div>

                        {error && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                            >
                                <AlertCircle size={16} />
                                <span>{error}</span>
                            </motion.div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full btn-primary py-4 flex items-center justify-center gap-2 text-lg"
                        >
                            {loading ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
                            立即登录
                        </button>
                    </form>

                </div>
            </motion.div>
        </div>
    );
};
