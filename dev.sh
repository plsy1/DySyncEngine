#!/bin/bash

# DySyncEngine Development Startup Script

echo "🚀 Starting DySyncEngine Backend in Development Mode..."

# Check if we are in the right directory
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "❌ Error: backend or frontend directory not found. Please run this script from the project root."
    exit 1
fi

# Install frontend dependencies if missing
if [ ! -d "frontend/node_modules" ]; then
    echo "📦 node_modules not found, installing frontend dependencies..."
    (cd frontend && npm install)
fi

# Function to clean up background processes
cleanup() {
    echo "🛑 Shutting down development servers..."
    kill $(jobs -p)
    exit
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

# Link configurations for 3rd party API crawlers
echo "🔗 Checking external API configurations..."
if [ -d "3rd/douyin_api/crawlers" ]; then
    # Douyin Web
    if [ -f "config/douyin_web/config.yaml" ]; then
        mkdir -p 3rd/douyin_api/crawlers/douyin/web
        ln -sf "$(pwd)/config/douyin_web/config.yaml" "3rd/douyin_api/crawlers/douyin/web/config.yaml"
        echo "✅ Linked: Douyin Web Config"
    fi
    # TikTok Web
    if [ -f "config/tiktok_web/config.yaml" ]; then
        mkdir -p 3rd/douyin_api/crawlers/tiktok/web
        ln -sf "$(pwd)/config/tiktok_web/config.yaml" "3rd/douyin_api/crawlers/tiktok/web/config.yaml"
        echo "✅ Linked: TikTok Web Config"
    fi
    # TikTok App
    if [ -f "config/tiktok_app/config.yaml" ]; then
        mkdir -p 3rd/douyin_api/crawlers/tiktok/app
        ln -sf "$(pwd)/config/tiktok_app/config.yaml" "3rd/douyin_api/crawlers/tiktok/app/config.yaml"
        echo "✅ Linked: TikTok App Config"
    fi
fi

if [ ! -s "config/kuaishou_web/config.yaml" ]; then
    mkdir -p config/kuaishou_web
    if [ -f "defaults/kuaishou_web/config.yaml.default" ]; then
        cp defaults/kuaishou_web/config.yaml.default config/kuaishou_web/config.yaml
        echo "✅ Initialized: Kuaishou Web Config"
    fi
fi

echo "🚀 Starting DySyncEngine in Development Mode..."

# Start Frontend (Vite) in background
echo "✨ Starting Frontend (Port 5173 on 0.0.0.0)..."
(cd frontend && npm run dev -- --host 0.0.0.0) &

# Start Backend (Uvicorn)
export PORT=${PORT:-8000}
export SAVE_DIR=${SAVE_DIR:-videos}
export PYTHONPATH=$PYTHONPATH:$(pwd)/backend

echo "🐍 Starting Backend (Port $PORT on 0.0.0.0)..."
uvicorn main:app --app-dir ./backend --host 0.0.0.0 --port $PORT --reload
