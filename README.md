# 🚀 DySyncEngine

**DySyncEngine** 是一款专为高效同步与管理网络视频设计的现代化引擎。它集成了自动化抓取、高并发下载以及多租户配置管理，为用户提供极致的音视频收藏体验。

---

## ✨ 核心特性

- **🔐 安全认证**：基于 JWT 的账户管理系统，支持管理员密码修改，保护您的下载配置。
- **⚙️ 深度自定义**：
  - **全局设置**：统一配置视频/图文的下载偏好。
  - **用户覆盖**：支持为特定作者设置独立的同步策略（强制开启/关闭）。
- **🔄 自动化同步**：可配置的后台自动更新间隔，实时监控作者动态，增量同步新作品。
- **📊 实时任务监控**：前端提供精美的进度条实时反馈下载状态，状态一目了然。
- **🛠️ 灵活配置**：
  - 支持 `config.yaml` 外部文件配置。
  - 支持环境变量（ENV）完全覆盖，完美适配 Docker 部署。
- **🌈 精美 UI**：基于 React + Framer Motion 打造的极简、灵动管理界面，原生支持深色模式。
- **🐍 优雅日志**：集成 `Loguru`，提供彩色、结构化的终端输出，调试与监控更自然。

---

## 🛠️ 技术栈

- **后端**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.11+) + [SQLAlchemy](https://www.sqlalchemy.org/) + [Loguru](https://github.com/Delgan/loguru)
- **前端**: [React](https://react.dev/) + [Vite](https://vitejs.dev/) + [Tailwind CSS](https://tailwindcss.com/) + [Framer Motion](https://www.framer.com/motion/)
- **数据库**: SQLite (轻量、免维护)
- **部署**: Docker (多阶段构建) + Docker Compose

---

## 🚀 快速启动

### 🐳 使用 Docker (推荐)

最简单的启动方式，一键运行前端、后端及配置：

```bash
# 1. 启动服务
docker compose up -d

# 2. 访问地址
# 默认映射到宿主机的 80 端口 (可在 docker-compose.yaml 修改)
http://localhost
```

### 🐍 本地开发环境

如果您需要修改代码或进行调试：

#### 1. 后端启动
```bash
# 安装依赖
pip install -r backend/requirements.txt

# 使用一键脚本启动 (默认 8000 端口，支持 PORT 环境变量)
# export PORT=8001
./dev.sh

# 手动启动命令 (若 ./dev.sh 不可用)
PYTHONPATH=./backend uvicorn main:app --app-dir ./backend --host 0.0.0.0 --port ${PORT:-8000} --reload
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
├── backend/            # FastAPI 核心逻辑
│   ├── api.py          # 业务接口
│   ├── config.py       # 配置管理中心
│   ├── db.py           # 数据库模型与逻辑
│   ├── downloader.py   # 下载核心实现
│   └── fetch.py        # 网络抓取逻辑
├── frontend/           # React + Vite 前端源码
├── config.yaml         # 全局默认配置文件
├── dev.sh              # 本地一键启动脚本
├── Dockerfile          # 多阶段镜像定义
└── docker-compose.yaml # 容器编排定义
```

---

## 🔑 默认凭据

- **用户名**: `root`
- **初始密码**: `password`  *(建议首次登录后立即在“设置”中修改)*

---

## 📝 许可证

本项目遵循 [Apache-2.0 License](LICENSE) 协议。仅供学习交流使用。
