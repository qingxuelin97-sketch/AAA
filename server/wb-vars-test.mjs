// 世界书变量持久化专项测试。
//
// —— 为什么这件事需要单独守 ——
// 变量状态此前完全由「每轮重扫整段历史里的 {{set:var=value}}」推导。上下文一加窗，
// 被挤出窗口的消息不再被扫描，第 3 回合定下的设定会在第 300 回合悄悄消失。
// 这类故障比「上下文超限」难缠得多：没有报错、没有日志，作者只会觉得「AI 忘了设定」，
// 而且无从复现——同一张卡在短会话里一切正常。
//
// 直接驱动 chat.js 导出的纯逻辑函数，不起 HTTP 服务。
// 运行：npm run test:wb-vars
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'wb-vars-test.tmp.sqlite');
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.env.DB_PATH = DB_PATH;

const db = (await import('./db.js')).default;
const { loadWbVars, mergeWbVars, invalidateWbVars, parseWbSets } = await import('./routes/chat.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — 实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`}`);

db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1,'u','x')").run();
db.prepare("INSERT INTO characters (id, owner_id, name) VALUES (1,1,'c')").run();
const newConv = () => {
  const info = db.prepare('INSERT INTO conversations (user_id, character_id) VALUES (1,1)').run();
  return { id: Number(info.lastInsertRowid) };
};
const say = (convId, role, content) => db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(convId, role, content);
const rawVars = (convId) => db.prepare('SELECT wb_vars FROM conversations WHERE id = ?').get(convId).wb_vars;

console.log('世界书变量持久化');

/* 1) 解析 */
eq(parseWbSets('剧情推进{{set:met_queen=true}}后续'), { met_queen: 'true' }, '解析单个 {{set:}}');
eq(parseWbSets('{{set:chapter=2}} 和 {{set:mood=calm}}'), { chapter: '2', mood: 'calm' }, '解析多个 {{set:}}');
eq(parseWbSets('{{set:x=1}}{{set:x=9}}'), { x: '9' }, '同名变量后写覆盖先写');
eq(parseWbSets('没有指令'), {}, '无指令返回空');
eq(parseWbSets(null), {}, 'null 内容不抛错');

/* 2) 存量会话：wb_vars 为 NULL 时一次性全量回扫 */
{
  const c = newConv();
  say(c.id, 'user', '你好');
  say(c.id, 'assistant', '好的{{set:met_queen=true}}');
  say(c.id, 'user', '继续');
  say(c.id, 'assistant', '进入第二章{{set:chapter=2}}');
  ok(rawVars(c.id) === null, '新列对存量会话为 NULL（不能给 DEFAULT，否则会被当成「已回扫且为空」）');
  eq(loadWbVars(c, []), { met_queen: 'true', chapter: '2' }, '首次读取全量回扫出历史变量');
  eq(JSON.parse(rawVars(c.id)), { met_queen: 'true', chapter: '2' }, '回扫结果已落库');
}

/* 3) 回扫只认 assistant，且不依赖传入的 history（history 将来会被加窗） */
{
  const c = newConv();
  say(c.id, 'user', '我说{{set:hacked=yes}}');       // 用户消息里的指令不算数
  say(c.id, 'assistant', '好{{set:trust=1}}');
  eq(loadWbVars(c, []), { trust: '1' }, '用户消息里的 {{set:}} 不生效（否则玩家可自行改写世界状态）');
  ok(!('hacked' in loadWbVars(c, [])), '玩家无法通过发言注入变量');
}

/* 4) 增量合并：新回复只解析自己那一条 */
{
  const c = newConv();
  say(c.id, 'assistant', '开局{{set:a=1}}');
  loadWbVars(c, []);                       // 回扫并落库
  mergeWbVars(c.id, '推进{{set:b=2}}');
  eq(JSON.parse(rawVars(c.id)), { a: '1', b: '2' }, '新回复的变量合并进已持久化状态');
  mergeWbVars(c.id, '改写{{set:a=9}}');
  eq(JSON.parse(rawVars(c.id)), { a: '9', b: '2' }, '同名变量被新值覆盖');
  mergeWbVars(c.id, '这条没有指令');
  eq(JSON.parse(rawVars(c.id)), { a: '9', b: '2' }, '无指令的回复不改动已有变量');
}

/* 5) 核心场景：历史被裁剪后变量依然存活 —— 这正是加窗会踩的坑 */
{
  const c = newConv();
  say(c.id, 'assistant', '第 3 回合定下设定{{set:met_queen=true}}');
  loadWbVars(c, []);
  for (let i = 0; i < 300; i++) say(c.id, 'assistant', `第 ${i} 段普通剧情`);
  // 模拟加窗：只把最近 20 条交给 buildSystemPrompt
  const windowed = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 20').all(c.id).reverse();
  ok(!windowed.some(m => m.content.includes('met_queen')), '窗口内确实已经看不到那条设定了');
  eq(loadWbVars(c, windowed), { met_queen: 'true' }, '窗口外的变量仍然生效（改造前这里会丢）');
}

/* 6) 编辑/删除消息后置空重扫，保持与改造前一致的语义 */
{
  const c = newConv();
  say(c.id, 'assistant', '设定{{set:v=old}}');
  loadWbVars(c, []);
  eq(JSON.parse(rawVars(c.id)), { v: 'old' }, '初始变量已落库');
  db.prepare("UPDATE messages SET content = '设定{{set:v=new}}' WHERE conversation_id = ? AND role='assistant'").run(c.id);
  ok(JSON.parse(rawVars(c.id)).v === 'old', '仅改消息不会自动更新已持久化的变量');
  invalidateWbVars(c.id);
  ok(rawVars(c.id) === null, '置空标记为「待重扫」');
  eq(loadWbVars(c, []), { v: 'new' }, '重扫后取到编辑后的值（与改造前每轮重扫的语义一致）');
}

/* 7) 损坏数据不能拖垮对话 */
{
  const c = newConv();
  say(c.id, 'assistant', '设定{{set:k=1}}');
  db.prepare("UPDATE conversations SET wb_vars = '{不是合法 JSON' WHERE id = ?").run(c.id);
  eq(loadWbVars(c, []), { k: '1' }, 'wb_vars 内容损坏时回落到全量重扫而不是抛错');
  eq(loadWbVars({ id: 999999 }, []), {}, '不存在的会话返回空对象');
  eq(loadWbVars(null, []), {}, 'conv 为空时返回空对象');
}

console.log(`\n世界书变量持久化: ${pass} passed, ${fail} failed`);
db.close();
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { fs.unlinkSync(f); } catch { /* */ } }
process.exit(fail ? 1 : 0);
