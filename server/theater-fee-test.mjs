// 互动小说平台模型兜底专项测试：
//   无 key 用户可玩（平台预扣 + 成功结算）/ 生成失败自动退款（reversal_of 对）
//   / 自带 key 用户零扣费（即使生成失败也不产生任何流水）/ GET 计费披露字段。
// 运行：npm run test:theater-fee
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4197;
const STUB_PORT = 4199;
const DB_PATH = path.join(ROOT, 'server', 'theater-fee-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

// —— 桩上游：OpenAI 形状的 /chat/completions。请求体含 FAIL500 时返回 500，
// 用于触发「预扣后生成失败 → 退款」路径（标记经由剧场 scene 注入 system）。
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (body.includes('FAIL500')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"stub 500"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '["推开吱呀作响的门","质问薇尔为何隐瞒","悄悄退回阴影中"]' } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

// 邮件拦截 preload（与 sec-test 相同机制）：验证码不真发信，直接从库读。
const interceptor = path.join(__dirname, 'theater-fee-test.interceptor.mjs');
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
    // SMTP 走环境变量配置（nodemailer 已被拦截，任意值可用）
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
const put = (p, body, tok) => fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });

const register = async (username, email) => {
  const sc = await J(await post('/auth/send-code', { email }));
  const r = await J(await post('/auth/register', { username, password: 'Passw0rd!', email, code: sc.test_code }));
  if (!r.token) throw new Error('注册失败：' + JSON.stringify(r));
  return r;
};
const dbRead = (fn) => { const d = new Database(DB_PATH, { readonly: true }); try { return fn(d); } finally { d.close(); } };
const goldOf = (uid) => dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
const txsOf = (uid) => dbRead((d) => d.prepare('SELECT kind, gold, reversal_of, ref_owner, share_eligible FROM transactions WHERE user_id = ? ORDER BY id').all(uid));

// 等服务端起来
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + '/engage/events'); if (r.ok) break; } catch { /* */ }
  await new Promise((r) => setTimeout(r, 300));
  if (i === 59) { console.error('服务端未启动：', serverOutput); process.exit(1); }
}

try {
  console.log('互动小说平台兜底专项:');
  // 注册默认受限（白名单政策）：与 sec-test 相同，直插白名单域名夹具。
  { const d = new Database(DB_PATH); d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'theater fee fixture')").run(); d.close(); }
  const a = await register('theaterfeeA', 'theaterfee-a@test.dev');
  const b = await register('theaterfeeB', 'theaterfee-b@test.dev');

  // A 建私有剧场（自有私有角色可入阵容）
  const ch = await J(await post('/characters', { name: '测试角色', is_public: 1 }, a.token));
  const chId = ch.character?.id || ch.id;
  // t1 公开（B 需要能加入验证多人「谁触发谁付费」视角）；t2 私有触发失败路径。
  const t1 = await J(await post('/theater', { name: '兜底测试', scene: '一间安静的书房', cast: [chId] }, a.token));
  const t2 = await J(await post('/theater', { name: '失败测试', scene: '这里必然 FAIL500 失败', cast: [chId], is_public: false }, a.token));
  const tid1 = t1.theater?.id, tid2 = t2.theater?.id;
  ok(tid1 && tid2, `建剧场成功（#${tid1} / #${tid2}）`);

  // 披露字段：无 key 用户 platform=true + 单段预估费
  const detail = await J(await get('/theater/' + tid1, a.token));
  ok(detail.llm?.platform === true && detail.llm?.fee === 20, `GET 披露平台计费（platform=true, fee=${detail.llm?.fee}）`);

  // 无 key 用户旁白续写：预扣 20 → 成功结算
  const g0 = goldOf(a.user.id);
  const act = await post('/theater/' + tid1 + '/act', { narrator: true }, a.token);
  const actBody = await J(act);
  ok(act.ok && actBody.message?.content, '无 key 用户可用平台模型续写');
  ok(actBody.fee === 20 && goldOf(a.user.id) === g0 - 20, `按段计费 20 金币（${g0} → ${goldOf(a.user.id)}）`);
  ok(actBody.balance === g0 - 20, '响应带实时余额');

  // 失败路径：预扣后上游 500 → 退款，余额分文不少，流水留下预扣/退款对
  const g1 = goldOf(a.user.id);
  const bad = await post('/theater/' + tid2 + '/act', { narrator: true }, a.token);
  ok(bad.status === 502, `上游失败返回 502（${bad.status}）`);
  ok(goldOf(a.user.id) === g1, '失败自动退款，余额分文不少');
  const txA = txsOf(a.user.id);
  const fees = txA.filter((t) => t.kind === 'theater_fee');
  const refunds = txA.filter((t) => t.kind === 'theater_refund');
  ok(fees.length === 2 && refunds.length === 1, `流水留下预扣/退款对（theater_fee×${fees.length} theater_refund×${refunds.length}）`);
  ok(refunds[0]?.reversal_of != null, '退款带 reversal_of 冲正关联');
  ok(txA.every((t) => t.ref_owner == null), '内测期剧场费不归因创作者（ref_owner 空，双保险防自刷分成）');

  // 命运抉择同样计费闭环
  const g2 = goldOf(a.user.id);
  const cho = await J(await post('/theater/' + tid1 + '/choices', {}, a.token));
  ok(Array.isArray(cho.choices) && cho.choices.length === 3, '命运抉择走平台模型返回 3 项');
  ok(goldOf(a.user.id) === g2 - 20 && cho.fee === 20, '命运抉择按段计费');

  // B 自带 key（指向内网地址会被 SSRF 防护拦截）：失败但零扣费、零流水
  await put('/settings', { llm_api_key: 'sk-own', llm_base_url: `http://127.0.0.1:${STUB_PORT}`, llm_model: 'gpt-x', llm_provider: 'custom', llm_protocol: 'openai' }, b.token);
  await post('/theater/' + tid1 + '/join', {}, b.token);
  const detailB = await J(await get('/theater/' + tid1, b.token));
  ok(detailB.llm?.platform === false && detailB.llm?.fee === 0, '自带 key 用户披露 platform=false 零费用');
  const gb0 = goldOf(b.user.id);
  await post('/theater/' + tid1 + '/act', { narrator: true }, b.token);
  ok(goldOf(b.user.id) === gb0 && txsOf(b.user.id).length === 0, '自带 key 用户零扣费零流水（无论成败）');
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n互动小说平台兜底专项: ${pass} passed, ${fail} failed`);
srv.kill(); stub.close();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
