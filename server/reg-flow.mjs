// 邮箱验证码注册 + 白名单政策的 HTTP 端到端测试。
// 起一个临时 DB 的服务端，mock 邮件发送（拦截 nodemailer.createTransport），跑完整注册流程。
//   运行：npm run reg-flow
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4197;
const DB_PATH = path.join(__dirname, 'reg-flow.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 注入一个 preload 脚本，monkey-patch nodemailer.createTransport，
// 拦截 sendMail 不真的联网发信；verify 直接返回 true。
const interceptor = path.join(__dirname, 'reg-flow.interceptor.mjs');
fs.writeFileSync(interceptor, `
import nodemailer from 'nodemailer';
const realCreate = nodemailer.createTransport.bind(nodemailer);
nodemailer.createTransport = function(opts, defaults) {
  const tp = realCreate(opts, defaults);
  tp.sendMail = async (mail) => {
    const code = (mail.subject || '').match(/\\d{6}/)?.[0] || (mail.text || '').match(/\\d{6}/)?.[0] || '000000';
    (globalThis.__MAIL_CODES__ ||= {})[mail.to] = code;
    return { messageId: 'mock-' + Date.now() };
  };
  tp.verify = async () => true;
  return tp;
};
`);

const srv = spawn('node', ['--import', interceptor, 'server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH, MAIL_CODE_IP_LIMIT: '50' },
  stdio: 'ignore',
});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* */ } await sleep(250); }

  // DB 为空，直接用 SQL 写入一个 GM 用户用于后台管理。
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(DB_PATH);
  const bcrypt = (await import('bcryptjs')).default;
  db.prepare('INSERT INTO users (username, password_hash, display_name, is_gm) VALUES (?,?,?,1)')
    .run('gm', bcrypt.hashSync('123456', 10), 'GM');
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(db.prepare("SELECT id FROM users WHERE username='gm'").get().id);
  db.close();

  const gmLogin = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gm', password: '123456' }) });
  const gmTok = (await gmLogin.json()).token;
  const H = { Authorization: 'Bearer ' + gmTok, 'Content-Type': 'application/json' };

  // 1. 未配置 SMTP，未加白名单 → send-code 应失败（邮件服务未配置）
  let r = await fetch(BASE + '/auth/send-code', { method: 'POST', headers: H, body: JSON.stringify({ email: 'anyone@example.com' }) });
  ok(r.status === 502, '未配置 SMTP → send-code 502');
  let j = await r.json();
  ok(/邮件服务未配置|邮件发送失败/.test(j.error), '错误信息含「邮件服务未配置」');

  // 2. GM 配置 SMTP（mock 拦截后任何配置都能"成功"）
  r = await fetch(BASE + '/admin/mail', { method: 'PUT', headers: H, body: JSON.stringify({ host: 'smtp.mock.com', port: 465, secure: true, user: 'u@mock.com', pass: 'p', from: '"T" <u@mock.com>' }) });
  ok(r.ok, 'GM 保存 SMTP 配置');

  // 3. 白名单为空（未启用）→ 任意邮箱可获取验证码
  r = await fetch(BASE + '/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'anyone@example.com' }) });
  ok(r.ok, '白名单为空 → 任意邮箱可获取验证码');

  // 4. GM 加白名单：仅 alice@example.com 和 @partner.com
  r = await fetch(BASE + '/admin/whitelist', { method: 'POST', headers: H, body: JSON.stringify({ email: 'alice@example.com', kind: 'exact' }) });
  ok(r.ok, 'GM 加精确邮箱白名单');
  r = await fetch(BASE + '/admin/whitelist', { method: 'POST', headers: H, body: JSON.stringify({ email: '@partner.com', kind: 'domain' }) });
  ok(r.ok, 'GM 加整域白名单');

  // 5. 不在白名单的邮箱 → send-code 403
  r = await fetch(BASE + '/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'stranger@evil.com' }) });
  ok(r.status === 403, '非白名单邮箱 → send-code 403');
  j = await r.json();
  ok(/不在.*白名单/.test(j.error), '错误信息含「不在白名单」');

  // 6. 白名单精确邮箱 → send-code 200（大小写不同也能匹配）
  r = await fetch(BASE + '/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'Alice@Example.com' }) });
  ok(r.ok, '白名单精确邮箱（大小写不同）→ send-code 200');

  // 7. 白名单整域邮箱 → send-code 200
  r = await fetch(BASE + '/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bob@partner.com' }) });
  ok(r.ok, '白名单整域邮箱 → send-code 200');

  // 8. 注册：缺验证码 → 400
  r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newuser', password: 'Abcdef12!', email: 'alice@example.com' }) });
  ok(r.status === 400, '注册缺验证码 → 400');

  // 9. 注册：错误验证码 → 400
  r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newuser', password: 'Abcdef12!', email: 'alice@example.com', code: '000000' }) });
  ok(r.status === 400, '注册错误验证码 → 400');
  j = await r.json();
  ok(/验证码不正确/.test(j.error), '错误信息含「验证码不正确」');

  // 10. 直接从 DB 读 step 6 发出的验证码（step 9 的错误尝试只 +1 attempts，未消费 code）
  const db2 = new Database(DB_PATH);
  const codeRow = db2.prepare("SELECT code FROM email_codes WHERE email='alice@example.com' ORDER BY id DESC LIMIT 1").get();
  db2.close();
  const code = codeRow?.code;
  ok(!!code, '从 DB 读到验证码');

  // 11. 非白名单邮箱 + 白名单邮箱的验证码 → 403（白名单政策在注册时也校验）
  r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newuser', password: 'Abcdef12!', email: 'stranger@evil.com', code }) });
  ok(r.status === 403, '非白名单邮箱注册 → 403');

  // 12. 正确邮箱 + 正确验证码 → 注册成功
  r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newuser', password: 'Abcdef12!', email: 'alice@example.com', code }) });
  ok(r.ok, '白名单邮箱 + 正确验证码 → 注册成功');
  if (r.ok) {
    j = await r.json();
    ok(!!j.token, '返回 token');
    ok(j.user?.username === 'newuser', '返回用户名');
    ok(j.user?.email === 'alice@example.com', '邮箱已写入用户表');
  }

  // 13. 已注册邮箱再发码 → 409
  r = await fetch(BASE + '/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com' }) });
  ok(r.status === 409, '已注册邮箱再发码 → 409');

  // 14. 验证码已被消费，再次用同码注册 → 409/400
  r = await fetch(BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newuser2', password: 'Abcdef12!', email: 'alice@example.com', code }) });
  ok(r.status === 409 || r.status === 400, '已注册邮箱再注册 → 409/400');

  // 15. GM 删除白名单条目
  const wl = await (await fetch(BASE + '/admin/whitelist', { headers: H })).json();
  const aliceEntry = wl.whitelist.find(w => w.email === 'alice@example.com');
  r = await fetch(BASE + '/admin/whitelist/' + aliceEntry.id, { method: 'DELETE', headers: H });
  ok(r.ok, 'GM 删除白名单条目');

  // 16. GM 清空白名单 → 白名单政策关闭
  r = await fetch(BASE + '/admin/whitelist', { method: 'DELETE', headers: H });
  ok(r.ok, 'GM 清空白名单');
  const wl2 = await (await fetch(BASE + '/admin/whitelist', { headers: H })).json();
  ok(wl2.enabled === false, '清空后白名单未启用');

  console.log(`\n注册流程 smoke: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.error('测试异常：', e);
  fail++;
} finally {
  srv.kill();
  try { fs.unlinkSync(interceptor); } catch { /* */ }
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
  process.exit(fail ? 1 : 0);
}
