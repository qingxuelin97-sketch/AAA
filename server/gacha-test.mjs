// 扭蛋统一版专项测试：每日免费一抽（零经济产出）/ 免费额度用尽 400 /
// 付费 300 金（kind=gacha）/ 金币不足拒绝 / 服务端保底 69→必出 SSR /
// 真实抽取推进每日任务与 gacha_pulls（成就「欧皇之路」口径）。
// 运行：npm run test:gacha
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4195;
const DB_PATH = path.join(ROOT, 'server', 'gacha-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const interceptor = path.join(__dirname, 'gacha-test.interceptor.mjs');
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
const get = (p, tok) => fetch(BASE + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
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
  console.log('扭蛋统一版专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'gacha fixture')").run());
  const a = await register('gachaUserA', 'gacha-a@test.dev');
  const uid = a.user.id;
  const goldOf = () => dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
  const txsOf = () => dbRead((d) => d.prepare('SELECT kind, gold, diamond FROM transactions WHERE user_id = ?').all(uid));

  // 1) 初始状态
  const st0 = await J(await get('/gacha/state', a.token));
  ok(st0.free_available === true && st0.paid_price === 300 && st0.pity === 0 && st0.pity_threshold === 70, 'state：免费可用 / 单价 300 / 保底 0/70');

  // 2) 免费抽：出货 + 零经济产出 + 推进任务与 gacha_pulls
  const gold0 = goldOf();
  const p1 = await J(await post('/gacha/pull', { use: 'free' }, a.token));
  ok(['N', 'R', 'SR', 'SSR'].includes(p1.tier) && p1.name && p1.seed && p1.persona, `免费抽出货（${p1.tier}·${p1.name}）`);
  ok(goldOf() === gold0 && txsOf().length === 0, '免费抽零经济产出（余额不变、零流水）');
  ok(p1.pity === (p1.tier === 'SSR' ? 0 : 1), `保底计数推进正确（pity=${p1.pity}）`);
  const tasks1 = await J(await get('/engage/tasks', a.token));
  ok(tasks1.tasks.find((t) => t.id === 'gacha')?.progress === 1, '真实抽取推进每日任务「抽卡」');
  ok(dbRead((d) => d.prepare('SELECT gacha_pulls FROM users WHERE id = ?').get(uid).gacha_pulls) === 1, 'gacha_pulls+1（成就「欧皇之路」口径）');

  // 3) 同日第二次免费 → 400
  const p2 = await post('/gacha/pull', { use: 'free' }, a.token);
  ok(p2.status === 400, `同日免费第二抽拒绝（${p2.status}）`);

  // 4) 付费抽 300 金（新号 300 金恰好一抽）
  const p3 = await J(await post('/gacha/pull', { use: 'paid' }, a.token));
  ok(p3.used === 'paid' && p3.wallet && goldOf() === gold0 - 300, `付费抽扣 300 金（${gold0} → ${goldOf()}）`);
  const gtx = txsOf().filter((t) => t.kind === 'gacha');
  ok(gtx.length === 1 && gtx[0].gold === -300, '流水 kind=gacha 单笔 -300');

  // 5) 金币不足 → 400，无新增流水
  const p4 = await post('/gacha/pull', { use: 'paid' }, a.token);
  ok(p4.status === 400 && txsOf().length === 1, `金币不足拒绝且零新流水（${p4.status}）`);

  // 6) 服务端保底：69 → 下一抽必出 SSR 且归零
  dbWrite((d) => d.prepare('UPDATE users SET gacha_pity = 69, gold = 300 WHERE id = ?').run(uid));
  const p5 = await J(await post('/gacha/pull', { use: 'paid' }, a.token));
  ok(p5.tier === 'SSR' && p5.pity === 0, `保底触发：第 70 抽必出 SSR 并归零（tier=${p5.tier}, pity=${p5.pity}）`);
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n扭蛋统一版专项: ${pass} passed, ${fail} failed`);
srv.kill();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
