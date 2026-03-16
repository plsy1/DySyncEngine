import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Loader2, Play, AlertCircle, Menu, X, Folder, Volume2, VolumeX, Maximize2, Minimize2, Monitor, Repeat, ArrowRightCircle, Clock, Shuffle, Trash2 } from 'lucide-react';
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
    DateCreated?: string;
    Path?: string;
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
    const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
    const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>(() => {
        const saved = localStorage.getItem('emby_player_folder_ids');
        return saved ? saved.split(',') : [];
    });
    const [sidebarPath, setSidebarPath] = useState<{ id: string, name: string }[]>([]);
    const [foldersLoading, setFoldersLoading] = useState(false);
    const [isMuted, setIsMuted] = useState(true);
    const [videoMetadata, setVideoMetadata] = useState<Record<string, any>>({});

    // Progress State
    const [currentTime, setCurrentTime] = useState<{ [key: string]: number }>({});
    const [duration, setDuration] = useState<{ [key: string]: number }>({});
    const [isDragging, setIsDragging] = useState(false);
    const [touchStartX, setTouchStartX] = useState(0);
    const [touchStartY, setTouchStartY] = useState(0);
    const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [isUserPaused, setIsUserPaused] = useState(false);
    const [isFastForwarding, setIsFastForwarding] = useState(false);
    const longPressTimerRef = useRef<any>(null);
    const wheelTimerRef = useRef<number>(0);
    const [hasStarted, setHasStarted] = useState<{ [key: string]: boolean }>({});
    const [hasManualSeek, setHasManualSeek] = useState<{ [key: string]: boolean }>({});
    const [displayMode, setDisplayMode] = useState<'smart' | 'cover' | 'contain'>('smart');
    const [playbackMode, setPlaybackMode] = useState<'loop' | 'next'>('loop');
    const [sharingId, setSharingId] = useState<string | null>(null);
    const [deleteConfirmItem, setDeleteConfirmItem] = useState<EmbyItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
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
        localStorage.setItem('emby_player_folder_ids', selectedFolderIds.join(','));
        loadSettingsAndVideos(tab, selectedFolderIds.length > 0 ? selectedFolderIds.join(',') : null);
    }, [tab, selectedFolderIds]);

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

            // IF a default library is set, and no specific folders are selected, 
            // use the default library as the starting ParentId.
            let effectiveFolderId = folderId;
            if (!effectiveFolderId && data.emby_default_library) {
                effectiveFolderId = data.emby_default_library;
            }

            const folderIds = effectiveFolderId ? effectiveFolderId.split(',') : [null];

            // Fetch from each folder in parallel
            const fetchPromises = folderIds.map(fid => {
                const params: any = {
                    api_key: data.emby_api_key,
                    IncludeItemTypes: 'Video,Movie,Episode',
                    Recursive: 'true',
                    SortBy: currentTab === 'latest' ? 'DateCreated' : 'Random',
                    SortOrder: currentTab === 'latest' ? 'Descending' : undefined,
                    Limit: folderIds.length > 1 ? Math.max(10, Math.floor(40 / folderIds.length)) : 40,
                    Fields: 'Overview,Path,PrimaryImageAspectRatio,ImageTags,Width,Height,DateCreated'
                };
                if (fid) params.ParentId = fid;
                return embyApi.get('/emby/Items', { params });
            });

            const responses = await Promise.all(fetchPromises);
            let allItems: EmbyItem[] = [];

            responses.forEach(response => {
                if (response.data && response.data.Items) {
                    allItems = [...allItems, ...response.data.Items];
                }
            });

            // Filter duplicates and only keep Videos
            const uniqueItems = Array.from(new Map(
                allItems
                    .filter(i => i.MediaType === 'Video')
                    .map(item => [item.Id, item])
            ).values());

            // Sort by date if latest tab
            if (currentTab === 'latest') {
                uniqueItems.sort((a, b) => {
                    const dateA = new Date(a.DateCreated || 0).getTime();
                    const dateB = new Date(b.DateCreated || 0).getTime();
                    return dateB - dateA;
                });
            } else {
                // Shuffle for random tab
                uniqueItems.sort(() => Math.random() - 0.5);
            }

            setItems(uniqueItems);

            // Enhance with local metadata
            const paths = uniqueItems.map(i => (i as any).Path).filter(Boolean);
            if (paths.length > 0) {
                api.lookupVideos(paths).then(mapping => {
                    setVideoMetadata(prev => ({ ...prev, ...mapping }));
                }).catch(e => console.error("Metadata lookup failed", e));
            }

            if (uniqueItems.length === 0) {
                setError('在指定的 Emby 服务器中没有找到视频内容');
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

            const folderIds = selectedFolderIds.length > 0 ? selectedFolderIds : [null];

            // For multi-folder, we fetch a small batch from each to merge
            // This is a simplified pagination strategy for merged results
            const fetchPromises = folderIds.map(fid => {
                const params: any = {
                    api_key: settings.emby_api_key,
                    IncludeItemTypes: 'Video,Movie,Episode',
                    Recursive: 'true',
                    SortBy: tab === 'latest' ? 'DateCreated' : 'Random',
                    SortOrder: tab === 'latest' ? 'Descending' : undefined,
                    Limit: folderIds.length > 1 ? 10 : 20,
                    Fields: 'Overview,Path,PrimaryImageAspectRatio,ImageTags,Width,Height,DateCreated',
                    StartIndex: folderIds.length === 1 ? items.length : undefined
                };

                // If multi-select, we can't easily use StartIndex without tracking per-folder counts.
                // Instead, we rely on the deduplication logic.
                if (fid) params.ParentId = fid;
                return embyApi.get('/emby/Items', { params });
            });

            const responses = await Promise.all(fetchPromises);
            let newItems: EmbyItem[] = [];

            responses.forEach(response => {
                if (response.data && response.data.Items) {
                    newItems = [...newItems, ...response.data.Items];
                }
            });

            // Filter out existing items and non-videos
            const uniqueNewItems = newItems.filter((i: EmbyItem) =>
                i.MediaType === 'Video' && !items.some(existing => existing.Id === i.Id)
            );

            if (uniqueNewItems.length > 0) {
                // Merged sort if latest
                let nextList = [...items, ...uniqueNewItems];
                if (tab === 'latest') {
                    nextList.sort((a, b) => {
                        const dateA = new Date(a.DateCreated || 0).getTime();
                        const dateB = new Date(b.DateCreated || 0).getTime();
                        return dateB - dateA;
                    });
                }
                setItems(nextList);

                // Enhance new items
                const newPaths = uniqueNewItems.map(i => (i as any).Path).filter(Boolean);
                if (newPaths.length > 0) {
                    api.lookupVideos(newPaths).then(mapping => {
                        setVideoMetadata(prev => ({ ...prev, ...mapping }));
                    }).catch(e => console.error("Metadata lookup (load more) failed", e));
                }
            }
        } catch (err) {
            console.error('Failed to load more videos:', err);
        } finally {
            setLoadingMore(false);
        }
    };

    const fetchFolders = async (parentId?: string) => {
        if (!settings || !settings.emby_server_url || !settings.emby_api_key) return;
        setFoldersLoading(true);
        try {
            const embyApi = axios.create({
                baseURL: settings.emby_server_url,
                timeout: 5000,
            });

            // If we are at root AND a default library is configured, fetch from that library instead.
            const effectiveParentId = (sidebarPath.length === 0 && settings.emby_default_library) 
                ? settings.emby_default_library 
                : parentId;

            const response = await embyApi.get('/emby/Items', {
                params: {
                    api_key: settings.emby_api_key,
                    ParentId: effectiveParentId,
                    Recursive: 'false',
                    IsFolder: 'true',
                    SortBy: 'SortName',
                    SortOrder: 'Ascending',
                    Fields: 'ImageTags' 
                }
            });
            if (response.data && response.data.Items) {
                setFolders(response.data.Items);
            }
        } catch (err) {
            console.error('获取媒体库失败', err);
            onNotify('获取目录失败', 'error');
        } finally {
            setFoldersLoading(false);
        }
    };

    const handleFolderClick = (folder: EmbyItem) => {
        setSidebarPath(prev => [...prev, { id: folder.Id, name: folder.Name }]);
        fetchFolders(folder.Id);
    };

    const handleBackFolder = () => {
        setSidebarPath(prev => {
            const newPath = prev.slice(0, -1);
            const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : undefined;
            fetchFolders(parentId);
            return newPath;
        });
    };

    const handleSelectFolder = (folderId: string | null) => {
        if (folderId === null) {
            setSelectedFolderIds([]);
            setIsSidebarOpen(false);
            return;
        }

        if (isMultiSelectMode) {
            setSelectedFolderIds(prev =>
                prev.includes(folderId)
                    ? prev.filter(id => id !== folderId)
                    : [...prev, folderId]
            );
        } else {
            setSelectedFolderIds([folderId]);
            setIsSidebarOpen(false);
        }
    };

    const handleOpenSidebar = () => {
        setIsSidebarOpen(true);
        // Only fetch if empty or we are at root
        if (sidebarPath.length === 0) {
            fetchFolders();
        } else {
            fetchFolders(sidebarPath[sidebarPath.length - 1].id);
        }
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

    const handleShare = async (item: EmbyItem) => {
        if (sharingId) return;
        const url = getVideoUrl(item);
        if (!url) return;

        setSharingId(item.Id);
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const fileName = `${item.Name || 'video'}.mp4`;
            const file = new File([blob], fileName, { type: 'video/mp4' });

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: item.Name,
                    text: item.Overview
                });
            } else {
                // Fallback for browsers that don't support file sharing
                const downloadUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(downloadUrl);
                onNotify('浏览器不支持直接分享，已尝试开启下载', 'success');
            }
        } catch (err) {
            console.error('Sharing failed', err);
            onNotify('准备视频失败，请重试', 'error');
        } finally {
            setSharingId(null);
        }
    };

    const handleDelete = async (item: EmbyItem) => {
        if (!settings || isDeleting) return;
        setIsDeleting(true);
        try {
            const embyApi = axios.create({
                baseURL: settings.emby_server_url,
                timeout: 10000,
            });
            await embyApi.delete(`/emby/Items/${item.Id}`, {
                params: { api_key: settings.emby_api_key }
            });
            // Remove deleted item from list
            setItems(prev => {
                const newItems = prev.filter(i => i.Id !== item.Id);
                // Adjust active index if needed
                if (activeVideoIndex >= newItems.length && newItems.length > 0) {
                    setActiveVideoIndex(newItems.length - 1);
                }
                return newItems;
            });
            onNotify('视频已删除', 'success');
        } catch (err: any) {
            console.error('Delete failed:', err);
            onNotify('删除失败，请检查权限或重试', 'error');
        } finally {
            setIsDeleting(false);
            setDeleteConfirmItem(null);
        }
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

    const handleWheel = (e: React.WheelEvent) => {
        if (isSidebarOpen || deleteConfirmItem || loadingMore) return;
        
        // Sensitivity check for standard mouse wheel
        if (Math.abs(e.deltaY) < 20) return;
        
        const now = Date.now();
        if (now - wheelTimerRef.current < 600) return; // Debounce to prevent rapid skipping

        if (e.deltaY > 0) {
            if (activeVideoIndex < items.length - 1) {
                wheelTimerRef.current = now;
                const nextIndex = activeVideoIndex + 1;
                itemRefs.current[nextIndex]?.scrollIntoView({ behavior: 'smooth' });
            }
        } else {
            if (activeVideoIndex > 0) {
                wheelTimerRef.current = now;
                const prevIndex = activeVideoIndex - 1;
                itemRefs.current[prevIndex]?.scrollIntoView({ behavior: 'smooth' });
            }
        }
    };

    // Handle scroll to play/pause using Intersection Observer
    useEffect(() => {
        if (!containerRef.current || items.length === 0) return;

        const observerOptions = {
            root: containerRef.current,
            rootMargin: '0px',
            threshold: 0.5, // Trigger slightly earlier for responsiveness
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

    // Keyboard Shortcuts for PC
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isSidebarOpen || deleteConfirmItem) return;
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (activeVideoIndex < items.length - 1) {
                    const nextIndex = activeVideoIndex + 1;
                    itemRefs.current[nextIndex]?.scrollIntoView({ behavior: 'smooth' });
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (activeVideoIndex > 0) {
                    const prevIndex = activeVideoIndex - 1;
                    itemRefs.current[prevIndex]?.scrollIntoView({ behavior: 'smooth' });
                }
            } else if (e.key === ' ') {
                e.preventDefault();
                const video = videoRefs.current[activeVideoIndex];
                if (video) {
                    if (video.paused) {
                        video.play();
                        setIsUserPaused(false);
                    } else {
                        video.pause();
                        setIsUserPaused(true);
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeVideoIndex, items.length, isSidebarOpen, deleteConfirmItem]);


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

    // Error handling moved to main return to allow sidebar access

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
            {/* Main Content Area */}
            <div className="flex-1 relative overflow-hidden">
                {error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-black">
                        <AlertCircle size={48} className="text-red-500/80 mb-4" />
                        <h2 className="text-xl font-bold text-white mb-2">出错了</h2>
                        <p className="text-white/60 max-w-sm mb-8">{error}</p>
                        <button
                            onClick={handleOpenSidebar}
                            className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/10 active:scale-95 flex items-center gap-2"
                        >
                            <Menu size={20} />
                            打开侧边栏选择目录
                        </button>
                    </div>
                ) : (
                    <div
                        ref={containerRef}
                        className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar scroll-smooth"
                        onWheel={handleWheel}
                    >
                        <div className="min-h-full">
                            {items.map((item, index) => (
                                <div
                                    key={item.Id}
                                    ref={(el) => { itemRefs.current[index] = el; }}
                                    className="h-screen w-full snap-start relative flex items-center justify-center overflow-hidden bg-black"
                                    style={{ scrollSnapStop: 'always' }}
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

                                        {/* Right Action Buttons */}
                                        <div className="absolute right-4 bottom-32 flex flex-col gap-10 items-center pointer-events-auto z-40">
                                            {item.Path && videoMetadata[item.Path]?.avatar_url && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const m = videoMetadata[item.Path];
                                                        if (m.platform === 'douyin' && m.sec_user_id) {
                                                            window.open(`https://www.douyin.com/user/${m.sec_user_id}`, '_blank');
                                                        } else if (m.platform === 'tiktok' && m.nickname) {
                                                            window.open(`https://www.tiktok.com/@${m.nickname}`, '_blank');
                                                        }
                                                    }}
                                                    className="w-14 h-14 rounded-full border-2 border-white overflow-hidden shadow-xl hover:scale-110 transition-transform active:scale-90"
                                                >
                                                    <img 
                                                        src={videoMetadata[item.Path].avatar_url} 
                                                        alt="avatar" 
                                                        className="w-full h-full object-cover"
                                                    />
                                                </button>
                                            )}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleShare(item);
                                                }}
                                                onTouchStart={(e) => e.stopPropagation()}
                                                onTouchMove={(e) => e.stopPropagation()}
                                                onTouchEnd={(e) => e.stopPropagation()}
                                                disabled={sharingId === item.Id}
                                                className="flex flex-col items-center group relative p-4 -m-4"
                                            >
                                                <div className="flex items-center justify-center text-white transition-all group-active:scale-95 drop-shadow-lg">
                                                    {sharingId === item.Id ? (
                                                        <Loader2 size={36} className="animate-spin opacity-80" />
                                                    ) : (
                                                        <svg width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                            <path d="M24 6L24 32" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                                                            <path d="M37 19L24 6L11 19" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                                                            <path d="M8 34V40C8 41.1046 8.89543 42 10 42H38C39.1046 42 40 41.1046 40 40V34" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                                                        </svg>
                                                    )}
                                                </div>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteConfirmItem(item);
                                                }}
                                                onTouchStart={(e) => e.stopPropagation()}
                                                onTouchMove={(e) => e.stopPropagation()}
                                                onTouchEnd={(e) => e.stopPropagation()}
                                                className="flex flex-col items-center group relative p-4 -m-4"
                                            >
                                                <div className="flex items-center justify-center text-white transition-all group-active:scale-95 drop-shadow-lg">
                                                    <Trash2 size={32} className="opacity-80" />
                                                </div>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Video Info Overlay */}
                                    <div className="absolute bottom-0 left-0 right-0 p-6 pb-12 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none flex flex-col justify-end z-30">
                                        <div className="flex items-center gap-2 mb-2 drop-shadow-md">
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (item.Path && videoMetadata[item.Path]) {
                                                        const m = videoMetadata[item.Path];
                                                        if (m.platform === 'douyin' && m.sec_user_id) {
                                                            window.open(`https://www.douyin.com/user/${m.sec_user_id}`, '_blank');
                                                        } else if (m.platform === 'tiktok' && m.nickname) {
                                                            window.open(`https://www.tiktok.com/@${m.nickname}`, '_blank');
                                                        }
                                                    }
                                                }}
                                                className="text-white font-bold text-lg hover:text-primary transition-colors pointer-events-auto"
                                            >
                                                @{item.Path && videoMetadata[item.Path]?.nickname ? videoMetadata[item.Path].nickname : item.Name}
                                            </button>
                                            {item.Path && videoMetadata[item.Path]?.platform && (
                                                <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded border border-primary/20 uppercase">
                                                    {videoMetadata[item.Path].platform}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-white/80 text-sm line-clamp-3 drop-shadow-md">
                                            {(item.Path && videoMetadata[item.Path]?.desc) || item.Overview}
                                        </p>
                                    </div>

                                    {/* Progress Bar - Bottom (Douyin Style) */}
                                    {activeVideoIndex === index && (
                                        <>
                                            <div
                                                className="absolute left-0 right-0 cursor-pointer pointer-events-auto z-[50] flex items-end group/progress"
                                                style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4px)', height: '40px' }}
                                                onMouseDown={() => setIsDragging(true)}
                                                onMouseUp={() => setIsDragging(false)}
                                                onClick={(e) => handleSeek(item.Id, index, e)}
                                                onTouchStart={() => setIsDragging(true)}
                                                onTouchEnd={() => setIsDragging(false)}
                                                onTouchMove={(e) => handleSeek(item.Id, index, e)}
                                            >
                                                <motion.div
                                                    className="w-full bg-white/20 overflow-hidden relative group-hover/progress:!h-[6px] group-hover/progress:!opacity-80"
                                                    initial={{ height: 2, opacity: 0 }}
                                                    animate={{
                                                        height: isDragging ? 6 : 2,
                                                        opacity: (isDragging || hasManualSeek[item.Id]) ? 0.8 : 0.4,
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
                        </div>

                        {items.length === 0 && !loading && !error && (
                            <div className="flex h-full items-center justify-center text-white/50">
                                暂无视频内容
                            </div>
                        )}
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

            {/* Delete Confirmation Dialog */}
            <AnimatePresence>
                {deleteConfirmItem && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => !isDeleting && setDeleteConfirmItem(null)}
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.85 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85vw] max-w-sm bg-[#1a1a1a] rounded-3xl z-[201] overflow-hidden border border-white/10 shadow-2xl"
                        >
                            <div className="p-6 text-center">
                                <div className="w-14 h-14 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
                                    <Trash2 size={28} className="text-red-500" />
                                </div>
                                <h3 className="text-white text-lg font-bold mb-2">确认删除</h3>
                                <p className="text-white/50 text-sm leading-relaxed">
                                    确定要从 Emby 服务器删除
                                    <span className="text-white/80 font-medium"> {deleteConfirmItem.Name} </span>
                                    吗？此操作不可撤销。
                                </p>
                            </div>
                            <div className="border-t border-white/10 flex">
                                <button
                                    onClick={() => setDeleteConfirmItem(null)}
                                    disabled={isDeleting}
                                    className="flex-1 py-4 text-white/70 font-medium text-[15px] hover:bg-white/5 transition-colors disabled:opacity-50"
                                >
                                    取消
                                </button>
                                <div className="w-px bg-white/10" />
                                <button
                                    onClick={() => handleDelete(deleteConfirmItem)}
                                    disabled={isDeleting}
                                    className="flex-1 py-4 text-red-500 font-bold text-[15px] hover:bg-red-500/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isDeleting ? (
                                        <><Loader2 size={18} className="animate-spin" /> 删除中...</>
                                    ) : '删除'}
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
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
                            <div className="flex flex-col h-full">
                                <div className="p-6 border-b border-white/10">
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-xl font-bold text-white">选择目录</h2>
                                        <button
                                            onClick={() => setIsSidebarOpen(false)}
                                            className="p-2 hover:bg-white/10 rounded-full transition-colors text-white"
                                        >
                                            <X size={24} />
                                        </button>
                                    </div>

                                    {/* Breadcrumbs for folder navigation */}
                                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                                        <button
                                            onClick={() => {
                                                setSidebarPath([]);
                                                fetchFolders();
                                            }}
                                            className={`text-sm whitespace-nowrap px-2 py-1 rounded transition-colors ${sidebarPath.length === 0 ? 'bg-white/20 text-white font-bold' : 'text-white/60 hover:text-white'}`}
                                        >
                                            媒体库
                                        </button>
                                        {sidebarPath.map((path, idx) => (
                                            <div key={path.id} className="flex items-center gap-2">
                                                <span className="text-white/30">/</span>
                                                <button
                                                    onClick={() => {
                                                        const newPath = sidebarPath.slice(0, idx + 1);
                                                        setSidebarPath(newPath);
                                                        fetchFolders(path.id);
                                                    }}
                                                    className={`text-sm whitespace-nowrap px-2 py-1 rounded transition-colors ${idx === sidebarPath.length - 1 ? 'bg-white/20 text-white font-bold' : 'text-white/60 hover:text-white'}`}
                                                >
                                                    {path.name}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto no-scrollbar p-2">
                                    <div className="p-2 space-y-2">
                                        <div className="flex items-center justify-between px-2 mb-2">
                                            <span className="text-white/40 text-xs font-medium uppercase tracking-wider">
                                                {sidebarPath.length > 0 ? sidebarPath[sidebarPath.length - 1].name : '根目录'}
                                            </span>
                                            <button
                                                onClick={() => setIsMultiSelectMode(!isMultiSelectMode)}
                                                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all uppercase tracking-tighter ${isMultiSelectMode
                                                    ? 'bg-primary text-white scale-105'
                                                    : 'bg-white/5 text-white/40 hover:bg-white/10'
                                                    }`}
                                            >
                                                {isMultiSelectMode ? '多选模式已开启' : '多选模式'}
                                            </button>
                                        </div>

                                        {foldersLoading ? (
                                            <div className="flex flex-col items-center justify-center h-40 gap-3">
                                                <Loader2 className="animate-spin text-white/20" size={32} />
                                                <span className="text-sm text-white/20">加载中...</span>
                                            </div>
                                        ) : (
                                            <div className="space-y-1">
                                                {/* All Videos Option (only at root) */}
                                                {sidebarPath.length === 0 && (
                                                    <button
                                                        onClick={() => handleSelectFolder(null)}
                                                        className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${selectedFolderIds.length === 0
                                                            ? 'bg-white/10 ring-1 ring-white/20'
                                                            : 'text-white/80 hover:bg-white/5 active:scale-95'
                                                            }`}
                                                    >
                                                        <div className="p-2 bg-white/5 rounded-xl">
                                                            <Monitor size={20} className="text-white/60" />
                                                        </div>
                                                        <span className="flex-1 text-left text-white/80">
                                                            {settings?.emby_default_library ? '仅看指定媒体库' : '全部媒体库'}
                                                        </span>
                                                    </button>
                                                )}

                                                {/* Back Button (if not at root) */}
                                                {sidebarPath.length > 0 && (
                                                    <button
                                                        onClick={handleBackFolder}
                                                        className="w-full flex items-center gap-4 p-4 rounded-2xl text-white/40 hover:bg-white/5 active:scale-95 transition-all mb-2 border border-dashed border-white/5"
                                                    >
                                                        <div className="p-2">
                                                            <ArrowLeft size={18} />
                                                        </div>
                                                        <span className="text-sm">返回上一级</span>
                                                    </button>
                                                )}

                                                {folders.map((folder: EmbyItem) => {
                                                    const isSelected = selectedFolderIds.includes(folder.Id);
                                                    return (
                                                        <div
                                                            key={folder.Id}
                                                            className={`group flex items-center gap-1 rounded-2xl transition-all ${isSelected
                                                                ? 'bg-white/10 ring-1 ring-white/20'
                                                                : 'hover:bg-white/5'
                                                                }`}
                                                        >
                                                            <button
                                                                onClick={() => handleFolderClick(folder)}
                                                                className="flex-1 flex items-center gap-4 p-4 rounded-l-2xl overflow-hidden"
                                                            >
                                                                <div className={`p-2 rounded-xl transition-colors shrink-0 ${isSelected ? 'bg-primary/20 text-primary' : 'bg-white/5 group-hover:bg-white/10'}`}>
                                                                    <Folder size={20} className={isSelected ? 'fill-primary/20' : ''} />
                                                                </div>
                                                                <span className={`flex-1 text-left line-clamp-1 text-sm ${isSelected ? 'text-white font-bold' : 'text-white/70'}`}>
                                                                    {folder.Name}
                                                                </span>
                                                            </button>

                                                            <button
                                                                onClick={() => handleSelectFolder(folder.Id)}
                                                                className={`p-4 rounded-r-2xl border-l border-white/5 hover:bg-white/10 transition-all ${isSelected ? 'text-primary' : 'text-white/20'}`}
                                                            >
                                                                {isMultiSelectMode ? (
                                                                    <div className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-white/20'}`}>
                                                                        {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                                                                    </div>
                                                                ) : (
                                                                    <Play size={18} className={isSelected ? 'fill-primary text-primary' : 'fill-white/20'} />
                                                                )}
                                                            </button>
                                                        </div>
                                                    );
                                                })}

                                                {folders.length === 0 && !foldersLoading && (
                                                    <div className="p-8 text-center">
                                                        <p className="text-white/40 text-sm">该目录下没有文件夹</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {selectedFolderIds.length > 0 && (
                                    <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md">
                                        <div className="flex items-center justify-between mb-4 px-2">
                                            <span className="text-white/60 text-xs">已选择 {selectedFolderIds.length} 个目录</span>
                                            <button
                                                onClick={() => setSelectedFolderIds([])}
                                                className="text-primary text-xs font-bold hover:underline"
                                            >
                                                清除全部
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => setIsSidebarOpen(false)}
                                            className="w-full py-4 bg-primary text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-95 transition-all shadow-xl shadow-primary/20"
                                        >
                                            <Play size={20} fill="white" />
                                            立即播放选定内容
                                        </button>
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
