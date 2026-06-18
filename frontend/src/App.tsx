import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, RefreshCw, LogOut, Settings as SettingsIcon, Loader2, Activity, Terminal, Play, MoreHorizontal, GripVertical, Users, Link as LinkIcon, Sparkles, Download, History, FileText } from 'lucide-react';
import type { User, ToastType, Task } from './types';
import * as api from './api';
import { UserCard } from './components/UserCard';
import { Toast } from './components/Toast';
import { Modal } from './components/Modal';
import { SingleDownload } from './components/SingleDownload';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Tasks } from './pages/Tasks';
import { Logs } from './pages/Logs';
import { EmbyPlayer } from './pages/EmbyPlayer';
import ReloadPrompt from './components/ReloadPrompt';

const LATEST_VERSION_URL = 'https://raw.githubusercontent.com/plsy1/DySyncEngine/refs/heads/main/VERSION';

type VersionState = {
  latest: string | null;
  hasUpdate: boolean;
  isChecking: boolean;
  error: boolean;
};

type PlatformTab = 'all' | 'douyin' | 'tiktok' | 'kuaishou';

const normalizeVersion = (version: string) => version.trim().replace(/^v/i, '');

const getUserPlatform = (user: User): Exclude<PlatformTab, 'all'> => {
  if (user.platform === 'tiktok') return 'tiktok';
  if (user.platform === 'kuaishou') return 'kuaishou';
  return 'douyin';
};

const getPlatformLabel = (platform: string) => {
  if (platform === 'tiktok') return 'TikTok';
  if (platform === 'kuaishou') return '快手';
  return '抖音';
};

const compareVersions = (current: string, latest: string) => {
  const currentParts = normalizeVersion(current).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const latestParts = normalizeVersion(latest).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(currentParts.length, latestParts.length);

  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;

    if (latestPart > currentPart) return 1;
    if (latestPart < currentPart) return -1;
  }

  return 0;
};

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const currentTheme = (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system';
    
    const applyTheme = (t: 'light' | 'dark' | 'system') => {
      let actualTheme = t;
      if (t === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        actualTheme = isDark ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', actualTheme);
    };
    
    applyTheme(currentTheme);
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      const activeSetting = (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system';
      if (activeSetting === 'system') {
        applyTheme('system');
      }
    };
    
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, []);

  const [view, setView] = useState<'dashboard' | 'subscriptions' | 'settings' | 'tasks' | 'logs' | 'player'>('dashboard');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserUrl, setNewUserUrl] = useState('');
  const [maxFetch, setMaxFetch] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [platformTab, setPlatformTab] = useState<PlatformTab>(() => {
    const savedTab = localStorage.getItem('dashboard_platform_tab');
    return savedTab === 'douyin' || savedTab === 'tiktok' || savedTab === 'kuaishou' ? savedTab : 'all';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [isSortingUsers, setIsSortingUsers] = useState(false);
  const [sortDraftUsers, setSortDraftUsers] = useState<User[]>([]);
  const [draggingUserUid, setDraggingUserUid] = useState<string | null>(null);
  const [savingUserOrder, setSavingUserOrder] = useState(false);
  const [activeActionTab, setActiveActionTab] = useState<'subscribe' | 'single'>('single');
  const [totalDownloaded, setTotalDownloaded] = useState<number>(0);
  const [recentDownloads, setRecentDownloads] = useState<any[]>([]);
  const [versionState, setVersionState] = useState<VersionState>({
    latest: null,
    hasUpdate: false,
    isChecking: true,
    error: false,
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [search, platformTab]);

  useEffect(() => {
    localStorage.setItem('dashboard_platform_tab', platformTab);
  }, [platformTab]);

  useEffect(() => {
    const controller = new AbortController();

    const checkLatestVersion = async () => {
      try {
        const response = await fetch(`${LATEST_VERSION_URL}?t=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Version check failed: ${response.status}`);
        }

        const latest = (await response.text()).trim();

        if (!latest) {
          throw new Error('Version check returned empty content');
        }

        setVersionState({
          latest,
          hasUpdate: compareVersions(__APP_VERSION__, latest) > 0,
          isChecking: false,
          error: false,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        console.error('Failed to check latest version:', error);
        setVersionState({
          latest: null,
          hasUpdate: false,
          isChecking: false,
          error: true,
        });
      }
    };

    checkLatestVersion();

    return () => controller.abort();
  }, []);

  // Notification state
  const [toast, setToast] = useState<{ message: string; type: ToastType; isVisible: boolean } | null>(null);

  // Modal state
  const [modal, setModal] = useState<{ isOpen: boolean; user: User | null }>({
    isOpen: false,
    user: null
  });

  const showToast = (message: string, type: ToastType = 'success') => {
    setToast({ message, type, isVisible: true });
    setTimeout(() => setToast(prev => prev ? { ...prev, isVisible: false } : null), 3000);
  };

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const [usersData, statsData] = await Promise.all([
        api.getUsers(),
        api.getStats().catch(() => ({ total_downloaded: 0, recent: [] }))
      ]);
      setUsers(usersData);
      setTotalDownloaded(statsData.total_downloaded);
      setRecentDownloads(statsData.recent || []);
    } catch (err) {
      showToast('加载用户列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const pollTasks = useCallback(async () => {
    try {
      const tasks = await api.getActiveTasks();
      setActiveTasks(tasks);

      // 如果有任务完成，刷新列表
      if (activeTasks.length > 0 && tasks.length < activeTasks.length) {
        loadUsers();
      }
    } catch (err) {
      console.error('Polling failed', err);
    }
  }, [activeTasks, loadUsers]);

  const checkAuth = useCallback(async () => {
    try {
      const status = await api.checkLoginStatus();
      setIsLoggedIn(status);
      if (status) {
        loadUsers();
      }
    } catch (error) {
      console.error("Failed to check login status:", error);
      setIsLoggedIn(false);
    }
  }, [loadUsers]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isLoggedIn) {
      const timer = setInterval(pollTasks, 2000);
      return () => clearInterval(timer);
    }
  }, [isLoggedIn, pollTasks]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserUrl) return;

    try {
      await api.downloadUserVideos(newUserUrl, maxFetch);
      showToast('已加入后台下载队列');
      setNewUserUrl('');
      setMaxFetch(0);
      // 立即拉取一次列表，以便看到新创建的“占位”卡片
      loadUsers();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      showToast(detail || '任务开启失败', 'error');
    }
  };

  const handleRefresh = async (secUserId: string, maxFetch: number = 0, forceFull: boolean = false) => {
    try {
      await api.refreshUserVideos(secUserId, maxFetch, forceFull);
      showToast(forceFull ? '补漏/全量同步已启动' : '增量同步已启动');
    } catch (err) {
      showToast('同步失败', 'error');
    }
  };

  const handleToggleAuto = async (uid: string, enabled: boolean) => {
    try {
      await api.toggleAutoUpdate(uid, enabled);
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, auto_update: enabled } : u));
      showToast(enabled ? '自动同步已开启' : '自动同步已关闭');
    } catch (err) {
      showToast('设置失败', 'error');
    }
  };

  const handleTgSync = async (uid: string) => {
    try {
      await api.tgSyncUser(uid);
      showToast('TG 手动同步已开始');
    } catch (err) {
      showToast('TG 同步启动失败', 'error');
    }
  };

  const handleMarkTgExported = async (uid: string) => {
    try {
      await api.tgMarkAllExported(uid);
      showToast('已标记该用户所有作品为已上传');
    } catch (err) {
      showToast('标记失败', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!modal.user) return;
    try {
      await api.deleteUser(modal.user.uid);
      setUsers(prev => prev.filter(u => u.uid !== modal.user?.uid));
      setSortDraftUsers(prev => prev.filter(u => u.uid !== modal.user?.uid));
      showToast('账号及其数据已彻底删除');
      setModal({ isOpen: false, user: null });
    } catch (err) {
      showToast('删除失败', 'error');
    }
  };

  const platformCounts = users.reduce<Record<PlatformTab, number>>((counts, user) => {
    counts.all += 1;
    counts[getUserPlatform(user)] += 1;
    return counts;
  }, { all: 0, douyin: 0, tiktok: 0, kuaishou: 0 });

  const platformTabs: Array<{ id: PlatformTab; label: string; count: number }> = [
    { id: 'all', label: '全部', count: platformCounts.all },
    { id: 'douyin', label: '抖音', count: platformCounts.douyin },
    { id: 'tiktok', label: 'TikTok', count: platformCounts.tiktok },
    { id: 'kuaishou', label: '快手', count: platformCounts.kuaishou },
  ];

  const platformUsers = platformTab === 'all'
    ? users
    : users.filter(user => getUserPlatform(user) === platformTab);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = platformUsers.filter(u =>
    !normalizedSearch ||
    u.nickname?.toLowerCase().includes(normalizedSearch) ||
    u.uid.toLowerCase().includes(normalizedSearch)
  );

  const startUserSorting = () => {
    setSortDraftUsers(filteredUsers);
    setIsSortingUsers(true);
  };

  const cancelUserSorting = () => {
    setSortDraftUsers([]);
    setDraggingUserUid(null);
    setIsSortingUsers(false);
  };

  const moveSortDraftUser = (dragUid: string, targetUid: string) => {
    if (dragUid === targetUid) return;
    setSortDraftUsers(prev => {
      const dragIndex = prev.findIndex(user => user.uid === dragUid);
      const targetIndex = prev.findIndex(user => user.uid === targetUid);
      if (dragIndex < 0 || targetIndex < 0) return prev;

      const next = [...prev];
      const [dragged] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, dragged);
      return next;
    });
  };

  const saveUserSorting = async () => {
    const filteredUidSet = new Set(sortDraftUsers.map(user => user.uid));
    const sortedQueue = [...sortDraftUsers];
    const orderedUsers = users.map(user => (
      filteredUidSet.has(user.uid) ? sortedQueue.shift() ?? user : user
    ));

    setSavingUserOrder(true);
    try {
      await api.reorderUsers(orderedUsers.map(user => user.uid));
      setUsers(orderedUsers);
      setCurrentPage(1);
      setIsSortingUsers(false);
      setDraggingUserUid(null);
      setSortDraftUsers([]);
      showToast('作者排序已保存');
    } catch (err) {
      showToast('保存排序失败', 'error');
    } finally {
      setSavingUserOrder(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (isSortingUsers) {
      cancelUserSorting();
    }
  };

  const handlePlatformTabChange = (tab: PlatformTab) => {
    setPlatformTab(tab);
    if (isSortingUsers) {
      cancelUserSorting();
    }
  };

  const handleLogout = async () => {
    try {
      api.logout();
      setIsLoggedIn(false);
      setUsers([]);
      setActiveTasks([]);
      showToast('已登出', 'success');
    } catch (error) {
      showToast('登出失败', 'error');
    }
  };

  if (isLoggedIn === null) {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center text-primary">
        <Loader2 className="animate-spin" size={40} />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Login onLoginSuccess={() => checkAuth()} />;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-primary/30 flex overflow-hidden">
      {/* Sidebar Navigation - Fixed on Left for Desktop */}
      <nav 
        style={{ paddingTop: 'var(--sat)' }}
        className="hidden md:flex fixed left-0 top-0 bottom-0 w-20 lg:w-64 bg-black/40 backdrop-blur-2xl border-r border-white/5 z-50 flex-col transition-all duration-500 ease-in-out group"
      >
        <div className="p-6 mb-8 flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 min-w-[40px] rounded-2xl bg-gradient-to-br from-primary to-primary/40 p-[1px]">
            <div className="w-full h-full bg-black rounded-2xl flex items-center justify-center overflow-hidden">
              <img src="/logo.svg" alt="DS" className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="hidden lg:block whitespace-nowrap">
            <h1 className="text-lg font-bold tracking-tight">DySync<span className="text-primary text-xl">.</span></h1>
            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest mt-[-4px]">Sync Engine</p>
          </div>
        </div>

        <div className="flex-1 px-3 space-y-2">
          <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<Search size={20} />} label="发现 & 下载" />
          <NavButton active={view === 'subscriptions'} onClick={() => setView('subscriptions')} icon={<Users size={20} />} label="订阅中" />
          <NavButton active={view === 'tasks'} onClick={() => setView('tasks')} icon={<Activity size={20} />} label="活跃任务" />
          <NavButton active={view === 'logs'} onClick={() => setView('logs')} icon={<Terminal size={20} />} label="审计日志" />
          <NavButton active={view === 'player'} onClick={() => setView('player')} icon={<Play size={20} />} label="Emby 播放" />
        </div>

        <div className="p-3 space-y-3 mb-6">
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={<SettingsIcon size={20} />} label="全局配置" />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-4 p-4 rounded-2xl text-white/40 hover:text-red-400 hover:bg-red-500/5 transition-all group/btn"
          >
            <LogOut size={20} />
            <span className="hidden lg:block text-sm font-bold">退出系统</span>
          </button>
          <VersionBadge versionState={versionState} />
        </div>
      </nav>

      {/* Main Content Area */}
      <main 
        style={{ paddingTop: 'var(--sat)' }}
        className={`flex-1 md:ml-20 lg:ml-64 min-h-screen md:h-screen overflow-y-auto custom-scrollbar flex flex-col ${
          view === 'dashboard' || view === 'subscriptions' ? 'md:overflow-hidden' : 'md:overflow-y-auto'
        }`}
      >
        {/* Mobile Top Header */}
        <div className="md:hidden w-full px-6 py-4 flex items-center justify-between border-b border-black/5 dark:border-white/5 bg-card/45 backdrop-blur-xl sticky top-0 z-45">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/40 p-[1px]">
              <div className="w-full h-full bg-black rounded-xl flex items-center justify-center overflow-hidden">
                <img src="/logo.svg" alt="DS" className="w-full h-full object-cover p-1.5" />
              </div>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">
                DySync<span className="text-primary font-black">.</span>
              </h1>
            </div>
          </div>
          <div className="text-[10px] font-black uppercase tracking-wider text-black/40 dark:text-white/30 bg-black/5 dark:bg-white/5 px-2.5 py-1 rounded-lg border border-black/5 dark:border-white/5">
            v{normalizeVersion(versionState.latest || __APP_VERSION__)}
          </div>
        </div>

        <div 
            className="max-w-[1920px] w-full mx-auto p-4 md:p-6 lg:p-10 pb-[calc(var(--sab)+5.5rem)] md:pb-6 lg:pb-10 space-y-6 md:space-y-10 flex-1 flex flex-col min-h-0"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex-1 flex flex-col min-h-0 h-full"
            >
              {view === 'settings' ? (
                <Settings onBack={() => setView('dashboard')} onNotify={showToast} />
              ) : view === 'player' ? (
                <EmbyPlayer onBack={() => setView('dashboard')} onNotify={showToast} />
              ) : view === 'tasks' ? (
                <Tasks onNotify={showToast} activeTasks={activeTasks} />
              ) : view === 'logs' ? (
                <Logs />
              ) : view === 'subscriptions' ? (
                <div className="space-y-6 lg:space-y-8 flex-1 flex flex-col min-h-0">
                  <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                      <h2 className="text-4xl font-black tracking-tight text-white mb-2">订阅中</h2>
                      <p className="text-white/30 text-sm font-medium">
                        当前显示 {platformUsers.length} / {users.length} 个账号，共有 {activeTasks.length} 个活跃任务
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative w-full lg:w-80">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                          <input
                            type="text"
                            value={search}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder="搜索当前平台..."
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-primary/50 transition-all font-medium text-sm"
                          />
                        </div>
                        <button
                          onClick={isSortingUsers ? cancelUserSorting : startUserSorting}
                          disabled={filteredUsers.length <= 1 || savingUserOrder}
                          className={`px-5 py-3 rounded-2xl border transition-all text-xs font-black whitespace-nowrap ${
                            isSortingUsers
                              ? 'bg-white/10 border-white/15 text-white'
                              : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          {isSortingUsers ? '取消排序' : '排序作者'}
                      </button>
                    </div>
                  </header>

                  <div className="flex flex-wrap items-center gap-2">
                    {platformTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => handlePlatformTabChange(tab.id)}
                        className={`h-10 px-4 rounded-xl border text-xs font-black transition-all flex items-center gap-2 ${
                          platformTab === tab.id
                            ? 'bg-primary text-black border-primary shadow-lg shadow-primary/15'
                            : 'bg-white/5 text-white/50 border-white/10 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`min-w-6 px-1.5 py-0.5 rounded-full text-[10px] ${
                          platformTab === tab.id
                            ? 'bg-black/15 text-black'
                            : 'bg-white/10 text-white/40'
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* User Grid - RECLAIMING THE SIDES */}
                  <section className="flex-1 flex flex-col min-h-0">
                    {loading && users.length === 0 ? (
                      <div className="flex items-center justify-center py-40 shrink-0">
                        <RefreshCw size={40} className="animate-spin text-primary" />
                      </div>
                    ) : filteredUsers.length > 0 ? (
                      <div className="flex-1 flex flex-col min-h-0">
                        {(() => {
                          const ITEMS_PER_PAGE = 12; // Back to standard 12 items for plenty of cards
                          const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
                          const activePage = currentPage > totalPages ? Math.max(1, totalPages) : currentPage;
                          const paginatedUsers = filteredUsers.slice((activePage - 1) * ITEMS_PER_PAGE, activePage * ITEMS_PER_PAGE);

                          return (
                            <>
                              {isSortingUsers && (
                                <div className="mb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 shrink-0">
                                  <div>
                                    <p className="text-sm font-black text-white">排序模式</p>
                                    <p className="text-xs text-white/40 mt-1">当前显示本平台全部匹配作者，拖动卡片调整顺序，保存后分页按新顺序展示。</p>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={cancelUserSorting}
                                      disabled={savingUserOrder}
                                      className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white transition-all text-xs font-black disabled:opacity-40"
                                    >
                                      取消
                                    </button>
                                    <button
                                      onClick={saveUserSorting}
                                      disabled={savingUserOrder}
                                      className="px-5 py-2.5 rounded-xl bg-primary text-black transition-all text-xs font-black disabled:opacity-40"
                                    >
                                      {savingUserOrder ? '保存中...' : '保存排序'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Grid container with internal scroll on desktop */}
                              <div className="flex-1 lg:overflow-y-auto min-h-0 custom-scrollbar lg:pr-2 lg:py-1 mb-4 no-scrollbar">
                                {isSortingUsers ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                                    {sortDraftUsers.map(user => (
                                      <SortUserRow
                                        key={user.uid}
                                        user={user}
                                        index={sortDraftUsers.findIndex(item => item.uid === user.uid)}
                                        isDragging={draggingUserUid === user.uid}
                                        onDragStart={() => setDraggingUserUid(user.uid)}
                                        onDragEnd={() => setDraggingUserUid(null)}
                                        onDragOver={() => {
                                          if (draggingUserUid) moveSortDraftUser(draggingUserUid, user.uid);
                                        }}
                                      />
                                    ))}
                                  </div>
                                ) : (
                                  <motion.div
                                    layout
                                    className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6 gap-4"
                                  >
                                    <AnimatePresence mode="popLayout">
                                      {paginatedUsers.map(user => (
                                        <UserCard
                                          key={user.uid}
                                          user={user}
                                          task={activeTasks.find(t => t.target_id === user.uid || t.target_id === user.sec_user_id)}
                                          onRefresh={handleRefresh}
                                          onToggleAutoUpdate={handleToggleAuto}
                                          onPreferenceChange={async (uid, v, n, tgS, tgC) => {
                                            try {
                                              await api.updateUserPreference(uid, v, n, tgS, tgC);
                                              setUsers(prev => prev.map(u => u.uid === uid ? {
                                                ...u,
                                                download_video_override: v,
                                                download_note_override: n,
                                                tg_sync_enabled: tgS,
                                                tg_target_chat: tgC
                                              } : u));
                                              showToast('个人偏好设置已更新');
                                            } catch (err) {
                                              showToast('更新失败', 'error');
                                            }
                                          }}
                                          onDelete={(u) => setModal({ isOpen: true, user: u })}
                                          onTgSync={handleTgSync}
                                          onMarkTgExported={handleMarkTgExported}
                                        />
                                      ))}
                                    </AnimatePresence>
                                  </motion.div>
                                )}
                              </div>

                              {/* Modern Pagination Controls */}
                              {totalPages > 1 && !isSortingUsers && (
                                <div className="flex items-center justify-center gap-2 mt-auto pb-24 md:pb-0 shrink-0">
                                  <button
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={activePage === 1}
                                    className="px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:hover:bg-white/5 border border-white/10 rounded-2xl disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs font-black text-white/60 hover:text-white"
                                  >
                                    上一页
                                  </button>
                                  <div className="flex items-center gap-1.5 px-2">
                                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                                      if (
                                        page === 1 ||
                                        page === totalPages ||
                                        Math.abs(page - activePage) <= 1
                                      ) {
                                        return (
                                          <button
                                            key={page}
                                            onClick={() => setCurrentPage(page)}
                                            className={`w-9 h-9 flex items-center justify-center font-black text-xs rounded-xl transition-all border ${
                                              page === activePage
                                                ? 'bg-primary text-black border-primary shadow-lg shadow-primary/20'
                                                : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white'
                                            }`}
                                          >
                                            {page}
                                          </button>
                                        );
                                      }
                                      if (
                                        (page === 2 && activePage > 3) ||
                                        (page === totalPages - 1 && activePage < totalPages - 2)
                                      ) {
                                        return (
                                          <span key={page} className="px-1 text-white/20 font-black text-xs select-none">
                                            ...
                                          </span>
                                        );
                                      }
                                      return null;
                                    })}
                                  </div>
                                  <button
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={activePage === totalPages}
                                    className="px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:hover:bg-white/5 border border-white/10 rounded-2xl disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs font-black text-white/60 hover:text-white"
                                  >
                                    下一页
                                  </button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="text-center py-40 border-2 border-dashed border-white/5 rounded-[40px] bg-white/[0.01]">
                        <p className="text-white/20 font-bold text-xl mb-2">
                          {search || platformTab !== 'all' ? '空空如也' : '尚未开始同步'}
                        </p>
                        <p className="text-white/10 text-sm">
                          {search || platformTab !== 'all' ? '尝试换个平台或关键词搜索' : '请到发现下载页添加作者'}
                        </p>
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <div className="space-y-8 flex flex-col h-full">
                  <header className="shrink-0">
                    <h2 className="text-4xl font-black tracking-tight text-white mb-2">发现 & 下载</h2>
                    <p className="text-white/30 text-sm font-medium">解析单条作品，或粘贴作者主页加入订阅同步。</p>
                  </header>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                    {/* Left Column (2/3 width): Action Panel & Recent Sync History */}
                    <div className="lg:col-span-2 flex flex-col gap-6 lg:h-full lg:min-h-0">
                      {/* Card 1: Consolidated Action Panel */}
                      <div className="glass-card flex flex-col lg:h-[380px] shrink-0">
                        {/* Tabs Header */}
                        <div className="flex border-b border-white/10 mb-6 gap-2 shrink-0">
                          <button
                            onClick={() => setActiveActionTab('single')}
                            className={`flex items-center gap-2 pb-3 px-4 text-sm font-bold transition-all relative ${
                              activeActionTab === 'single'
                                ? 'text-primary'
                                : 'text-white/40 hover:text-white/80'
                            }`}
                          >
                            <Sparkles size={16} />
                            单视频下载 / 解析
                            {activeActionTab === 'single' && (
                              <motion.div
                                layoutId="activeActionTabUnderline"
                                className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                              />
                            )}
                          </button>
                          <button
                            onClick={() => setActiveActionTab('subscribe')}
                            className={`flex items-center gap-2 pb-3 px-4 text-sm font-bold transition-all relative ${
                              activeActionTab === 'subscribe'
                                ? 'text-primary'
                                : 'text-white/40 hover:text-white/80'
                            }`}
                          >
                            <Users size={16} />
                            添加订阅作者
                            {activeActionTab === 'subscribe' && (
                              <motion.div
                                layoutId="activeActionTabUnderline"
                                className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                              />
                            )}
                          </button>
                        </div>

                        {/* Tab Contents */}
                        <div className="flex-1 flex flex-col justify-start">
                          <div className={activeActionTab === 'single' ? '' : 'hidden'}>
                            <SingleDownload onNotify={showToast} inline={true} />
                          </div>
                          <div className={activeActionTab === 'subscribe' ? '' : 'hidden'}>
                            <form onSubmit={handleAddUser} className="space-y-6">
                              <div className="text-xs text-white/30 font-medium">
                                输入抖音、TikTok 或快手作者的主页链接，系统将自动监控并同步其最新发布的作品。
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px] gap-4 items-end">
                                <div>
                                  <label className="block text-xs font-black text-white/35 uppercase tracking-wider mb-2">
                                    作者主页链接
                                  </label>
                                  <div className="relative">
                                    <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                                    <input
                                      type="text"
                                      value={newUserUrl}
                                      onChange={(e) => setNewUserUrl(e.target.value)}
                                      placeholder="抖音/TikTok/快手 主页链接"
                                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-11 pr-24 outline-none focus:border-primary/50 transition-all text-sm font-medium placeholder:text-white/20"
                                    />
                                    {newUserUrl && (
                                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 select-none">
                                        {newUserUrl.includes('tiktok.com') ? (
                                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white border border-white/20 uppercase tracking-wide">TikTok</span>
                                        ) : newUserUrl.includes('kuaishou.com') || newUserUrl.includes('chenzhongtech.com') || newUserUrl.includes('kuaishouzt.com') || newUserUrl.includes('kwai.net') ? (
                                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/10 uppercase tracking-wide">快手</span>
                                        ) : (
                                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/10 uppercase tracking-wide">抖音</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-xs font-black text-white/35 uppercase tracking-wider mb-2">
                                    初次抓取数量
                                  </label>
                                  <input
                                    type="number"
                                    value={maxFetch || ''}
                                    onChange={(e) => setMaxFetch(parseInt(e.target.value) || 0)}
                                    placeholder="0 = 全量"
                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3.5 px-4 outline-none focus:border-primary/50 transition-all text-sm font-medium placeholder:text-white/20"
                                    title="最大抓取作品数量，0 表示抓取全部"
                                  />
                                </div>
                              </div>

                              <button
                                type="submit"
                                disabled={!newUserUrl}
                                className="w-full py-3.5 bg-primary text-black font-black rounded-xl hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-primary/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 animate-fade-in"
                              >
                                添加并启动订阅同步
                              </button>
                            </form>
                          </div>
                        </div>
                      </div>

                      {/* Card 2: Recent Sync History */}
                      <div className="glass-card lg:flex-1 flex flex-col lg:overflow-hidden lg:min-h-0">
                        <div className="flex items-center gap-3 mb-5 shrink-0">
                          <History className="text-primary" size={20} />
                          <h3 className="text-xl font-bold">最近同步</h3>
                        </div>
                        {recentDownloads.length > 0 ? (
                          <div className="divide-y divide-white/5 space-y-4 flex-1 lg:overflow-y-auto no-scrollbar">
                            {recentDownloads.map((item, idx) => (
                              <div key={`${item.aweme_id}-${idx}`} className="flex items-center gap-4 pt-4 first:pt-0">
                                {/* Type icon wrapper */}
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                  item.platform === 'tiktok' 
                                    ? 'bg-white/10 text-white' 
                                    : item.platform === 'kuaishou' 
                                      ? 'bg-orange-500/10 text-orange-400' 
                                      : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {item.aweme_type === 68 ? <FileText size={18} /> : <Play size={18} />}
                                </div>

                                {/* Content info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-white/80 truncate max-w-[120px]">{item.nickname || '未知作者'}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                      item.platform === 'tiktok' 
                                        ? 'bg-black text-white border border-white/20' 
                                        : item.platform === 'kuaishou' 
                                          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/10' 
                                          : 'bg-red-500/20 text-red-500 border border-red-500/10'
                                    }`}>
                                      {item.platform === 'tiktok' ? 'TikTok' : item.platform === 'kuaishou' ? '快手' : '抖音'}
                                    </span>
                                  </div>
                                  <p className="text-xs text-white/45 truncate" title={item.desc}>{item.desc || '（无描述文字）'}</p>
                                </div>

                                {/* Synced Date */}
                                <div className="text-[10px] text-white/25 shrink-0">
                                  {new Date(item.create_time * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-sm font-bold text-white/20 select-none flex-1 flex items-center justify-center">
                            暂无同步历史记录
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column (1/3 width): Resource & Stats & Platform Distribution */}
                    <div className="lg:col-span-1 flex flex-col gap-4 lg:h-full w-full lg:min-h-0">
                      {/* Card 3: Resource & Stats */}
                      <div className="glass-card flex-1 flex flex-col">
                        <div className="flex items-center gap-3 mb-4 shrink-0">
                          <Activity className="text-primary" size={20} />
                          <h3 className="text-xl font-bold">资源与统计</h3>
                        </div>
                        <div className="flex-1 flex flex-col justify-center gap-3">
                          {/* Large Featured Stat: Total Downloaded */}
                          <div className="group rounded-2xl border border-white/5 bg-gradient-to-r from-emerald-500/[0.05] to-teal-500/[0.05] hover:from-emerald-500/[0.08] hover:to-teal-500/[0.08] py-3 px-4 flex items-center justify-between transition-all duration-300 hover:border-emerald-500/20 hover:shadow-[0_0_30px_rgba(16,185,129,0.12)]">
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-wider text-white/30 group-hover:text-white/50 transition-colors duration-300">已同步作品总数</div>
                              <div className="mt-1.5 text-3xl font-black tabular-nums text-emerald-400 group-hover:scale-[1.02] origin-left transition-all duration-300">
                                {totalDownloaded.toLocaleString('zh-CN')} <span className="text-xs text-white/30 font-medium">个</span>
                              </div>
                            </div>
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:rotate-6 transition-all duration-300">
                              <Download size={20} />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <DashboardStat label="活跃任务" value={activeTasks.length} type="tasks" />
                            <DashboardStat label="自动更新" value={users.filter(u => u.auto_update).length} type="auto" />
                          </div>
                        </div>
                      </div>

                      {/* Card 4: Platform Distribution */}
                      <div className="glass-card flex-1 flex flex-col">
                        <div className="flex items-center gap-3 mb-4 shrink-0">
                          <Users className="text-primary" size={20} />
                          <h3 className="text-xl font-bold">作者分布</h3>
                        </div>
                        <div className="flex-1 flex flex-col justify-center">
                          <div className="grid grid-cols-2 gap-3">
                            <DashboardStat label="总订阅数" value={users.length} type="all" />
                            <DashboardStat label="抖音作者" value={platformCounts.douyin} type="douyin" />
                            <DashboardStat label="TikTok作者" value={platformCounts.tiktok} type="tiktok" />
                            <DashboardStat label="快手作者" value={platformCounts.kuaishou} type="kuaishou" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {toast && toast.isVisible && (
          <Toast
            message={toast.message}
            type={toast.type}
            isVisible={true}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <Modal
        isOpen={modal.isOpen}
        title="删除确认"
        description={modal.user ? `您即将从核心数据库中抹除作者 "${modal.user.nickname}"。其本地存储的文件将被保留，但追踪任务会立即终止。` : ''}
        confirmText="确认删除"
        isDanger={true}
        onClose={() => setModal({ isOpen: false, user: null })}
        onConfirm={confirmDelete}
      />
      <ReloadPrompt />

      {/* Bottom Navigation for Mobile/PWA - Minimalist Floating Island */}
      <nav 
        style={{ marginBottom: 'max(var(--sab), 16px)' }}
        className="md:hidden fixed bottom-0 left-6 right-6 h-16 bg-card/85 backdrop-blur-xl border border-black/10 dark:border-white/10 z-[60] flex items-center justify-around px-2 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
      >
        <MobileNavButton active={view === 'dashboard'} onClick={() => { setView('dashboard'); setShowMoreMenu(false); }} icon={<Search size={22} />} label="发现" />
        <MobileNavButton active={view === 'subscriptions'} onClick={() => { setView('subscriptions'); setShowMoreMenu(false); }} icon={<Users size={22} />} label="订阅" />
        <MobileNavButton active={view === 'tasks'} onClick={() => { setView('tasks'); setShowMoreMenu(false); }} icon={<Activity size={22} />} label="任务" />
        <MobileNavButton active={view === 'player'} onClick={() => { setView('player'); setShowMoreMenu(false); }} icon={<Play size={22} />} label="播放" />
        <MobileNavButton 
          active={showMoreMenu} 
          onClick={() => setShowMoreMenu(!showMoreMenu)} 
          icon={<MoreHorizontal size={22} />} 
          label="更多" 
        />
      </nav>

      {/* More Menu Bottom Sheet */}
      <AnimatePresence>
        {showMoreMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMoreMenu(false)}
              className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[70]" 
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="md:hidden fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur-2xl border-t border-black/10 dark:border-white/10 rounded-t-[40px] z-[80] p-7 pb-[calc(28px+var(--sab))] shadow-2xl"
            >
              <div className="w-12 h-1 bg-white/10 rounded-full mx-auto mb-8" />
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => { setView('settings'); setShowMoreMenu(false); }}
                  className="flex items-center gap-4 p-4 rounded-2xl hover:bg-white/5 transition-all text-left"
                >
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <SettingsIcon size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">全局配置</div>
                    <div className="text-xs text-white/40">调整下载、同步和媒体库设置</div>
                  </div>
                </button>

                <button
                  onClick={() => { setView('logs'); setShowMoreMenu(false); }}
                  className="flex items-center gap-4 p-4 rounded-2xl hover:bg-white/5 transition-all text-left"
                >
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <Terminal size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">审计日志</div>
                    <div className="text-xs text-white/40">查看后台实时运行记录</div>
                  </div>
                </button>


                <button
                  onClick={() => { handleLogout(); setShowMoreMenu(false); }}
                  className="flex items-center gap-4 p-4 rounded-2xl hover:bg-red-500/10 transition-all text-left group"
                >
                  <div className="p-3 rounded-xl bg-red-500/10 text-red-500">
                    <LogOut size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-red-500">退出系统</div>
                    <div className="text-xs text-red-500/40">清除登录凭证</div>
                  </div>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Sub-component for navigation buttons
function VersionBadge({ versionState }: { versionState: VersionState }) {
  const title = versionState.hasUpdate && versionState.latest
    ? `发现新版本 v${normalizeVersion(versionState.latest)}`
    : versionState.error
      ? '版本检查失败'
      : versionState.isChecking
        ? '正在检查版本'
        : '当前已是最新版本';

  return (
    <a
      href="https://github.com/plsy1/DySyncEngine"
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={`version-badge group/version ${versionState.hasUpdate ? 'version-badge-update' : ''}`}
    >
      <span className="version-dot" />
      <span className="hidden lg:flex min-w-0 flex-col leading-none">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/30 group-hover/version:text-white/60 transition-colors">
          Core Version
        </span>
        <span className={`mt-1 text-xs font-black transition-colors ${versionState.hasUpdate ? 'text-red-200' : 'text-white/45'}`}>
          v{normalizeVersion(__APP_VERSION__)}
        </span>
        {versionState.hasUpdate && versionState.latest && (
          <span className="mt-1 text-[10px] font-bold text-red-200/80 truncate">
            最新 v{normalizeVersion(versionState.latest)}
          </span>
        )}
      </span>
    </a>
  );
}

function DashboardStat({ label, value, type }: { label: string, value: number, type: string }) {
  const getHoverStyle = () => {
    switch (type) {
      case 'douyin':
        return 'hover:border-cyan-500/30 hover:bg-cyan-500/[0.02] hover:shadow-[0_0_20px_rgba(6,182,212,0.12)]';
      case 'tiktok':
        return 'hover:border-white/20 hover:bg-white/[0.02] hover:shadow-[0_0_20px_rgba(255,255,255,0.06)]';
      case 'kuaishou':
        return 'hover:border-orange-500/30 hover:bg-orange-500/[0.02] hover:shadow-[0_0_20px_rgba(249,115,22,0.12)]';
      case 'tasks':
        return 'hover:border-primary/30 hover:bg-primary/[0.02] hover:shadow-[0_0_20px_rgba(254,44,85,0.12)]';
      case 'auto':
        return 'hover:border-emerald-500/30 hover:bg-emerald-500/[0.02] hover:shadow-[0_0_20px_rgba(16,185,129,0.12)]';
      default:
        return 'hover:border-indigo-500/30 hover:bg-indigo-500/[0.02] hover:shadow-[0_0_20px_rgba(99,102,241,0.12)]';
    }
  };

  const getBadgeStyle = () => {
    switch (type) {
      case 'douyin':
        return 'text-cyan-400 bg-cyan-500/10';
      case 'tiktok':
        return 'text-white bg-white/10';
      case 'kuaishou':
        return 'text-orange-400 bg-orange-500/10';
      case 'tasks':
        return 'text-primary bg-primary/10';
      case 'auto':
        return 'text-emerald-400 bg-emerald-500/10';
      default:
        return 'text-indigo-400 bg-indigo-500/10';
    }
  };

  return (
    <div className={`group rounded-2xl border border-white/5 bg-white/[0.035] py-3.5 px-4 transition-all duration-300 ${getHoverStyle()}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-2xl font-black tabular-nums text-white group-hover:scale-105 transition-transform duration-300">{value}</div>
        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${getBadgeStyle()}`}>
          {type === 'all' ? 'ALL' : type === 'auto' ? 'AUTO' : type === 'tasks' ? 'RUN' : type.slice(0, 2).toUpperCase()}
        </span>
      </div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-white/30 group-hover:text-white/50 transition-colors duration-300">{label}</div>
    </div>
  );
}

function SortUserRow({
  user,
  index,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  user: User,
  index: number,
  isDragging: boolean,
  onDragStart: () => void,
  onDragEnd: () => void,
  onDragOver: () => void,
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-all cursor-grab active:cursor-grabbing ${
        isDragging
          ? 'border-primary/40 bg-primary/10 opacity-60 scale-[0.98]'
          : 'border-white/5 bg-white/[0.035] hover:bg-white/[0.06]'
      }`}
    >
      <div className="w-8 text-center text-xs font-black text-white/25 tabular-nums shrink-0">
        {index + 1}
      </div>
      <img
        src={user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${user.nickname}`}
        alt={user.nickname || ''}
        className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-white">{user.nickname || '未命名'}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/30">
          <span>{getPlatformLabel(getUserPlatform(user))}</span>
          <span>•</span>
          <span className="truncate">{user.uid}</span>
        </div>
      </div>
      <div className="text-white/25 shrink-0">
        <GripVertical size={18} />
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all relative group/btn ${active ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
    >
      <div className={`${active ? 'scale-110' : 'group-hover/btn:scale-110'} transition-transform duration-300`}>
        {icon}
      </div>
      <span className={`hidden lg:block text-sm font-black whitespace-nowrap transition-all duration-300 ${active ? 'translate-x-0 opacity-100' : 'translate-x-0 opacity-60 group-hover/lg:opacity-100'}`}>
        {label}
      </span>
      {active && <motion.div layoutId="nav-glow" className="absolute inset-0 bg-white/10 rounded-2xl -z-10" />}
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      style={{ color: active ? 'var(--primary)' : 'var(--text-dim)' }}
      className="flex-1 flex flex-col items-center justify-center transition-all duration-300 relative"
    >
      <div className={`transition-all duration-300 ${active ? 'scale-110' : 'active:scale-95'}`}>
        {icon}
      </div>
      <span className="text-[10px] font-black mt-1 tracking-tighter">
        {label}
      </span>
    </button>
  );
}

export default App;
