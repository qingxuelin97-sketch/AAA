#!/usr/bin/env bash
# 确保 Node 满足 vite 8 / rolldown 的引擎要求（^20.19.0 || >=22.12.0）。
# 版本过旧或未安装时，从国内镜像下载 Node 22 LTS 到 /opt/node22 并接管
# /usr/local/bin 软链（镜像失败时回退官方源）。
# 由 install.sh / update.sh source；也可单独执行：bash deploy/ensure-node.sh
ensure_node() {
  local NODE_VER="v22.14.0"
  if command -v node >/dev/null 2>&1 && node -e '
    const [a,b]=process.versions.node.split(".").map(Number);
    process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>=23?0:1)' 2>/dev/null; then
    echo "==> Node $(node -v) 满足要求，跳过安装"
    return 0
  fi
  echo "==> 安装 Node ${NODE_VER}（当前 $(node -v 2>/dev/null || echo '未安装') 不满足 vite 8 引擎要求 ^20.19.0 || >=22.12.0）"
  local here; here="$(pwd)"
  cd /opt
  curl -fsSL "https://registry.npmmirror.com/-/binary/node/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.gz" -o node.tar.gz \
    || curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.gz" -o node.tar.gz
  tar -xzf node.tar.gz && rm -f node.tar.gz
  rm -rf /opt/node22 && mv -f "node-${NODE_VER}-linux-x64" /opt/node22
  ln -sf /opt/node22/bin/node /usr/local/bin/node
  ln -sf /opt/node22/bin/npm  /usr/local/bin/npm
  ln -sf /opt/node22/bin/npx  /usr/local/bin/npx
  hash -r 2>/dev/null || true
  cd "$here"
  echo "==> Node 就绪：$(node -v)"
}
ensure_node
