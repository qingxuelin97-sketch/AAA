// 一次性脚本：把架空政治小说《朔月当空 · 平行2026》（含约 23 条局外设定母版）
// 注入【现有】数据库的 demo 账号名下。幂等：同名作品会先删后建，不动其它数据。
//
// 用法（项目根目录）：
//   node server/scripts/add-qiushuoyue-novel.mjs
//   OWNER_ID=3 node server/scripts/add-qiushuoyue-novel.mjs   # 指定归属用户 id（默认 demo）
//
// 设定数据来源：server/seed-data/qiushuoyue-novel.js（服务端与浏览器版共用）。

import db from '../db.js';
import { seedQiushuoyueNovel, QIUSHUOYUE_NOVEL } from '../seed-data/qiushuoyue-novel.js';

const ownerId = process.env.OWNER_ID ? Number(process.env.OWNER_ID)
  : (db.prepare("SELECT id FROM users WHERE username = 'demo'").get()?.id
     || db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id);
if (!ownerId) { console.error('数据库里还没有任何用户，请先注册或灌入演示数据。'); process.exit(1); }

const id = seedQiushuoyueNovel(db, ownerId);
console.log(`✅ 已注入《${QIUSHUOYUE_NOVEL.title}》到用户 #${ownerId} 名下（novel id=${id}，含 ${QIUSHUOYUE_NOVEL.codex.length} 条局外设定，已复刻主线）。`);
