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

echo "🚀 Starting DySyncEngine in Development Mode..."

# Start Frontend (Vite) in background
echo "✨ Starting Frontend (Port 5173)..."
(cd frontend && npm run dev) &

# Start Backend (Uvicorn)
echo "🐍 Starting Backend (Port 8000)..."
export PYTHONPATH=$PYTHONPATH:$(pwd)/backend
uvicorn main:app --app-dir ./backend --host 0.0.0.0 --port ${PORT:-8000} --reload
