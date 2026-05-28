# --- Stage 1: Build Frontend ---
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY VERSION /app/VERSION
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Final Backend ---
FROM python:3.11-slim
WORKDIR /app

# Install backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend source
COPY backend/ ./backend/
COPY 3rd/douyin_api/ ./3rd/douyin_api/

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# 备份镜像内的默认 config 文件（用于首次启动时自动初始化）
# .default 文件保持不变，供 entrypoint.sh 初始化挂载的 config.yaml
RUN cp /app/3rd/douyin_api/crawlers/douyin/web/config.yaml \
       /app/3rd/douyin_api/crawlers/douyin/web/config.yaml.default && \
    cp /app/3rd/douyin_api/crawlers/tiktok/web/config.yaml \
       /app/3rd/douyin_api/crawlers/tiktok/web/config.yaml.default

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/backend

ENV PORT=80
EXPOSE ${PORT}

# Use entrypoint to auto-init configs before starting
ENTRYPOINT ["/app/entrypoint.sh"]
