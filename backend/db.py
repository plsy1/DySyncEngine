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
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey
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
    downloaded = Column(Boolean, default=False)


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
    created_at = Column(Integer, default=lambda: int(time.time()))
    updated_at = Column(Integer, default=lambda: int(time.time()))


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
# 创建表
# ----------------------------
Base.metadata.create_all(bind=engine)


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
        return  # 已存在，跳过
    aweme = Aweme(
        aweme_id=item["aweme_id"],
        desc=item.get("desc", ""),
        share_url=item.get("share_url", ""),
        nickname=item.get("nickname", ""),
        uid=item.get("uid", ""),
        create_time=item.get("create_time", 0),
        aweme_type=item.get("aweme_type", 0)
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

    user = session.query(User).filter_by(uid=uid).first()
    if not user:
        user = User(uid=uid)
        session.add(user)

    # 仅更新非空值
    if user_data.get("sec_user_id"):
        user.sec_user_id = user_data["sec_user_id"]
    if user_data.get("nickname"):
        user.nickname = user_data["nickname"]
    if user_data.get("avatar_url"):
        user.avatar_url = user_data["avatar_url"]
    if user_data.get("signature"):
        user.signature = user_data["signature"]

    user.updated_at = int(time.time())
    session.commit()


def get_all_users(session: Session):
    """
    获取所有作者信息
    """
    return session.query(User).all()


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


def get_active_tasks_by_targets(session: Session, target_ids: list[str]):
    """
    获取指定目标列表的活跃任务（running）
    """
    return session.query(Task).filter(
        Task.target_id.in_(target_ids),
        Task.status == "running"
    ).all()


def get_all_active_tasks(session: Session):
    """
    获取所有活跃任务
    """
    return session.query(Task).filter(Task.status == "running").all()


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


def update_user_preference(session: Session, uid: str, video_pref: bool = None, note_pref: bool = None):
    user = session.query(User).filter_by(uid=uid).first()
    if user:
        if video_pref is not None:
            user.download_video_override = video_pref
        if note_pref is not None:
            user.download_note_override = note_pref
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