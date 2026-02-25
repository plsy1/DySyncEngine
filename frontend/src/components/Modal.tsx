import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
}

export const Modal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmText = '确定',
    cancelText = '取消',
    isDanger = false
}: ModalProps) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative bg-card border border-white/10 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
                    >
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-xl font-bold">{title}</h3>
                                <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <p className="text-white/60 mb-8">{description}</p>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={onClose}
                                    className="px-6 py-2 rounded-lg font-semibold hover:bg-white/5 transition-colors"
                                >
                                    {cancelText}
                                </button>
                                <button
                                    onClick={() => {
                                        onConfirm();
                                        onClose();
                                    }}
                                    className={`px-6 py-2 rounded-lg font-semibold transition-all active:scale-95 ${isDanger ? 'bg-primary text-white' : 'bg-white text-black'
                                        }`}
                                >
                                    {confirmText}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
