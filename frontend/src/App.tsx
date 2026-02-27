import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, RefreshCw, LogOut, Settings as SettingsIcon, Loader2, Activity, Terminal } from 'lucide-react';
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
import ReloadPrompt from './components/ReloadPrompt';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [view, setView] = useState<'dashboard' | 'settings' | 'tasks' | 'logs'>('dashboard');
  const [users, setUsers] = useState<User[]>([]);
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserUrl, setNewUserUrl] = useState('');
  const [search, setSearch] = useState('');

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
      await api.downloadUserVideos(newUserUrl);
      showToast('已加入后台下载队列');
      setNewUserUrl('');
      // 立即拉取一次列表，以便看到新创建的“占位”卡片
      loadUsers();
    } catch (err) {
      showToast('任务开启失败', 'error');
    }
  };

  const handleRefresh = async (secUserId: string) => {
    try {
      await api.refreshUserVideos(secUserId);
      showToast('增量同步已启动');
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
    <div className="min-h-screen bg-[#060606] text-white selection:bg-primary/30">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-black border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10 overflow-hidden">
              <img src="/logo.svg" alt="DySyncEngine" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">DySync<span className="text-primary">Engine</span></h1>
              <p className="text-[10px] text-white/40 font-medium uppercase tracking-widest">Advanced Sync Core</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setView(v => v === 'tasks' ? 'dashboard' : 'tasks')}
              className={`p-3 rounded-xl transition-all ${view === 'tasks' ? 'bg-primary text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
              title="任务管理"
            >
              <Activity size={20} />
            </button>
            <button
              onClick={() => setView(v => v === 'logs' ? 'dashboard' : 'logs')}
              className={`p-3 rounded-xl transition-all ${view === 'logs' ? 'bg-primary text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
              title="运行日志"
            >
              <Terminal size={20} />
            </button>
            <button
              onClick={() => setView(v => v === 'settings' ? 'dashboard' : 'settings')}
              className={`p-3 rounded-xl transition-all ${view === 'settings' ? 'bg-primary text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
              title="设置"
            >
              <SettingsIcon size={20} />
            </button>
            <button
              onClick={handleLogout}
              className="p-3 rounded-xl bg-white/5 hover:bg-red-500/10 active:scale-95 transition-all text-white/60 hover:text-red-400"
              title="登出"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </nav>

      {view === 'settings' ? (
        <Settings onBack={() => setView('dashboard')} onNotify={showToast} />
      ) : view === 'tasks' ? (
        <main className="max-w-7xl mx-auto px-6 pt-12">
          <Tasks onNotify={showToast} activeTasks={activeTasks} />
        </main>
      ) : view === 'logs' ? (
        <main className="max-w-7xl mx-auto px-6 pt-12">
          <Logs />
        </main>
      ) : (
        <main className="max-w-7xl mx-auto px-6 pt-12">
          {/* Single Video Download Section */}
          <SingleDownload onNotify={showToast} />

          {/* Top Controls */}
          <section className="flex flex-col md:flex-row gap-4 mb-12">
            <form onSubmit={handleAddUser} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Plus className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={20} />
                <input
                  type="text"
                  value={newUserUrl}
                  onChange={(e) => setNewUserUrl(e.target.value)}
                  placeholder="添加新作者 (粘贴抖音主页链接)..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-primary/50 transition-all"
                />
              </div>
              <button type="submit" className="btn-primary">
                添加
              </button>
            </form>

            <div className="relative w-full md:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={20} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索账号或 UID..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-white/20 transition-all"
              />
            </div>
          </section>

          {/* User Grid */}
          {loading && users.length === 0 ? (
            <div className="flex items-center justify-center py-40">
              <RefreshCw size={40} className="animate-spin text-primary" />
            </div>
          ) : filteredUsers.length > 0 ? (
            <motion.div
              layout
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            >
              <AnimatePresence mode="popLayout">
                {filteredUsers.map(user => (
                  <UserCard
                    key={user.uid}
                    user={user}
                    task={activeTasks.find(t => t.target_id === user.uid || t.target_id === user.sec_user_id)}
                    onRefresh={handleRefresh}
                    onToggleAutoUpdate={handleToggleAuto}
                    onPreferenceChange={async (uid, v, n) => {
                      try {
                        await api.updateUserPreference(uid, v, n);
                        setUsers(prev => prev.map(u => u.uid === uid ? { ...u, download_video_override: v, download_note_override: n } : u));
                        showToast('个人偏好设置已更新');
                      } catch (err) {
                        showToast('更新失败', 'error');
                      }
                    }}
                    onDelete={(u) => setModal({ isOpen: true, user: u })}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <div className="text-center py-40 border-2 border-dashed border-white/5 rounded-3xl">
              <p className="text-white/20 font-medium">
                {search ? '没有找到匹配的账号' : '尚未添加任何账号，粘贴链接开启追踪'}
              </p>
            </div>
          )}
        </main>
      )}

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
        title="删除账号"
        description={modal.user ? `确定要删除作者 "${modal.user.nickname}" 及其所有下载记录吗？此操作不可撤销。` : ''}
        confirmText="彻底删除"
        isDanger={true}
        onClose={() => setModal({ isOpen: false, user: null })}
        onConfirm={confirmDelete}
      />
      <ReloadPrompt />
    </div>
  );
}

export default App;
