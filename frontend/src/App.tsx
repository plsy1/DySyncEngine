import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, RefreshCw, LogOut, Settings as SettingsIcon, Loader2, Activity, Terminal, Play, Send, MoreHorizontal } from 'lucide-react';
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
import { Telegram } from './pages/Telegram';
import ReloadPrompt from './components/ReloadPrompt';

const LATEST_VERSION_URL = 'https://raw.githubusercontent.com/plsy1/DySyncEngine/refs/heads/main/VERSION';

type VersionState = {
  latest: string | null;
  hasUpdate: boolean;
  isChecking: boolean;
  error: boolean;
};

const normalizeVersion = (version: string) => version.trim().replace(/^v/i, '');

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
  const [view, setView] = useState<'dashboard' | 'settings' | 'tasks' | 'logs' | 'player' | 'telegram'>('dashboard');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserUrl, setNewUserUrl] = useState('');
  const [maxFetch, setMaxFetch] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [versionState, setVersionState] = useState<VersionState>({
    latest: null,
    hasUpdate: false,
    isChecking: true,
    error: false,
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

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
      const data = await api.getUsers();
      setUsers(data);
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
      showToast('任务开启失败', 'error');
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
      showToast('账号及其数据已彻底删除');
      setModal({ isOpen: false, user: null });
    } catch (err) {
      showToast('删除失败', 'error');
    }
  };

  const filteredUsers = users.filter(u =>
    u.nickname?.toLowerCase().includes(search.toLowerCase()) ||
    u.uid.includes(search)
  );

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
          <NavButton active={view === 'tasks'} onClick={() => setView('tasks')} icon={<Activity size={20} />} label="活跃任务" />
          <NavButton active={view === 'logs'} onClick={() => setView('logs')} icon={<Terminal size={20} />} label="审计日志" />
          <NavButton active={view === 'player'} onClick={() => setView('player')} icon={<Play size={20} />} label="Emby 播放" />
          <NavButton active={view === 'telegram'} onClick={() => setView('telegram')} icon={<Send size={20} />} label="TG 集成" />
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
        className="flex-1 md:ml-20 lg:ml-64 min-h-screen overflow-y-auto custom-scrollbar"
      >
        <div 
            style={{ paddingBottom: 'var(--sab)' }}
            className="max-w-[1920px] mx-auto p-6 lg:p-10 space-y-10"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              {view === 'settings' ? (
                <Settings onBack={() => setView('dashboard')} onNotify={showToast} />
              ) : view === 'player' ? (
                <EmbyPlayer onBack={() => setView('dashboard')} onNotify={showToast} />
              ) : view === 'tasks' ? (
                <Tasks onNotify={showToast} activeTasks={activeTasks} />
              ) : view === 'logs' ? (
                <Logs />
              ) : view === 'telegram' ? (
                <Telegram onBack={() => setView('dashboard')} onNotify={showToast} />
              ) : (
                <div className="space-y-12">
                  <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                      <h2 className="text-4xl font-black tracking-tight text-white mb-2">主控制台</h2>
                      <p className="text-white/30 text-sm font-medium">当前监控 {users.length} 个账号，共有 {activeTasks.length} 个活跃任务</p>
                    </div>
                    <div className="flex gap-4">
                        <div className="relative w-full lg:w-80">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                          <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="搜索..."
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-primary/50 transition-all font-medium text-sm"
                          />
                        </div>
                    </div>
                  </header>

                  <SingleDownload onNotify={showToast} />

                  {/* Quick Add Form Section */}
                  <form onSubmit={handleAddUser} className="relative group p-1 rounded-3xl bg-gradient-to-r from-primary/20 to-transparent">
                    <div className="bg-[#0b0b0b] rounded-[22px] p-6 flex flex-col md:flex-row gap-4 items-center">
                      <div className="flex-1 w-full relative">
                        <Plus className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" size={20} />
                        <input
                          type="text"
                          value={newUserUrl}
                          onChange={(e) => setNewUserUrl(e.target.value)}
                          placeholder="粘贴抖音主页链接以开始自动同步..."
                          className="w-full bg-transparent py-2 pl-12 pr-4 outline-none text-white font-medium placeholder:text-white/20"
                        />
                      </div>
                      <div className="w-full md:w-40 relative md:border-l border-white/10 md:pl-4">
                        <div className="flex items-center gap-2">
                          <span className="text-white/30 text-xs font-bold uppercase lg:hidden">数量:</span>
                          <input
                            type="number"
                            value={maxFetch || ''}
                            onChange={(e) => setMaxFetch(parseInt(e.target.value) || 0)}
                            placeholder="数量 (0=全量)"
                            className="w-full bg-transparent py-2 outline-none text-white font-medium placeholder:text-white/20"
                            title="最大抓取作品数量，0 表示抓取全部"
                          />
                        </div>
                      </div>
                      <button type="submit" className="w-full md:w-auto px-8 py-3 bg-primary text-black font-black rounded-xl hover:scale-105 active:scale-95 transition-all shadow-xl shadow-primary/20">
                        添加作者
                      </button>
                    </div>
                  </form>

                  {/* User Grid - RECLAIMING THE SIDES */}
                  <section>
                    {loading && users.length === 0 ? (
                      <div className="flex items-center justify-center py-40">
                        <RefreshCw size={40} className="animate-spin text-primary" />
                      </div>
                    ) : filteredUsers.length > 0 ? (
                      <div>
                        {(() => {
                          const ITEMS_PER_PAGE = 12;
                          const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
                          const activePage = currentPage > totalPages ? Math.max(1, totalPages) : currentPage;
                          const paginatedUsers = filteredUsers.slice((activePage - 1) * ITEMS_PER_PAGE, activePage * ITEMS_PER_PAGE);

                          return (
                            <>
                              <motion.div
                                layout
                                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6 gap-6"
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

                              {/* Modern Pagination Controls */}
                              {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-2 mt-10 pb-24 md:pb-0">
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
                          {search ? '空空如也' : '尚未开始同步'}
                        </p>
                        <p className="text-white/10 text-sm">{search ? '尝试换个关键词搜索' : '请在上方粘贴作者主页链接'}</p>
                      </div>
                    )}
                  </section>
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
        className="md:hidden fixed bottom-0 left-6 right-6 h-16 bg-white/5 backdrop-blur-xl border border-white/20 ring-1 ring-inset ring-white/10 z-[60] flex items-center justify-around px-2 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.2)]"
      >
        <MobileNavButton active={view === 'dashboard'} onClick={() => { setView('dashboard'); setShowMoreMenu(false); }} icon={<Search size={22} />} label="首页" />
        <MobileNavButton active={view === 'tasks'} onClick={() => { setView('tasks'); setShowMoreMenu(false); }} icon={<Activity size={22} />} label="任务" />
        <MobileNavButton active={view === 'player'} onClick={() => { setView('player'); setShowMoreMenu(false); }} icon={<Play size={22} />} label="播放" />
        <MobileNavButton active={view === 'settings'} onClick={() => { setView('settings'); setShowMoreMenu(false); }} icon={<SettingsIcon size={22} />} label="配置" />
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
              className="md:hidden fixed bottom-0 left-0 right-0 bg-[#060608]/80 backdrop-blur-2xl border-t border-white/20 rounded-t-[40px] z-[80] p-7 pb-[calc(28px+var(--sab))] shadow-2xl"
            >
              <div className="w-12 h-1 bg-white/10 rounded-full mx-auto mb-8" />
              <div className="grid grid-cols-1 gap-2">
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
                  onClick={() => { setView('telegram'); setShowMoreMenu(false); }}
                  className="flex items-center gap-4 p-4 rounded-2xl hover:bg-white/5 transition-all text-left"
                >
                  <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400">
                    <Send size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">TG 集成</div>
                    <div className="text-xs text-white/40">配置自动化推送服务</div>
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
      className={`flex-1 flex flex-col items-center justify-center transition-all duration-300 relative ${active ? 'text-primary' : 'text-white/20'}`}
    >
      <div className={`transition-all duration-300 ${active ? 'scale-110' : 'active:scale-90'}`}>
        {icon}
      </div>
      {active && (
        <motion.span 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[10px] font-black mt-0.5 tracking-tighter"
        >
          {label}
        </motion.span>
      )}
    </button>
  );
}

export default App;
