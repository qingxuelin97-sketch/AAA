// 头像框装扮位专项（毛坯修缮⑤）：白名单校验、SVIP 硬闸、佩戴/摘下落库、
// 未传字段不动原值。运行：npm run test:frame
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4198;
const DB_PATH = path.join(ROOT, 'server', 'frame-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const interceptor = path.join(__dirname, 'frame-test.interceptor.mjs');
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
const put = (p, body, tok) => fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
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
  console.log('头像框装扮位专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'frame fixture')").run());
  const a = await register('frameUserA', 'frame-a@test.dev');

  // 1) 非 SVIP 佩戴 SVIP 框 → 403
  const r1 = await put('/auth/me', { avatar_frame: 'aurora' }, a.token);
  ok(r1.status === 403, `非 SVIP 佩戴流光框 403（${r1.status}）`);

  // 2) 目录外框 id → 400
  const r2 = await put('/auth/me', { avatar_frame: 'hacker-frame' }, a.token);
  ok(r2.status === 400, `目录外框 id 400（${r2.status}）`);

  // 3) 授予 SVIP 后佩戴成功并落库、/auth/me 回显
  dbWrite((d) => d.prepare('UPDATE users SET svip = 1 WHERE id = ?').run(a.user.id));
  const r3 = await J(await put('/auth/me', { avatar_frame: 'aurora' }, a.token));
  ok(r3.user?.avatar_frame === 'aurora', '佩戴成功，响应回显 aurora');
  const me1 = await J(await get('/auth/me', a.token));
  ok(me1.user?.avatar_frame === 'aurora', '/auth/me 持久回显框 id');

  // 4) 不传字段的资料更新不动框
  await put('/auth/me', { bio: '只改简介' }, a.token);
  const me2 = await J(await get('/auth/me', a.token));
  ok(me2.user?.avatar_frame === 'aurora' && me2.user?.bio === '只改简介', '未传 avatar_frame 时保持原框');

  // 5) 摘下（空串在目录内）
  const r5 = await J(await put('/auth/me', { avatar_frame: '' }, a.token));
  ok(r5.user?.avatar_frame === '', '摘下头像框（空串落库）');

  // 6) 动态框目录：碧波全员可戴、鎏金 SVIP 专属
  const b = await register('frameUserB', 'frame-b@test.dev');
  const r6 = await J(await put('/auth/me', { avatar_frame: 'aqua' }, b.token));
  ok(r6.user?.avatar_frame === 'aqua', '非 SVIP 佩戴通用动态框「碧波」成功');
  const r7 = await put('/auth/me', { avatar_frame: 'gilt' }, b.token);
  ok(r7.status === 403, `非 SVIP 佩戴「鎏金」403（${r7.status}）`);

  // 7) 装扮可见性（修缮⑥）：公开主页对他人回显框 + 徽章字段 + 成就数
  const pub = await J(await get(`/users/${b.user.id}`, a.token));
  ok(pub.user?.avatar_frame === 'aqua', '公开主页对他人回显 avatar_frame');
  ok('creator_tier' in (pub.user || {}) && pub.user?.is_councilor === false, '公开主页补发 creator_tier / is_councilor');
  ok(typeof pub.stats?.achievements === 'number', `公开主页 stats 含成就已解锁数（${pub.stats?.achievements}）`);
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n头像框装扮位专项: ${pass} passed, ${fail} failed`);
srv.kill();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
