# 幻域 — 全栈单服务镜像（Express API + SQLite + 已构建前端）
# vite 8 / rolldown 引擎要求 ^20.19.0 || >=22.12.0，用 22 LTS
FROM node:22-bookworm-slim

# better-sqlite3 native build deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the server-mode client (real API, not the static mock)
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Listen on 80 by default (matches 微信云托管 default port). Hosts that inject their
# own PORT env (e.g. Render) override this automatically at runtime.
ENV PORT=80
# Optional: point at a mounted volume for a persistent database
# ENV DB_PATH=/data/data.sqlite
EXPOSE 80

# Seed demo data ONLY when the database has no users yet (seed.js is destructive),
# then start the server. Subsequent restarts keep existing data.
CMD node -e "import('better-sqlite3').then(({default:D})=>{const f=process.env.DB_PATH||'server/data.sqlite';try{const d=new D(f);const n=d.prepare('SELECT COUNT(*) n FROM users').get().n;if(n>0){console.log('DB has',n,'users — skip seed');process.exit(0)}}catch{}process.exit(7)})" \
  ; if [ $? -eq 7 ]; then echo 'seeding demo data...'; node server/seed.js; fi \
  ; node server/index.js
