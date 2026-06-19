import os
import time
import bcrypt
# Monkeypatch bcrypt for passlib compatibility (passlib is unmaintained)
try:
    if not hasattr(bcrypt, "__about__"):
        bcrypt.__about__ = type("about", (object,), {"__version__": bcrypt.__version__})
except Exception:
    pass
from typing import Generator
from loguru import logger
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, text, inspect
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# ----------------------------
# 数据库路径配置
# ----------------------------
# 项目根目录（main.py 所在目录）
main_dir = os.path.dirname(os.path.abspath(__file__))

# 数据库存放目录
data_dir = os.path.join(main_dir, "data")
os.makedirs(data_dir, exist_ok=True)

# SQLite 数据库路径
database_path = os.path.join(data_dir, "database.db")
DATABASE_URL = f"sqlite:///{database_path}"

# ----------------------------
# SQLAlchemy 初始化
# ----------------------------
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ----------------------------
# ORM 模型
# ----------------------------
class Aweme(Base):
    __tablename__ = "awemes"

    id = Column(Integer, primary_key=True, index=True)
    aweme_id = Column(String, unique=True, index=True, nullable=False)
    desc = Column(String)
    share_url = Column(String)
    nickname = Column(String, index=True)
    uid = Column(String)
    create_time = Column(Integer)
    aweme_type = Column(Integer, default=0)  # 0: 视频, 68: 图文
    platform = Column(String, default="douyin")
    downloaded = Column(Boolean, default=False)
    tg_exported = Column(Boolean, default=False)
    local_path = Column(String, nullable=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String, unique=True, index=True, nullable=False)
    sec_user_id = Column(String, index=True)
    nickname = Column(String)
    avatar_url = Column(String)
    signature = Column(String)
    auto_update = Column(Boolean, default=False)
    # 个人偏好：None 表示使用全局默认，True/False 表示强制覆盖
    download_video_override = Column(Boolean, nullable=True)
    download_note_override = Column(Boolean, nullable=True)
    tg_sync_enabled = Column(Boolean, nullable=True)  # True/False 表示强制覆盖，None 表示遵循全局
    tg_target_chat = Column(String, nullable=True)   # 如果设置了，则同步到此，否则遵循全局
    created_at = Column(Integer, default=lambda: int(time.time()))
    updated_at = Column(Integer, default=lambda: int(time.time()))
    sort_order = Column(Integer, default=0)
    platform = Column(String, default="douyin")
    sync_cursor = Column(String, nullable=True)
    sync_incomplete = Column(Boolean, default=False)
    sync_head_cursor = Column(String, nullable=True)
    sync_head_latest_time = Column(Integer, default=0)


class Account(Base):
    """管理员账户"""
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(Integer, default=lambda: int(time.time()))


class Config(Base):
    """全局配置"""
    __tablename__ = "configs"

    key = Column(String, primary_key=True)
    value = Column(String)  # 存储为字符串，根据 key 解析


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, index=True)
    target_id = Column(String, index=True)  # 如 uid
    status = Column(String, default="pending")  # pending, running, completed, failed
    progress = Column(Integer, default=0)
    message = Column(String, nullable=True)
    created_at = Column(Integer, default=lambda: int(time.time()))
    updated_at = Column(Integer, default=lambda: int(time.time()))


# ----------------------------
# 创建表与增量迁移
# ----------------------------
Base.metadata.create_all(bind=engine)

# 简单的 SQLite 增量迁移检查（针对已有数据库添加新列）
with engine.connect() as conn:
    inspector = inspect(engine)
    
    # User table migrations
    columns = [c["name"] for c in inspector.get_columns("users")]
    if "tg_sync_enabled" not in columns:
        conn.execute(text("ALTER TABLE users ADD COLUMN tg_sync_enabled BOOLEAN"))
        conn.commit()
    if "tg_target_chat" not in columns:
        conn.execute(text("ALTER TABLE users ADD COLUMN tg_target_chat TEXT"))
        conn.commit()
    if "sort_order" not in columns:
        conn.execute(text("ALTER TABLE users ADD COLUMN sort_order INTEGER DEFAULT 0"))
        conn.commit()
    if "sync_cursor" not in columns:
        conn.execute(text("ALTER TABLE users ADD COLUMN sync_cursor TEXT"))
        conn.commit()
    if "sync_incomplete" not in columns:
        conn.execute(text("ALTER TABLE users ADD COLUMN sync_incomplete BOOLEAN DEFAULT 0"))
        conn.commit()
    if "sync_head_cursor" not in columns:
        conn.execute(text("ALTER TABLE users ADD COLUMN sync_head_cursor TEXT"))
        conn.commit()
    if "sync_head_latest_time" not in columns:
        conn.execute(text("ALTER TABLE users ADD COLUMN sync_head_latest_time INTEGER DEFAULT 0"))
        conn.commit()
    users_for_order = conn.execute(text(
        "SELECT id, sort_order FROM users "
        "ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at ASC, id ASC"
    )).fetchall()
    current_orders = [row[1] for row in users_for_order]
    expected_orders = list(range(len(users_for_order)))
    if current_orders != expected_orders:
        for index, row in enumerate(users_for_order):
            conn.execute(text("UPDATE users SET sort_order = :sort_order WHERE id = :id"), {"sort_order": index, "id": row[0]})
        conn.commit()

    # Aweme table migrations
    aweme_columns = [c["name"] for c in inspector.get_columns("awemes")]
    if "tg_exported" not in aweme_columns:
        conn.execute(text("ALTER TABLE awemes ADD COLUMN tg_exported BOOLEAN DEFAULT 0"))
        conn.commit()
    if "local_path" not in aweme_columns:
        conn.execute(text("ALTER TABLE awemes ADD COLUMN local_path TEXT"))
        conn.commit()


# ----------------------------
# Session 管理器
# ----------------------------
def get_session() -> Generator[Session, None, None]:
    """提供数据库会话"""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# ----------------------------
# 增量插入
# ----------------------------
def add_aweme(session: Session, item: dict):
    """
    插入一条 aweme 数据，如果 aweme_id 已存在自动跳过
    """
    exists = session.query(Aweme).filter_by(aweme_id=item["aweme_id"]).first()
    if exists:
        changed = False
        for field in ("aweme_type", "platform", "share_url"):
            value = item.get(field)
            if value is not None and getattr(exists, field) != value:
                setattr(exists, field, value)
                changed = True
        nickname = item.get("nickname")
        if nickname and exists.nickname != nickname and exists.nickname in (None, "", exists.uid):
            exists.nickname = nickname
            changed = True
        if changed:
            session.commit()
        return  # 已存在，跳过
    aweme = Aweme(
        aweme_id=item["aweme_id"],
        desc=item.get("desc", ""),
        share_url=item.get("share_url", ""),
        nickname=item.get("nickname", ""),
        uid=item.get("uid", ""),
        create_time=item.get("create_time", 0),
        aweme_type=item.get("aweme_type", 0),
        platform=item.get("platform", "douyin")
    )
    session.add(aweme)
    session.commit()


def add_or_update_user(session: Session, user_data: dict):
    """
    插入新用户或更新现有用户信息
    """
    uid = user_data.get("uid")
    if not uid:
        return

    def next_sort_order() -> int:
        max_order = session.query(User.sort_order).filter(User.sort_order >= 0).order_by(User.sort_order.desc()).first()
        return ((max_order[0] if max_order and max_order[0] is not None else -1) + 1)

    user = session.query(User).filter_by(uid=uid).first()
    if not user:
        user = User(uid=uid)
        user.sort_order = next_sort_order()
        session.add(user)
    elif user_data.get("subscribed") and (user.sort_order is None or user.sort_order < 0):
        user.sort_order = next_sort_order()

    # 仅更新非空值
    if user_data.get("sec_user_id"):
        user.sec_user_id = user_data["sec_user_id"]
    
    # 检测昵称变更并触发本地存储及数据库路径重命名迁移
    new_nickname = user_data.get("nickname")
    if new_nickname and user.nickname and user.nickname != new_nickname:
        old_nickname = user.nickname
        try:
            from utils import handle_nickname_change
            platform = user.platform or user_data.get("platform") or "douyin"
            handle_nickname_change(session, uid, old_nickname, new_nickname, platform)
        except Exception as e:
            from loguru import logger
            logger.error(f"处理作者昵称更新迁移失败: {e}")

    if new_nickname:
        user.nickname = new_nickname
    if user_data.get("avatar_url"):
        user.avatar_url = user_data["avatar_url"]
    if user_data.get("signature"):
        user.signature = user_data["signature"]
    if user_data.get("platform"):
        user.platform = user_data["platform"]

    user.updated_at = int(time.time())
    session.commit()


def get_all_users(session: Session):
    """
    获取所有订阅用户信息（sort_order >= 0 的用户），不包含仅用于 Emby 元数据的临时用户（sort_order = -1）
    """
    return session.query(User).filter(User.sort_order >= 0).order_by(User.sort_order.asc(), User.created_at.asc(), User.id.asc()).all()


def update_user_sort_order(session: Session, ordered_uids: list[str]):
    """
    按传入 uid 顺序持久化作者卡片排序。
    """
    if not ordered_uids:
        return True

    users = session.query(User).filter(User.uid.in_(ordered_uids)).all()
    users_by_uid = {user.uid: user for user in users}

    for index, uid in enumerate(ordered_uids):
        user = users_by_uid.get(uid)
        if user:
            user.sort_order = index

    session.commit()
    return True


def toggle_user_auto_update(session: Session, uid: str, enabled: bool):
    """
    切换用户的自动更新状态
    """
    user = session.query(User).filter_by(uid=uid).first()
    if user:
        user.auto_update = enabled
        session.commit()
        return True
    return False


def get_auto_update_users(session: Session):
    """
    获取所有开启了自动更新的用户
    """
    return session.query(User).filter_by(auto_update=True).all()


def delete_user_data(session: Session, uid: str):
    """
    物理删除指定用户及其关联的所有视频记录
    """
    # 1. 删除视频记录
    session.query(Aweme).filter_by(uid=uid).delete()
    # 2. 删除用户信息
    session.query(User).filter_by(uid=uid).delete()
    session.commit()
    return True


def create_task(session: Session, task_id: str, target_id: str):
    """
    创建新任务
    """
    task = Task(id=task_id, target_id=target_id)
    session.add(task)
    session.commit()
    return task


def update_task_progress(session: Session, task_id: str, progress: int, status: str = "running", message: str = None, target_id: str = None):
    """
    更新任务进度
    """
    task = session.query(Task).filter_by(id=task_id).first()
    if task:
        task.progress = progress
        task.status = status
        if message:
            task.message = message
        if target_id:
            task.target_id = target_id
        task.updated_at = int(time.time())
        session.commit()
        return True
    return False


def _get_task_timeout_minutes(session: Session) -> int:
    value = os.getenv("TASK_TIMEOUT_MINUTES", "30")
    try:
        value = get_config(session, "task_timeout_minutes", value) or value
    except Exception:
        pass

    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 30


def mark_stale_active_tasks_as_failed(session: Session, timeout_minutes: int | None = None) -> int:
    """
    将长时间没有进度更新的 pending/running 任务标记为失败，避免残留任务卡住后续操作。
    """
    timeout = timeout_minutes if timeout_minutes is not None else _get_task_timeout_minutes(session)
    cutoff = int(time.time()) - (max(1, timeout) * 60)
    stale_tasks = session.query(Task).filter(
        Task.status.in_(["running", "pending"]),
        Task.updated_at < cutoff
    ).all()

    if not stale_tasks:
        return 0

    logger.info(f"清理超时任务，共发现 {len(stale_tasks)} 个超过 {timeout} 分钟未更新的任务")
    now = int(time.time())
    for task in stale_tasks:
        task.status = "failed"
        task.message = "任务超时，可能已被中断"
        task.updated_at = now
    session.commit()
    return len(stale_tasks)


def get_active_tasks_by_targets(session: Session, target_ids: list[str]):
    """
    获取指定目标列表的活跃任务（running）
    """
    mark_stale_active_tasks_as_failed(session)
    return session.query(Task).filter(
        Task.target_id.in_(target_ids),
        Task.status == "running"
    ).all()


def get_all_active_tasks(session: Session):
    """
    获取所有活跃任务
    """
    mark_stale_active_tasks_as_failed(session)
    return session.query(Task).filter(Task.status == "running").all()


def mark_interrupted_tasks_as_failed(session: Session):
    """
    在启动时调用，将所有处于 running 或 pending 状态的任务标记为失败（中断）
    """
    stale_tasks = session.query(Task).filter(
        Task.status.in_(["running", "pending"])
    ).all()
    
    if stale_tasks:
        logger.info(f"清理遗留任务，共发现 {len(stale_tasks)} 个中断的任务")
        for task in stale_tasks:
            task.status = "failed"
            task.message = "任务因系统重启或意外终止而被中断"
            task.updated_at = int(time.time())
        session.commit()


# ----------------------------
# 查询示例：按作者获取作品
# ----------------------------
def get_awemes_by_author(session: Session, nickname: str):
    """
    查询指定作者的作品，按 create_time 降序排列
    """
    return session.query(Aweme).filter_by(nickname=nickname).order_by(Aweme.create_time.desc()).all()

def mark_downloaded(session, aweme_id: str):
    aweme = session.query(Aweme).filter_by(aweme_id=aweme_id).first()
    if aweme:
        aweme.downloaded = True
        session.commit()

def get_undownloaded_awemes_by_uid(session: Session, uid: str):
    """
    查询指定作者 uid 的未下载作品
    """
    return session.query(Aweme).filter_by(uid=uid, downloaded=False).all()

def mark_all_tg_exported(session: Session, uid: str):
    """
    将指定用户的所有作品标记为已导出到 Telegram
    """
    session.query(Aweme).filter_by(uid=uid).update({Aweme.tg_exported: True})
    session.commit()
    return True

def get_undownloaded_awemes(session: Session):
    """
    查询所有未下载的作品
    """
    return session.query(Aweme).filter_by(downloaded=False).all()


def get_latest_create_time(session: Session, uid: str) -> int:
    """
    查询指定作者 uid 的最新 create_time
    返回 0 如果没有作品
    """
    aweme = (
        session.query(Aweme)
        .filter_by(uid=uid)
        .order_by(Aweme.create_time.desc())
        .first()
    )
    if aweme:
        return aweme.create_time
    return 0


# ----------------------------
# 配置与账户管理
# ----------------------------
def get_config(session: Session, key: str, default: str = None) -> str:
    conf = session.query(Config).filter_by(key=key).first()
    return conf.value if conf else default


def set_config(session: Session, key: str, value: str):
    conf = session.query(Config).filter_by(key=key).first()
    if not conf:
        conf = Config(key=key)
        session.add(conf)
    conf.value = value
    session.commit()


def get_account(session: Session, username: str):
    return session.query(Account).filter_by(username=username).first()


def create_account(session: Session, username: str, password_hash: str):
    acc = Account(username=username, password_hash=password_hash)
    session.add(acc)
    session.commit()
    return acc


def update_account_password(session: Session, username: str, new_password_hash: str):
    acc = session.query(Account).filter_by(username=username).first()
    if acc:
        acc.password_hash = new_password_hash
        session.commit()
        return True
    return False


class _Unset:
    def __bool__(self):
        return False

UNSET = _Unset()

def update_user_preference(session: Session, uid: str, video_pref=UNSET, note_pref=UNSET, tg_sync_pref=UNSET, tg_chat_pref=UNSET):
    user = session.query(User).filter_by(uid=uid).first()
    if user:
        if video_pref is not UNSET: user.download_video_override = video_pref
        if note_pref is not UNSET: user.download_note_override = note_pref
        if tg_sync_pref is not UNSET: user.tg_sync_enabled = tg_sync_pref
        if tg_chat_pref is not UNSET: user.tg_target_chat = tg_chat_pref
        user.updated_at = int(time.time())
        session.commit()
        return True
    return False


def init_defaults(session: Session):
    # 初始化默认配置
    if not get_config(session, "download_video"):
        set_config(session, "download_video", "true")
    if not get_config(session, "download_note"):
        set_config(session, "download_note", "true")
    if not get_config(session, "auto_update_interval"):
        set_config(session, "auto_update_interval", "120")
    if not get_config(session, "max_initial_fetch"):
        set_config(session, "max_initial_fetch", "0")
    if not get_config(session, "kuaishou_sync_max_pages"):
        set_config(session, "kuaishou_sync_max_pages", "3")
    if not get_config(session, "kuaishou_feed_min_interval"):
        set_config(session, "kuaishou_feed_min_interval", "20")
    if not get_config(session, "task_timeout_minutes"):
        set_config(session, "task_timeout_minutes", "30")
    if not get_config(session, "shortcut_token"):
        set_config(session, "shortcut_token", os.getenv("SHORTCUT_TOKEN", "password"))
    
    # 初始化默认管理员 (如果不存在任何账户)
    if session.query(Account).count() == 0:
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        admin_hash = pwd_context.hash("password")
        create_account(session, "root", admin_hash)
        logger.info("Default root account created: root / password")


# 在模块加载时可选调用，或者在 main.py 启动时调用
with SessionLocal() as session:
    init_defaults(session)
