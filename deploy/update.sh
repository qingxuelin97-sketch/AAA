#!/usr/bin/env bash
# 幻域 · 更新到最新代码（数据不受影响：server/data.sqlite 不在 git 里）
# 用法：cd /opt/huanyu && bash deploy/update.sh
set -e
cd "$(dirname "$0")/.."

echo "==> 拉取最新代码"
git pull

echo "==> 安装依赖 + 修复原生二进制"
npm install --registry=https://registry.npmmirror.com
V=$(node -p "require('rolldown/package.json').version" 2>/dev/null || echo "")
[ -n "$V" ] && npm install --no-save "@rolldown/binding-linux-x64-gnu@$V" --registry=https://registry.npmjs.org || true

echo "==> 构建前端"
NODE_OPTIONS=--max-old-space-size=2048 npm run build
[ -f client/dist/index.html ] || { echo "!! 前端构建失败"; exit 1; }

echo "==> 重启服务"
pm2 restart huanyu

echo "==> 更新完成"
