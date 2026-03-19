import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Loader2, Play, AlertCircle, Menu, X, Folder, Volume2, VolumeX, Maximize2, Monitor, Repeat, ArrowRightCircle, Trash2, Home, Plus, Clock, Shuffle, Maximize, Minimize } from 'lucide-react';
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
    PrimaryImageAspectRatio?: number;
    DateCreated?: string;
    Path?: string;
    ImageTags?: {
        Primary?: string;
    };
    ParentId?: string;
    Children?: EmbyItem[];
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
    const [volume, setVolume] = useState(() => Number(localStorage.getItem('emby_player_volume') || '1'));
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const [isPCVolumeVisible, setIsPCVolumeVisible] = useState(false);
    const volumeHideTimerRef = useRef<any>(null);
    const [videoMetadata, setVideoMetadata] = useState<Record<string, any>>({});

    // Progress State
    const [currentTime, setCurrentTime] = useState<{ [key: string]: number }>({});
    const [duration, setDuration] = useState<{ [key: string]: number }>({});
    const [videoDimensions, setVideoDimensions] = useState<{ [key: string]: { width: number, height: number } }>({});
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
    const [isMobile, setIsMobile] = useState(
        typeof window !== 'undefined' ? window.innerWidth < 768 : false
    );
    const [isScreenLandscape, setIsScreenLandscape] = useState(
        typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
    );
    const [isIOS] = useState(() => {
        if (typeof window === 'undefined') return false;
        return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    });
    const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
    const [galleryIndexes, setGalleryIndexes] = useState<{ [key: string]: number }>({});
    const [isGalleryManual, setIsGalleryManual] = useState<{ [key: string]: boolean }>({});
    const galleryTimerRef = useRef<any>(null);
    const [fetchState, setFetchState] = useState<{ [key: string]: number }>({}); // Track next StartIndex per folderId
    const [filterMode, setFilterMode] = useState<'video' | 'photo' | 'mixed'>(() => {
        const saved = localStorage.getItem('emby_player_filter_mode');
        return (saved as any) || 'mixed';
    });
    const [isFullscreen, setIsFullscreen] = useState(false);
    const skipClickRef = useRef(false);
    const [expandedDescs, setExpandedDescs] = useState<{ [key: string]: boolean }>({});
    const [isTruncated, setIsTruncated] = useState<{ [key: string]: boolean }>({});
    const descRefs = useRef<{ [key: string]: HTMLParagraphElement | null }>({});

    // Effect to check if descriptions are truncated
    useEffect(() => {
        const checkTruncation = () => {
            const newTruncated: { [key: string]: boolean } = {};
            items.forEach(item => {
                const el = descRefs.current[item.Id];
                if (el) {
                    // Temporarily set to line-clamp-3 to measure its original state
                    // if it's already expanded, it might not show scrollHeight correctly for collapsed state.
                    // But scrollHeight is usually the total height regardless of clamp.
                    newTruncated[item.Id] = el.scrollHeight > el.clientHeight + 2; // +2 for potential sub-pixel differences
                }
            });
            setIsTruncated(newTruncated);
        };

        // Small delay to ensure items are rendered and CSS is applied
        const timer = setTimeout(checkTruncation, 300);
        window.addEventListener('resize', checkTruncation);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', checkTruncation);
        };
    }, [items, videoMetadata, activeVideoIndex]); // Re-check when items/metadata or active index changes

    useEffect(() => {
        const handleResize = () => {
            setIsScreenLandscape(window.innerWidth > window.innerHeight);
            setIsMobile(window.innerWidth < 768);
        };
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        window.addEventListener('resize', handleResize);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('emby_player_volume', volume.toString());
        videoRefs.current.forEach(v => {
            if (v) {
                v.volume = volume;
                v.muted = isMuted;
            }
        });
    }, [volume, isMuted]);

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                onNotify(`无法进入全屏: ${err.message}`, 'error');
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }, [onNotify]);

    const goToNextContent = useCallback(() => {
        if (activeVideoIndex < items.length - 1) {
            const nextIndex = activeVideoIndex + 1;
            itemRefs.current[nextIndex]?.scrollIntoView({ behavior: 'smooth' });
            // safePlay(nextIndex) is handled by video el's ref or other logic if needed, 
            // but setting active index via scroll observer is usually how this app works.
        }
    }, [activeVideoIndex, items.length]);

    useEffect(() => {
        if (galleryTimerRef.current) clearTimeout(galleryTimerRef.current);

        const currentItem = items[activeVideoIndex];
        if (currentItem?.Type === 'Gallery' && !isGalleryManual[currentItem.Id] && !isUserPaused) {
            const currentIndex = galleryIndexes[currentItem.Id] || 0;
            const totalImages = currentItem.Children?.length || 0;

            galleryTimerRef.current = setTimeout(() => {
                if (currentIndex < totalImages - 1) {
                    setGalleryIndexes(prev => ({ ...prev, [currentItem.Id]: currentIndex + 1 }));
                } else {
                    // Last image, go to next content
                    goToNextContent();
                }
            }, 1500); // 5 seconds per image
        }

        return () => {
            if (galleryTimerRef.current) clearTimeout(galleryTimerRef.current);
        };
    }, [activeVideoIndex, galleryIndexes, isGalleryManual, isUserPaused, items, goToNextContent]);

    useEffect(() => {
        const item = items[activeVideoIndex];
        if (item?.Type === 'Gallery') {
            // Reset manual flag and index when we first land on a gallery
            setIsGalleryManual(prev => ({ ...prev, [item.Id]: false }));
            setGalleryIndexes(prev => ({ ...prev, [item.Id]: 0 }));
        }
    }, [activeVideoIndex]); // Only depend on active index to reset when switching between cards

    // Preload next image in current gallery
    useEffect(() => {
        const currentItem = items[activeVideoIndex];
        if (currentItem?.Type === 'Gallery' && currentItem.Children) {
            const currentIndex = galleryIndexes[currentItem.Id] || 0;
            const nextIndex = currentIndex + 1;
            if (nextIndex < currentItem.Children.length) {
                const url = getPosterUrl(currentItem.Children[nextIndex], true);
                if (url) {
                    const img = new Image();
                    img.src = url;
                }
            }
        }
    }, [activeVideoIndex, galleryIndexes, items]);

    const getFolderName = (path?: string) => {
        if (!path) return '';
        const parts = path.replace(/\\/g, '/').split('/');
        return parts.length > 1 ? parts[parts.length - 2] : '';
    };

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    };

    const handlePlaying = (itemId: string) => {
        setHasStarted(prev => ({ ...prev, [itemId]: true }));
    };

    const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        localStorage.setItem('emby_player_folder_ids', selectedFolderIds.join(','));
        localStorage.setItem('emby_player_filter_mode', filterMode);
        loadSettingsAndVideos(tab, selectedFolderIds.length > 0 ? selectedFolderIds.join(',') : null);
    }, [tab, selectedFolderIds, filterMode]);

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
                timeout: 15000, // Increased timeout for larger libraries
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
                const includeTypes = filterMode === 'video' ? 'Video,Movie,Episode' :
                    filterMode === 'photo' ? 'Photo' :
                        'Video,Movie,Episode,Photo';

                const params: any = {
                    api_key: data.emby_api_key,
                    IncludeItemTypes: includeTypes,
                    Recursive: 'true',
                    SortBy: currentTab === 'latest' ? 'DateCreated' : 'Random',
                    SortOrder: currentTab === 'latest' ? 'Descending' : undefined,
                    Limit: folderIds.length > 1 ? Math.max(40, Math.floor(200 / folderIds.length)) : 100,
                    Fields: 'Overview,Path,PrimaryImageAspectRatio,ImageTags,Width,Height,DateCreated,ParentId',
                    StartIndex: 0
                };
                if (fid) params.ParentId = fid;
                return embyApi.get('/emby/Items', { params });
            });

            const responses = await Promise.all(fetchPromises);
            let allItems: EmbyItem[] = [];


            const newFetchState: { [key: string]: number } = {};
            responses.forEach((response, idx) => {
                const fid = folderIds[idx] || 'root';
                if (response.data && response.data.Items) {
                    allItems = [...allItems, ...response.data.Items];
                    newFetchState[fid] = response.data.Items.length;
                }
            });
            setFetchState(newFetchState);

            // Grouping logic: Videos are separate, Photos are grouped by ParentId
            const videos = allItems.filter(i => i.MediaType === 'Video');
            const photos = allItems.filter(i => i.MediaType === 'Photo' || i.Type === 'Photo');

            const photoGroups = new Map<string, EmbyItem[]>();
            photos.forEach(p => {
                const pid = p.ParentId || 'root';
                if (!photoGroups.has(pid)) photoGroups.set(pid, []);
                // Deduplicate photos by ID within the same group
                if (!photoGroups.get(pid)!.some(existing => existing.Id === p.Id)) {
                    photoGroups.get(pid)!.push(p);
                }
            });

            // Create processed items list
            let processedItems: EmbyItem[] = [...videos];

            // Add photos: If multiple in a folder, create a gallery. Else add individually.
            photoGroups.forEach((group) => {
                if (group.length > 1) {
                    // Sorting photos by name naturally treats (1.jpg, 2.jpg) correctly
                    group.sort((a, b) => (a.Name || '').localeCompare(b.Name || '', undefined, { numeric: true }));

                    // We use the first photo as the "template" for the gallery item
                    const template = { ...group[0] };
                    const folderName = getFolderName(template.Path);
                    if (folderName) template.Name = folderName;

                    processedItems.push({
                        ...template,
                        Type: 'Gallery', // UI internal type
                        Children: group,
                    });
                } else {
                    const item = { ...group[0] };
                    const folderName = getFolderName(item.Path);
                    // If the item name is just a generic filename (like 1.jpg), use folder name
                    if (folderName && (item.Name.match(/^\d+\.(jpg|png|jpeg|webp)$/i) || item.Name.length < 5)) {
                        item.Name = folderName;
                    }
                    processedItems.push(item);
                }
            });

            // Filter duplicates (just in case)
            const uniqueItems = Array.from(new Map(
                processedItems.map(item => [
                    (item.Type === 'Gallery' || item.MediaType === 'Photo' || item.Type === 'Photo')
                        ? `gallery_${item.ParentId || 'root'}`
                        : item.Id,
                    item
                ])
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

            let effectiveFolderId = selectedFolderIds.length > 0 ? selectedFolderIds.join(',') : null;
            if (!effectiveFolderId && settings.emby_default_library) {
                effectiveFolderId = settings.emby_default_library;
            }
            const folderIds = effectiveFolderId ? effectiveFolderId.split(',') : [null];

            // For multi-folder, we fetch a small batch from each to merge
            // This is a simplified pagination strategy for merged results
            const includeTypes = filterMode === 'video' ? 'Video,Movie,Episode' :
                filterMode === 'photo' ? 'Photo' :
                    'Video,Movie,Episode,Photo';

            const fetchPromises = folderIds.map(fid => {
                const params: any = {
                    api_key: settings.emby_api_key,
                    IncludeItemTypes: includeTypes,
                    Recursive: 'true',
                    SortBy: tab === 'latest' ? 'DateCreated' : 'Random',
                    SortOrder: tab === 'latest' ? 'Descending' : undefined,
                    Limit: folderIds.length > 1 ? 50 : 150,
                    Fields: 'Overview,Path,PrimaryImageAspectRatio,ImageTags,Width,Height,DateCreated,ParentId',
                    StartIndex: tab === 'latest' ? (fetchState[fid || 'root'] || 0) : undefined
                };

                // If multi-select, we track per-folder counts.
                if (fid) params.ParentId = fid;
                return embyApi.get('/emby/Items', { params });
            });

            const responses = await Promise.all(fetchPromises);
            let newItems: EmbyItem[] = [];
            const updatedFetchState = { ...fetchState };

            responses.forEach((response, idx) => {
                const fid = folderIds[idx] || 'root';
                if (response.data && response.data.Items) {
                    newItems = [...newItems, ...response.data.Items];
                    updatedFetchState[fid] = (updatedFetchState[fid] || 0) + response.data.Items.length;
                }
            });
            setFetchState(updatedFetchState);

            // Grouping logic: Same as initial load
            const videos = newItems.filter(i => i.MediaType === 'Video');
            const photos = newItems.filter(i => i.MediaType === 'Photo' || i.Type === 'Photo');

            const photoGroups = new Map<string, EmbyItem[]>();
            photos.forEach(p => {
                const pid = p.ParentId || 'root';
                if (!photoGroups.has(pid)) photoGroups.set(pid, []);
                if (!photoGroups.get(pid)!.some(existing => existing.Id === p.Id)) {
                    photoGroups.get(pid)!.push(p);
                }
            });

            let processedNewItems: EmbyItem[] = [...videos];
            photoGroups.forEach((group) => {
                if (group.length > 1) {
                    group.sort((a, b) => (a.Name || '').localeCompare(b.Name || '', undefined, { numeric: true }));
                    const template = { ...group[0] };
                    const folderName = getFolderName(template.Path);
                    if (folderName) template.Name = folderName;

                    processedNewItems.push({
                        ...template,
                        Type: 'Gallery',
                        Children: group,
                    });
                } else {
                    const item = { ...group[0] };
                    const folderName = getFolderName(item.Path);
                    if (folderName && (item.Name.match(/^\d+\.(jpg|png|jpeg|webp)$/i) || item.Name.length < 5)) {
                        item.Name = folderName;
                    }
                    processedNewItems.push(item);
                }
            });

            // Merging logic: 
            // 1. For videos, just check if exists.
            // 2. For photos, if a gallery or single photo for that PID exists, MERGE them.

            let updatedItems = [...items];
            let brandNewItems: EmbyItem[] = [];

            // Handle Videos
            videos.forEach(v => {
                if (!updatedItems.some(existing => existing.Id === v.Id)) {
                    brandNewItems.push(v);
                }
            });

            // Handle Photos/Galleries
            photoGroups.forEach((group, pid) => {
                const existingIndex = updatedItems.findIndex(i =>
                    (i.Type === 'Gallery' || i.MediaType === 'Photo' || i.Type === 'Photo') &&
                    (i.ParentId || 'root') === pid
                );

                if (existingIndex !== -1) {
                    const existing = updatedItems[existingIndex];
                    // Already exists, merge children
                    const currentChildren = existing.Type === 'Gallery' ? (existing.Children || []) : [existing];
                    const mergedChildren = [...currentChildren];

                    group.forEach(newPhoto => {
                        if (!mergedChildren.some(c => c.Id === newPhoto.Id)) {
                            mergedChildren.push(newPhoto);
                        }
                    });

                    if (mergedChildren.length > 1) {
                        mergedChildren.sort((a, b) => (a.Name || '').localeCompare(b.Name || '', undefined, { numeric: true }));
                        const template = { ...mergedChildren[0] };
                        const folderName = getFolderName(template.Path);
                        if (folderName) template.Name = folderName;

                        updatedItems[existingIndex] = {
                            ...template,
                            Type: 'Gallery',
                            Children: mergedChildren,
                            ParentId: pid === 'root' ? undefined : pid
                        };
                    } else {
                        const item = { ...mergedChildren[0] };
                        const folderName = getFolderName(item.Path);
                        if (folderName && (item.Name.match(/^\d+\.(jpg|png|jpeg|webp)$/i) || item.Name.length < 5)) {
                            item.Name = folderName;
                        }
                        updatedItems[existingIndex] = item;
                    }
                } else {
                    // Brand new group
                    if (group.length > 1) {
                        group.sort((a, b) => (a.Name || '').localeCompare(b.Name || '', undefined, { numeric: true }));
                        const template = { ...group[0] };
                        const folderName = getFolderName(template.Path);
                        if (folderName) template.Name = folderName;

                        brandNewItems.push({
                            ...template,
                            Type: 'Gallery',
                            Children: group,
                            ParentId: pid === 'root' ? undefined : pid
                        });
                    } else {
                        const item = { ...group[0] };
                        const folderName = getFolderName(item.Path);
                        if (folderName && (item.Name.match(/^\d+\.(jpg|png|jpeg|webp)$/i) || item.Name.length < 5)) {
                            item.Name = folderName;
                        }
                        brandNewItems.push(item);
                    }
                }
            });

            if (newItems.length > 0) {
                let nextList = [...updatedItems, ...brandNewItems];
                if (tab === 'latest') {
                    nextList.sort((a, b) => {
                        const dateA = new Date(a.DateCreated || 0).getTime();
                        const dateB = new Date(b.DateCreated || 0).getTime();
                        return dateB - dateA;
                    });
                }
                setItems(nextList);

                // Enhance new items
                const newPaths = [...newItems].map(i => (i as any).Path).filter(Boolean);
                if (newPaths.length > 0) {
                    api.lookupVideos(newPaths).then(mapping => {
                        setVideoMetadata(prev => ({ ...prev, ...mapping }));
                    }).catch(e => console.error("Metadata lookup (load more) failed", e));
                }

                // If we fetched items but none were "brand new" vertical slots (all merged), 
                // try fetching one more time automatically to prevent the user from hitting a dead end.
                if (brandNewItems.length === 0 && newItems.length > 0) {
                    setTimeout(() => loadMoreVideos(), 100);
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
            // On iOS, changing volume via JS has no effect, so we skip it to avoid any overhead
            if (!isIOS) video.volume = volume;
            await video.play();
        } catch (err: any) {
            console.warn(`Playback failed for video ${index}:`, err);
            // If blocked by browser (NotAllowedError/iOS policy), fallback to muted auto-play
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                video.muted = true;
                video.play().catch(e => console.error("Muted fallback failed too:", e));
            }
        }
    };

    // Helper to unlock all video elements on first interaction
    const unlockAudio = useCallback(() => {
        if (isAudioUnlocked) return;
        videoRefs.current.forEach(v => {
            if (v) {
                // Prime the audio context by playing/pausing once in a user-gesture handler
                v.muted = isMuted;
                const p = v.play();
                if (p !== undefined) {
                    p.then(() => v.pause()).catch(() => { });
                }
            }
        });
        setIsAudioUnlocked(true);
    }, [isAudioUnlocked, isMuted]);

    const handleTimeUpdate = (itemId: string, e: React.SyntheticEvent<HTMLVideoElement>) => {
        if (isDragging) return;
        const video = e.currentTarget;
        setCurrentTime(prev => ({ ...prev, [itemId]: video.currentTime }));
    };

    const handleLoadedMetadata = (itemId: string, e: React.SyntheticEvent<HTMLVideoElement>) => {
        const video = e.currentTarget;
        setDuration(prev => ({ ...prev, [itemId]: video.duration }));
        setVideoDimensions(prev => ({ ...prev, [itemId]: { width: video.videoWidth, height: video.videoHeight } }));
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
        const url = item.MediaType === 'Video' ? getVideoUrl(item) : getPosterUrl(item);
        if (!url) return;

        setSharingId(item.Id);
        try {
            const isVideo = item.MediaType === 'Video';
            const response = await fetch(url);
            const blob = await response.blob();
            const ext = isVideo ? 'mp4' : 'jpg';
            const mime = isVideo ? 'video/mp4' : 'image/jpeg';
            const fileName = `${item.Name || 'file'}.${ext}`;
            const file = new File([blob], fileName, { type: mime });

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

            // Flag to ignore the following click event
            skipClickRef.current = true;
            setTimeout(() => { skipClickRef.current = false; }, 300);
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

                    // Trigger load more when approaching the end (e.g., 10 items left)
                    if (index >= items.length - 10 && !loadingMore) {
                        loadMoreVideos();
                    }

                    // Advanced Preloading: 3 items ahead, 1 item behind
                    [index - 1, index + 1, index + 2, index + 3].forEach(adjIndex => {
                        const adjItem = items[adjIndex];
                        if (!adjItem) return;

                        if (adjItem.MediaType === 'Video' || adjItem.Type === 'Video') {
                            const adjVideo = videoRefs.current[adjIndex];
                            if (adjVideo && adjVideo.paused) {
                                adjVideo.preload = 'auto';
                            }
                        } else if (adjItem.Type === 'Gallery' && adjItem.Children) {
                            // Preload first 2 images of upcoming galleries
                            adjItem.Children.slice(0, 2).forEach(child => {
                                const url = getPosterUrl(child, true);
                                if (url) {
                                    const img = new Image();
                                    img.src = url;
                                }
                            });
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
                        video.play().catch(() => { });
                        setIsUserPaused(false);
                    } else {
                        video.pause();
                        setIsUserPaused(true);
                    }
                }
            } else if (e.key === 'ArrowRight') {
                const item = items[activeVideoIndex];
                if (item?.Type === 'Gallery') {
                    const current = galleryIndexes[item.Id] || 0;
                    if (current < (item.Children?.length || 0) - 1) {
                        setGalleryIndexes(prev => ({ ...prev, [item.Id]: current + 1 }));
                        setIsGalleryManual(prev => ({ ...prev, [item.Id]: true }));
                    }
                }
            } else if (e.key === 'ArrowLeft') {
                const item = items[activeVideoIndex];
                if (item?.Type === 'Gallery') {
                    const current = galleryIndexes[item.Id] || 0;
                    if (current > 0) {
                        setGalleryIndexes(prev => ({ ...prev, [item.Id]: current - 1 }));
                        setIsGalleryManual(prev => ({ ...prev, [item.Id]: true }));
                    }
                }
            } else if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                toggleFullscreen();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeVideoIndex, items.length, isSidebarOpen, deleteConfirmItem, toggleFullscreen]);


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

    const getPosterUrl = (item: EmbyItem, highRes: boolean = false) => {
        if (!settings || !item.ImageTags?.Primary) return undefined;
        let url = `${settings.emby_server_url}/emby/Items/${item.Id}/Images/Primary?api_key=${settings.emby_api_key}&tag=${item.ImageTags.Primary}&quality=90`;
        if (highRes) url += '&maxWidth=1920';
        return url;
    };

    return (
        <div
            className="fixed inset-0 bg-black z-[100] overflow-hidden flex flex-col select-none"
            onContextMenu={(e) => e.preventDefault()}
            style={{
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                height: isMobile ? '100dvh' : '100vh'
            } as any}
        >
            {/* Top Navigation Bar - Douyin Style */}
            <div className="absolute top-0 left-0 right-0 z-50 pointer-events-none"
                style={{ paddingTop: 'env(safe-area-inset-top)' }}>
                <div className="flex items-center justify-between px-4 sm:px-6 h-14 sm:h-16">
                    {/* Left: Back Button */}
                    <div className="flex-1 flex justify-start items-center">
                        <button
                            onClick={onBack}
                            className="p-2 sm:p-3 text-white transition-all pointer-events-auto drop-shadow-lg opacity-80 hover:opacity-100 hover:bg-white/10 rounded-full"
                        >
                            <ArrowLeft size={28} />
                        </button>
                    </div>

                    {/* Center: Filter Tabs */}
                    <div className="flex-none pointer-events-auto">
                        <div className="flex items-center bg-white/5 backdrop-blur-xl rounded-full px-1 py-1 border border-white/20 ring-1 ring-inset ring-white/10 shadow-xl">
                            {[
                                { id: 'video', label: '视频' },
                                { id: 'mixed', label: '综合' },
                                { id: 'photo', label: '图片' }
                            ].map((m) => (
                                <button
                                    key={m.id}
                                    onClick={() => {
                                        setFilterMode(m.id as any);
                                        onNotify(`切换至: ${m.label}模式`, 'success');
                                    }}
                                    className={`px-4 sm:px-5 py-1.5 rounded-full text-xs sm:text-sm font-black tracking-tight transition-all duration-300 ${filterMode === m.id
                                        ? 'bg-white text-black shadow-lg scale-105'
                                        : 'text-white/60 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Right: PC Version Utilities or Empty Spacer for Mobile to keep Center centered */}
                    <div className="flex-1 flex justify-end items-center pointer-events-auto">
                        {!isMobile ? (
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        const newTab = tab === 'latest' ? 'random' : 'latest';
                                        setTab(newTab);
                                        onNotify(`排序切换至: ${newTab === 'latest' ? '最新发布' : '随机推荐'}`, 'success');
                                    }}
                                    className="p-2.5 text-white/70 hover:text-white transition-all bg-white/5 hover:bg-white/10 rounded-full"
                                    title={tab === 'latest' ? '切换至随机推荐' : '切换至最新发布'}
                                >
                                    {tab === 'latest' ? <Clock size={20} /> : <Shuffle size={20} className="text-primary" />}
                                </button>
                                <button
                                    onClick={() => {
                                        const newMode = playbackMode === 'loop' ? 'next' : 'loop';
                                        setPlaybackMode(newMode);
                                        onNotify(`播放模式: ${newMode === 'loop' ? '单片循环' : '自动连播'}`, 'success');
                                    }}
                                    className="p-2.5 text-white/70 hover:text-white transition-all bg-white/5 hover:bg-white/10 rounded-full"
                                    title="播放模式"
                                >
                                    {playbackMode === 'loop' ? <Repeat size={20} /> : <ArrowRightCircle size={20} className="text-primary" />}
                                </button>
                                <button
                                    onClick={() => {
                                        const modes: ('smart' | 'cover' | 'contain')[] = ['smart', 'cover', 'contain'];
                                        const nextIndex = (modes.indexOf(displayMode) + 1) % modes.length;
                                        setDisplayMode(modes[nextIndex]);
                                        onNotify(`适配模式: ${modes[nextIndex]}`, 'success');
                                    }}
                                    className="p-2.5 text-white/70 hover:text-white transition-all bg-white/5 hover:bg-white/10 rounded-full"
                                    title="画面占比"
                                >
                                    {displayMode === 'smart' ? <Monitor size={20} /> : <Maximize2 size={20} />}
                                </button>
                                <button
                                    onClick={toggleFullscreen}
                                    className="p-2.5 text-white/70 hover:text-white transition-all bg-white/5 hover:bg-white/10 rounded-full"
                                    title={isFullscreen ? "退出全屏" : "全屏模式"}
                                >
                                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                                </button>
                                <div
                                    className="relative flex items-center"
                                    onMouseEnter={() => {
                                        if (volumeHideTimerRef.current) clearTimeout(volumeHideTimerRef.current);
                                        setIsPCVolumeVisible(true);
                                    }}
                                    onMouseLeave={() => {
                                        volumeHideTimerRef.current = setTimeout(() => setIsPCVolumeVisible(false), 800);
                                    }}
                                >
                                    <AnimatePresence>
                                        {isPCVolumeVisible && (
                                            <motion.div
                                                initial={{ opacity: 0, x: 10, scale: 0.95 }}
                                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                                exit={{ opacity: 0, x: 10, scale: 0.9 }}
                                                className="absolute right-full mr-3 bg-black/80 backdrop-blur-xl rounded-full px-4 py-2 flex items-center gap-3 border border-white/10 shadow-2xl z-[100]"
                                            >
                                                <span className="text-[10px] font-bold text-white/70 w-8">{Math.round(volume * 100)}%</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    value={isMuted ? 0 : volume}
                                                    onChange={(e) => {
                                                        const v = parseFloat(e.target.value);
                                                        setVolume(v);
                                                        if (v > 0) setIsMuted(false);
                                                        else setIsMuted(true);
                                                    }}
                                                    onMouseDown={() => {
                                                        if (volumeHideTimerRef.current) clearTimeout(volumeHideTimerRef.current);
                                                    }}
                                                    className="w-24 volume-slider appearance-none cursor-pointer"
                                                    style={{ backgroundSize: `${(isMuted ? 0 : volume) * 100}% 100%` }}
                                                />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                    <button
                                        onClick={() => {
                                            const nextMuted = !isMuted;
                                            setIsMuted(nextMuted);
                                            if (!nextMuted && volume === 0) {
                                                setVolume(1.0);
                                            }
                                        }}
                                        className={`p-2.5 transition-all rounded-full ${!isMuted ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
                                        title="音量控制"
                                    >
                                        {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                                    </button>
                                </div>
                                <button
                                    onClick={() => setIsSidebarOpen(true)}
                                    className="p-2.5 text-white/70 hover:text-white transition-all bg-white/10 hover:bg-white/20 rounded-full ml-1 border border-white/10"
                                    title="选择目录"
                                >
                                    <Menu size={20} />
                                </button>
                            </div>
                        ) : (
                            <div className="w-10" /> // Spacer for balance
                        )}
                    </div>
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
                        onClick={unlockAudio}
                    >
                        <div className="min-h-full">
                            {items.map((item, index) => {
                                const isSmartContain = (isScreenLandscape || (item.Width || 0) > (item.Height || 0) || (item.PrimaryImageAspectRatio || 0) > 0.65 || (videoDimensions[item.Id]?.width / videoDimensions[item.Id]?.height) > 0.65);
                                const isContain = displayMode === 'contain' || (displayMode === 'smart' && isSmartContain);
                                
                                return (
                                <div
                                    key={item.Id}
                                    ref={(el) => { itemRefs.current[index] = el; }}
                                    className={`
                                        w-full snap-start relative flex items-center justify-center
                                        overflow-hidden bg-black h-[100dvh]
                                        ${isContain && isMobile && !isFullscreen ? 'pb-[120px]' : ''}
                                    `}
                                    style={{ scrollSnapStop: 'always' }}
                                    data-index={index}
                                    onTouchStart={(e) => {
                                        unlockAudio();
                                        handleGlobalTouchStart(index, e);
                                    }}
                                    onTouchMove={(e) => handleGlobalTouchMove(item.Id, index, e)}
                                    onTouchEnd={(e) => handleGlobalTouchEnd(item.Id, index, e)}
                                    onClick={() => {
                                        if (skipClickRef.current) return;
                                        // For desktop mouse clicks
                                        const video = videoRefs.current[index];
                                        if (video) {
                                            if (video.paused) {
                                                video.play().catch(() => { });
                                                setIsUserPaused(false);
                                            } else {
                                                video.pause();
                                                setIsUserPaused(true);
                                            }
                                        } else if (item.Type === 'Gallery') {
                                            // Cycle through photos on click for desktop
                                            const current = galleryIndexes[item.Id] || 0;
                                            const next = (current + 1) % (item.Children?.length || 1);
                                            setGalleryIndexes(prev => ({ ...prev, [item.Id]: next }));
                                            setIsGalleryManual(prev => ({ ...prev, [item.Id]: true }));
                                        }
                                    }}
                                >
                                    {Math.abs(activeVideoIndex - index) <= 1 ? (
                                        <>
                                            {/* Blurred Background */}
                                            {getPosterUrl(item) && (
                                                <div className="absolute inset-0 w-full h-full overflow-hidden">
                                                    <img
                                                        src={getPosterUrl(item)}
                                                        className="w-full h-full object-cover blur-2xl opacity-40 scale-110"
                                                        alt=""
                                                    />
                                                    <div className="absolute inset-0 bg-black/30" />
                                                </div>
                                            )}

                                            {item.MediaType === 'Video' ? (
                                                <>
                                                    <video
                                                        ref={(el) => {
                                                            videoRefs.current[index] = el;
                                                            if (el && activeVideoIndex === index && el.paused && !isUserPaused) {
                                                                safePlay(index);
                                                            }
                                                        }}
                                                        src={getVideoUrl(item)}
                                                        className={`relative z-10 w-full h-full pointer-events-auto bg-transparent ${displayMode === 'cover' ? 'object-cover' :
                                                            displayMode === 'contain' ? 'object-contain' :
                                                                (isScreenLandscape || (item.Width || 0) > (item.Height || 0) || (item.PrimaryImageAspectRatio || 0) > 0.65 || (videoDimensions[item.Id]?.width / videoDimensions[item.Id]?.height) > 0.65) ? 'object-contain' : 'object-cover'
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
                                                                    (isScreenLandscape || (item.Width || 0) > (item.Height || 0) || (item.PrimaryImageAspectRatio || 0) > 0.65 || (videoDimensions[item.Id]?.width / videoDimensions[item.Id]?.height) > 0.65) ? 'object-contain' : 'object-cover'
                                                                }`}
                                                            alt=""
                                                        />
                                                    )}
                                                </>
                                            ) : item.Type === 'Gallery' ? (
                                                <div className="relative z-10 w-full h-full flex items-center justify-center">
                                                    {/* Progress indicators at top */}
                                                    <div className="absolute top-[calc(env(safe-area-inset-top)+84px)] right-6 bg-black/30 backdrop-blur-md px-3 py-1 rounded-full z-50 border border-white/10">
                                                        <span className="text-white text-xs font-bold tracking-tighter tabular-nums">
                                                            {(galleryIndexes[item.Id] || 0) + 1} / {item.Children?.length}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className="w-full h-full flex items-center justify-center touch-pan-y"
                                                        onTouchStart={(e) => {
                                                            const startX = e.touches[0].clientX;
                                                            (e.currentTarget as any)._startX = startX;
                                                        }}
                                                        onTouchEnd={(e) => {
                                                            const startX = (e.currentTarget as any)._startX;
                                                            if (startX === undefined) return;
                                                            const endX = e.changedTouches[0].clientX;
                                                            const diff = endX - startX;
                                                            if (Math.abs(diff) > 40) {
                                                                const count = item.Children!.length;
                                                                const current = galleryIndexes[item.Id] || 0;
                                                                if (diff < 0 && current < count - 1) {
                                                                    setGalleryIndexes(prev => ({ ...prev, [item.Id]: current + 1 }));
                                                                    setIsGalleryManual(prev => ({ ...prev, [item.Id]: true }));
                                                                    if (window.navigator.vibrate) window.navigator.vibrate(10);
                                                                } else if (diff > 0 && current > 0) {
                                                                    setGalleryIndexes(prev => ({ ...prev, [item.Id]: current - 1 }));
                                                                    setIsGalleryManual(prev => ({ ...prev, [item.Id]: true }));
                                                                    if (window.navigator.vibrate) window.navigator.vibrate(10);
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <AnimatePresence mode="popLayout">
                                                            <motion.img
                                                                key={galleryIndexes[item.Id] || 0}
                                                                src={getPosterUrl(item.Children![galleryIndexes[item.Id] || 0], true)}
                                                                initial={{ opacity: 0, x: 20 }}
                                                                animate={{ opacity: 1, x: 0 }}
                                                                exit={{ opacity: 0, x: -20 }}
                                                                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                                                className={`w-full h-full pointer-events-none ${displayMode === 'cover' ? 'object-cover' :
                                                                    displayMode === 'contain' ? 'object-contain' :
                                                                        (isScreenLandscape || (item.Width || 0) > (item.Height || 0) || (item.PrimaryImageAspectRatio || 0) > 1) ? 'object-contain' : 'object-cover'
                                                                    }`}
                                                            />
                                                        </AnimatePresence>
                                                    </div>
                                                </div>
                                            ) : (
                                                <img
                                                    src={getPosterUrl(item, true)}
                                                    className={`relative z-10 w-full h-full pointer-events-auto ${displayMode === 'cover' ? 'object-cover' :
                                                        displayMode === 'contain' ? 'object-contain' :
                                                            (isScreenLandscape || (item.Width || 0) > (item.Height || 0) || (item.PrimaryImageAspectRatio || 0) > 1) ? 'object-contain' : 'object-cover'
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

                                        {/* iOS Autoplay / Muted hint */}
                                        {(activeVideoIndex === index && !isUserPaused && !isMuted && videoRefs.current[index]?.muted) && (
                                            <motion.button
                                                initial={{ y: 20, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setIsMuted(false);
                                                    if (videoRefs.current[index]) {
                                                        const v = videoRefs.current[index]!;
                                                        v.muted = false;
                                                        v.play().catch(() => { });
                                                    }
                                                }}
                                                onTouchStart={(e) => e.stopPropagation()}
                                                onTouchEnd={(e) => e.stopPropagation()}
                                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto bg-primary text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 shadow-2xl active:scale-95 transition-transform"
                                            >
                                                <Volume2 size={24} />
                                                点击开启声音
                                            </motion.button>
                                        )}

                                        {/* Right Action Buttons */}
                                        <div className="absolute right-3 md:right-4 bottom-[180px] md:bottom-12 flex flex-col gap-6 items-center pointer-events-auto z-40">
                                            {/* Avatar */}
                                            {item.Path && videoMetadata[item.Path]?.avatar_url && (
                                                <div className="flex flex-col items-center mb-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (!item.Path) return;
                                                            const m = videoMetadata[item.Path];
                                                            if (m.platform === 'douyin' && m.sec_user_id) {
                                                                window.open(`https://www.douyin.com/user/${m.sec_user_id}`, '_blank');
                                                            } else if (m.platform === 'tiktok' && m.nickname) {
                                                                window.open(`https://www.tiktok.com/@${m.nickname}`, '_blank');
                                                            }
                                                        }}
                                                        className="w-12 h-12 rounded-full border-2 border-white overflow-hidden shadow-xl hover:scale-110 transition-transform active:scale-90"
                                                    >
                                                        <img
                                                            src={videoMetadata[item.Path!].avatar_url}
                                                            alt="avatar"
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Share Button */}
                                            <div className="flex flex-col items-center">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleShare(item);
                                                    }}
                                                    onTouchStart={(e) => e.stopPropagation()}
                                                    onTouchMove={(e) => e.stopPropagation()}
                                                    onTouchEnd={(e) => e.stopPropagation()}
                                                    disabled={sharingId === item.Id}
                                                    className="flex items-center justify-center w-10 h-10 text-white transition-all active:scale-95 drop-shadow-xl"
                                                >
                                                    {sharingId === item.Id ? (
                                                        <Loader2 size={24} className="animate-spin opacity-80" />
                                                    ) : (
                                                        <svg width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                            <path d="M26 6L42 22L26 38" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                                                            <path d="M6 42C6 42 10 30 20 25C30 20 42 22 42 22" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                    )}
                                                </button>
                                                <span className="text-white text-[10px] font-black mt-1 drop-shadow-md opacity-80">分享</span>
                                            </div>

                                            {/* Delete Button */}
                                            <div className="flex flex-col items-center">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirmItem(item);
                                                    }}
                                                    onTouchStart={(e) => e.stopPropagation()}
                                                    onTouchMove={(e) => e.stopPropagation()}
                                                    onTouchEnd={(e) => e.stopPropagation()}
                                                    className="flex items-center justify-center w-10 h-10 text-white transition-all active:scale-95 drop-shadow-xl"
                                                >
                                                    <svg width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M9 10V44H39V10H9Z" fill="none" stroke="white" strokeWidth="4" strokeLinejoin="round" />
                                                        <path d="M20 20V34" stroke="white" strokeWidth="4" strokeLinecap="round" />
                                                        <path d="M28 20V34" stroke="white" strokeWidth="4" strokeLinecap="round" />
                                                        <path d="M4 10H44" stroke="white" strokeWidth="4" strokeLinecap="round" />
                                                        <path d="M16 10L19.289 4H28.7771L32 10H16Z" fill="none" stroke="white" strokeWidth="4" strokeLinejoin="round" />
                                                    </svg>
                                                </button>
                                                <span className="text-white text-[10px] font-black mt-1 drop-shadow-md opacity-80">删除</span>
                                            </div>
                                        </div>
                                    </div>


                                    {/* Video Info Overlay */}
                                    <div className="absolute bottom-0 left-0 right-0 p-6 pb-[100px] md:pb-6 pointer-events-none flex flex-col justify-end z-30">
                                        <div className="flex items-center gap-2 mb-2 drop-shadow-md overflow-x-auto no-scrollbar w-full scroll-smooth pointer-events-auto">
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
                                                className="text-white font-bold text-lg hover:text-primary transition-colors pointer-events-auto whitespace-nowrap flex-shrink-0 px-0.5"
                                            >
                                                @{item.Path && videoMetadata[item.Path]?.nickname ? videoMetadata[item.Path].nickname : (getFolderName(item.Path) || 'Emby Video')}
                                            </button>
                                            {item.Path && videoMetadata[item.Path]?.platform && (
                                                <span className="flex-shrink-0 px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded border border-primary/20 uppercase">
                                                    {videoMetadata[item.Path].platform}
                                                </span>
                                            )}
                                            {item.Path && videoMetadata[item.Path]?.create_time > 0 && (
                                                <span className="flex-shrink-0 text-white/40 text-[10px] font-medium ml-1 whitespace-nowrap">
                                                    · {formatDate(videoMetadata[item.Path].create_time)}
                                                </span>
                                            )}
                                        </div>
                                        <div 
                                            className="flex flex-col items-start gap-1 pointer-events-auto"
                                            onClick={(e) => {
                                                if (!isTruncated[item.Id]) return;
                                                e.stopPropagation();
                                                setExpandedDescs(prev => ({ ...prev, [item.Id]: !prev[item.Id] }));
                                            }}
                                            onTouchStart={(e) => {
                                                if (isTruncated[item.Id]) e.stopPropagation();
                                            }}
                                        >
                                            <p
                                                ref={(el) => { descRefs.current[item.Id] = el; }}
                                                className={`text-white/80 text-sm drop-shadow-md transition-all ${
                                                    isTruncated[item.Id] ? 'cursor-pointer' : ''
                                                } ${
                                                    expandedDescs[item.Id] 
                                                        ? 'whitespace-pre-wrap max-h-[40vh] overflow-y-auto no-scrollbar py-2' 
                                                        : 'line-clamp-3'
                                                }`}
                                            >
                                                {(item.Path && videoMetadata[item.Path]?.desc) || item.Overview || item.Name}
                                            </p>
                                            {isTruncated[item.Id] && (
                                                <button
                                                    className="text-white/40 text-[11px] font-bold hover:text-white transition-colors py-2 px-1 -ml-1 flex items-center gap-1 active:opacity-50"
                                                >
                                                    {expandedDescs[item.Id] ? '[ 收起文本 ]' : '...... [ 展开全文 ]'}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Progress Bar - Bottom (Douyin Style) */}
                                    {activeVideoIndex === index && item.MediaType === 'Video' && (
                                        <>
                                            <div
                                                className="absolute left-0 right-0 cursor-pointer pointer-events-auto z-[50] flex items-end group/progress"
                                                style={{ bottom: '0px', height: '40px' }}
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
                            );
                        })}
                        </div>

                        {items.length === 0 && !loading && !error && (
                            <div className="flex h-full items-center justify-center text-white/50">
                                暂无视频内容
                            </div>
                        )}
                    </div>
                )}

            </div>

            {/* Dedicated Bottom Navigation Bar - Mobile ONLY - Floating Capsule */}
            {isMobile && !isFullscreen && (
                <div
                    style={{ marginBottom: 'max(var(--sab), 16px)' }}
                    className="fixed bottom-0 left-6 right-6 h-16 bg-white/5 backdrop-blur-xl border border-white/20 ring-1 ring-inset ring-white/10 z-[60] flex items-center justify-around px-2 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.2)] pointer-events-auto"
                >
                    <button
                        onClick={() => {
                            const newTab = tab === 'latest' ? 'random' : 'latest';
                            setTab(newTab);
                            onNotify(`排序切换至: ${newTab === 'latest' ? '最新发布' : '随机推荐'}`, 'success');
                        }}
                        className={`flex-1 flex flex-col items-center justify-center transition-all active:scale-95 ${tab === 'latest' ? 'text-white' : 'text-primary'}`}
                    >
                        <div className="relative">
                            <Home size={22} className={tab === 'latest' ? '' : 'fill-primary'} />
                            {tab === 'latest' && <div className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />}
                        </div>
                        <span className="text-[10px] font-black mt-0.5 tracking-tighter opacity-80">{tab === 'latest' ? '最新' : '随机'}</span>
                    </button>

                    <button
                        onClick={() => {
                            const newMode = playbackMode === 'loop' ? 'next' : 'loop';
                            setPlaybackMode(newMode);
                            onNotify(`播放模式: ${newMode === 'loop' ? '单片循环' : '自动连播'}`, 'success');
                        }}
                        className={`flex-1 flex flex-col items-center justify-center transition-all active:scale-95 ${playbackMode === 'next' ? 'text-primary' : 'text-white/40'}`}
                    >
                        {playbackMode === 'next' ? <ArrowRightCircle size={22} className="fill-primary/20" /> : <Repeat size={22} />}
                        <span className="text-[10px] font-black mt-0.5 tracking-tighter opacity-80">
                            {playbackMode === 'next' ? '连播' : '循环'}
                        </span>
                    </button>

                    <div className="flex-1 flex items-center justify-center -translate-y-1">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="w-12 h-10 bg-white rounded-2xl flex items-center justify-center transition-all active:scale-90 shadow-xl shadow-white/10"
                        >
                            <Plus size={26} className="text-black font-black" />
                        </button>
                    </div>

                    <button
                        onClick={() => {
                            const modes: ('smart' | 'cover' | 'contain')[] = ['smart', 'cover', 'contain'];
                            const nextIndex = (modes.indexOf(displayMode) + 1) % modes.length;
                            setDisplayMode(modes[nextIndex]);
                            onNotify(`适配: ${modes[nextIndex]}`, 'success');
                        }}
                        className="flex-1 flex flex-col items-center justify-center transition-all active:scale-95 text-white/40"
                    >
                        <div className="relative">
                            {displayMode === 'smart' ? <Monitor size={22} /> : <Maximize2 size={22} className="text-primary" />}
                        </div>
                        <span className="text-[10px] font-black mt-0.5 tracking-tighter opacity-80">画面</span>
                    </button>

                    <div className="flex-1 relative flex flex-col items-center justify-center">
                        <AnimatePresence>
                            {(showVolumeSlider && !isIOS) && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    className="absolute bottom-full mb-4 bg-black/80 backdrop-blur-xl rounded-2xl p-4 flex flex-col items-center gap-3 border border-white/10 shadow-2xl z-[100]"
                                >
                                    <div className="flex justify-between w-full px-1">
                                        <span className="text-[10px] font-bold text-white/50">音量</span>
                                        <span className="text-[10px] font-bold text-primary">{Math.round(volume * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={isMuted ? 0 : volume}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            setVolume(v);
                                            if (v > 0) setIsMuted(false);
                                            else setIsMuted(true);
                                        }}
                                        className="w-28 volume-slider appearance-none cursor-pointer"
                                        style={{ backgroundSize: `${(isMuted ? 0 : volume) * 100}% 100%` }}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                        <button
                            onClick={() => {
                                const nextMuted = !isMuted;
                                setIsMuted(nextMuted);
                                if (!nextMuted && volume === 0) setVolume(1.0);
                                if (!isIOS) setShowVolumeSlider(!showVolumeSlider);
                                if (window.navigator.vibrate) window.navigator.vibrate(10);
                            }}
                            className={`flex flex-col items-center justify-center transition-all active:scale-95 ${!isMuted ? 'text-white' : 'text-red-500'}`}
                        >
                            {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
                            <span className="text-[10px] font-black mt-0.5 tracking-tighter opacity-80">{isMuted ? '静音' : '音量'}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Global Styles for hiding scrollbar */}
            <style>{`
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .no-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
                
                input[type='range'].volume-slider {
                    -webkit-appearance: none;
                    height: 6px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 5px;
                    background-image: linear-gradient(#fe2c55, #fe2c55);
                    background-repeat: no-repeat;
                }

                input[type='range'].volume-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    height: 14px;
                    width: 14px;
                    border-radius: 50%;
                    background: #fff;
                    cursor: pointer;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
                }

                input[type='range'].volume-slider::-webkit-slider-runnable-track {
                    -webkit-appearance: none;
                    box-shadow: none;
                    border: none;
                    background: transparent;
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
                                    <span className="text-white/80 font-medium"> {deleteConfirmItem!.Name} </span>
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
                                    onClick={() => handleDelete(deleteConfirmItem!)}
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
