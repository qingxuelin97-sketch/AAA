// 防呆（离谱输入）回归测试：假设用户会用任何方式滥用接口 —— 类型错乱、超长字符串、
// 负数/NaN/Infinity、深层嵌套 JSON、原型污染、超大分页、控制字符、代理对…
// 核心不变量只有一条：**服务端可以拒绝，但绝不能 500，更不能崩**。
//
// 另外锁住本轮修复的具体行为（ReDoS / 小说越权读 / 参数上限 / 分页上限）。
// 运行：npm run test:abuse
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isLinearRegex, compileSafeRegex, num, jsonText } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4197;                       // 4198=sec/s7、4199=smoke，避开
const DB_PATH = path.join(__dirname, 'abuse-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

// ——————————————————————————————————————————————
// 阶段 0：纯单元（不依赖服务端）—— 正则安全分析器
// ——————————————————————————————————————————————
console.log('\n· 正则安全分析器（ReDoS 静态防护）');
{
  // 指数级形状：量词作用在「内部含量词或含 | 的分组」上
  const evil = ['(a+)+b', '(a*)*b', '(a|a)+b', '(a|ab)*c', '([a-z]+)+$', '(x+x+)+y', '(.*)*x'];
  ok(evil.every(p => isLinearRegex(p) === false), `拒绝 ${evil.length} 种指数级回溯模式`);
  // 相邻量词且字符集相交 → 有歧义
  ok(['a+a+b', String.raw`\d+\w+x`, '.*.*x'].every(p => isLinearRegex(p) === false), '拒绝字符集相交的相邻量词');
  // 相邻量词但字符集不相交 → 线性，放行（避免误伤合法模式）
  ok([String.raw`price:\s*\d+`, String.raw`\w+\s?$`].every(p => isLinearRegex(p) === true), '放行字符集不相交的相邻量词');
  // 无法静态推理的构造
  ok(['(?=a)b', '(?<=a)b', String.raw`(a)\1`, 'a{200}', 'x'.repeat(130)].every(p => isLinearRegex(p) === false), '拒绝前后瞻/反向引用/超大重复/超长模式');
  // 常规世界书关键词必须照常可用
  const good = ['dragon', '龙王', 'fire|ice|wind', '^Chapter', 'a.*b', String.raw`\d{1,3}`, '[A-Z][a-z]+', 'colou?r'];
  ok(good.every(p => isLinearRegex(p) === true), `放行 ${good.length} 种常规关键词模式`);

  // 真实攻击载荷：修复前 (a+)+b 对 24 个 a 就 >30s 不返回
  const t0 = performance.now();
  const re = compileSafeRegex('(a+)+b', 'i');
  const hit = re ? re.test('a'.repeat(24) + '!') : false;
  const dt = performance.now() - t0;
  ok(re === null && hit === false && dt < 500, `灾难性回溯载荷 ${dt.toFixed(1)}ms 内被拒（修复前 >30s）`);

  // 被放行的模式必须在扫描上限（2000 字）的恶意输入上保持线性
  let worst = 0;
  for (const p of good) {
    const r = compileSafeRegex(p, 'i');
    for (const hay of ['a'.repeat(2000), 'ab'.repeat(1000), 'a'.repeat(1999) + '!']) {
      const s = performance.now(); r?.test(hay); worst = Math.max(worst, performance.now() - s);
    }
  }
  ok(worst < 50, `放行模式在 2000 字恶意输入上最慢 ${worst.toFixed(1)}ms`);

  // 深层 JSON / 循环引用 → 400 而非 500
  let threw = 0;
  const deep = (n) => { let a = []; for (let i = 0; i < n; i++) a = [a]; return a; };
  try { jsonText(deep(30000), 32768); } catch (e) { if (e.status === 400) threw++; }
  const cyc = {}; cyc.self = cyc;
  try { jsonText(cyc, 32768); } catch (e) { if (e.status === 400) threw++; }
  ok(threw === 2, 'jsonText 把深层嵌套/循环引用转成 400');
  ok(num({}, 0, 2, 0.8) === 0.8 && num([], 0, 2, 0.8) === 0.8 && num(1 / 0, 0, 2, 0.8) === 0.8,
    'num 拒绝 {} / [] / Infinity（Number([])===0 陷阱）');
}

// ——————————————————————————————————————————————
// 启动服务端
// ——————————————————————————————————————————————
const run = (cmd, args, env) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  p.on('exit', (code) => (code === 0 ? res() : rej(new Error(cmd + ' exited ' + code))));
});
console.log('\n· 灌入临时演示数据…');
await run('node', ['server/seed.js'], { DB_PATH });

console.log('· 启动服务端…');
const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env, NODE_ENV: 'test', PORT: String(PORT), DB_PATH,
    // 限流不是本套件的被测对象。不抬高的话，矩阵会先把配额打空，后续用例
    // 全部收到 429，就测不到「参数校验」这些真正要验的分支了。
    API_ANON_RATE_LIMIT: '1000000', API_AUTH_RATE_LIMIT: '1000000',
    CONTENT_RATE_LIMIT: '1000000', AI_RATE_LIMIT: '1000000', UPLOAD_RATE_LIMIT: '1000000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
srv.stdout.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });
srv.stderr.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (srv.exitCode !== null) break;
    try { if ((await fetch(BASE + '/health')).ok) { ready = true; break; } } catch { /* retry */ }
    await sleep(250);
  }
  if (!ready) throw new Error(`测试服务未就绪（exit=${srv.exitCode}）\n${serverOutput}`);

  const login = async (u, p) => (await (await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
  })).json()).token;

  // 第二个账号直接写库（绕开邮箱验证码流程），用于越权读用例。
  {
    const db = new Database(DB_PATH);
    const bcrypt = (await import('bcryptjs')).default;
    db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)')
      .run('abuser', bcrypt.hashSync('123456', 10), 'Abuser');
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(db.prepare("SELECT id FROM users WHERE username='abuser'").get().id);
    db.close();
  }
  const TOK = await login('demo', '123456');
  const TOK2 = await login('abuser', '123456');
  const H = (t = TOK) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
  const send = (method, p, body, t = TOK) => fetch(BASE + p, {
    method, headers: H(t), body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const jget = async (p, t = TOK) => (await (await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + t } })).json());

  // ————————————————————————————————————————————
  // 阶段 1：离谱输入矩阵
  // ————————————————————————————————————————————
  console.log('\n· 离谱输入矩阵（类型/长度/数值/编码）');
  const deepJsonText = (n) => '['.repeat(n) + ']'.repeat(n);   // 手工构造，避免本进程 stringify 爆栈
  const HOSTILE = [
    ['object', {}], ['array', [1, 2, 3]], ['null', null], ['bool', true],
    ['number', 12345], ['numeric-string', '99999999999999999999'],
    ['nan', 'NaN'], ['inf', 1e308 * 10], ['neg', -1], ['zero', 0], ['float', 1.5],
    ['huge', 'x'.repeat(300000)], ['emoji', '👩‍👩‍👧‍👦'.repeat(500)],
    ['rtl', '‮evil'], ['surrogate', '\ud800'], ['nul', 'a b'],
    ['proto', JSON.parse('{"__proto__":{"pwned":true}}')],
    ['nested', { a: { b: { c: { d: [1, 2, 3] } } } }],
  ];

  const cid = (await jget('/characters/public')).characters?.[0]?.id;
  const convId = (await jget('/chat/conversations')).conversations?.[0]?.id;

  const TARGETS = [
    ['PUT', '/settings', {}, ['llm_base_url', 'llm_api_key', 'llm_model', 'llm_temperature', 'llm_max_tokens', 'theme', 'privacy_profile', 'allow_dm', 'nsfw', 'interests', 'voice_name']],
    ['POST', '/characters', { name: 'probe' }, ['name', 'intro', 'persona', 'greeting', 'tags', 'avatar', 'background', 'background_type', 'is_public', 'world']],
    ['POST', '/worldbooks', { name: 'probe' }, ['name', 'description', 'tags', 'entries', 'scan_depth', 'token_budget', 'max_active', 'front_schema', 'variable_schema']],
    ['POST', '/community/posts', { title: 'probe' }, ['title', 'body', 'tags', 'cover', 'payload', 'type', 'character_id']],
    ['POST', '/community/push', { post_id: 1, to_username: 'demo' }, ['post_id', 'to_username', 'note']],
    ['POST', '/groups', { name: 'probe' }, ['name', 'description', 'avatar', 'is_public']],
    ['POST', '/theater', { name: 'probe' }, ['name', 'stage', 'world', 'style', 'is_public']],
    ['POST', '/novels', { title: 'probe' }, ['title', 'logline', 'genre', 'tags', 'cover']],
    ['POST', '/scripts', { title: 'probe' }, ['title', 'summary', 'price', 'tags', 'content']],
    ['POST', '/economy/exchange', { diamond: 1 }, ['diamond']],
    ['POST', '/economy/redeem', { code: 'X' }, ['code']],
    ['POST', '/social/moments', { text: 'probe' }, ['text', 'image']],
    ['PUT', '/auth/profile', {}, ['display_name', 'bio', 'avatar', 'banner']],
    ['POST', '/logs/client', { message: 'probe' }, ['level', 'event', 'message', 'extra', 'session_id']],
    ...(convId ? [['POST', `/chat/conversations/${convId}/memories`, {}, ['content']]] : []),
    ...(cid ? [['POST', '/characters/' + cid + '/favorite', {}, ['on']]] : []),
    ...(cid ? [['PUT', '/characters/' + cid, {}, ['name', 'intro', 'persona', 'tags', 'category', 'avatar', 'voice_speed', 'background_type']]] : []),
  ];

  let sent = 0, got5xx = 0, got2xx = 0, got4xx = 0;
  const fiveXX = [];
  for (const [method, p, base, fields] of TARGETS) {
    for (const f of fields) {
      for (const [label, val] of HOSTILE) {
        let r;
        try { r = await send(method, p, { ...base, [f]: val }); }
        catch { continue; }   // 传输层偶发错误不是被测性质
        sent++;
        if (r.status >= 500) { got5xx++; if (fiveXX.length < 12) fiveXX.push(`${method} ${p} ${f}=${label} → ${r.status}`); }
        else if (r.status >= 400) got4xx++; else got2xx++;
        await r.text().catch(() => {});
      }
    }
  }
  ok(got5xx === 0, `${sent} 个离谱输入：0 个 5xx（4xx=${got4xx} 2xx=${got2xx}）${fiveXX.length ? '\n     ' + fiveXX.join('\n     ') : ''}`);
  ok(({}).pwned === undefined && Object.prototype.pwned === undefined, '__proto__ 注入未污染原型链');

  // 路径参数同样喂离谱值
  console.log('\n· 路径参数与查询串');
  const WEIRD_IDS = ['0', '-1', 'abc', '1e308', '9'.repeat(40), 'null', 'undefined', '%00', '../../etc/passwd', '1;DROP TABLE users'];
  const PATHS = ['/characters/:id', '/chat/conversations/:id', '/groups/:id', '/theater/:id', '/novels/:id',
    '/scripts/:id', '/users/:id', '/worldbooks/:id', '/parliament/proposals/:id/comments'];
  let pathSent = 0, path5xx = 0;
  for (const tpl of PATHS) {
    for (const id of WEIRD_IDS) {
      const r = await fetch(BASE + tpl.replace(':id', encodeURIComponent(id)), { headers: { Authorization: 'Bearer ' + TOK } });
      pathSent++; if (r.status >= 500) path5xx++;
      await r.text();
    }
  }
  ok(path5xx === 0, `${pathSent} 个离谱路径参数：0 个 5xx`);

  // ————————————————————————————————————————————
  // 阶段 2：锁住本轮每一处修复
  // ————————————————————————————————————————————
  console.log('\n· ReDoS：写入侧拒绝 + 存量数据读取侧兜底');
  {
    const r = await send('POST', '/worldbooks', { name: 'redos', entries: [{ mode: 'regex', keys: '(a+)+b', content: 'x' }] });
    ok(r.status === 400, `新建世界书带灾难性正则 → ${r.status}（期望 400）`);
    await r.text();

    const created = await (await send('POST', '/worldbooks', { name: 'safe-wb', entries: [{ mode: 'keyword', keys: 'dragon', content: 'x' }] })).json();
    const wbId = created.worldbook?.id;
    const upd = await send('PUT', '/worldbooks/' + wbId, { entries: [{ mode: 'regex', keys: '(x+x+)+y', content: 'x' }] });
    ok(upd.status === 400, `更新世界书塞入灾难性正则 → ${upd.status}（期望 400）`);
    await upd.text();

    // 模拟「防护上线前就已入库」的危险模式：直接写库，绕开写入侧校验。
    {
      const db = new Database(DB_PATH);
      db.prepare(`INSERT INTO worldbook_entries (worldbook_id, keys, content, enabled, position, mode)
        VALUES (?,?,?,1,0,'regex')`).run(wbId, '(a+)+b', 'legacy evil');
      db.close();
    }
    const t0 = performance.now();
    const trig = await send('POST', `/worldbooks/${wbId}/test-trigger`, { text: 'a'.repeat(2000) });
    const body = await trig.json();
    const dt = performance.now() - t0;
    ok(trig.status === 200 && dt < 1000, `存量危险正则触发预览 ${dt.toFixed(0)}ms 内返回（修复前挂死）`);
    ok(JSON.stringify(body).includes('regex_rejected'), '预览回显 regex_rejected，作者可知模式为何不生效');
  }

  console.log('\n· 小说越权读：删除已发布剧情线后不得泄露未发布内容');
  {
    const nv = await (await send('POST', '/novels', { title: '越权探针' })).json();
    const nid = nv.novel?.id;
    const runs = [];
    for (const nm of ['线A', '线B']) {
      const r = await (await send('POST', `/novels/${nid}/runs`, { name: nm })).json();
      if (r.run?.id) runs.push(r.run.id);
    }
    ok(runs.length >= 2, `建立 ${runs.length} 条剧情线`);
    await (await send('POST', `/novels/${nid}/publish`, { publish: true, run_id: runs[0] })).text();
    const delR = await send('DELETE', `/novels/runs/${runs[0]}`);
    await delR.text();
    const readAsOther = await send('GET', `/novels/${nid}/read`, undefined, TOK2);
    const readBody = await readAsOther.json();
    ok(readAsOther.status === 403, `删除已发布线后，他人读取 → ${readAsOther.status}（期望 403）`);
    ok(!readBody.beats || readBody.beats.length === 0, '响应中不含任何未发布的 beats');
  }

  console.log('\n· 参数上限与枚举');
  {
    const r1 = await send('PUT', '/settings', { llm_temperature: {} });
    await r1.text();
    ok(r1.status < 500, `llm_temperature:{} → ${r1.status}（不得 500）`);
    await (await send('PUT', '/settings', { privacy_profile: '💀', allow_dm: 'nonsense' })).text();
    const s = await jget('/settings');
    ok(['public', 'followers', 'private'].includes(s.settings?.privacy_profile), `privacy_profile 收敛到枚举（=${s.settings?.privacy_profile}）`);
    ok(['all', 'followers', 'none'].includes(s.settings?.allow_dm), `allow_dm 收敛到枚举（=${s.settings?.allow_dm}）`);
    await (await send('PUT', '/settings', { llm_base_url: 'https://x.example/' + 'y'.repeat(300000) })).text();
    const s2 = await jget('/settings');
    ok((s2.settings?.llm_base_url || '').length <= 500, `llm_base_url 落库长度 ${(s2.settings?.llm_base_url || '').length} ≤ 500`);

    // 深层 JSON：修复前 JSON.stringify 抛 RangeError → 500
    const deepPost = await send('POST', '/community/posts', `{"title":"deep","payload":${deepJsonText(30000)}}`);
    ok(deepPost.status >= 400 && deepPost.status < 500, `深层嵌套 payload → ${deepPost.status}（期望 4xx，不得 500）`);
    await deepPost.text();

    // 单条聊天消息上限：/complete 在调用上游模型之前就应拒绝，不该先流式再失败。
    if (convId) {
      const big = await send('POST', `/chat/conversations/${convId}/complete`, { content: 'x'.repeat(200000) });
      ok(big.status >= 400 && big.status < 500, `20 万字聊天消息 → ${big.status}（期望 4xx）`);
      await big.text();
      const objContent = await send('POST', `/chat/conversations/${convId}/complete`, { content: { evil: 1 } });
      ok(objContent.status >= 400 && objContent.status < 500, `content 传对象 → ${objContent.status}（期望 4xx）`);
      await objContent.text();
    }
  }

  console.log('\n· 分页上限');
  {
    const g = await (await send('POST', '/groups', { name: '分页探针' })).json();
    const gid = g.group?.id;
    const db = new Database(DB_PATH);
    const uid = db.prepare("SELECT id FROM users WHERE username='demo'").get().id;
    const ins = db.prepare('INSERT INTO group_messages (group_id, user_id, content) VALUES (?,?,?)');
    const many = db.transaction(() => { for (let i = 0; i < 500; i++) ins.run(gid, uid, 'm' + i); });
    many();
    db.close();
    const page = await jget(`/groups/${gid}/messages?after=0`);
    ok((page.messages || []).length <= 200, `群消息一次最多返回 ${(page.messages || []).length} 条（≤200）`);
    for (const bad of ['-1', 'abc', '1e308', '99999999999999999999']) {
      const r = await fetch(`${BASE}/groups/${gid}/messages?after=${bad}`, { headers: { Authorization: 'Bearer ' + TOK } });
      ok(r.status < 500, `after=${bad} → ${r.status}（不得 500）`);
      await r.text();
    }
  }

  console.log('\n· 请求体与 JSON 边界');
  {
    const oversize = await fetch(BASE + '/community/posts', {
      method: 'POST', headers: H(), body: JSON.stringify({ title: 'x', body: 'y'.repeat(3 * 1024 * 1024) }),
    });
    ok(oversize.status === 413, `3MB 请求体 → ${oversize.status}（期望 413）`);
    await oversize.text();
    const dup = await send('POST', '/community/posts', '{"title":"a","title":"b"}');
    ok(dup.status < 500, `重复 JSON 键 → ${dup.status}（不得 500）`);
    await dup.text();
    const topArr = await send('POST', '/community/posts', '[1,2,3]');
    ok(topArr.status < 500, `顶层数组 → ${topArr.status}（不得 500）`);
    await topArr.text();
    const broken = await fetch(BASE + '/community/posts', { method: 'POST', headers: H(), body: '{"title":' });
    ok(broken.status >= 400 && broken.status < 500, `畸形 JSON → ${broken.status}（期望 4xx）`);
    await broken.text();
    const wrongCt = await fetch(BASE + '/community/posts', {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + TOK }, body: 'not json',
    });
    ok(wrongCt.status < 500, `text/plain 请求体 → ${wrongCt.status}（不得 500）`);
    await wrongCt.text();
  }

  // ————————————————————————————————————————————
  // 阶段 3：事件循环阻塞探针（ReDoS 修复的正面证明）
  // ————————————————————————————————————————————
  console.log('\n· 事件循环阻塞探针');
  {
    const wb = await (await send('POST', '/worldbooks', { name: 'loop-probe', entries: [{ mode: 'keyword', keys: 'x', content: 'c' }] })).json();
    const wbId = wb.worldbook?.id;
    // 直接写库塞入一批危险模式（模拟存量数据 / 绕过写入校验的攻击者）
    {
      const db = new Database(DB_PATH);
      const ins = db.prepare(`INSERT INTO worldbook_entries (worldbook_id, keys, content, enabled, position, mode)
        VALUES (?,?,?,1,?,'regex')`);
      const tx = db.transaction(() => {
        const evil = ['(a+)+b', '(a*)*c', '(a|a)+d', '([a-z]+)+$', '(x+x+)+y'];
        for (let i = 0; i < 100; i++) ins.run(wbId, evil[i % evil.length], 'evil' + i, i);
      });
      tx();
      db.close();
    }
    // 探针以 20Hz 轮询 /health（该路径不写访问日志，开销可忽略），
    // 攻击流量在整个窗口内持续发射 —— 单发太快会导致探针只采到 1 次样，测不出东西。
    const WINDOW_MS = 2000;
    let maxGap = 0, samples = 0, probing = true, attacksSent = 0;
    const probe = (async () => {
      let last = performance.now();
      while (probing) {
        try { await fetch(BASE + '/health'); } catch { /* */ }
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last); last = now; samples++;
        await sleep(50);
      }
    })();
    const until = Date.now() + WINDOW_MS;
    // 连接被重置（本地 socket 压力下偶发）不是被测性质，吞掉即可 —— 否则
    // CI 会因为偶发 ECONNRESET 变红，那种测试很快就会被人加上 continue-on-error。
    const fireOne = () => send('POST', `/worldbooks/${wbId}/test-trigger`, { text: 'a'.repeat(4000) })
      .then(r => r.text()).catch(() => null);
    while (Date.now() < until) {
      await Promise.all(Array.from({ length: 4 }, fireOne));
      attacksSent += 4;
    }
    probing = false; await probe;
    ok(samples >= 15, `健康探针在 ${WINDOW_MS}ms 内采样 ${samples} 次（并发攻击 ${attacksSent} 发）`);
    ok(maxGap < 1000, `攻击期间事件循环最大停顿 ${maxGap.toFixed(0)}ms（阈值 1000ms；修复前 >30000ms）`);
  }

  // ————————————————————————————————————————————
  // 阶段 4：存活与全局零 5xx 不变量
  // ————————————————————————————————————————————
  console.log('\n· 存活与全局不变量');
  {
    const h = await fetch(BASE + '/health');
    ok(h.ok && srv.exitCode === null, `跑完全部用例后服务仍存活（/health=${h.status}, exit=${srv.exitCode}）`);
    await h.text();
    // index.js 会把每个 5xx 连堆栈落库 —— 把「没有 500」升级为全套件不变量。
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT message, extra FROM logs WHERE level='error' AND event='server_error' ORDER BY id LIMIT 5").all();
    const n = db.prepare("SELECT COUNT(*) c FROM logs WHERE level='error' AND event='server_error'").get().c;
    db.close();
    ok(n === 0, `服务端日志中 server_error 计数 = ${n}${rows.length ? '\n     ' + rows.map(r => r.message).join('\n     ') : ''}`);
  }
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}

console.log(`\n防呆回归: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
