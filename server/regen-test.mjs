// 重新生成 / 回复变体专项测试。
//
// —— 守的是什么 ——
// 改造前「重新生成」是先 DELETE 掉上一条 assistant 消息再重新生成。于是：
//   · 生成失败（上游 500 / 断流 / 空产出）时旧回复已经没了，用户凭空丢内容且无法撤销；
//   · 即使成功，上一版也永远消失，没法比较或退回；
//   · 消息被删除重建，id 变了，挂在旧 id 上的书签与表情反应一并消失。
// 这三件事都是「系统在用户不知情时销毁用户的东西」，也是本轮的主线。
//
// 走真实 HTTP + 桩上游，因为要覆盖 SSE 失败路径。
// 运行：npm run test:regen
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4197;
const STUB_PORT = 4198;
const DB_PATH = path.join(__dirname, 'regen-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { fs.unlinkSync(f); } catch { /* */ } }

// 桩上游：正常回一句可辨识的文本；请求体含 FAIL500 时返回 500。
let replyNo = 0;
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (body.includes('FAIL500')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"stub 500"}'); }
    replyNo += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `第${replyNo}版回复` } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

const interceptor = path.join(__dirname, 'regen-test.interceptor.mjs');
fs.writeFileSync(interceptor, `
import nodemailer from 'nodemailer';
const realCreate = nodemailer.createTransport.bind(nodemailer);
nodemailer.createTransport = function (o, d) { const t = realCreate(o, d); t.sendMail = async () => ({ messageId: 'm' }); t.verify = async () => true; return t; };
`);

const srv = spawn(process.execPath, ['--import', pathToFileURL(interceptor).href, 'server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env, NODE_ENV: 'test', TEST_EXPOSE_EMAIL_CODES: '1', PORT: String(PORT), DB_PATH,
    PLATFORM_LLM_BASE_URL: `http://127.0.0.1:${STUB_PORT}`, PLATFORM_LLM_KEY: 'stub-key',
    API_ANON_RATE_LIMIT: '500', API_AUTH_RATE_LIMIT: '2000',
    SMTP_HOST: 'smtp.mock.com', SMTP_PORT: '465', SMTP_SECURE: '1',
    SMTP_USER: 'u@mock.com', SMTP_PASS: 'p', SMTP_FROM: '"T" <u@mock.com>',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
srv.stdout.on('data', (c) => { serverOutput = (serverOutput + c).slice(-8000); });
srv.stderr.on('data', (c) => { serverOutput = (serverOutput + c).slice(-8000); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const J = (r) => r.json();
const post = (p, body, tok) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
const get = (p, tok) => fetch(BASE + p, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
const dbRead = (fn) => { const d = new Database(DB_PATH, { readonly: true }); try { return fn(d); } finally { d.close(); } };
const dbWrite = (fn) => { const d = new Database(DB_PATH); try { return fn(d); } finally { d.close(); } };
const sse = async (p, body, tok) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
};

for (let i = 0; i < 120; i++) {
  try { await fetch(`${BASE}/meta/categories`); break; } catch { await new Promise(r => setTimeout(r, 250)); }
}

console.log('重新生成 / 回复变体');
try {
  dbWrite((d) => d.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev','domain','regen fixture')").run());
  const sc = await J(await post('/auth/send-code', { email: 'r@test.dev' }));
  const acct = await J(await post('/auth/register', { username: 'regen', password: 'Passw0rd!', email: 'r@test.dev', code: sc.test_code }));
  if (!acct.token) throw new Error(`注册失败: ${JSON.stringify(acct)}`);
  const tok = acct.token;
  const uid = acct.user?.id ?? dbRead(d => d.prepare("SELECT id FROM users WHERE username='regen'").get().id);
  dbWrite((d) => d.prepare('UPDATE users SET gold = 100000 WHERE id = ?').run(uid));

  const ch = await J(await post('/characters', { name: '变体角色' }, tok));
  const cid = ch.character?.id || ch.id;
  const cv = await J(await post('/chat/conversations', { character_id: cid }, tok));
  const convId = cv.conversation.id;

  const msgs = async () => (await J(await get(`/chat/conversations/${convId}`, tok))).messages;
  const lastAssistant = async () => (await msgs()).filter(m => m.role === 'assistant').pop();

  // 1) 首轮回复
  await sse(`/chat/conversations/${convId}/complete`, { content: '你好' }, tok);
  const m1 = await lastAssistant();
  ok(m1 && m1.content === '第1版回复', `首轮回复落库（${m1?.content}）`);
  ok(!m1.variant_count, '首轮没有变体（未被重新生成过）');
  const originalId = m1.id;

  // 2) 在这条消息上挂书签 + 表情反应，稍后验证它们在重新生成后仍然存活
  await post(`/chat/conversations/${convId}/messages/${originalId}/bookmark`, {}, tok);
  await post(`/chat/conversations/${convId}/messages/${originalId}/react`, { reaction: '❤️' }, tok);

  // 3) 重新生成成功 → 追加变体，旧版仍可取回，消息 id 不变
  await sse(`/chat/conversations/${convId}/regenerate`, {}, tok);
  const m2 = await lastAssistant();
  ok(m2.id === originalId, '重新生成不新建消息，id 保持不变');
  ok(m2.content === '第2版回复', `content 指向新版本（${m2.content}）`);
  ok(m2.variant_count === 2, `变体数为 2（实际 ${m2.variant_count}）`);
  ok(m2.variant_index === 1, `当前是第 2 版（index=${m2.variant_index}）`);
  ok(m2.bookmarked === 1, '书签在重新生成后仍然存活');
  ok(m2.reaction === '❤️', '表情反应在重新生成后仍然存活');
  const kept = dbRead(d => d.prepare('SELECT content FROM message_variants WHERE message_id = ? ORDER BY id').all(originalId).map(r => r.content));
  ok(JSON.stringify(kept) === JSON.stringify(['第1版回复', '第2版回复']), `两版都留在变体表（${JSON.stringify(kept)}）`);

  // 4) 切回第 1 版
  const sw = await J(await post(`/chat/conversations/${convId}/messages/${originalId}/variant`, { index: 0 }, tok));
  ok(sw.message?.content === '第1版回复', '切回第 1 版');
  ok((await lastAssistant()).content === '第1版回复', '会话读取到的 content 也跟着变了');
  const bad = await post(`/chat/conversations/${convId}/messages/${originalId}/variant`, { index: 99 }, tok);
  ok(bad.status === 400, `越界的版本序号被拒（${bad.status}）`);

  // 5) 最关键的一条：重新生成失败时旧回复必须原封不动
  await post(`/chat/conversations/${convId}/messages/${originalId}/variant`, { index: 1 }, tok);
  const beforeFail = await lastAssistant();
  dbWrite((d) => d.prepare('UPDATE characters SET name = ?, persona = ? WHERE id = ?').run('FAIL500', 'FAIL500', cid));
  await sse(`/chat/conversations/${convId}/regenerate`, {}, tok);
  const afterFail = await lastAssistant();
  ok(afterFail.id === beforeFail.id && afterFail.content === beforeFail.content,
    `生成失败后旧回复原封不动（${afterFail.content}）`);
  ok(afterFail.variant_count === 2, '失败没有产生新变体');
  ok(afterFail.bookmarked === 1, '失败后书签仍在');

  // 6) 重新生成不能把「正在被重写的那一条」喂回给模型（否则退化成续写）
  dbWrite((d) => d.prepare('UPDATE characters SET name = ?, persona = ? WHERE id = ?').run('变体角色', '', cid));
  const seen = [];
  const orig = stub.listeners('request')[0];
  stub.removeAllListeners('request');
  stub.on('request', (req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { seen.push(b); }); orig(req, res); });
  await sse(`/chat/conversations/${convId}/regenerate`, {}, tok);
  const sentToModel = seen.at(-1) || '';
  ok(!sentToModel.includes('第2版回复'), '被重写的那一版没有出现在发给模型的上下文里');
  ok(sentToModel.includes('你好'), '用户消息仍然在上下文里');

  // 7) 中断：已送达的内容必须保留并照常计费；一字未达才退款
  {
    // 桩上游改为「先吐一段、再拖住不结束」，客户端中途 abort 模拟点「停止」。
    const prev = stub.listeners('request')[0];
    stub.removeAllListeners('request');
    stub.on('request', (req, res) => {
      let b = ''; req.on('data', c => { b += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '这段已经送到用户眼前了' } }] })}\n\n`);
        // 故意不结束，让客户端有机会中途断开
      });
    });

    const convId2 = (await J(await post('/chat/conversations', { character_id: cid }, tok))).conversation.id;
    const goldBefore = dbRead(d => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
    const ac = new AbortController();
    const p = fetch(`${BASE}/chat/conversations/${convId2}/complete`, {
      method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ content: '你好' }),
    }).catch(() => null);
    await new Promise(r => setTimeout(r, 600));
    ac.abort();                       // ← 相当于用户点了「停止」
    await p;
    await new Promise(r => setTimeout(r, 900));

    const kept2 = dbRead(d => d.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role='assistant'").all(convId2));
    const goldAfter = dbRead(d => d.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold);
    ok(kept2.length === 1 && kept2[0].content.includes('这段已经送到用户眼前了'),
      `中断时已送达的内容被保留（${kept2.length} 条）`);
    ok(goldAfter < goldBefore, `中断且有内容送达时照常计费（${goldBefore} → ${goldAfter}）`);

    stub.removeAllListeners('request');
    stub.on('request', prev);
  }

  // 8) 收尾事件：本轮 id 必须随流带回，客户端不再需要重拉整个会话
  {
    const convId4 = (await J(await post('/chat/conversations', { character_id: cid }, tok))).conversation.id;
    const r = await sse(`/chat/conversations/${convId4}/complete`, { content: '带回 id' }, tok);
    const tail = r.text.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]'))
      .map(l => { try { return JSON.parse(l.slice(5)); } catch { return null; } })
      .find(x => x?.assistant_message_id);
    ok(!!tail, '流里带回了收尾事件');
    const stored = dbRead(d => d.prepare("SELECT id, role FROM messages WHERE conversation_id = ? ORDER BY id").all(convId4));
    ok(tail?.user_message_id === stored.find(m => m.role === 'user')?.id, `user_message_id 与落库一致（${tail?.user_message_id}）`);
    ok(tail?.assistant_message_id === stored.find(m => m.role === 'assistant')?.id, `assistant_message_id 与落库一致（${tail?.assistant_message_id}）`);
    ok(typeof tail?.affinity === 'number', '带回好感度，省掉一次会话重拉');

    // 重新生成时 id 不变、变体计数随流带回，气泡上的翻页器才能立刻出现
    const r2 = await sse(`/chat/conversations/${convId4}/regenerate`, {}, tok);
    const tail2 = r2.text.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]'))
      .map(l => { try { return JSON.parse(l.slice(5)); } catch { return null; } })
      .find(x => x?.assistant_message_id);
    ok(tail2?.assistant_message_id === tail?.assistant_message_id, '重新生成后 id 不变');
    ok(tail2?.variant_count === 2 && tail2?.variant_index === 1, `变体计数随流带回（${tail2?.variant_count}/${tail2?.variant_index}）`);
  }

  // 9) 扣费失败分型：错误里必须带 code，且 error 仍是字符串（sse.js 依赖这个契约）
  {
    const convId3 = (await J(await post('/chat/conversations', { character_id: cid }, tok))).conversation.id;
    dbWrite((d) => d.prepare('UPDATE users SET gold = 0 WHERE id = ?').run(uid));
    const r = await sse(`/chat/conversations/${convId3}/complete`, { content: '你好' }, tok);
    const evt = r.text.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).find(x => x?.error);
    ok(typeof evt?.error === 'string', 'error 仍是字符串（client/src/chat/sse.js 是 throw new Error(j.error)）');
    ok(evt?.code === 'INSUFFICIENT_GOLD', `金币不足带 code=INSUFFICIENT_GOLD（实际 ${evt?.code}）`);
    ok(typeof evt?.fee === 'number' && typeof evt?.balance === 'number', '带上 fee 与 balance 供前端直接渲染');
    const logged = dbRead(d => d.prepare("SELECT COUNT(*) n FROM logs WHERE event='ai_fee_rejected'").get().n);
    ok(logged > 0, `扣费被拒有日志留痕（${logged} 条，改造前是空 catch 完全静默）`);

    // 经济冻结必须与「金币不足」区分开：文案不能引导用户去充值
    dbWrite((d) => d.prepare('UPDATE users SET gold = 100000, economic_hold = 1, diamond_debt = 5 WHERE id = ?').run(uid));
    const r2 = await sse(`/chat/conversations/${convId3}/complete`, { content: '再来' }, tok);
    const evt2 = r2.text.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).find(x => x?.error);
    ok(evt2?.code === 'ECONOMIC_HOLD', `经济冻结带 code=ECONOMIC_HOLD（实际 ${evt2?.code}）`);
    ok(!/金币不足/.test(evt2?.error || ''), '经济冻结不再谎称「金币不足」（照着去充值也解决不了）');
    dbWrite((d) => d.prepare('UPDATE users SET economic_hold = 0, diamond_debt = 0 WHERE id = ?').run(uid));
  }

  // 9) 删除消息时变体一并清理（ON DELETE CASCADE）
  const before = dbRead(d => d.prepare('SELECT COUNT(*) n FROM message_variants WHERE message_id = ?').get(originalId).n);
  ok(before > 0, `删除前该消息有 ${before} 个变体`);
  await fetch(`${BASE}/chat/conversations/${convId}/messages/${originalId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
  const after = dbRead(d => d.prepare('SELECT COUNT(*) n FROM message_variants WHERE message_id = ?').get(originalId).n);
  ok(after === 0, '消息删除后变体级联清理，不留孤儿');
} catch (e) {
  fail++; console.error('  ✗ 异常：', e.message, `\n---- server output ----\n${serverOutput}`);
}

console.log(`\n重新生成 / 回复变体: ${pass} passed, ${fail} failed`);
srv.kill(); stub.close();
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, interceptor]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
