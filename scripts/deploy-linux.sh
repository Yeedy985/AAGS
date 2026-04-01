#!/bin/bash
# ============================================================
# AAGS Linux 一键部署脚本
# 用法: bash scripts/deploy-linux.sh
# 前提: 已安装 Node.js >= 18, pnpm, pm2
# ============================================================

set -e

echo ""
echo "========================================="
echo "  AAGS Linux Deploy"
echo "========================================="
echo ""

# 检查依赖
command -v node >/dev/null 2>&1 || { echo "❌ 需要安装 Node.js >= 18"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "❌ 需要安装 pnpm: npm install -g pnpm"; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "❌ 需要安装 pm2: npm install -g pm2"; exit 1; }

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 版本过低，需要 >= 18，当前: $(node -v)"
  exit 1
fi

echo "✅ Node.js $(node -v)"
echo "✅ pnpm $(pnpm -v)"
echo "✅ pm2 $(pm2 -v)"

# 项目目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"
echo ""
echo "📁 项目目录: $PROJECT_DIR"

# 安装依赖
echo ""
echo "📦 安装依赖..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 构建前端
echo ""
echo "🔨 构建前端..."
pnpm build

# 检查构建产物
if [ ! -f "dist/index.html" ]; then
  echo "❌ 构建失败: dist/index.html 不存在"
  exit 1
fi
echo "✅ 构建完成: dist/"

# 启动/重启 PM2 守护进程
echo ""
echo "🚀 启动 AAGS 服务..."
PORT=${AAGS_PORT:-8080}

# 先停掉旧的
pm2 delete aags 2>/dev/null || true

# 启动新的
pm2 start server.cjs --name aags -- --port "$PORT"
pm2 save

echo ""
echo "========================================="
echo "  ✅ AAGS 部署完成！"
echo "  🌐 访问: http://$(hostname -I | awk '{print $1}'):${PORT}"
echo "  📋 查看日志: pm2 logs aags"
echo "  🔄 重启: pm2 restart aags"
echo "  ⏹  停止: pm2 stop aags"
echo "========================================="
echo ""
