
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Play, Clock, Activity, CheckCircle, Loader2 } from 'lucide-react';
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

    const formatTime = (ts: number | null) => {
        if (!ts) return '从未执行';
        return new Date(ts * 1000).toLocaleString();
    };

    return (
        <div className="space-y-8 pb-20">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">任务控制台</h2>
                    <p className="text-white/40 mt-1">管理后台更新计划与实时任务状态</p>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Scheduler Status Card */}
                <div className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                <Clock size={20} />
                            </div>
                            <h3 className="font-semibold text-lg">账号自动更新调度器</h3>
                        </div>
                        {schedulerStatus?.is_running && (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-primary px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                正在运行
                            </span>
                        )}
                    </div>

                    <div className="space-y-4 pt-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-white/40">上次运行时间</span>
                            <span className="font-medium">{formatTime(schedulerStatus?.last_run || null)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-white/40">下次运行时间</span>
                            <span className="font-medium">{formatTime(schedulerStatus?.next_run || null)}</span>
                        </div>
                    </div>

                    <button
                        onClick={handleRunScheduler}
                        disabled={schedulerStatus?.is_running}
                        className="w-full flex items-center justify-center gap-2 py-3.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all rounded-2xl font-medium text-sm border border-white/10"
                    >
                        {schedulerStatus?.is_running ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Play size={18} />
                        )}
                        立即执行更新计划
                    </button>
                </div>

                {/* Global Check Card */}
                <div className="card p-6 border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400">
                            <RefreshCw size={20} />
                        </div>
                        <h3 className="font-semibold text-lg">全局数据审计</h3>
                    </div>

                    <p className="text-sm text-white/40 leading-relaxed">
                        扫描数据库中所有被标记为“未下载”的作品，并根据当前全局设置或作者特定偏号重新尝试补漏。
                    </p>

                    <button
                        onClick={handleCheckUndownloaded}
                        className="w-full flex items-center justify-center gap-2 py-3.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 transition-all rounded-2xl font-medium text-sm border border-orange-500/20"
                    >
                        <Activity size={18} />
                        开始全局补漏扫描
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
                                            <span className="font-semibold">{task.target_id === 'global_check' ? '全局扫描任务' : `同步任务: ${task.target_id}`}</span>
                                            <span className="text-[10px] text-white/20 font-mono bg-white/5 px-2 py-0.5 rounded uppercase tracking-tighter">
                                                {task.id.split('-')[0]}
                                            </span>
                                        </div>
                                        <p className="text-xs text-white/40 mt-1">{task.message}</p>
                                    </div>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${task.status === 'running' ? 'bg-primary/10 text-primary border-primary/20' :
                                        task.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                            'bg-red-500/10 text-red-400 border-red-500/20'
                                        }`}>
                                        {task.status}
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs font-mono text-white/40">
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
                        <div className="text-center py-16 border border-dashed border-white/5 rounded-3xl">
                            <CheckCircle className="mx-auto text-white/10 mb-3" size={32} />
                            <p className="text-white/20 text-sm font-medium">当前没有任何活跃任务</p>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
