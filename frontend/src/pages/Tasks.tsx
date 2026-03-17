
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Play, Clock, Activity, CheckCircle, Loader2, Send } from 'lucide-react';
import type { Task, SchedulerStatus, ToastType } from '../types';
import * as api from '../api';

interface TasksProps {
    onNotify: (message: string, type?: ToastType) => void;
    activeTasks: Task[];
}

export function Tasks({ onNotify, activeTasks }: TasksProps) {
    const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);

    const loadSchedulerStatus = useCallback(async () => {
        try {
            const status = await api.getSchedulerStatus();
            setSchedulerStatus(status);
        } catch (err) {
            console.error('Failed to load scheduler status', err);
        } finally {
            // Done loading
        }
    }, []);

    useEffect(() => {
        loadSchedulerStatus();
        const timer = setInterval(loadSchedulerStatus, 5000);
        return () => clearInterval(timer);
    }, [loadSchedulerStatus]);

    const handleRunScheduler = async () => {
        try {
            await api.runSchedulerNow();
            onNotify('定时更新任务已手动触发');
            loadSchedulerStatus();
        } catch (err) {
            onNotify('触发失败', 'error');
        }
    };

    const handleCheckUndownloaded = async () => {
        try {
            await api.checkUndownloaded();
            onNotify('全局补漏扫描已启动');
        } catch (err) {
            onNotify('扫描启动失败', 'error');
        }
    };

    const handleTgSyncAll = async () => {
        try {
            await api.tgSyncAll();
            onNotify('全局 TG 同步审计已启动');
        } catch (err) {
            onNotify('同步审计启动失败', 'error');
        }
    };

    const formatTime = (ts: number | null) => {
        if (!ts) return '从未执行';
        return new Date(ts * 1000).toLocaleString();
    };

    return (
        <div className="space-y-8 pb-20">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-black tracking-tight text-white">任务控制台</h2>
                    <p className="text-white/60 mt-1">管理后台更新计划与实时任务状态</p>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Scheduler Status Card */}
                <div className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                <Clock size={20} />
                            </div>
                            <h3 className="font-semibold text-lg">全量调度器</h3>
                        </div>
                        {schedulerStatus?.is_running && (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-primary px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                正在同步
                            </span>
                        )}
                    </div>

                    <div className="space-y-4 pt-2 flex-1">
                        <div className="flex justify-between items-center text-base">
                            <span className="text-white/60 font-semibold">上次运行</span>
                            <span className="font-medium text-white/60">{formatTime(schedulerStatus?.last_run || null)}</span>
                        </div>
                        <div className="flex justify-between items-center text-base">
                            <span className="text-white/60 font-semibold">下次运行</span>
                            <span className="font-bold text-primary">{formatTime(schedulerStatus?.next_run || null)}</span>
                        </div>
                    </div>

                    <button
                        onClick={handleRunScheduler}
                        disabled={schedulerStatus?.is_running}
                        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all rounded-2xl font-bold text-sm border border-primary/20"
                    >
                        {schedulerStatus?.is_running ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Play size={18} />
                        )}
                        立即执行全量更新
                    </button>
                </div>

                {/* Global Check Card */}
                <div className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400">
                            <RefreshCw size={20} />
                        </div>
                        <h3 className="font-semibold text-lg">本地补漏审计</h3>
                    </div>

                    <p className="text-sm text-white/60 leading-relaxed flex-1 pt-2">
                        扫描库中所有“未下载”的作品，重新尝试补齐。不涉及任何社交平台上传逻辑，仅针对本地存储。
                    </p>

                    <button
                        onClick={handleCheckUndownloaded}
                        className="w-full flex items-center justify-center gap-2 py-3.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 transition-all rounded-2xl font-bold text-sm border border-orange-500/20"
                    >
                        <Activity size={18} />
                        开始本地扫描
                    </button>
                </div>

                {/* Telegram Audit Card */}
                <div className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6 flex flex-col">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                            <Send size={20} />
                        </div>
                        <h3 className="font-semibold text-lg">TG 同步审计</h3>
                    </div>

                    <div className="space-y-4 pt-2 flex-1">
                        <p className="text-sm text-white/60 leading-relaxed">
                            扫描所有已下载但在数据库中标记为“未导出”的作品，强制推送到指定的 Telegram 频道。
                        </p>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-white/60 text-sm font-semibold">同步周期</span>
                            <span className="font-medium text-xs text-blue-400 bg-blue-400/10 px-2.5 py-1 rounded uppercase font-mono">
                                Follows Scheduler
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={handleTgSyncAll}
                        className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-all rounded-2xl font-bold text-sm border border-blue-500/20"
                    >
                        <Send size={18} />
                        立即审计 TG 导出
                    </button>
                </div>
            </div>

            {/* Active Tasks List */}
            <section className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                        <Activity size={16} />
                    </div>
                    <h3 className="font-bold text-xl">活跃任务</h3>
                </div>

                <div className="grid gap-4">
                    {activeTasks.length > 0 ? (
                        activeTasks.map(task => (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                key={task.id}
                                className="card p-5 border border-white/5 bg-white/2 rounded-2xl"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold">
                                                {task.target_id === 'global_check' ? '本地补漏扫描' : 
                                                 task.target_id === 'tg_global_audit' ? 'TG 全量同步审计' : 
                                                 `同步任务: ${task.target_id}`}
                                            </span>
                                            <span className="text-xs text-white/50 font-mono bg-white/10 px-2.5 py-1 rounded uppercase tracking-tighter">
                                                {task.id.split('-')[0]}
                                            </span>
                                        </div>
                                        <p className="text-sm text-white/60 mt-1">{task.message}</p>
                                    </div>
                                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border ${task.status === 'running' ? 'bg-primary/10 text-primary border-primary/20' :
                                        task.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                            'bg-red-500/10 text-red-400 border-red-500/20'
                                        }`}>
                                        {task.status}
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm font-mono text-white/40">
                                        <span>PROGRESS</span>
                                        <span>{task.progress}%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${task.progress}%` }}
                                            className="h-full bg-gradient-to-r from-primary to-primary/40"
                                        />
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    ) : (
                        <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl">
                            <CheckCircle className="mx-auto text-white/20 mb-3" size={32} />
                            <p className="text-white/50 text-sm font-black">当前没有任何活跃任务</p>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
