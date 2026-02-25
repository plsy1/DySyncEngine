#!/bin/bash

# DySyncEngine Development Startup Script

echo "🚀 Starting DySyncEngine Backend in Development Mode..."

# Check if we are in the right directory
if [ ! -d "backend" ]; then
    echo "❌ Error: backend directory not found. Please run this script from the project root."
    exit 1
fi

# Set PYTHONPATH to include the backend directory
export PYTHONPATH=$PYTHONPATH:$(pwd)/backend

# Start uvicorn
# --app-dir backend: look for main:app inside the backend folder
# --host 0.0.0.0: listen on all interfaces
# --port ${PORT:-8000}: default port
# --reload: auto-restart on code changes
uvicorn main:app --app-dir ./backend --host 0.0.0.0 --port ${PORT:-8000} --reload
