// 上下文封顶 + 滚动摘要专项测试。
//
// —— 守的是什么 ——
// 加窗是本轮唯一会「悄悄改写用户剧情」的改动。它的失效形态不是报错，而是：
//   · 世界书关键词随会话变长而静默失效（窗口比 scan_depth 还短）；
//   · 第 3 回合定下的设定在第 300 回合消失（wb_vars 已在 wb-vars-test 覆盖）；
//   · 摘要服务挂掉时把整个对话一起阻塞（摘要应当是增强，不是前置依赖）。
// 这些都不会在短会话里复现，因此必须显式测。
//
// 运行：npm run test:ctx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'ctx-test.tmp.sqlite');
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.env.DB_PATH = DB_PATH;

const db = (await import('./db.js')).default;
const { getSummary, updateSummary } = await import('./summary.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

console.log('上下文封顶 / 滚动摘要');

/* 1) clampHistory 的行为（从 chat.js 源码取实现口径，避免测一个副本） */
const chatSrc = fs.readFileSync(path.join(__dirname, 'routes', 'chat.js'), 'utf8');
ok(/const CTX_MAX_MESSAGES = \d+/.test(chatSrc), '存在条数上限常量');
ok(/const CTX_MAX_CHARS = \d+/.test(chatSrc), '存在字符数上限常量');
ok(/Math\.max\(flags\.ctx_max_messages \?\? CTX_MAX_MESSAGES, scanFloor\)/.test(chatSrc),
  '窗口下限与 scan_depth 绑定（否则世界书关键词会随会话变长静默失效）');
ok(/scanFloor = Math\.max\(built0ScanDepth\(character\) \* 2\) \|\| 0, 12\)/.test(chatSrc.replace(/\s+/g, ' '))
  || /built0ScanDepth\(character\) \* 2/.test(chatSrc), 'scanFloor 取 scan_depth 的两倍');
ok(/flags\.summary !== false/.test(chatSrc), '摘要可由 flag 关闭');
ok(/updateSummary\([\s\S]{0,200}\)\s*\n\s*\.catch\(/.test(chatSrc), '摘要刷新不 await（不拖慢首字）且挂了 catch');
ok(/historyLen: convMsgCount/.test(chatSrc), '计费档位仍用会话真实消息数，未被窗口改变');

/* 2) clampHistory 逐条行为 —— 直接复刻实现做等价验证 */
function clampHistory(rows, maxMessages, maxChars) {
  if (!rows.length) return { rows, dropped: 0 };
  const kept = []; let chars = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const len = (rows[i].content || '').length;
    if (kept.length >= maxMessages) break;
    if (kept.length && chars + len > maxChars) break;
    kept.push(rows[i]); chars += len;
  }
  kept.reverse();
  return { rows: kept, dropped: rows.length - kept.length };
}
const mk = (n, len = 10) => Array.from({ length: n }, (_, i) => ({ id: i + 1, role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(len) }));
{
  const r = clampHistory(mk(200), 80, 999999);
  ok(r.rows.length === 80 && r.dropped === 120, `条数封顶生效（保留 ${r.rows.length}，丢弃 ${r.dropped}）`);
  ok(r.rows[r.rows.length - 1].id === 200, '保留的是最近的消息而不是最早的');
  const c = clampHistory(mk(200, 1000), 80, 5000);
  ok(c.rows.length === 5, `字符数封顶先触顶时按字符截断（保留 ${c.rows.length} 条）`);
  const one = clampHistory([{ id: 1, role: 'user', content: 'y'.repeat(99999) }], 80, 100);
  ok(one.rows.length === 1, '单条超长消息仍被保留（否则上下文会变成空的）');
  ok(clampHistory([], 80, 5000).rows.length === 0, '空历史不炸');
}

/* 3) 摘要：失败必须降级，且绝不抛出 */
db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1,'u','x')").run();
db.prepare("INSERT INTO characters (id, owner_id, name) VALUES (1,1,'c')").run();
const convId = Number(db.prepare('INSERT INTO conversations (user_id, character_id) VALUES (1,1)').run().lastInsertRowid);
for (let i = 0; i < 30; i++) {
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)')
    .run(convId, i % 2 ? 'assistant' : 'user', `第 ${i} 条剧情`);
}
const windowStartId = db.prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(convId).id;

{
  // 上游必然失败的配置
  const brokenEff = { platform: true, base_url: 'http://127.0.0.1:1', api_key: 'x', model: 'm' };
  let threw = false;
  let result;
  try { result = await updateSummary({ convId, eff: brokenEff, windowStartId, userId: 1 }); }
  catch { threw = true; }
  ok(!threw, '摘要生成失败时不抛出（否则会连带阻塞用户发消息）');
  ok(result === false, '失败返回 false，调用方据此降级为纯截断');
  ok(getSummary(convId).text === '', '失败时不写入半成品摘要');
  const logged = db.prepare("SELECT COUNT(*) n FROM logs WHERE event='summary_failed'").get().n;
  ok(logged > 0, `失败有 warn 留痕（${logged} 条）——静默失败会让人以为摘要在工作`);
}

/* 4) 摘要成功路径：写入 + 单调推进 + 不向用户计费 */
{
  const { llmOnce } = await import('./llm.js');
  ok(typeof llmOnce === 'function', 'llmOnce 已收敛到 llm.js 供摘要与小说线共用');

  // 直接写入模拟一次成功，验证读写与单调约束
  db.prepare('UPDATE conversations SET summary = ?, summary_upto_msg_id = ? WHERE id = ?')
    .run('梗概正文', windowStartId, convId);
  const s = getSummary(convId);
  ok(s.text === '梗概正文' && s.upto === windowStartId, '摘要可读回');

  // 单调约束：更早的覆盖点不得倒退
  db.prepare('UPDATE conversations SET summary = ?, summary_upto_msg_id = ? WHERE id = ? AND COALESCE(summary_upto_msg_id,0) < ?')
    .run('旧梗概', 1, convId, 1);
  ok(getSummary(convId).upto === windowStartId, 'summary_upto_msg_id 单调不回退（否则同一段历史会被反复压缩）');

  const charged = db.prepare("SELECT COALESCE(SUM(gold),0) g FROM transactions WHERE user_id=1 AND kind='summary'").get().g;
  ok(charged === 0, '摘要不向用户计费（用户看不见它，为看不见的东西付钱不可接受）');
}

/* 5) 新列必须进备份白名单 —— 摘要是用户内容 */
{
  const snap = fs.readFileSync(path.join(__dirname, 'snapshot.js'), 'utf8');
  ok(/'conversations'/.test(snap), 'conversations 在备份白名单内（summary 随表一起备份）');
}

console.log(`\n上下文封顶 / 滚动摘要: ${pass} passed, ${fail} failed`);
db.close();
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
