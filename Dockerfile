# ============================================================
# AAGS Docker 镜像 - 多阶段构建
# 用法:
#   构建: docker build -t aags .
#   运行: docker run -d -p 8080:8080 --name aags aags
#   访问: http://localhost:8080
# ============================================================

# Stage 1: 构建前端
FROM node:18-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 先复制依赖文件，利用 Docker 缓存
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 复制源代码并构建
COPY . .
RUN pnpm build

# Stage 2: 生产运行（极小镜像）
FROM node:18-alpine AS production

WORKDIR /app

# 只复制需要的文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.cjs ./server.cjs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080 || exit 1

CMD ["node", "server.cjs", "--port", "8080"]
