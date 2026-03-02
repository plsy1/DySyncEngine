import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Loader2, Play, AlertCircle, Menu, X, Folder, Volume2, VolumeX, Maximize2, Minimize2, Monitor, Repeat, ArrowRightCircle, Clock, Shuffle } from 'lucide-react';
import * as api from '../api';
import type { GlobalSettings } from '../types';
import axios from 'axios';

interface EmbyPlayerProps {
    onBack: () => void;
    onNotify: (msg: string, type: 'success' | 'error') => void;
}

interface EmbyItem {
    Id: string;
    Name: string;
    Overview?: string;
    Type: string;
    MediaType: string;
    RunTimeTicks?: number;
    Container?: string;
    Width?: number;
    Height?: number;
    ImageTags?: {
        Primary?: string;
    };
}

export const EmbyPlayer = ({ onBack, onNotify }: EmbyPlayerProps) => {
    const [settings, setSettings] = useState<GlobalSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<EmbyItem[]>([]);
    const [error, setError] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const [activeVideoIndex, setActiveVideoIndex] = useState(0);
    const [tab, setTab] = useState<'latest' | 'random'>('latest');

    // Sidebar & Folders State
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [folders, setFolders] = useState<EmbyItem[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() => {
        return localStorage.getItem('emby_player_folder_id');
    });
    const [foldersLoading, setFoldersLoading] = useState(false);

    // Progress State
    const [currentTime, setCurrentTime] = useState<{ [key: string]: number }>({});
    const [duration, setDuration] = useState<{ [key: string]: number }>({});
    const [isDragging, setIsDragging] = useState(false);
    const [touchStartX, setTouchStartX] = useState(0);
    const [touchStartY, setTouchStartY] = useState(0);
    const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [isUserPaused, setIsUserPaused] = useState(false);
    const [isMuted, setIsMuted] = useState(true);
    const [isFastForwarding, setIsFastForwarding] = useState(false);
    const longPressTimerRef = useRef<any>(null);
    const [hasStarted, setHasStarted] = useState<{ [key: string]: boolean }>({});
    const [hasManualSeek, setHasManualSeek] = useState<{ [key: string]: boolean }>({});
    const [displayMode, setDisplayMode] = useState<'smart' | 'cover' | 'contain'>('smart');
    const [playbackMode, setPlaybackMode] = useState<'loop' | 'next'>('loop');
    const [isScreenLandscape, setIsScreenLandscape] = useState(
        typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
    );

    useEffect(() => {
        const handleResize = () => {
            setIsScreenLandscape(window.innerWidth > window.innerHeight);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handlePlaying = (itemId: string) => {
        setHasStarted(prev => ({ ...prev, [itemId]: true }));
    };

    const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        if (selectedFolderId) {
            localStorage.setItem('emby_player_folder_id', selectedFolderId);
        } else {
            localStorage.removeItem('emby_player_folder_id');
        }
        loadSettingsAndVideos(tab, selectedFolderId);
    }, [tab, selectedFolderId]);

    const loadSettingsAndVideos = async (currentTab: 'latest' | 'random', folderId: string | null) => {
        setLoading(true);
        setError('');
        setItems([]);
        setActiveVideoIndex(0);
        try {
            const data = await api.getSettings();
            setSettings(data);
            if (!data.emby_server_url || !data.emby_api_key) {
                setError('请先在设置中配置 Emby 服务器地址和 API Key');
                setLoading(false);
                return;
            }

            const embyApi = axios.create({
                baseURL: data.emby_server_url,
                timeout: 10000,
            });

            // Fetch Videos, Episodes, Movies from Emby
            const params: any = {
                api_key: data.emby_api_key,
                IncludeItemTypes: 'Video,Movie,Episode',
                Recursive: 'true',
                SortBy: currentTab === 'latest' ? 'DateCreated' : 'Random',
                SortOrder: currentTab === 'latest' ? 'Descending' : undefined,
                Limit: 30, // Get 30 videos
                Fields: 'Overview,Path,PrimaryImageAspectRatio,ImageTags,Width,Height'
            };

            if (folderId) {
                params.ParentId = folderId;
            }

            const response = await embyApi.get('/emby/Items', { params });

            if (response.data && response.data.Items) {
                // Filter out items that are not streamable video types (just to be safe)
                const videoItems = response.data.Items.filter((i: EmbyItem) => i.MediaType === 'Video');
                setItems(videoItems);
                if (videoItems.length === 0) {
                    setError('在指定的 Emby 服务器中没有找到视频内容');
                }
            } else {
                setError('无法读取 Emby 数据格式');
            }
        } catch (err: any) {
            const msg = err.message || '连接 Emby 服务器失败，请检查配置或网络';
            setError(msg);
            onNotify(msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadMoreVideos = async () => {
        if (loadingMore || !settings || loading) return;
        setLoadingMore(true);
        try {
            const embyApi = axios.create({
                baseURL: settings.emby_server_url,
                timeout: 15000,
            });

            // Fetch Videos, Episodes, Movies from Emby
            const params: any = {
                api_key: settings.emby_api_key,
                IncludeItemTypes: 'Video,Movie,Episode',
                Recursive: 'true',
                SortBy: tab === 'latest' ? 'DateCreated' : 'Random',
                SortOrder: tab === 'latest' ? 'Descending' : undefined,
                Limit: 20,
                Fields: 'Overview,Path,PrimaryImageAspectRatio,ImageTags,Width,Height',
                StartIndex: tab === 'latest' ? items.length : 0
            };

            if (selectedFolderId) {
                params.ParentId = selectedFolderId;
            }

            const response = await embyApi.get('/emby/Items', { params });

            if (response.data && response.data.Items) {
                const videoItems = response.data.Items.filter((i: EmbyItem) =>
                    i.MediaType === 'Video' && !items.some(existing => existing.Id === i.Id)
                );

                if (videoItems.length > 0) {
                    setItems(prev => [...prev, ...videoItems]);
                }
            }
        } catch (err) {
            console.error('Failed to load more videos:', err);
        } finally {
            setLoadingMore(false);
        }
    };

    const fetchFolders = async () => {
        if (!settings || !settings.emby_server_url || !settings.emby_api_key || folders.length > 0) return;
        setFoldersLoading(true);
        try {
            const embyApi = axios.create({
                baseURL: settings.emby_server_url,
                timeout: 5000,
            });
            const response = await embyApi.get('/emby/Items', {
                params: {
                    api_key: settings.emby_api_key,
                    Recursive: 'false',
                    IsFolder: 'true',
                    SortBy: 'SortName',
                    SortOrder: 'Ascending'
                }
            });
            if (response.data && response.data.Items) {
                setFolders(response.data.Items);
            }
        } catch (err) {
            console.error('获取媒体库失败', err);
        } finally {
            setFoldersLoading(false);
        }
    };

    const handleOpenSidebar = () => {
        setIsSidebarOpen(true);
        fetchFolders();
    };

    const safePlay = async (index: number) => {
        const video = videoRefs.current[index];
        if (!video) return;

        try {
            // Set initial muted state based on global preference
            video.muted = isMuted;
            await video.play();
        } catch (err: any) {
            console.warn(`Playback failed for video ${index}:`, err);
            // If blocked by browser (NotAllowedError), fallback to muted auto-play
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                video.muted = true;
                // If the user *thought* they were unmuted, we might want to sync back or show a hint
                // For now, just ensure it plays
                video.play().catch(e => console.error("Muted fallback failed too:", e));
            }
        }
    };

    const handleTimeUpdate = (itemId: string, e: React.SyntheticEvent<HTMLVideoElement>) => {
        if (isDragging) return;
        const video = e.currentTarget;
        setCurrentTime(prev => ({ ...prev, [itemId]: video.currentTime }));
    };

    const handleLoadedMetadata = (itemId: string, e: React.SyntheticEvent<HTMLVideoElement>) => {
        const video = e.currentTarget;
        setDuration(prev => ({ ...prev, [itemId]: video.duration }));
    };

    const handleSeek = (itemId: string, index: number, e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
        const video = videoRefs.current[index];
        if (!video) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const pos = (clientX - rect.left) / rect.width;
        const newTime = pos * (duration[itemId] || 0);

        video.currentTime = newTime;
        setCurrentTime(prev => ({ ...prev, [itemId]: newTime }));
        setHasManualSeek(prev => ({ ...prev, [itemId]: true }));
    };

    const handleGlobalTouchStart = (index: number, e: React.TouchEvent) => {
        setTouchStartX(e.touches[0].clientX);
        setTouchStartY(e.touches[0].clientY);

        // Long press detection for 2x speed
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
            const video = videoRefs.current[index];
            if (video && !video.paused) {
                video.playbackRate = 2.0;
                setIsFastForwarding(true);
                if (window.navigator.vibrate) window.navigator.vibrate(60);
            }
        }, 500);
    };

    const handleGlobalTouchMove = (itemId: string, index: number, e: React.TouchEvent) => {
        if (touchStartX === 0) return;
        const deltaX = e.touches[0].clientX - touchStartX;
        const deltaY = e.touches[0].clientY - touchStartY;

        // Cancel long press if moved significantly
        if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }
        }

        // Only trigger seek if horizontal movement is significant
        if (Math.abs(deltaX) > 10) {
            setIsDragging(true);
            const video = videoRefs.current[index];
            if (!video) return;

            const totalDuration = duration[itemId] || 0;
            const sensitivity = 0.5; // Adjust seeking sensitivity
            const seekDelta = (deltaX / window.innerWidth) * totalDuration * sensitivity;
            let newTime = (currentTime[itemId] || 0) + seekDelta;

            // Clamp
            newTime = Math.max(0, Math.min(newTime, totalDuration));
            setSeekPreviewTime(newTime);
        }
    };

    const handleGlobalTouchEnd = (itemId: string, index: number, e: React.TouchEvent) => {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        const displacement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        // Clean up long press timer
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }

        // If we were fast forwarding, just stop it and ignore the rest of the gesture
        if (isFastForwarding) {
            const video = videoRefs.current[index];
            if (video) video.playbackRate = 1.0;
            setIsFastForwarding(false);
            setIsDragging(false);
            setTouchStartX(0);
            setTouchStartY(0);
            setSeekPreviewTime(null);
            return;
        }

        // If it's a tap (minimal movement) - increase threshold slightly for robustness
        if (displacement < 25 && !isDragging) {
            // Prevent emulated click on mobile to avoid double-toggle
            if (e.cancelable) e.preventDefault();

            const video = videoRefs.current[index];
            if (video) {
                if (video.paused) {
                    video.play().catch(err => console.error("Play failed", err));
                    setIsUserPaused(false);
                } else {
                    video.pause();
                    setIsUserPaused(true);
                }
            }
        }
        else if (isDragging && seekPreviewTime !== null) {
            const video = videoRefs.current[index];
            if (video) {
                video.currentTime = seekPreviewTime;
                setCurrentTime(prev => ({ ...prev, [itemId]: seekPreviewTime }));
                setHasManualSeek(prev => ({ ...prev, [itemId]: true }));
            }
        }

        setIsDragging(false);
        setTouchStartX(0);
        setTouchStartY(0);
        setSeekPreviewTime(null);

        // SYNC GESTURE BINDING: Unmute and prime adjacent videos immediately
        // This links the "Unmute" action to the user's swipe gesture
        if (!isMuted) {
            [index, index + 1, index - 1].forEach(idx => {
                const v = videoRefs.current[idx];
                if (v) {
                    v.muted = false;
                    // Trigger a micro play-then-pause to 'unlock' audio context for this element
                    if (idx !== activeVideoIndex) {
                        const playPromise = v.play();
                        if (playPromise !== undefined) {
                            playPromise.then(() => v.pause()).catch(() => { });
                        }
                    }
                }
            });
        }

        // Call safePlay immediately without setTimeout
        if (displacement >= 25 && videoRefs.current[activeVideoIndex]) {
            safePlay(activeVideoIndex);
        }
    };

    // Handle scroll to play/pause using Intersection Observer
    useEffect(() => {
        if (!containerRef.current || items.length === 0) return;

        const observerOptions = {
            root: containerRef.current,
            rootMargin: '0px',
            threshold: 0.6, // Trigger when 60% of video is visible
        };

        const observerCallback: IntersectionObserverCallback = (entries) => {
            entries.forEach((entry) => {
                const index = Number(entry.target.getAttribute('data-index'));
                const videoEl = videoRefs.current[index];

                if (entry.isIntersecting) {
                    setActiveVideoIndex(index);

                    // Trigger load more when approaching the end (e.g., 5 items left)
                    if (index >= items.length - 5 && !loadingMore) {
                        loadMoreVideos();
                    }

                    // Preload adjacent videos (next and previous)
                    [index - 1, index + 1].forEach(adjIndex => {
                        const adjVideo = videoRefs.current[adjIndex];
                        if (adjVideo && adjVideo.paused) {
                            adjVideo.preload = 'auto';
                        }
                    });
                } else {
                    // Just pause if it's definitely out of view
                    if (videoEl && !videoEl.paused) {
                        videoEl.pause();
                        videoEl.preload = 'none';
                    }
                }
            });
        };

        const observer = new IntersectionObserver(observerCallback, observerOptions);

        // Track items
        itemRefs.current.forEach((ref) => {
            if (ref) {
                observer.observe(ref);
            }
        });

        return () => observer.disconnect();
    }, [items.length]);

    // Handle active video playback
    useEffect(() => {
        setIsUserPaused(false);
        setIsDragging(false);
        setSeekPreviewTime(null);
        safePlay(activeVideoIndex);

        // Reset hasStarted for other videos to ensure poster shows when they play again or remount
        setHasStarted(prev => {
            const next = { ...prev };
            items.forEach((item, idx) => {
                if (idx !== activeVideoIndex) {
                    next[item.Id] = false;
                }
            });
            return next;
        });

        // Pause others (safety check)
        videoRefs.current.forEach((v, idx) => {
            if (v && idx !== activeVideoIndex && !v.paused) {
                v.pause();
            }
        });
    }, [activeVideoIndex, items]);


    if (loading) {
        return (
            <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
                <button
                    onClick={onBack}
                    className="absolute top-6 left-6 z-50 p-3 text-white transition-all drop-shadow-lg opacity-80 hover:opacity-100"
                >
                    <ArrowLeft size={28} />
                </button>
                <Loader2 className="animate-spin text-primary mb-4" size={48} />
                <p className="text-white/60">正在连接 Emby...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="fixed inset-0 z-[100] bg-black flex flex-col">
                <button
                    onClick={onBack}
                    className="absolute top-6 left-6 z-50 p-3 flex items-center justify-center text-white transition-all drop-shadow-lg opacity-80 hover:opacity-100"
                >
                    <ArrowLeft size={28} />
                </button>
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                    <AlertCircle size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">出错了</h2>
                    <p className="text-white/60 max-w-md">{error}</p>
                </div>
            </div>
        );
    }

    const getVideoUrl = (item: EmbyItem) => {
        if (!settings) return '';
        // Emby stream endpoint
        return `${settings.emby_server_url}/emby/videos/${item.Id}/stream.mp4?api_key=${settings.emby_api_key}&Static=true`;
    };

    const getPosterUrl = (item: EmbyItem) => {
        if (!settings || !item.ImageTags?.Primary) return undefined;
        return `${settings.emby_server_url}/emby/Items/${item.Id}/Images/Primary?api_key=${settings.emby_api_key}&tag=${item.ImageTags.Primary}&quality=90`;
    };

    return (
        <div
            className="fixed inset-0 bg-black z-[100] overflow-hidden flex flex-col select-none"
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as any}
        >
            {/* Top Navigation Bar - Douyin Style */}
            <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center p-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"
                style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
                <button
                    onClick={onBack}
                    className="absolute p-3 text-white transition-all pointer-events-auto drop-shadow-lg opacity-80 hover:opacity-100 hover:bg-white/10 rounded-full"
                    style={{ top: 'calc(env(safe-area-inset-top) + 12px)', left: '20px' }}
                >
                    <ArrowLeft size={28} />
                </button>

                {/* Tabs removed for unified UI */}

                <div
                    className="absolute flex items-center gap-2 pointer-events-auto drop-shadow-lg opacity-80"
                    style={{ top: 'calc(env(safe-area-inset-top) + 12px)', right: '20px' }}
                >
                    <button
                        onClick={() => {
                            const newTab = tab === 'latest' ? 'random' : 'latest';
                            setTab(newTab);
                            onNotify(`排序切换至: ${newTab === 'latest' ? '最新发布' : '随机推荐'}`, 'success');
                        }}
                        className="p-3 text-white transition-all hover:opacity-100 hover:bg-white/10 rounded-full"
                        title="切换数据源"
                    >
                        {tab === 'latest' ? <Clock size={24} /> : <Shuffle size={24} />}
                    </button>
                    <button
                        onClick={() => {
                            const newMode = playbackMode === 'loop' ? 'next' : 'loop';
                            setPlaybackMode(newMode);
                            onNotify(`播放模式: ${newMode === 'loop' ? '单片循环' : '自动连播'}`, 'success');
                        }}
                        className="p-3 text-white transition-all hover:opacity-100 hover:bg-white/10 rounded-full"
                        title="切换播放模式"
                    >
                        {playbackMode === 'loop' ? <Repeat size={24} /> : <ArrowRightCircle size={24} className="text-primary" />}
                    </button>
                    <button
                        onClick={() => {
                            const modes: ('smart' | 'cover' | 'contain')[] = ['smart', 'cover', 'contain'];
                            const nextIndex = (modes.indexOf(displayMode) + 1) % modes.length;
                            setDisplayMode(modes[nextIndex]);
                            onNotify(`切换至: ${modes[nextIndex] === 'smart' ? '智能适配' : modes[nextIndex] === 'cover' ? '全屏铺满' : '完整显示'}`, 'success');
                        }}
                        className="p-3 text-white transition-all hover:opacity-100 hover:bg-white/10 rounded-full"
                        title="切换显示模式"
                    >
                        {displayMode === 'smart' ? <Monitor size={24} /> : displayMode === 'cover' ? <Maximize2 size={24} /> : <Minimize2 size={24} />}
                    </button>
                    <button
                        onClick={() => {
                            const nextMuted = !isMuted;
                            setIsMuted(nextMuted);

                            // WARM UP: If unmuting, try to play/pause adjacent videos
                            // This signals to iOS that these videos are allowed to have sound
                            if (!nextMuted) {
                                [activeVideoIndex, activeVideoIndex + 1, activeVideoIndex - 1].forEach(idx => {
                                    const v = videoRefs.current[idx];
                                    if (v) {
                                        v.muted = false;
                                        // A quick play/pause can sometimes 'unlock' the audio context for that element
                                        const p = v.play();
                                        if (p) p.then(() => { if (idx !== activeVideoIndex) v.pause(); }).catch(() => { });
                                    }
                                });
                            }
                        }}
                        className="p-3 text-white transition-all hover:opacity-100 hover:bg-white/10 rounded-full"
                    >
                        {isMuted ? <VolumeX size={24} className="text-red-500" /> : <Volume2 size={24} />}
                    </button>
                    <button onClick={handleOpenSidebar} className="p-3 text-white transition-all hover:opacity-100 hover:bg-white/10 rounded-full">
                        <Menu size={28} />
                    </button>
                </div>
            </div>

            {/* Scrolling Container */}
            <div
                ref={containerRef}
                className="flex-1 overflow-y-scroll snap-y snap-mandatory bg-black no-scrollbar scroll-smooth"
                style={{ scrollBehavior: 'smooth' }}
            >
                {items.map((item, index) => (
                    <div
                        key={item.Id}
                        ref={(el) => { itemRefs.current[index] = el; }}
                        className="relative w-full h-[100dvh] snap-start snap-always flex bg-black overflow-hidden group"
                        data-index={index}
                        onTouchStart={(e) => handleGlobalTouchStart(index, e)}
                        onTouchMove={(e) => handleGlobalTouchMove(item.Id, index, e)}
                        onTouchEnd={(e) => handleGlobalTouchEnd(item.Id, index, e)}
                        onClick={() => {
                            // For desktop mouse clicks
                            const video = videoRefs.current[index];
                            if (video) {
                                if (video.paused) {
                                    video.play();
                                    setIsUserPaused(false);
                                } else {
                                    video.pause();
                                    setIsUserPaused(true);
                                }
                            }
                        }}
                    >
                        {Math.abs(activeVideoIndex - index) <= 1 ? (
                            <>
                                {/* Blurred Background for Landscape videos */}
                                {((item.Width || 0) > (item.Height || 0)) && getPosterUrl(item) && (
                                    <div className="absolute inset-0 w-full h-full overflow-hidden">
                                        <img
                                            src={getPosterUrl(item)}
                                            className="w-full h-full object-cover blur-2xl opacity-40 scale-110"
                                            alt=""
                                        />
                                        <div className="absolute inset-0 bg-black/30" />
                                    </div>
                                )}

                                <video
                                    ref={(el) => {
                                        videoRefs.current[index] = el;
                                        // Try to play immediately if it's the active one that just mounted
                                        if (el && activeVideoIndex === index && el.paused && !isUserPaused) {
                                            safePlay(index);
                                        }
                                    }}
                                    src={getVideoUrl(item)}
                                    className={`relative z-10 w-full h-full pointer-events-auto bg-transparent ${displayMode === 'cover' ? 'object-cover' :
                                        displayMode === 'contain' ? 'object-contain' :
                                            (isScreenLandscape || (item.Width || 0) > (item.Height || 0)) ? 'object-contain' : 'object-cover'
                                        }`}
                                    autoPlay={activeVideoIndex === index}
                                    loop={playbackMode === 'loop'}
                                    muted={isMuted}
                                    playsInline
                                    onPlaying={() => handlePlaying(item.Id)}
                                    onEnded={() => {
                                        if (playbackMode === 'next' && activeVideoIndex < items.length - 1) {
                                            const nextIndex = activeVideoIndex + 1;
                                            itemRefs.current[nextIndex]?.scrollIntoView({ behavior: 'smooth' });
                                            // Trigger play immediately. onEnded is also a valid user-originated activation point in some browsers
                                            safePlay(nextIndex);
                                        }
                                    }}
                                    onTimeUpdate={(e) => handleTimeUpdate(item.Id, e)}
                                    onLoadedMetadata={(e) => handleLoadedMetadata(item.Id, e)}
                                />
                                {getPosterUrl(item) && !hasStarted[item.Id] && (
                                    <img
                                        src={getPosterUrl(item)}
                                        className={`absolute inset-0 w-full h-full z-20 pointer-events-none ${displayMode === 'cover' ? 'object-cover' :
                                            displayMode === 'contain' ? 'object-contain' :
                                                (isScreenLandscape || (item.Width || 0) > (item.Height || 0)) ? 'object-contain' : 'object-cover'
                                            }`}
                                        alt=""
                                    />
                                )}
                            </>
                        ) : (
                            <div className="w-full h-full bg-black pointer-events-auto" />
                        )}

                        {/* Video Controls Overlay */}
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
                            {isFastForwarding && activeVideoIndex === index && (
                                <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50">
                                    <motion.div
                                        initial={{ opacity: 0, y: -20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10"
                                    >
                                        <div className="flex gap-0.5">
                                            <Play size={14} className="fill-white text-white" />
                                            <Play size={14} className="fill-white text-white" />
                                        </div>
                                        <span className="text-white font-bold text-sm tracking-widest">2.0X 倍速播放中</span>
                                    </motion.div>
                                </div>
                            )}

                            {(activeVideoIndex === index && isUserPaused) && (
                                <motion.div
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="w-20 h-20 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white/80"
                                >
                                    <Play size={40} className="ml-2" />
                                </motion.div>
                            )}
                        </div>

                        {/* Video Info Overlay */}
                        <div className="absolute bottom-0 left-0 right-0 p-6 pb-12 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none flex flex-col justify-end z-30">
                            <h2 className="text-white text-xl font-bold mb-2 drop-shadow-lg leading-tight line-clamp-2">
                                {item.Name}
                            </h2>
                            {item.Overview && (
                                <p className="text-white/80 text-sm line-clamp-3 drop-shadow-md">
                                    {item.Overview}
                                </p>
                            )}
                        </div>

                        {/* Progress Bar - Bottom (Douyin Style) */}
                        {activeVideoIndex === index && (
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
                                            height: isDragging ? 4 : 1,
                                            opacity: (isDragging || hasManualSeek[item.Id]) ? 0.8 : 0,
                                            translateY: (isDragging || hasManualSeek[item.Id]) ? 0 : 2
                                        }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <motion.div
                                            className="h-full bg-white relative"
                                            style={{ width: `${(((isDragging && seekPreviewTime !== null ? seekPreviewTime : currentTime[item.Id]) || 0) / (duration[item.Id] || 1)) * 100}%` }}
                                        />
                                    </motion.div>

                                    {/* Visual Thumb for dragging */}
                                    {isDragging && (
                                        <motion.div
                                            className="absolute w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
                                            style={{
                                                left: `${(((isDragging && seekPreviewTime !== null ? seekPreviewTime : currentTime[item.Id]) || 0) / (duration[item.Id] || 1)) * 100}%`,
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
                                                    style={{ width: `${(seekPreviewTime / (duration[item.Id] || 1)) * 100}%` }}
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
            <style>{`
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .no-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
            {/* Sidebar Overlay Content */}
            <AnimatePresence>
                {isSidebarOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsSidebarOpen(false)}
                            className="absolute inset-0 bg-black/50 z-[60] backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="absolute top-0 bottom-0 right-0 w-80 max-w-[80vw] bg-[#111] z-[70] shadow-2xl flex flex-col border-l border-white/10"
                        >
                            <div className="flex items-center justify-between p-6 border-b border-white/10"
                                style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Folder size={20} className="text-primary" />
                                    选择媒体库
                                </h2>
                                <button onClick={() => setIsSidebarOpen(false)} className="p-2 -mr-2 text-white/60 hover:text-white transition-colors">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                <button
                                    onClick={() => {
                                        setSelectedFolderId(null);
                                        setIsSidebarOpen(false);
                                    }}
                                    className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${selectedFolderId === null ? 'bg-primary/20 text-primary border border-primary/30' : 'text-white/80 hover:bg-white/5 border border-transparent'}`}
                                >
                                    全部媒体
                                </button>

                                {foldersLoading ? (
                                    <div className="flex items-center justify-center p-8 text-white/40">
                                        <Loader2 className="animate-spin mr-2" size={20} /> 加载中...
                                    </div>
                                ) : (
                                    folders.map(folder => (
                                        <button
                                            key={folder.Id}
                                            onClick={() => {
                                                setSelectedFolderId(folder.Id);
                                                setIsSidebarOpen(false);
                                            }}
                                            className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center justify-between ${selectedFolderId === folder.Id ? 'bg-primary/20 text-primary border border-primary/30' : 'text-white/80 hover:bg-white/5 border border-transparent'}`}
                                        >
                                            <span className="truncate flex-1">{folder.Name}</span>
                                            {selectedFolderId === folder.Id && <div className="w-2 h-2 rounded-full bg-primary" />}
                                        </button>
                                    ))
                                )}

                                {!foldersLoading && folders.length === 0 && (
                                    <div className="text-center p-8 text-white/40 text-sm">
                                        未能获取到媒体库信息
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

export default EmbyPlayer;
