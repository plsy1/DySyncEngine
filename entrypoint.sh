#!/bin/sh
# =============================================================================
# DySyncEngine 容器启动脚本
# 自动将镜像内置的默认 config 拷贝到持久化挂载目录（若文件不存在）
# 这样新用户无需手动准备任何配置文件，容器可以直接正常启动
# =============================================================================

copy_default_if_missing() {
    SRC="$1"
    DST="$2"
    if [ ! -f "$DST" ]; then
        mkdir -p "$(dirname "$DST")"
        if [ -f "$SRC" ]; then
            cp "$SRC" "$DST"
            echo "[entrypoint] 已初始化默认配置: $DST"
        else
            echo "[entrypoint] 警告: 找不到源文件 $SRC"
        fi
    else
        echo "[entrypoint] 配置已存在，跳过: $DST"
    fi
}

# 初始化各平台默认配置（如果宿主机挂载目录中不存在）
copy_default_if_missing \
    "/app/3rd/douyin_api/crawlers/douyin/web/config.yaml.default" \
    "/app/config/douyin_web/config.yaml"

copy_default_if_missing \
    "/app/3rd/douyin_api/crawlers/tiktok/web/config.yaml.default" \
    "/app/config/tiktok_web/config.yaml"

# 将宿主机持久化的 config 软链回到 3rd/douyin_api 内部
# 确保外部 API 读取到用户自定义的配置（含 Cookie）
echo "[entrypoint] 创建配置软链..."
ln -sf /app/config/douyin_web/config.yaml /app/3rd/douyin_api/crawlers/douyin/web/config.yaml
ln -sf /app/config/tiktok_web/config.yaml /app/3rd/douyin_api/crawlers/tiktok/web/config.yaml

echo "[entrypoint] 配置初始化完成，正在启动服务..."
exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-80}"
