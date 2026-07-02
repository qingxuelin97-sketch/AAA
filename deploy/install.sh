#!/usr/bin/env bash
# 幻域 · 阿里云/任意 Ubuntu 服务器 一键安装
# 用法（在服务器以 root 运行）：
#   apt-get update -y && apt-get install -y git
#   git clone https://github.com/qingxuelin97-sketch/AAA.git /opt/huanyu
#   cd /opt/huanyu && bash deploy/install.sh
# 完成后访问 http://<公网IP>:4000 （记得在安全组放行 TCP 4000）
# 数据库文件 server/data.sqlite 落在本机硬盘，重启/更新都不丢。
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${PORT:-4000}"

echo "==> 1/6 交换内存（小内存机器防止构建被杀）"
if ! swapon --show 2>/dev/null | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile || true
fi

echo "==> 2/6 Node 22（国内镜像；vite 8 / rolldown 要求 ^20.19.0 || >=22.12.0，老的 v20.18 不够）"
source "$ROOT/deploy/ensure-node.sh"

echo "==> 3/6 编译依赖（better-sqlite3 需要）"
apt-get update -y && apt-get install -y python3 make g++ git

echo "==> 4/6 安装依赖 + 修复 Vite 原生二进制 + 构建前端"
# 仓库根 .npmrc 已把 @fontsource*/@rolldown 这些镜像常漏同步的 scope 固定到官方源；
# 其余包正常走镜像。镜像整体故障（E404/超时）时整体回退官方源重试一次。
npm install --registry=https://registry.npmmirror.com || {
  echo "!! 镜像安装失败（常见：个别 tarball 未同步导致 npm error E404），改用官方源整体重试"
  npm install --registry=https://registry.npmjs.org
}
# 关键坑：国内镜像常缺 rolldown 的平台二进制，单独从官方源补一个匹配版本
V=$(node -p "require('rolldown/package.json').version" 2>/dev/null || echo "")
[ -n "$V" ] && npm install --no-save "@rolldown/binding-linux-x64-gnu@$V" --registry=https://registry.npmjs.org || true
NODE_OPTIONS=--max-old-space-size=2048 npm run build
[ -f client/dist/index.html ] || { echo "!! 前端构建失败：client/dist/index.html 未生成"; exit 1; }

echo "==> 5/6 首次写入演示数据（已有数据则跳过）"
[ -f server/data.sqlite ] || node server/seed.js

echo "==> 6/6 pm2 常驻（端口 $PORT）"
npm i -g pm2
PM2_BIN="$(npm prefix -g 2>/dev/null)/bin/pm2"
[ -x "$PM2_BIN" ] && ln -sf "$PM2_BIN" /usr/local/bin/pm2 2>/dev/null || true
pm2 delete huanyu 2>/dev/null || true
PORT="$PORT" pm2 start server/index.js --name huanyu --update-env
pm2 save || true
pm2 startup systemd -u root --hp /root || true

echo ""
echo "================================================="
echo " 部署完成！访问 http://<你的公网IP>:$PORT"
echo " 演示账号 demo / 123456"
echo " 安全组别忘了放行 TCP $PORT"
echo "================================================="
