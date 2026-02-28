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
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent">
                        系统日志
                    </h1>
                    <p className="text-white/40 mt-1">监控后台运行状态与错误信息</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                        <input
                            type="text"
                            placeholder="过滤内容..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/50 text-sm transition-all w-48"
                        />
                    </div>

                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                        <select
                            value={logLevel}
                            onChange={(e) => setLogLevel(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/50 text-sm transition-all cursor-pointer appearance-none hover:bg-white/10 w-32"
                        >
                            <option value="ALL" className="bg-[#1a1a1a]">ALL</option>
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
            </div>

            <div className="glass-card p-1 overflow-hidden h-[70vh] flex flex-col">
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-b border-white/5">
                    <Terminal size={14} className="text-primary" />
                    <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">Terminal Output</span>
                </div>

                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 selection:bg-primary/30"
                    onWheel={() => setAutoScroll(false)}
                >
                    {filteredLogs.length > 0 ? (
                        filteredLogs.map((log, i) => (
                            <div key={i} className="whitespace-pre-wrap break-all border-l-2 border-transparent hover:border-white/10 hover:bg-white/5 px-2 transition-colors">
                                {log.includes('| ERROR    |') ? (
                                    <span className="text-red-400">{log}</span>
                                ) : log.includes('| WARNING  |') ? (
                                    <span className="text-yellow-400">{log}</span>
                                ) : log.includes('| SUCCESS  |') ? (
                                    <span className="text-green-400">{log}</span>
                                ) : (
                                    <span className="text-white/60">{log}</span>
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
