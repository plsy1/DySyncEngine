#!/bin/sh
# =============================================================================
# DySyncEngine 容器启动脚本
# 自动将镜像内置的默认 config 拷贝到持久化 config 目录（若文件不存在）
# 这样新用户无需手动准备任何配置文件，容器可以直接正常启动
# =============================================================================

init_config() {
    SRC="$1"
    PERSISTENT_DST="$2"
    RUNTIME_DST="$3"

    if [ -d "$PERSISTENT_DST" ]; then
        echo "[entrypoint] 错误: $PERSISTENT_DST 是目录，不是 config.yaml 文件"
        echo "[entrypoint] 请删除该目录后重启容器"
        exit 1
    fi

    if [ ! -s "$PERSISTENT_DST" ]; then
        mkdir -p "$(dirname "$PERSISTENT_DST")"
        if [ -f "$SRC" ]; then
            cp "$SRC" "$PERSISTENT_DST"
            echo "[entrypoint] 已初始化默认配置: $PERSISTENT_DST"
        else
            echo "[entrypoint] 警告: 找不到源文件 $SRC"
        fi
    else
        echo "[entrypoint] 配置已存在，跳过: $PERSISTENT_DST"
    fi

    if [ -s "$PERSISTENT_DST" ]; then
        cp "$PERSISTENT_DST" "$RUNTIME_DST"
        echo "[entrypoint] 已同步运行时配置: $RUNTIME_DST"
    fi
}

# 初始化各平台默认配置（如果宿主机挂载目录中不存在或为空）
init_config \
    "/app/3rd/douyin_api/crawlers/douyin/web/config.yaml.default" \
    "/app/config/douyin_web/config.yaml" \
    "/app/3rd/douyin_api/crawlers/douyin/web/config.yaml"

init_config \
    "/app/3rd/douyin_api/crawlers/tiktok/web/config.yaml.default" \
    "/app/config/tiktok_web/config.yaml" \
    "/app/3rd/douyin_api/crawlers/tiktok/web/config.yaml"

init_config \
    "/app/defaults/kuaishou_web/config.yaml.default" \
    "/app/config/kuaishou_web/config.yaml" \
    "/app/config/kuaishou_web/config.yaml"

echo "[entrypoint] 配置初始化完成，正在启动服务..."
exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-80}"
