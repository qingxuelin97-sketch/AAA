// 心动回流专项（毛坯修缮①）：发现流「心动」从 localStorage 回流服务端。
// 断言：toggle 幂等、零公开计数污染（不动 characters.likes）、私密卡 404
// 不当存在性探针、hearts/list 回填、recommended 权重吃到心动信号。
// 运行：npm run test:hearts
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4196;
const DB_PATH = path.join(ROOT, 'server', 'hearts-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const interceptor = path.join(__dirname, 'hearts-test.interceptor.mjs');
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
  console.log('心动回流专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'hearts fixture')").run());
  const a = await register('heartsA', 'hearts-a@test.dev');
  const b = await register('heartsB', 'hearts-b@test.dev');

  // B 的三张卡：两张公开（同类/异类）+ 一张私密
  const mk = async (name, category, is_public) =>
    (await J(await post('/characters', { name, category, is_public, greeting: '你好' }, b.token))).character.id;
  const cX = await mk('心动X·星语者', 'fantasy', true);
  const cX2 = await mk('心动X2·同类卡', 'fantasy', true);
  const cY = await mk('心动Y·异类卡', 'city', true);
  const cP = await mk('心动P·私密卡', 'fantasy', false);

  const likesOf = (id) => dbRead((d) => d.prepare('SELECT likes FROM characters WHERE id = ?').get(id).likes);

  // 1) toggle 开：hearted=true，characters.likes 零污染
  const l0 = likesOf(cX);
  const h1 = await J(await post(`/characters/${cX}/heart`, {}, a.token));
  ok(h1.hearted === true, '心动 toggle 开（hearted=true）');
  ok(likesOf(cX) === l0, '心动不动 characters.likes（零公开计数污染）');

  // 2) hearts/list 回填
  const list = await J(await get('/characters/hearts/list', a.token));
  ok(Array.isArray(list.ids) && list.ids.includes(cX), 'hearts/list 返回已心动 id');

  // 3) toggle 关：行删除、likes 依旧不动
  const h2 = await J(await post(`/characters/${cX}/heart`, {}, a.token));
  ok(h2.hearted === false, '心动 toggle 关（hearted=false）');
  ok(dbRead((d) => d.prepare('SELECT COUNT(*) n FROM hearts WHERE user_id = ?').get(a.user.id).n) === 0, 'toggle 关后 hearts 行清空');
  ok(likesOf(cX) === l0, '取消心动同样不动 likes');

  // 4) 私密卡 404（不当存在性探针）
  const priv = await post(`/characters/${cP}/heart`, {}, a.token);
  ok(priv.status === 404, `他人私密卡心动 404（${priv.status}）`);

  // 5) recommended 权重吃到心动：A 心动 fantasy 的 cX 后，同类 cX2 应排在异类 cY 前
  await post(`/characters/${cX}/heart`, {}, a.token);
  const rec = await J(await get('/characters/recommended', a.token));
  const ids = (rec.characters || []).map((c) => c.id);
  const iX2 = ids.indexOf(cX2), iY = ids.indexOf(cY);
  ok(rec.personalized === true, '心动后 recommended 进入个性化态');
  ok(iX2 !== -1 && iY !== -1 && iX2 < iY, `同类卡排位高于异类卡（${iX2} < ${iY}）`);
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n心动回流专项: ${pass} passed, ${fail} failed`);
srv.kill();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
