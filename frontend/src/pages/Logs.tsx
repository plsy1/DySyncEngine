import { useState, useEffect, useRef } from 'react';
import * as api from '../api';
import { RefreshCw, Terminal, Search, ArrowDown, Filter } from 'lucide-react';

export const Logs = () => {
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [logLevel, setLogLevel] = useState('ALL');
    const [autoScroll, setAutoScroll] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const data = await api.getLogs();
            setLogs(data.logs);
        } catch (err) {
            console.error('Failed to fetch logs:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const filteredLogs = logs.filter(log => {
        const matchesFilter = log.toLowerCase().includes(filter.toLowerCase());
        const matchesLevel = logLevel === 'ALL' || log.includes(`| ${logLevel.padEnd(8)} |`);
        return matchesFilter && matchesLevel;
    });

    return (
        <div className="space-y-8 pb-20">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-3xl font-black tracking-tight text-white">系统审计日志</h2>
                    <p className="text-white/60 text-base mt-1">监控后台运行状态与实时错误报告</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                        <input
                            type="text"
                            placeholder="过滤内容..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="pl-11 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/50 text-sm transition-all w-48 font-medium"
                        />
                    </div>

                    <div className="relative">
                        <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                        <select
                            value={logLevel}
                            onChange={(e) => setLogLevel(e.target.value)}
                            className="pl-11 pr-8 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/50 text-sm transition-all cursor-pointer appearance-none hover:bg-white/10 w-36 font-bold"
                        >
                            <option value="ALL" className="bg-[#1a1a1a]">ALL LEVELS</option>
                            <option value="INFO" className="bg-[#1a1a1a]">INFO</option>
                            <option value="SUCCESS" className="bg-[#1a1a1a]">SUCCESS</option>
                            <option value="WARNING" className="bg-[#1a1a1a]">WARNING</option>
                            <option value="ERROR" className="bg-[#1a1a1a]">ERROR</option>
                        </select>
                    </div>

                    <button
                        onClick={() => setAutoScroll(!autoScroll)}
                        className={`p-2 rounded-xl border transition-all ${autoScroll ? 'bg-primary/20 border-primary text-primary' : 'bg-white/5 border-white/10 text-white/40 hover:text-white'}`}
                        title={autoScroll ? "已开启自动滚动" : "已关闭自动滚动"}
                    >
                        <ArrowDown size={20} className={autoScroll ? 'animate-bounce' : ''} />
                    </button>

                    <button
                        onClick={fetchLogs}
                        disabled={loading}
                        className="p-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all disabled:opacity-50"
                    >
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </header>

            <div className="card p-1 overflow-hidden h-[75vh] flex flex-col border border-white/5 bg-white/2 backdrop-blur-sm rounded-3xl">
                <div className="flex items-center justify-between px-6 py-4 bg-white/5 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <Terminal size={18} className="text-primary" />
                        <span className="text-xs uppercase tracking-widest font-black text-white/60">Audit Terminal Output</span>
                    </div>
                    <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40" />
                        <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/40" />
                        <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
                    </div>
                </div>

                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-6 font-mono text-sm space-y-1.5 selection:bg-primary/30 custom-scrollbar"
                    onWheel={() => setAutoScroll(false)}
                >
                    {filteredLogs.length > 0 ? (
                        filteredLogs.map((log, i) => (
                            <div key={i} className="whitespace-pre-wrap break-all border-l-2 border-transparent hover:border-white/10 hover:bg-white/5 px-3 py-0.5 transition-colors rounded-lg">
                                {log.includes('| ERROR    |') ? (
                                    <span className="text-red-400 font-bold">{log}</span>
                                ) : log.includes('| WARNING  |') ? (
                                    <span className="text-amber-400 font-bold">{log}</span>
                                ) : log.includes('| SUCCESS  |') ? (
                                    <span className="text-emerald-400 font-bold">{log}</span>
                                ) : (
                                    <span className="text-white/70">{log}</span>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="h-full flex items-center justify-center text-white/20 text-sm italic">
                            {filter ? '没有匹配的日志记录' : '暂无日志信息'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
