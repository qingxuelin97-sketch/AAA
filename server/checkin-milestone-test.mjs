// 连签里程碑专项测试：7/30/100 天 +100/500/2000 与签到同事务、kind=milestone
// 区分日常 checkin、重放（同日再签）不重发、VIP 翻倍不作用于里程碑。
// 运行：npm run test:milestone
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4194;
const DB_PATH = path.join(ROOT, 'server', 'checkin-milestone-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const interceptor = path.join(__dirname, 'checkin-milestone-test.interceptor.mjs');
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
const cnYesterday = () => new Date(Date.now() - 86400000 + 8 * 3600e3).toISOString().slice(0, 10);

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
  console.log('连签里程碑专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'milestone fixture')").run());
  const a = await register('milestoneA', 'milestone-a@test.dev');
  const uid = a.user.id;
  const txKinds = () => dbRead((d) => d.prepare('SELECT kind, gold FROM transactions WHERE user_id = ? ORDER BY id').all(uid));

  // 普通签到（第 1 天）：无里程碑
  const c1 = await J(await post('/economy/checkin', {}, a.token));
  ok(c1.streak === 1 && c1.milestone === 0, `第 1 天签到无里程碑（streak=${c1.streak}）`);

  // 第 7 天：+100，kind=milestone 独立成行
  dbWrite((d) => d.prepare('UPDATE users SET last_checkin = ?, checkin_streak = 6 WHERE id = ?').run(cnYesterday(), uid));
  const gold7Before = dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
  const c7 = await J(await post('/economy/checkin', {}, a.token));
  ok(c7.streak === 7 && c7.milestone === 100, `第 7 天里程碑 +100（milestone=${c7.milestone}）`);
  const goldAfter7 = dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
  ok(goldAfter7 === gold7Before + c7.reward + 100, '签到奖 + 里程碑同事务一并到账');
  const ms = txKinds().filter((t) => t.kind === 'milestone');
  ok(ms.length === 1 && ms[0].gold === 100, '账本 kind=milestone 与日常 checkin 区分');

  // 同日重放：409，不重发
  const replay = await post('/economy/checkin', {}, a.token);
  ok(replay.status === 409 && txKinds().filter((t) => t.kind === 'milestone').length === 1, '同日重放 409，里程碑不重发');

  // 第 30 天 + VIP：日常奖翻倍、里程碑 500 不翻倍
  dbWrite((d) => d.prepare("UPDATE users SET last_checkin = ?, checkin_streak = 29, vip_until = datetime('now', '+30 days') WHERE id = ?").run(cnYesterday(), uid));
  const c30r = await post('/economy/checkin', {}, a.token); const c30 = await J(c30r); if (!c30r.ok) console.log('  [debug] c30 status', c30r.status, JSON.stringify(c30));
  ok(c30.streak === 30 && c30.milestone === 500, `第 30 天里程碑 +500（milestone=${c30.milestone}）`);
  ok([100, 200, 400].includes(c30.reward), `VIP 日常签到奖翻倍生效（reward=${c30.reward}）`);
  const m30 = txKinds().filter((t) => t.kind === 'milestone');
  ok(m30.length === 2 && m30[1].gold === 500, 'VIP 不改变里程碑金额（+500 原样）');

  // 第 100 天：+2000
  dbWrite((d) => d.prepare('UPDATE users SET last_checkin = ?, checkin_streak = 99 WHERE id = ?').run(cnYesterday(), uid));
  const c100 = await J(await post('/economy/checkin', {}, a.token));
  ok(c100.streak === 100 && c100.milestone === 2000, `第 100 天里程碑 +2000（milestone=${c100.milestone}）`);

  // 成就阈值联动：checkin_30 / checkin_100 已解锁可领
  const ach = await J(await fetch(BASE + '/achievements', { headers: { Authorization: 'Bearer ' + a.token } }));
  const a30 = ach.achievements.find((x) => x.id === 'checkin_30');
  const a100 = ach.achievements.find((x) => x.id === 'checkin_100');
  ok(a30?.unlocked && a100?.unlocked, '成就 checkin_30 / checkin_100 随连签解锁');
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n连签里程碑专项: ${pass} passed, ${fail} failed`);
srv.kill();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
