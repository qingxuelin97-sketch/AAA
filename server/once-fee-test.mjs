// 一次性 AI 生成计费专项（毛坯修缮③）：世界书拆书平台兜底 + novels 九条
// llmOnce 路由堵白嫖。断言：无 key 用户可用且按次扣费（ai_fee）、失败退款
// 留 reversal_of 对、自带 key（内网地址被 SSRF 拦截）零流水。
// 运行：npm run test:once-fee
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4192;
const STUB_PORT = 4191;
const DB_PATH = path.join(ROOT, 'server', 'once-fee-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

// 桩上游：按请求内容返回数组（拆书）或对象（brainstorm）；含 FAIL500 时 500。
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (body.includes('FAIL500')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"stub 500"}'); }
    const content = body.includes('世界书条目')
      ? '[{"keys":"星港,空间站","content":"环绕行星的巨型空间站，剧情主舞台。","comment":"主舞台"}]'
      : '{"title":"星海拾遗","logline":"拾荒少女捡到会说话的飞船","genre":"科幻","synopsis":"边缘星区的拾荒少女……","tags":"科幻,冒险"}';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

const interceptor = path.join(__dirname, 'once-fee-test.interceptor.mjs');
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
const put = (p, body, tok) => fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
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
  console.log('一次性 AI 计费专项:');
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'once-fee fixture')").run());
  const a = await register('onceFeeA', 'once-a@test.dev');
  const uid = a.user.id;
  const goldOf = () => dbRead((d) => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
  const txs = () => dbRead((d) => d.prepare("SELECT kind, gold, reversal_of FROM transactions WHERE user_id = ? AND kind IN ('ai_fee','ai_refund') ORDER BY id").all(uid));

  // 1) 世界书拆书：无 key 用户走平台，扣 20 金并出条目
  const g0 = goldOf();
  const ex = await J(await post('/worldbooks/assist/extract', { text: '星港是环绕行星的巨型空间站，也是故事的主舞台。' }, a.token));
  ok(Array.isArray(ex.entries) && ex.entries.length >= 1 && ex.fee === 20, `拆书平台兜底出条目并计费（fee=${ex.fee}）`);
  ok(goldOf() === g0 - 20, `扣款落账（${g0} → ${goldOf()}）`);

  // 2) novels brainstorm：同样计费（此前白嫖）
  const g1 = goldOf();
  const br = await J(await post('/novels/brainstorm', { seed: '拾荒少女捡到会说话的飞船' }, a.token));
  ok(br.draft?.title && br.fee === 20 && goldOf() === g1 - 20, `brainstorm 平台分支计费（fee=${br.fee}）`);

  // 3) 失败路径：上游 500 → 502 + 退款对（reversal_of）
  const g2 = goldOf();
  const bad = await post('/novels/brainstorm', { seed: '触发 FAIL500 失败' }, a.token);
  ok(bad.status === 502, `上游失败 502（${bad.status}）`);
  ok(goldOf() === g2, '失败退款，余额分文不少');
  const pair = txs();
  const refunds = pair.filter((t) => t.kind === 'ai_refund');
  ok(refunds.length === 1 && refunds[0].reversal_of != null, '流水留下预扣/退款对（reversal_of 关联）');

  // 4) 自带 key（内网地址被 SSRF 拦截）：失败但零新增流水
  await put('/settings', { llm_api_key: 'sk-own', llm_base_url: `http://127.0.0.1:${STUB_PORT}`, llm_model: 'gpt-x', llm_provider: 'custom', llm_protocol: 'openai' }, a.token);
  const nTx = txs().length;
  await post('/worldbooks/assist/extract', { text: '任意文本试拆。' }, a.token);
  ok(txs().length === nTx && goldOf() === g2, '自带 key 用户零扣费零新流水（无论成败）');
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, '\n---- server output ----\n' + serverOutput);
}

console.log(`\n一次性 AI 计费专项: ${pass} passed, ${fail} failed`);
srv.kill(); stub.close();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
