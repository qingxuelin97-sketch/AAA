// 礼物金币消耗口专项测试：
//   扣款+RP消息+好感同事务 / 余额不足整体回滚 / 好感走共享日配额（打满后
//   礼物照送好感+0）/ 流水 kind=gift 带 ref_owner 且 share_eligible=0（不入分成）。
// 运行：npm run test:gift
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4196;
const DB_PATH = path.join(ROOT, 'server', 'gift-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const interceptor = path.join(__dirname, 'gift-test.interceptor.mjs');
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
  console.log('礼物消耗口专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'gift fixture')").run());
  const a = await register('giftUserA', 'gift-a@test.dev');
  const b = await register('giftUserB', 'gift-b@test.dev');
  const uid = a.user.id;

  // 角色属于他人（B 的公开角色）：ref_owner 归因才会落库（自送自的归因会被
  // wallet.js 置空——消费者即作者时不记录，防自刷）。
  const ch = await J(await post('/characters', { name: '受礼角色', is_public: 1 }, b.token));
  const chId = ch.character?.id || ch.id;
  const cv = await J(await post('/chat/conversations', { character_id: chId }, a.token));
  const cvId = cv.conversation.id;

  const st = (q) => dbRead((d) => d.prepare(q).get(uid));
  const gold0 = st('SELECT gold FROM users WHERE id = ?').gold;
  const msgs0 = dbRead((d) => d.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id = ?').get(cvId).n);

  // 1) 正常送礼：扣款 + RP 消息 + 好感一次到位
  const g1 = await J(await post(`/chat/conversations/${cvId}/gift`, { gift_id: 'rose' }, a.token));
  ok(g1.message?.content?.includes('一枝红玫瑰'), 'RP 消息落库并返回');
  ok(dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold) === gold0 - 20, '扣款 20 金币');
  ok(g1.affinity?.granted === 2 && dbRead((d) => d.prepare('SELECT affinity FROM conversations WHERE id = ?').get(cvId).affinity) === 2, '好感 +2 落库');
  const tx1 = dbRead((d) => d.prepare("SELECT * FROM transactions WHERE user_id = ? AND kind = 'gift'").all(uid));
  ok(tx1.length === 1 && tx1[0].ref_owner === b.user.id && tx1[0].share_eligible === 0, '流水 kind=gift 带 ref_owner 且 share_eligible=0（内测不入分成）');

  // 2) 余额不足：整体回滚——无消息、无好感、无流水
  const before = {
    gold: dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold),
    aff: dbRead((d) => d.prepare('SELECT affinity FROM conversations WHERE id = ?').get(cvId).affinity),
    msgs: dbRead((d) => d.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id = ?').get(cvId).n),
  };
  const poor = await post(`/chat/conversations/${cvId}/gift`, { gift_id: 'mystery' }, a.token);
  ok(poor.status === 400, `余额不足返回 400（${poor.status}）`);
  const after = {
    gold: dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold),
    aff: dbRead((d) => d.prepare('SELECT affinity FROM conversations WHERE id = ?').get(cvId).affinity),
    msgs: dbRead((d) => d.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id = ?').get(cvId).n),
  };
  ok(after.gold === before.gold && after.aff === before.aff && after.msgs === before.msgs, '失败整体回滚：余额/好感/消息全都不变');

  // 3) 非法礼物 id → 400
  const badId = await post(`/chat/conversations/${cvId}/gift`, { gift_id: 'nope' }, a.token);
  ok(badId.status === 400, '非法礼物 id 拒绝');

  // 4) 好感日配额共享：打满 40 后礼物照送、好感 +0
  dbWrite((d) => d.prepare('UPDATE users SET gold = 100000 WHERE id = ?').run(uid));
  let lastGranted = -1;
  for (let i = 0; i < 6; i++) {
    const r = await J(await post(`/chat/conversations/${cvId}/gift`, { gift_id: 'bear' }, a.token));
    lastGranted = r.affinity?.granted;
  }
  const affFinal = dbRead((d) => d.prepare('SELECT affinity FROM conversations WHERE id = ?').get(cvId).affinity);
  ok(affFinal === 40, `好感封顶在日配额 40（当前 ${affFinal}）`);
  ok(lastGranted === 0, '配额打满后 granted=0（礼物照送好感不涨）');
  const goldAfterCap = dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
  ok(goldAfterCap === 100000 - 6 * 100, '配额打满不影响扣款（6 件玩偶各 100 金）');
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n礼物消耗口专项: ${pass} passed, ${fail} failed`);
srv.kill();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
