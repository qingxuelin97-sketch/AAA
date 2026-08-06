// 收件箱专项（毛坯修缮②）：推送给玩家 → 通知到达 → 收件箱列出（带 unseen）
// → seen 清零。含 character_id 入口（无广场卡片时就地物化 post）与防探针。
// 运行：npm run test:inbox
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4197;
const DB_PATH = path.join(ROOT, 'server', 'inbox-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const interceptor = path.join(__dirname, 'inbox-test.interceptor.mjs');
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
const get = (p, tok) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + tok } });
const post = (p, body, tok) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
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
  console.log('收件箱专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'inbox fixture')").run());
  const a = await register('inboxSenderA', 'inbox-a@test.dev');
  const b = await register('inboxTargetB', 'inbox-b@test.dev');

  // A 的公开角色（仅 is_public，未发布过广场卡片）与私密角色
  const mk = async (name, is_public) =>
    (await J(await post('/characters', { name, is_public, greeting: '你好', category: 'fantasy' }, a.token))).character.id;
  const cPub = await mk('推送样卡·灯塔看守', true);
  const cPriv = await mk('推送样卡·私密', false);

  // 1) A 推送给 B（character_id 入口，就地物化广场卡片）
  const p1 = await J(await post('/community/push', { character_id: cPub, to_username: 'inboxTargetB', note: '超对你胃口' }, a.token));
  ok(p1.ok === true, '按 character_id 推送成功（就地物化卡片 post）');
  const postRow = dbRead((d) => d.prepare('SELECT * FROM posts WHERE character_id = ?').get(cPub));
  ok(postRow && postRow.author_id === a.user.id && postRow.type === 'card', '物化 post 归属角色作者、类型 card');

  // 2) B 收到通知（文案带推送者与卡名）
  const noti = dbRead((d) => d.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC').all(b.user.id));
  ok(noti.some((n) => n.text.includes('inboxSenderA') && n.text.includes('灯塔看守') && n.link === '/messages'), '推送触达通知（含来源与卡名，链接指向消息页）');

  // 3) B 收件箱列出，unseen=1，行带 character_id 供跳转
  const ib = await J(await get('/community/inbox', b.token));
  ok(ib.unseen === 1 && ib.shares.length === 1, `收件箱 1 条未读（unseen=${ib.unseen}）`);
  ok(ib.shares[0].character_id === cPub && ib.shares[0].from_name === 'inboxSenderA' && ib.shares[0].note === '超对你胃口', '行含 character_id/from_name/note');

  // 4) seen 清零
  await post('/community/inbox/seen', {}, b.token);
  const ib2 = await J(await get('/community/inbox', b.token));
  ok(ib2.unseen === 0 && ib2.shares[0].seen === 1, 'seen 后 unseen 清零');

  // 5) 再推同一角色：复用已物化的 post，不重复建卡
  await post('/community/push', { character_id: cPub, to_username: 'inboxTargetB' }, a.token);
  ok(dbRead((d) => d.prepare('SELECT COUNT(*) n FROM posts WHERE character_id = ?').get(cPub).n) === 1, '重复推送复用同一张卡片 post');

  // 6) 防探针与目标校验
  const badUser = await post('/community/push', { character_id: cPub, to_username: '不存在的人' }, a.token);
  ok(badUser.status === 404, `目标用户不存在 404（${badUser.status}）`);
  const badChar = await post('/community/push', { character_id: cPriv, to_username: 'inboxTargetB' }, b.token);
  ok(badChar.status === 404, `他人私密角色推送 404（${badChar.status}）`);

  // 7) 剧本推送（修缮⑬）：script_id 入口物化 type='script' 卡片，行带 script_id 供跳转
  const scriptId = dbWrite((d) => Number(d.prepare(
    'INSERT INTO scripts (author_id, title, summary, content, category, tags, price_gold) VALUES (?,?,?,?,?,?,0)'
  ).run(a.user.id, '雾港谜案·推送样本', '悬疑短剧', '【开场】……', 'mystery', '悬疑').lastInsertRowid));
  const ps = await J(await post('/community/push', { script_id: scriptId, to_username: 'inboxTargetB', note: '这本超好玩' }, a.token));
  ok(ps.ok === true, '按 script_id 推送成功（就地物化剧本卡）');
  const spost = dbRead((d) => d.prepare('SELECT * FROM posts WHERE script_id = ?').get(scriptId));
  ok(spost && spost.type === 'script' && spost.author_id === a.user.id, '物化 post 类型 script、归属剧本作者');
  const ib3 = await J(await get('/community/inbox', b.token));
  const srow = ib3.shares.find((x) => x.script_id === scriptId);
  ok(srow && srow.type === 'script' && srow.title === '雾港谜案·推送样本', '收件箱行带 script_id/type 供跳转');
  await post('/community/push', { script_id: scriptId, to_username: 'inboxTargetB' }, a.token);
  ok(dbRead((d) => d.prepare('SELECT COUNT(*) n FROM posts WHERE script_id = ?').get(scriptId).n) === 1, '重复推送复用同一张剧本 post');
  const badScript = await post('/community/push', { script_id: 99999, to_username: 'inboxTargetB' }, a.token);
  ok(badScript.status === 404, `不存在剧本推送 404（${badScript.status}）`);
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n收件箱专项: ${pass} passed, ${fail} failed`);
srv.kill();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
