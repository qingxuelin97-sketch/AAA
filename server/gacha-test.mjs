// 幸运转盘专项测试（扭蛋改造版）：每日免费一转 / 奖品（金币/钻石/次数卡）
// 与账本或 chat_credits 严格对账 / 免费额度用尽 400 / 付费 100 金 / 金币不足
// 拒绝 / 保底强制稀有档 / 聊天次数卡在平台对话中优先抵扣且失败退回。
// 运行：npm run test:gacha
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4195;
const STUB_PORT = 4193;
const DB_PATH = path.join(ROOT, 'server', 'gacha-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

// 桩上游：OpenAI 形状流式 /chat/completions（供平台对话消耗次数卡用例）。
// 请求体含 FAIL500 时返回 500（触发「已扣卡 → 生成失败 → 退卡」路径）。
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (body.includes('FAIL500')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"stub 500"}'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"你好呀。"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

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
    PLATFORM_LLM_BASE_URL: `http://127.0.0.1:${STUB_PORT}`, PLATFORM_LLM_KEY: 'stub-key',
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
// 读完 SSE 全文（对话回复用）
const sseText = async (p, body, tok) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, text };
};

for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + '/engage/events'); if (r.ok) break; } catch { /* */ }
  await new Promise((r) => setTimeout(r, 300));
  if (i === 59) { console.error('服务端未启动：', serverOutput); process.exit(1); }
}

try {
  console.log('幸运转盘专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'wheel fixture')").run());
  const a = await register('wheelUserA', 'wheel-a@test.dev');
  const uid = a.user.id;
  const row = () => dbRead((d) => d.prepare('SELECT gold, diamond, COALESCE(chat_credits,0) credits, COALESCE(gacha_pity,0) pity FROM users WHERE id = ?').get(uid));
  const txs = () => dbRead((d) => d.prepare("SELECT kind, gold, diamond, memo FROM transactions WHERE user_id = ? AND kind = 'gacha' ORDER BY id").all(uid));

  // 1) 初始状态
  const st0 = await J(await get('/gacha/state', a.token));
  ok(st0.free_available === true && st0.paid_price === 100 && Array.isArray(st0.prizes) && st0.prizes.length === 8 && st0.guarantee === 10,
    `state：免费可用 / 单价 100 / 8 格奖品 / 保底 ${st0.guarantee}`);

  // 2) 免费转：奖品与账本/次数卡严格对账
  const before = row();
  const s1 = await J(await post('/gacha/spin', { use: 'free' }, a.token));
  const after = row();
  ok(s1.prize?.id && s1.index >= 0 && s1.index < 8, `免费转出奖（${s1.prize.label} @ ${s1.index}）`);
  if (s1.prize.kind === 'gold') ok(after.gold === before.gold + s1.prize.amount && after.credits === before.credits, '金币奖入账与账本一致');
  else if (s1.prize.kind === 'diamond') ok(after.diamond === before.diamond + s1.prize.amount && after.gold === before.gold, '钻石奖入账与账本一致');
  else ok(after.credits === before.credits + s1.prize.amount && after.gold === before.gold, '次数卡奖入 chat_credits');
  const tasks1 = await J(await get('/engage/tasks', a.token));
  ok(tasks1.tasks.find((t) => t.id === 'gacha')?.progress === 1, '真实转动推进每日任务');

  // 3) 同日第二次免费 → 400
  const s2 = await post('/gacha/spin', { use: 'free' }, a.token);
  ok(s2.status === 400, `同日免费第二转拒绝（${s2.status}）`);

  // 4) 付费转 100 金：净额 = 奖品 - 100，账本留付费/奖品对
  dbWrite((d) => d.prepare('UPDATE users SET gold = 1000 WHERE id = ?').run(uid));
  const g0 = row();
  const s3 = await J(await post('/gacha/spin', { use: 'paid' }, a.token));
  const g1 = row();
  const expectGold = 1000 - 100 + (s3.prize.kind === 'gold' ? s3.prize.amount : 0);
  ok(s3.used === 'paid' && g1.gold === expectGold, `付费转净额正确（1000 → ${g1.gold}，中 ${s3.prize.label}）`);
  ok(txs().some((t) => t.gold === -100), '账本留下付费 -100 流水');

  // 5) 金币不足 → 400
  dbWrite((d) => d.prepare('UPDATE users SET gold = 50 WHERE id = ?').run(uid));
  const s4 = await post('/gacha/spin', { use: 'paid' }, a.token);
  ok(s4.status === 400, `金币不足拒绝（${s4.status}）`);

  // 6) 保底：pity=9 → 强制稀有档（钻石或大额金币）并归零
  dbWrite((d) => d.prepare('UPDATE users SET gacha_pity = 9, gold = 500 WHERE id = ?').run(uid));
  const s5 = await J(await post('/gacha/spin', { use: 'paid' }, a.token));
  ok(['diamond5', 'gold300', 'diamond20'].includes(s5.prize.id) && s5.pity === 0, `保底触发必中稀有档（${s5.prize.label}）并归零`);

  // 7) 聊天次数卡：平台对话优先抵扣（不扣金币），用完回落金币计费
  dbWrite((d) => d.prepare('UPDATE users SET chat_credits = 1, gold = 500 WHERE id = ?').run(uid));
  const ch = await J(await post('/characters', { name: '次数卡角色' }, a.token));
  const cv = await J(await post('/chat/conversations', { character_id: ch.character?.id || ch.id }, a.token));
  const r1 = await sseText(`/chat/conversations/${cv.conversation.id}/complete`, { content: '你好' }, a.token);
  const c1 = row();
  ok(r1.status === 200 && r1.text.includes('credit_used') && c1.credits === 0 && c1.gold === 500,
    `次数卡抵扣：卡 1→${c1.credits}，金币分文未动（${c1.gold}）`);
  const r2 = await sseText(`/chat/conversations/${cv.conversation.id}/complete`, { content: '再聊一句' }, a.token);
  const c2 = row();
  ok(r2.status === 200 && c2.gold === 500 - 20 && c2.credits === 0, `卡用完回落金币计费（500 → ${c2.gold}）`);

  // 8) 已扣卡但生成失败 → 退卡（角色名注入 FAIL500 让桩上游报错）
  dbWrite((d) => d.prepare('UPDATE users SET chat_credits = 1 WHERE id = ?').run(uid));
  const chBad = await J(await post('/characters', { name: 'FAIL500', persona: 'FAIL500' }, a.token));
  const cvBad = await J(await post('/chat/conversations', { character_id: chBad.character?.id || chBad.id }, a.token));
  await sseText(`/chat/conversations/${cvBad.conversation.id}/complete`, { content: '触发失败' }, a.token);
  const c3 = row();
  ok(c3.credits === 1, `生成失败退卡（credits=${c3.credits}）`);
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n幸运转盘专项: ${pass} passed, ${fail} failed`);
srv.kill(); stub.close();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
