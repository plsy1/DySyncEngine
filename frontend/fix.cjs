const fs = require('fs');

let content = fs.readFileSync('src/pages/EmbyPlayer.tsx', 'utf8');

const regex = /\{activeVideoIndex === index && \([\s\S]+?<\/style>/m;

const replacement = `{activeVideoIndex === index && (
                                <>
                                    <div
                                        className="absolute left-0 right-0 cursor-pointer pointer-events-auto z-[50] flex items-end"
                                        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)', height: '24px' }}
                                        onMouseDown={() => setIsDragging(true)}
                                        onMouseUp={() => setIsDragging(false)}
                                        onClick={(e) => handleSeek(item.Id, index, e)}
                                        onTouchStart={() => setIsDragging(true)}
                                        onTouchEnd={() => setIsDragging(false)}
                                        onTouchMove={(e) => handleSeek(item.Id, index, e)}
                                    >
                                        <motion.div
                                            className="w-full bg-white/20 overflow-hidden relative"
                                            initial={{ height: 2, opacity: 0 }}
                                            animate={{
                                                height: isDragging ? 6 : 2,
                                                opacity: isDragging ? 0.8 : 0
                                            }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            <motion.div
                                                className="h-full bg-white relative"
                                                style={{ width: \`\${(((isDragging && seekPreviewTime !== null ? seekPreviewTime : currentTime[item.Id]) || 0) / (duration[item.Id] || 1)) * 100}%\` }}
                                            />
                                        </motion.div>

                                        {/* Visual Thumb for dragging */}
                                        {isDragging && (
                                            <motion.div
                                                className="absolute w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
                                                style={{
                                                    left: \`\${(((isDragging && seekPreviewTime !== null ? seekPreviewTime : currentTime[item.Id]) || 0) / (duration[item.Id] || 1)) * 100}%\`,
                                                    bottom: '2px',
                                                    transform: 'translateX(-50%)'
                                                }}
                                            />
                                        )}
                                    </div>

                                    {/* Seek Preview Time Label */}
                                    <AnimatePresence>
                                        {isDragging && seekPreviewTime !== null && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.5, y: 20 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.5, y: 20 }}
                                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/60 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/10 flex flex-col items-center pointer-events-none z-[100]"
                                            >
                                                <div className="text-white text-2xl font-bold tracking-widest tabular-nums">
                                                    {Math.floor(seekPreviewTime / 60)}:{(Math.floor(seekPreviewTime % 60)).toString().padStart(2, '0')}
                                                    <span className="text-white/40 text-lg mx-1">/</span>
                                                    <span className="text-white/40 text-lg">
                                                        {Math.floor((duration[item.Id] || 0) / 60)}:{(Math.floor((duration[item.Id] || 0) % 60)).toString().padStart(2, '0')}
                                                    </span>
                                                </div>
                                                <div className="w-40 h-1 bg-white/20 mt-3 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary"
                                                        style={{ width: \`\${(seekPreviewTime / (duration[item.Id] || 1)) * 100}%\` }}
                                                    />
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            )}
                        </div>
                    ))}

                        {items.length === 0 && !loading && !error && (
                            <div className="flex h-full items-center justify-center text-white/50">
                                暂无视频内容
                            </div>
                        )}
                    </div>

                        {/* Global Styles for hiding scrollbar */}
                    <style>{\`
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .no-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            \`}</style>`;

content = content.replace(regex, replacement);

fs.writeFileSync('src/pages/EmbyPlayer.tsx', content);
console.log('Fixed');
