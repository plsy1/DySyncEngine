import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Server, Link, Loader2, Sparkles, User, FileVideo } from 'lucide-react';
import type { VideoParseInfo } from '../types';
import * as api from '../api';

interface SingleDownloadProps {
    onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const SingleDownload = ({ onNotify }: SingleDownloadProps) => {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [videoData, setVideoData] = useState<VideoParseInfo | null>(null);

    const handleParse = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!url) return;

        setLoading(true);
        try {
            const data = await api.parseVideo(url);
            setVideoData(data);
        } catch (err) {
            onNotify('解析视频失败，请检查链接是否正确', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveToServer = async () => {
        if (!url) return;
        setSaving(true);
        try {
            await api.downloadShareUrl(url);
            onNotify('视频已成功保存到服务器', 'success');
        } catch (err) {
            onNotify('保存失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleLocalDownload = () => {
        if (!url) return;
        const filename = videoData?.desc || videoData?.aweme_id || 'video';
        window.location.href = `/api/download_proxy?share_url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
        onNotify('正在准备下载，请稍候...', 'success');
    };

    return (
        <div className="glass-card mb-12">
            <div className="flex items-center gap-3 mb-6">
                <Sparkles className="text-primary" size={20} />
                <h2 className="text-xl font-bold">单视频下载 / 解析</h2>
            </div>

            <form onSubmit={handleParse} className="flex gap-2">
                <div className="relative flex-1">
                    <Link className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                    <input
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="粘贴抖音视频分享链接..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-primary/50 transition-all text-sm"
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading || !url}
                    className="btn-primary py-2 px-6 flex items-center gap-2"
                >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : '解析视频'}
                </button>
            </form>

            <AnimatePresence>
                {videoData && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-8 border-t border-white/5 pt-8 overflow-hidden"
                    >
                        <div className="flex flex-col md:flex-row gap-6">
                            <div className="relative w-full md:w-48 aspect-[9/16] rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                                <img src={videoData.cover_url || ''} className="w-full h-full object-cover" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                                    <div className="flex items-center gap-2 text-xs font-medium">
                                        <User size={12} className="text-primary" />
                                        <span className="truncate">{videoData.author_name}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 space-y-6">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${videoData.aweme_type === 68 ? 'bg-amber-500/20 text-amber-500' : 'bg-blue-500/20 text-blue-500'}`}>
                                            {videoData.aweme_type === 68 ? '图文 / Note' : '视频 / Video'}
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-bold mb-2 line-clamp-3">{videoData.desc || '（暂无描述）'}</h3>
                                    <div className="flex items-center gap-2 text-white/40 text-sm">
                                        <FileVideo size={14} />
                                        <span>Aweme ID: {videoData.aweme_id}</span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-3">
                                    <button
                                        onClick={handleSaveToServer}
                                        disabled={saving}
                                        className="flex-1 md:flex-none flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-primary text-white font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 className="animate-spin" size={18} /> : <Server size={18} />}
                                        保存到服务器
                                    </button>
                                    <button
                                        onClick={handleLocalDownload}
                                        className="flex-1 md:flex-none flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 active:scale-95 transition-all"
                                    >
                                        <Download size={18} />
                                        下载到本地
                                    </button>
                                </div>

                                <p className="text-xs text-white/30 italic">
                                    * “下载到本地”将尝试直接打开无水印视频直链。
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
