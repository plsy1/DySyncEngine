import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Server, Link, Loader2, Sparkles, ImageOff } from 'lucide-react';
import type { VideoParseInfo } from '../types';
import * as api from '../api';

interface SingleDownloadProps {
    onNotify: (msg: string, type: 'success' | 'error') => void;
    inline?: boolean;
}

const getErrorDetail = (err: unknown) => {
    return (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
};

export const SingleDownload = ({ onNotify, inline = false }: SingleDownloadProps) => {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [videoData, setVideoData] = useState<VideoParseInfo | null>(null);
    const [coverFailed, setCoverFailed] = useState(false);

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    };

    const handleParse = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!url) return;

        setLoading(true);
        try {
            const data = await api.parseVideo(url);
            setCoverFailed(false);
            setVideoData(data);
        } catch (err) {
            onNotify(getErrorDetail(err) || '解析作品失败，请检查链接是否正确', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveToServer = async () => {
        if (!url) return;
        setSaving(true);
        try {
            await api.downloadShareUrl(url);
            onNotify('作品已成功保存到服务器', 'success');
        } catch (err) {
            onNotify(getErrorDetail(err) || '保存失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleLocalDownload = () => {
        if (!url) return;
        const filename = videoData?.desc || videoData?.aweme_id || 'video';
        const token = localStorage.getItem('token') || '';
        window.location.href = `/api/download_proxy?share_url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&token=${encodeURIComponent(token)}`;
        onNotify('正在准备下载，请稍候...', 'success');
    };

    const coverUrl = videoData?.cover_url
        ? videoData.platform === 'xiaohongshu'
            ? `/api/xiaohongshu/image?url=${encodeURIComponent(videoData.cover_url)}&token=${encodeURIComponent(localStorage.getItem('token') || '')}`
            : videoData.cover_url
        : '';

    const renderContent = () => (
        <>
            {!inline && (
                <div className="flex items-center gap-3 mb-6">
                    <Sparkles className="text-primary" size={20} />
                    <h2 className="text-xl font-bold">单作品下载 / 解析</h2>
                </div>
            )}

            <form onSubmit={handleParse} className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Link className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                    <input
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="粘贴抖音/TikTok/快手/小红书作品分享链接..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-primary/50 transition-all text-sm font-medium"
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading || !url}
                    className="btn-primary py-3 px-6 flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : '解析作品'}
                </button>
            </form>

            <AnimatePresence>
                {videoData && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-6 border-t border-white/5 pt-6 overflow-hidden"
                    >
                        <div className="flex gap-4 items-start">
                            {/* Compact Video Cover */}
                            <div className="relative w-24 aspect-[9/16] rounded-xl overflow-hidden border border-white/10 shadow-xl shrink-0">
                                {coverUrl && !coverFailed ? (
                                    <img
                                        src={coverUrl}
                                        alt={videoData.desc || '作品封面'}
                                        className="w-full h-full object-cover"
                                        onError={() => setCoverFailed(true)}
                                    />
                                ) : (
                                    <div className="w-full h-full bg-white/5 flex items-center justify-center text-white/20">
                                        <ImageOff size={24} />
                                    </div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-center">
                                    <div className="text-[10px] text-white/80 font-bold truncate">
                                        {videoData.author_name}
                                    </div>
                                </div>
                            </div>

                            {/* Compact Details & Actions */}
                            <div className="flex-1 min-w-0 flex flex-col justify-between h-[170px] py-1">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${videoData.aweme_type === 68 ? 'bg-amber-500/20 text-amber-500 border border-amber-500/10' : 'bg-blue-500/20 text-blue-500 border border-blue-500/10'}`}>
                                            {videoData.aweme_type === 68 ? '图文' : '视频'}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${videoData.platform === 'tiktok' ? 'bg-black text-white border border-white/20' : videoData.platform === 'kuaishou' ? 'bg-orange-500/20 text-orange-400' : videoData.platform === 'xiaohongshu' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/10' : 'bg-red-500/20 text-red-500 border border-red-500/10'}`}>
                                            {videoData.platform === 'tiktok' ? 'TikTok' : videoData.platform === 'kuaishou' ? '快手' : videoData.platform === 'xiaohongshu' ? '小红书' : 'Douyin'}
                                        </span>
                                        {videoData.create_time > 0 && (
                                            <span className="text-[10px] text-white/30 font-medium">
                                                {formatDate(videoData.create_time)}
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="text-sm font-bold text-white/95 line-clamp-2 leading-snug" title={videoData.desc || ''}>
                                        {videoData.desc || '（暂无描述）'}
                                    </h3>
                                    <div className="text-[10px] text-white/40 truncate font-mono">
                                        ID: {videoData.aweme_id}
                                    </div>
                                </div>

                                <div className="space-y-2 shrink-0">
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleSaveToServer}
                                            disabled={saving}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-black font-black text-xs hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50"
                                        >
                                            {saving ? <Loader2 className="animate-spin" size={14} /> : <Server size={14} />}
                                            保存到服务器
                                        </button>
                                        <button
                                            onClick={handleLocalDownload}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-white/5 border border-white/10 text-white font-bold text-xs hover:bg-white/10 active:scale-[0.99] transition-all"
                                        >
                                            <Download size={14} />
                                            下载到本地
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-white/20 italic leading-none">
                                        * 视频下载为 MP4，图文下载为 ZIP；抖音/小红书实况图按 MP4 视频保存
                                    </p>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );

    if (inline) {
        return <div className="h-full">{renderContent()}</div>;
    }

    return (
        <div className="glass-card h-full">
            {renderContent()}
        </div>
    );
};
