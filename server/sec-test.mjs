// 安全加固专项测试：注册 IP 日配额 / 邮箱别名去重 / 新号购买冷静期 / 匿名限流分档。
// 运行：npm run test:sec
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4198;
const DB_PATH = path.join(ROOT, 'server', 'sec-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 邮件拦截 preload（与 reg-flow 相同机制，独立生成避免顺序依赖）
const interceptor = path.join(__dirname, 'sec-test.interceptor.mjs');
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

const srv = spawn('node', ['--import', interceptor, 'server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH, MAIL_CODE_IP_LIMIT: '50' }, stdio: 'ignore',
});
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const J = (r) => r.json();
const post = (p, body, tok) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });

// 服务端从邮件拦截器读不到 —— 但验证码写库了；直接读临时库拿 code（测试环境专用）。
import Database from 'better-sqlite3';
const codeOf = (email) => {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT code FROM email_codes WHERE email = ? AND consumed = 0 ORDER BY id DESC LIMIT 1').get(email);
  db.close();
  return row?.code;
};

const register = async (username, email) => {
  const sc = await post('/auth/send-code', { email });
  if (!sc.ok) return { status: sc.status, ...(await J(sc)) };
  const code = codeOf(email.toLowerCase());
  const r = await post('/auth/register', { username, password: 'Passw0rd!', email, code });
  return { status: r.status, ...(await J(r)) };
};

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* */ } await sleep(250); }

  // GM 用户 + SMTP 配置（mock 拦截后任意配置可用）—— 同 reg-flow 的做法
  {
    const db = new Database(DB_PATH);
    const bcrypt = (await import('bcryptjs')).default;
    db.prepare('INSERT INTO users (username, password_hash, display_name, is_gm) VALUES (?,?,?,1)')
      .run('gm', bcrypt.hashSync('123456', 10), 'GM');
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(db.prepare("SELECT id FROM users WHERE username='gm'").get().id);
    db.close();
  }
  const gmTok = (await J(await post('/auth/login', { username: 'gm', password: '123456' }))).token;
  await fetch(BASE + '/admin/mail', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gmTok }, body: JSON.stringify({ host: 'smtp.mock.com', port: 465, secure: true, user: 'u@mock.com', pass: 'p', from: '"T" <u@mock.com>' }) });

  // 1) 同 IP 连注 3 个成功，第 4 个 429
  const r1 = await register('sec_u1', 'sec1@test.dev');
  const r2 = await register('sec_u2', 'sec2@test.dev');
  const r3 = await register('sec_u3', 'sec3@test.dev');
  ok(r1.token && r2.token && r3.token, `同 IP 前 3 个注册成功 (${r1.status}/${r2.status}/${r3.status})`);
  const r4 = await register('sec_u4', 'sec4@test.dev');
  ok(r4.status === 429, `同 IP 第 4 个注册被日配额拦截 → ${r4.status} ${r4.error || ''}`);

  // 2) 邮箱别名去重：sec1+alt@test.dev 与 sec1@test.dev 同规范形 → 409（send-code 即拦）
  const alias = await post('/auth/send-code', { email: 'sec1+alt@test.dev' });
  const aliasBody = await J(alias);
  ok(alias.status === 409, `别名邮箱 send-code 被拦 → ${alias.status} ${aliasBody.error || ''}`);

  // 3) 新号 24h 内禁止购买付费剧本：u1 发布付费剧本，u2（刚注册）购买 → 403
  const pub = await post('/scripts', { title: '防刷测试剧本', summary: 't', content: '正文', price_gold: 100 }, r1.token);
  const pubBody = await J(pub);
  const sid = pubBody.script?.id || pubBody.id;
  ok(pub.ok && sid, `发布付费剧本 → ${pub.status} id=${sid}`);
  const buy = await post(`/scripts/${sid}/buy`, {}, r2.token);
  const buyBody = await J(buy);
  ok(buy.status === 403, `新号购买付费剧本被冷静期拦截 → ${buy.status} ${buyBody.error || ''}`);
  // 账龄改到 25h 前 → 可以买（策略只拦新号）
  {
    const db = new Database(DB_PATH);
    db.prepare("UPDATE users SET created_at = datetime('now', '-25 hours') WHERE username = 'sec_u2'").run();
    db.close();
  }
  const buy2 = await post(`/scripts/${sid}/buy`, {}, r2.token);
  ok(buy2.ok, `满 24h 账号购买放行 → ${buy2.status}`);

  // 4) 匿名限流分档：60/min。快速打 70 发匿名请求，出现 429；带合法 token 同量不拦。
  let anon429 = 0;
  for (let i = 0; i < 70; i++) { const r = await fetch(BASE + '/economy/packages'); if (r.status === 429) anon429++; }
  ok(anon429 > 0, `匿名请求超 60/min 触发限流（429 × ${anon429}）`);
  let auth429 = 0;
  for (let i = 0; i < 70; i++) { const r = await fetch(BASE + '/economy/packages', { headers: { Authorization: 'Bearer ' + r1.token } }); if (r.status === 429) auth429++; }
  ok(auth429 === 0, `登录用户同量请求不受匿名档限制（429 × ${auth429}）`);
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
console.log(`\n安全加固专项: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
