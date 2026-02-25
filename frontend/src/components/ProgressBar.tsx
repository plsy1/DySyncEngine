import { motion } from 'framer-motion';

interface ProgressBarProps {
    progress: number;
    message?: string | null;
    status?: string;
}

export const ProgressBar = ({ progress, message, status }: ProgressBarProps) => {
    const isFailed = status === 'failed';

    return (
        <div className="w-full space-y-2">
            <div className="flex justify-between items-end">
                <span className={`text-xs font-semibold ${isFailed ? 'text-red-400' : 'text-primary'}`}>
                    {message || (isFailed ? '任务失败' : '正在处理...')}
                </span>
                <span className="text-xs font-mono text-white/40">{progress}%</span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{
                        width: `${progress}%`,
                        backgroundColor: isFailed ? '#ef4444' : '#fe2c55'
                    }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="h-full rounded-full"
                />
            </div>
        </div>
    );
};
