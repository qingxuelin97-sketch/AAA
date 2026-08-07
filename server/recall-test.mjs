// 三回流专项（修缮⑩⑪⑫）：浏览历史 / 消息书签 / 阅读进度从 localStorage
// 回流服务端。运行：npm run test:recall
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4199;
const DB_PATH = path.join(ROOT, 'server', 'recall-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const interceptor = path.join(__dirname, 'recall-test.interceptor.mjs');
fs.writeFileSync(interceptor, `
import nodemailer from 'nodemailer';
const realCreate = nodemailer.createTransport.bind(nodemailer);
nodemailer.createTransport = function(opts, defaults) {
  const tp = realCreate(opts, defaults);
  tp.sendMail = async () => ({ messageId: 'mock-' + Date.now() });
  tp.verify = async () => true;
  return tp;
};
`);

const srv = spawn(process.execPath, ['--import', pathToFileURL(interceptor).href, 'server/index.js'], {
  cwd: ROOT, env: {
    ...process.env, NODE_ENV: 'test', TEST_EXPOSE_EMAIL_CODES: '1',
    PORT: String(PORT), DB_PATH,
    API_ANON_RATE_LIMIT: '120', API_AUTH_RATE_LIMIT: '1000',
    SMTP_HOST: 'smtp.mock.com', SMTP_PORT: '465', SMTP_SECURE: '1',
    SMTP_USER: 'u@mock.com', SMTP_PASS: 'p', SMTP_FROM: '"T" <u@mock.com>',
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
srv.stdout.on('data', (c) => { serverOutput = (serverOutput + c).slice(-8000); });
srv.stderr.on('data', (c) => { serverOutput = (serverOutput + c).slice(-8000); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const J = (r) => r.json();
const get = (p, tok) => fetch(BASE + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
const post = (p, body, tok) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
const put = (p, body, tok) => fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
const dbRead = (fn) => { const d = new Database(DB_PATH, { readonly: true }); try { return fn(d); } finally { d.close(); } };
const dbWrite = (fn) => { const d = new Database(DB_PATH); try { return fn(d); } finally { d.close(); } };

const register = async (username, email) => {
  const sc = await J(await post('/auth/send-code', { email }));
  const r = await J(await post('/auth/register', { username, password: 'Passw0rd!', email, code: sc.test_code }));
  if (!r.token) throw new Error('注册失败：' + JSON.stringify(r));
  return r;
};

for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + '/engage/events'); if (r.ok) break; } catch { /* */ }
  await new Promise((r) => setTimeout(r, 300));
  if (i === 59) { console.error('服务端未启动：', serverOutput); process.exit(1); }
}

try {
  console.log('三回流专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'recall fixture')").run());
  const a = await register('recallA', 'recall-a@test.dev');
  const b = await register('recallB', 'recall-b@test.dev');

  // ---------- ⑩ 浏览历史 ----------
  const mkChar = async (name, is_public = true) =>
    (await J(await post('/characters', { name, category: 'fantasy', is_public, greeting: '你好' }, b.token))).character.id;
  const c1 = await mkChar('回流·晨星');
  const c2 = await mkChar('回流·暮雨');
  await post('/engage/view', { type: 'character', id: c1 }, a.token);
  await new Promise((r) => setTimeout(r, 1100)); // viewed_at 秒级精度，隔开保证排序
  await post('/engage/view', { type: 'character', id: c2 }, a.token);
  const rec1 = await J(await get('/engage/recent', a.token));
  ok(rec1.characters?.length === 2 && rec1.characters[0].id === c2, `recent 倒序返回（最新在前：${rec1.characters?.[0]?.name}）`);
  await new Promise((r) => setTimeout(r, 1100));
  await post('/engage/view', { type: 'character', id: c1 }, a.token); // 重看 c1 → 刷到最前
  const rec2 = await J(await get('/engage/recent', a.token));
  ok(rec2.characters?.length === 2 && rec2.characters[0].id === c1, '重看同一角色 upsert 刷新到最前（不重复落行）');
  ok(rec2.characters[0].owner_name === 'recallB' && 'featured' in rec2.characters[0], '行字段对齐本地缓存结构（owner_name/featured）');
  const anonViews = dbRead((d) => d.prepare('SELECT COUNT(*) n FROM character_views').get().n);
  const anonTry = await post('/engage/view', { type: 'character', id: c1 }, null);
  ok(anonTry.status === 401 && dbRead((d) => d.prepare('SELECT COUNT(*) n FROM character_views').get().n) === anonViews, '匿名请求不落历史行');

  // ---------- ⑪ 消息书签 ----------
  const conv = (await J(await post('/chat/conversations', { character_id: c1 }, a.token))).conversation;
  const msgs = dbWrite((d) => {
    const ins = d.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)");
    return [Number(ins.run(conv.id, 'assistant', '第一段').lastInsertRowid), Number(ins.run(conv.id, 'user', '第二段').lastInsertRowid)];
  });
  const bm1 = await J(await post(`/chat/conversations/${conv.id}/messages/${msgs[0]}/bookmark`, {}, a.token));
  ok(bm1.bookmarked === true, '书签 toggle 开');
  const convRead = await J(await get(`/chat/conversations/${conv.id}`, a.token));
  ok(convRead.messages?.find((m) => m.id === msgs[0])?.bookmarked === 1, '消息行随读回带 bookmarked 字段');
  const bm2 = await J(await post(`/chat/conversations/${conv.id}/messages/${msgs[0]}/bookmark`, {}, a.token));
  ok(bm2.bookmarked === false, '书签 toggle 关');
  const alien = await post(`/chat/conversations/${conv.id}/messages/${msgs[1]}/bookmark`, {}, b.token);
  ok(alien.status === 403 || alien.status === 404, `他人会话书签被拒（${alien.status}）`);

  // ---------- ⑫ 阅读进度 ----------
  // novel：B 建作品并发布
  const novel = (await J(await post('/novels', { title: '回流之书', logline: '测试' }, b.token))).novel;
  dbWrite((d) => {
    const run = d.prepare("INSERT INTO novel_runs (novel_id, owner_id, name, words) VALUES (?,?,?,0)").run(novel.id, b.user.id, '主线');
    d.prepare("INSERT INTO novel_beats (run_id, seq, content) VALUES (?,1,'开篇……')").run(run.lastInsertRowid);
    d.prepare('UPDATE novels SET published = 1, published_run_id = ? WHERE id = ?').run(run.lastInsertRowid, novel.id);
  });
  const pw = await J(await put(`/novels/${novel.id}/progress`, { ratio: 0.42 }, a.token));
  ok(pw.ok === true && pw.ratio === 0.42, '小说进度写入');
  const readBack = await J(await get(`/novels/${novel.id}/read`, a.token));
  ok(readBack.progress?.ratio === 0.42, '读回 read 响应附 progress');
  const clamp = await J(await put(`/novels/${novel.id}/progress`, { ratio: 7 }, a.token));
  ok(clamp.ratio === 1, 'ratio 钳制到 [0,1]');
  // theater：B 建公开剧场，A 可写进度；私有剧场外人 403
  const th = (await J(await post('/theater', { name: '回流剧场', is_public: true, cast: [c1] }, b.token))).theater;
  const tw = await J(await put(`/theater/${th.id}/progress`, { ratio: 0.6 }, a.token));
  ok(tw.ok === true, '剧场进度写入（公开可读者）');
  const thDetail = await J(await get(`/theater/${th.id}`, a.token));
  ok(thDetail.progress?.ratio === 0.6, '剧场详情附 progress');
  const thPriv = (await J(await post('/theater', { name: '私有剧场', is_public: false, cast: [c1] }, b.token))).theater;
  const twBad = await put(`/theater/${thPriv.id}/progress`, { ratio: 0.5 }, a.token);
  ok(twBad.status === 403, `私有剧场外人进度 403（${twBad.status}）`);
  // kind 命名空间：novel 与 theater 同 ref_id 不串
  const rows = dbRead((d) => d.prepare('SELECT kind, ref_id, ratio FROM reading_progress WHERE user_id = ? ORDER BY kind').all(a.user.id));
  ok(rows.length === 2 && new Set(rows.map((r) => r.kind)).size === 2, 'novel/theater 两条进度各自独立（kind 命名空间）');

  // ---------- ⑮ Admin 举报处置（resolve 扩 action:'delete'） ----------
  dbWrite((d) => d.prepare('UPDATE users SET is_gm = 1 WHERE id = ?').run(a.user.id));
  const momentId = dbWrite((d) => Number(d.prepare("INSERT INTO moments (user_id, text) VALUES (?, '违规样本动态')").run(b.user.id).lastInsertRowid));
  const repId = dbWrite((d) => Number(d.prepare("INSERT INTO reports (target_type, target_id, reporter_id, reason) VALUES ('moment', ?, ?, '不当内容')").run(momentId, a.user.id).lastInsertRowid));
  const rr = await J(await post(`/admin/reports/${repId}/resolve`, { action: 'delete' }, a.token));
  ok(rr.ok === true, '举报 delete-resolve 一次往返');
  ok(dbRead((d) => d.prepare('SELECT COUNT(*) n FROM moments WHERE id = ?').get(momentId).n) === 0, '违规动态已删除');
  ok(dbRead((d) => d.prepare("SELECT status FROM reports WHERE id = ?").get(repId).status) === 'resolved', '举报同步结案');
  ok(dbRead((d) => d.prepare("SELECT COUNT(*) n FROM logs WHERE category = 'admin' AND event = 'moment_delete'").get().n) >= 1, '处置留痕（audit 落 logs）');
  const repUser = dbWrite((d) => Number(d.prepare("INSERT INTO reports (target_type, target_id, reporter_id, reason) VALUES ('user', ?, ?, '骚扰')").run(b.user.id, a.user.id).lastInsertRowid));
  const ru = await post(`/admin/reports/${repUser}/resolve`, { action: 'delete' }, a.token);
  ok(ru.status === 400, `user 类型不支持 delete 处置 400（${ru.status}）`);
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n三回流专项: ${pass} passed, ${fail} failed`);
srv.kill();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
