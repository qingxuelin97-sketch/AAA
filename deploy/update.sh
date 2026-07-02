#!/usr/bin/env bash
# 幻域 · 更新到最新代码（数据不受影响：server/data.sqlite 不在 git 里）
# 用法：cd /opt/huanyu && bash deploy/update.sh
#   纯净更新（默认）：强制对齐到 GitHub 最新 main，丢弃服务器上对“代码”的本地改动
#   （例如上次 npm install 改动了被跟踪的 package-lock.json，普通 git pull 会冲突）。
#   数据库文件不在 git 里，绝不受影响。
set -e
cd "$(dirname "$0")/.."

# 让脚本能找到 node/npm/pm2（cron 或精简 shell 下 PATH 常常不全）
export PATH="/usr/local/bin:/opt/node22/bin:/opt/node20/bin:$PATH"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-4000}"

echo "==> 强制同步到 origin/$BRANCH（保留数据库，丢弃代码本地改动）"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> 校验 Node 版本（vite 8 要求 ^20.19.0 || >=22.12.0，不满足则自动升到 22）"
source deploy/ensure-node.sh

echo "==> 安装依赖 + 修复原生二进制"
# .npmrc 已把 @fontsource*/@rolldown 固定到官方源（镜像常漏同步个别 tarball）；
# 镜像整体故障时回退官方源重试一次。
npm install --registry=https://registry.npmmirror.com || {
  echo "!! 镜像安装失败（常见：个别 tarball 未同步导致 npm error E404），改用官方源整体重试"
  npm install --registry=https://registry.npmjs.org
}
V=$(node -p "require('rolldown/package.json').version" 2>/dev/null || echo "")
[ -n "$V" ] && npm install --no-save "@rolldown/binding-linux-x64-gnu@$V" --registry=https://registry.npmjs.org || true

# Node 升级后 better-sqlite3 的 .node 二进制 ABI 会失配（NODE_MODULE_VERSION 变），
# 而 npm install 看到版本号不变就跳过，不会重编译。必须显式 rebuild 对齐当前 Node，
# 否则 server/db.js 第 8 行 ERR_DLOPEN_FAILED，进程秒崩、端口不监听 → 拒绝连接。
npm rebuild better-sqlite3

echo "==> 构建前端"
NODE_OPTIONS=--max-old-space-size=2048 npm run build
[ -f client/dist/index.html ] || { echo "!! 前端构建失败：client/dist/index.html 未生成"; exit 1; }

echo "==> 重启服务（找不到进程则新建）"
PM2="$(command -v pm2 || echo /usr/local/bin/pm2)"
"$PM2" restart huanyu --update-env 2>/dev/null || PORT="$PORT" "$PM2" start server/index.js --name huanyu --update-env
"$PM2" save 2>/dev/null || true

echo "==> 更新完成"
