# 🚀 DySyncEngine

**DySyncEngine** 是一款专为高效同步、管理与沉浸式播放网络视频设计的现代化全栈引擎。它不仅支持 **抖音 (Douyin)** 和 **TikTok** 的全量/增量视频抓取与下载，还集成了一个媲美原生的 **PWA 沉浸式视频播放器**，并支持将内容自动/手动推送至 **Telegram**。

---

## ✨ 核心特性

### 1. 📥 智能抓取与下载
- **双平台支持**：完美支持抖音与 TikTok 视频、图文内容的解析与下载。
- **全量/增量同步**：一键抓取用户所有历史作品，或实时监控作者动态进行增量更新。
- **自动化订阅**：可配置的后台调度器，定时巡检已关注的作者，新作品自动入库。
- **高并发下载**：基于高效下载引擎，支持断点续传与多线程处理。

### 2. 📱 沉浸式 PWA 播放器
- **TikTok 级体验**：纵向滑动手势切换，媲美原生的流畅动效（React + Framer Motion）。
- **Emby 深度集成**：直接读取 Emby 媒体库数据，结合本地数据库提供丰富的元数据展示。
- **多模态支持**：支持视频播放与精美图文（Gallery）幻灯片浏览。
- **智能手势**：长按 2 倍速、横滑进度调节、双击点赞（预留）等原生操作逻辑。

### 3. ✈️ Telegram 集成
- **自动推送**：新内容下载完成后，可自动转发至指定的 Telegram 频道或对话。
- **排版优化**：自动对 WebP 图片进行转换，支持分批次（Batch）发送，保持频道整洁。
- **全量审计**：支持手动触发已下载内容的全量 TG 同步，补齐历史遗留文件。

### 4. ⚙️ 深度管理与配置
- **任务控制台**：精美的进度反馈系统，实时监控每一个抓取与下载任务。
- **多级偏好设置**：
  - **全局设置**：统一配置视频/图文下载、TG 推送开关及同步间隔。
  - **用户覆盖**：支持为特定作者设置独立的同步策略（如：仅同步 A 的视频，不推送 B 的 TG）。
- **实时日志**：前端集成可视化日志控制台，后端运行状况一目了然。
- **安全认证**：基于 JWT 的账户管理系统，保护您的个人配置与隐私。

---

## 🛠️ 技术栈

- **后端**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.11+) + [SQLAlchemy 2.0](https://www.sqlalchemy.org/) + [Telethon](https://github.com/LonamiWebs/Telethon)
- **前端**: [React 19](https://react.dev/) + [Vite 7](https://vitejs.dev/) + [Tailwind CSS 4](https://tailwindcss.com/) + [Framer Motion](https://www.framer.com/motion/)
- **数据库**: SQLite (轻量、高效、免维护)
- **部署**: [Docker](https://www.docker.com/) + Docker Compose

---

## 🚀 快速启动

### 🐳 使用 Docker (推荐)

最简单的启动方式，一键运行前端、后端及所有服务：

```bash
# 1. 启动服务
docker compose up -d

# 2. 访问地址
# 默认映射到宿主机的 80 端口 (可在 docker-compose.yaml 修改)
http://localhost
```

### 🐍 本地开发环境

#### 1. 后端启动
```bash
cd backend
# 建议使用虚拟环境
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 启动 (默认 8000 端口)
./dev.sh
```

#### 2. 前端开发
```bash
cd frontend
npm install
npm run dev
```

---

## 📁 项目结构

```text
├── backend/            # FastAPI 后端核心
│   ├── api.py          # 路由定义 (任务/用户/配置/TG)
│   ├── scheduler.py    # 定时调度逻辑 (自动更新)
│   ├── downloader.py   # 下载核心实现
│   ├── fetch.py        # 网络抓取逻辑 (Douyin/TikTok)
│   └── telegram_uploader.py # Telegram 推送服务
├── frontend/           # React 前端源码
│   ├── src/pages/EmbyPlayer.tsx # 核心播放器实现
│   └── src/pages/Tasks.tsx      # 任务控制台
├── 3rd/                # 第三方 API 集成
│   └── douyin_api/     # 集成的 Douyin_TikTok_Download_API
├── config/             # 挂载配置目录
├── videos/             # 媒体资源存储
└── docker-compose.yaml # 容器编排定义
```

---

## 🔑 默认凭据

- **用户名**: `root`
- **初始密码**: `password`  *(建议首次登录后立即在“设置”中修改)*

---

## 📝 许可证

本项目遵循 [Apache-2.0 License](LICENSE) 协议。
**严告**：本项目仅供学习交流、研究网络协议及个人收藏使用，请勿用于任何形式的商业用途或侵权行为。
