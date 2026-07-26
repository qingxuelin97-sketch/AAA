// S7 边界回归测试：北京日界（签到日历）、北京周界（周报）、会话整理
// mark-only PATCH 语义。跑法：npm run test:server:s7
//
// 为什么单独存在：smoke 只验 200，这里验「值」——时区折算与排序语义
// 一旦回归，界面不会报错，只会安静地把签到记到错误的日子上。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4198;
const DB_PATH = path.join(__dirname, 's7test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const run = (cmd, args, env) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? res() : rej(new Error(cmd + ' exited ' + code))));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqliteUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const cnToday = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);

console.log('· 灌入临时演示数据…');
await run('node', ['server/seed.js'], { DB_PATH });

console.log('· 启动服务端…');
const srv = spawn('node', ['server/index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH }, stdio: 'ignore' });

let ok = true;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* */ } await sleep(250); }
  const tok = (await (await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: '123456' }),
  })).json()).token;
  const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const j = async (p, init) => (await fetch(BASE + p, { headers: H, ...init })).json();
  const me = await j('/auth/me');
  const uid = me.user.id;

  // 第二个连接直写库，构造边界样本（服务端 WAL 模式下跨进程读写安全）
  const db = new Database(DB_PATH);

  /* ── 1. 签到日历：北京日界折算 ── */
  // 取一个稳定的历史日：本月 10 日（避免撞今天/月首的次要分支）。
  const today = cnToday();
  const month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const dayMs = Date.UTC(y, m - 1, 10); // 北京 10 日 00:00 == UTC 09 日 16:00
  const ins = db.prepare(`INSERT INTO transactions (user_id, kind, gold, diamond, memo, created_at)
    VALUES (?, 'checkin', 50, 0, ?, ?)`);
  // 北京 10 日 00:10（UTC 09 日 16:10）与北京 10 日 23:50（UTC 10 日 15:50）→ 同一天
  ins.run(uid, '边界样本A', sqliteUtc(dayMs - 8 * 3600e3 + 10 * 60e3));
  ins.run(uid, '边界样本B', sqliteUtc(dayMs + 16 * 3600e3 - 10 * 60e3));
  // 北京 11 日 00:05（UTC 10 日 16:05）→ 次日
  ins.run(uid, '边界样本C', sqliteUtc(dayMs + 24 * 3600e3 - 8 * 3600e3 + 5 * 60e3));

  const cal = await j(`/economy/checkin/calendar?month=${month}`);
  assert.ok(cal.days.includes(10), `北京 10 日的两笔跨 UTC 日签到都应归入 10 日（got ${JSON.stringify(cal.days)})`);
  assert.ok(cal.days.includes(11), '北京 11 日凌晨（UTC 仍是 10 日）的签到应归入 11 日');
  assert.equal(cal.month, month);
  console.log('  ✅ 日历：UTC 存储跨日样本按北京日正确归桶');

  // 月参数校验与 12 个月钳制
  const bad = await fetch(BASE + '/economy/checkin/calendar?month=2020-01', { headers: H });
  assert.equal(bad.status, 400, '超过 12 个月的查询必须被拒绝');
  const malformed = await fetch(BASE + '/economy/checkin/calendar?month=abcd', { headers: H });
  assert.equal(malformed.status, 400, '非法月份格式必须被拒绝');
  console.log('  ✅ 日历：月份格式与 12 个月钳制生效');

  /* ── 2. 周报：北京周界（周一起始）与逐日归桶 ── */
  const w0 = await j('/me/weekly');
  const ws = new Date(w0.week_start + 'T00:00:00Z');
  assert.equal((ws.getUTCDay() + 6) % 7, 0, `week_start 必须是周一（got ${w0.week_start}）`);
  assert.equal(w0.days.length, 7, '周报必须恰好 7 天');
  assert.ok(w0.days.every((d) => typeof d.n === 'number'), '每天都要有数值（未来天为 0）');

  const convId = (await j('/chat/conversations')).conversations?.[0]?.id;
  assert.ok(convId, '演示账号必须有会话');
  const weekStartMs = Date.parse(w0.week_start + 'T00:00:00Z');
  const insMsg = db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)');
  // 本周一北京 00:05（UTC 周日 16:05）→ 计入本周第一天
  insMsg.run(convId, 'user', '周界内样本', sqliteUtc(weekStartMs - 8 * 3600e3 + 5 * 60e3));
  // 上周日北京 23:55（UTC 上周日 15:55）→ 不计入本周
  insMsg.run(convId, 'user', '周界外样本', sqliteUtc(weekStartMs - 8 * 3600e3 - 5 * 60e3));

  const w1 = await j('/me/weekly');
  assert.equal(w1.messages, w0.messages + 1, '恰好一条边界内消息应计入本周');
  assert.equal(w1.days[0].n, w0.days[0].n + 1, '周一凌晨（UTC 仍是周日）的消息应归入周一');
  console.log('  ✅ 周报：周一起始 + 北京周界归桶正确');

  /* ── 3. 会话整理：mark-only PATCH 不 bump updated_at；置顶列表先行 ── */
  const before = db.prepare('SELECT updated_at FROM conversations WHERE id = ?').get(convId).updated_at;
  await j(`/chat/conversations/${convId}`, { method: 'PATCH', body: JSON.stringify({ pinned: 1, muted: 1 }) });
  const afterMark = db.prepare('SELECT updated_at, pinned, muted FROM conversations WHERE id = ?').get(convId);
  assert.equal(afterMark.pinned, 1);
  assert.equal(afterMark.muted, 1);
  assert.equal(afterMark.updated_at, before, '置顶/免打扰不得改变会话排序时间戳');

  const list = await j('/chat/conversations');
  assert.equal(list.conversations[0].id, convId, '置顶会话必须排在列表首位');

  await j(`/chat/conversations/${convId}`, { method: 'PATCH', body: JSON.stringify({ title: '改名会 bump' }) });
  const afterTitle = db.prepare('SELECT updated_at FROM conversations WHERE id = ?').get(convId).updated_at;
  assert.notEqual(afterTitle, before, '改名等实质编辑仍应刷新排序时间戳');
  console.log('  ✅ 会话整理：mark-only 语义与置顶排序正确');

  /* ── 4. 经济与成就语义：410 旧口 / 荣誉拒领 / 兴趣白名单钳制 ── */
  const gone = await fetch(BASE + '/economy/recharge', { method: 'POST', headers: H, body: JSON.stringify({ amount: 100 }) });
  assert.equal(gone.status, 410, '旧充值接口必须返回 410');
  assert.equal((await gone.json()).code, 'PAYMENT_ORDER_REQUIRED', '410 必须携带稳定的语义码');

  const honor = await fetch(BASE + '/achievements/creator_hall/claim', { method: 'POST', headers: H });
  assert.equal(honor.status, 400, '荣誉成就的领取请求必须被拒绝');

  const cats = (await j('/meta/categories')).categories.map((c) => c.slug);
  const mixed = [...cats.slice(0, 7), 'not_a_slug', '__evil__', cats[0]].join(',');
  await j('/settings', { method: 'PUT', body: JSON.stringify({ interests: mixed }) });
  const savedInterests = String((await j('/settings')).settings?.interests
    ?? (await j('/settings')).interests ?? '').split(',').filter(Boolean);
  assert.ok(savedInterests.length <= 6, `兴趣至多 6 个（got ${savedInterests.length}）`);
  assert.ok(savedInterests.every((slug) => cats.includes(slug)), `兴趣必须全部落在分类白名单内（got ${savedInterests.join(',')}）`);
  assert.equal(new Set(savedInterests).size, savedInterests.length, '兴趣必须去重');
  console.log('  ✅ 语义：旧充值 410 / 荣誉拒领 / 兴趣白名单去重钳 6');

  /* ── 5. 排行榜我的名次：声望公式一致 + 排位单调 ── */
  const lb = await j('/engage/leaderboard');
  assert.ok(lb.me && lb.me.rank >= 1, '登录请求必须附带我的排位');
  const myLikes = db.prepare(`SELECT
      (SELECT COALESCE(SUM(likes),0) FROM characters WHERE owner_id=?) +
      (SELECT COALESCE(SUM(likes),0) FROM scripts WHERE author_id=? AND deleted_at IS NULL) AS s`)
    .get(uid, uid).s || 0;
  assert.equal(lb.me.score, myLikes, '排位声望必须等于角色+剧本获赞和');
  // 给自己的角色加一批赞后排位不应变差
  db.prepare('UPDATE characters SET likes = likes + 1000 WHERE owner_id = ?').run(uid);
  const lb2 = await j('/engage/leaderboard');
  assert.ok(lb2.me.rank <= lb.me.rank, `加赞后排位不得下降（${lb.me.rank} → ${lb2.me.rank}）`);
  assert.ok(lb2.me.score > lb.me.score, '加赞后声望必须上升');
  console.log('  ✅ 名次：声望公式一致 + 排位单调');

  /* ── 6. 周报未来天恒 0（北京周界；今天是周日则该组自然为空） ── */
  const wNow = await j('/me/weekly');
  const cnDow = (new Date(cnToday() + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0=周一
  const futureDays = wNow.days.slice(cnDow + 1);
  assert.ok(futureDays.every((d) => d.n === 0), `未来天必须为 0（got ${JSON.stringify(futureDays)})`);
  console.log('  ✅ 周报：未来天恒 0');

  /* ── 7. 列表排序端到端（API 层）：置顶旧会话在新会话出现后仍居首 ── */
  const pubChars = (await j('/characters/public')).characters;
  const convsNow = (await j('/chat/conversations')).conversations;
  const usedChars = new Set(convsNow.map((c) => c.character_id));
  const freshChar = pubChars.find((c) => !usedChars.has(c.id));
  assert.ok(freshChar, '需要一个未开聊的公开角色');
  const made = await j('/chat/conversations', { method: 'POST', body: JSON.stringify({ character_id: freshChar.id }) });
  assert.ok(made.conversation?.id, '新会话创建失败');
  const ordered = (await j('/chat/conversations')).conversations;
  assert.equal(ordered[0].id, convId, '置顶会话必须压住 updated_at 更新的新会话');
  assert.equal(ordered[0].pinned, 1, '首位必须是置顶态');
  console.log('  ✅ 排序：置顶权重高于新鲜度（API 层端到端）');

  db.close();
  console.log('\n✅ S7 边界回归：全部通过');
} catch (e) {
  ok = false;
  console.error('\n❌ S7 边界回归失败：', e.message);
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
process.exit(ok ? 0 : 1);
