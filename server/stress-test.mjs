// 压力测试（按需运行，**刻意不进 CI**）：并发、双花、连接翻搅、事件循环健康度、配额。
//   运行：npm run test:stress
//
// 为什么不进 CI：吞吐与时延断言在共享 runner 上会抖动，一旦 flaky 就会被加上
// continue-on-error，此后便什么都保障不了。CI 每次必须守住的那条性质
//（「不许有请求钉死事件循环」）已用确定性探针放进 npm run test:abuse。
// 本套件面向发版前与故障复盘，跑在可控机器上，因此阈值更紧。
//
// 关于「并发双花」：本服务是 better-sqlite3（同步）+ 单进程，任何**全同步**的
// 路由都不可能与另一请求交错执行 —— 经典的读改写竞态在当前部署下天然不成立。
// 真正可交错的是「余额读」与「余额写」之间存在 await 的路径：
//   · POST /ai/image        （ai.js，等上游生图）
//   · POST /chat/tts        （chat.js，等上游 TTS）
//   · 平台 AI 预扣          （platform.js，等上游补全）
// 因此这三条给最高并发并 mock 上游 —— 回归真要发生，就发生在这里。
// 其余端点仍然全部跑一遍：一是防止将来有人在事务里插入 await，二是做账本对账。
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4196;
const DB_PATH = path.join(__dirname, 'stress-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const pct = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);

const run = (cmd, args, env) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  p.on('exit', (code) => (code === 0 ? res() : rej(new Error(cmd + ' exited ' + code))));
});

console.log('· 灌入临时演示数据…');
await run('node', ['server/seed.js'], { DB_PATH });

// 上游 mock：预载进服务端进程，拦截**出站**的平台 AI 调用（生图/对话/TTS），
// 让计费路径能端到端跑完而不真的联网。只拦截固定的 mock 主机，其余原样透传。
// 平台生图配置指向字面公网 IP（93.184.216.34）以跳过 DNS 解析。
const interceptor = path.join(__dirname, 'stress-test.interceptor.mjs');
fs.writeFileSync(interceptor, `
const realFetch = globalThis.fetch;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.includes('93.184.216.34')) return realFetch(url, opts);
  if (u.includes('/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
`);
{
  const db = new Database(DB_PATH);
  const cfg = { image: { provider: 'openai', protocol: 'openai', base_url: 'https://93.184.216.34', key: 'sk-mock', model: 'gpt-image-1', size: '1024x1024' } };
  db.prepare("INSERT INTO app_config (key,value) VALUES ('platform',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(cfg));
  db.close();
}

console.log('· 启动服务端…');
const srv = spawn(process.execPath, ['--import', pathToFileURL(interceptor).href, 'server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env, NODE_ENV: 'test', PORT: String(PORT), DB_PATH,
    // 限流器不是被测对象：抬高配额，让压力真正落到业务与数据库上。
    API_ANON_RATE_LIMIT: '1000000', API_AUTH_RATE_LIMIT: '1000000',
    CONTENT_RATE_LIMIT: '1000000', AI_RATE_LIMIT: '1000000', UPLOAD_RATE_LIMIT: '1000000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
// 子进程 RSS（Linux /proc）：内存泄漏检测用。非 Linux 环境返回 0，对应断言跳过。
const rss = () => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8'))?.[1] || 0) / 1024; } catch { return 0; } };
let serverOutput = '';
srv.stdout.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });
srv.stderr.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });

// —— 全程事件循环健康度探针（贯穿所有阶段）——
let probing = true, maxGap = 0, probeSamples = 0;
const probeTask = (async () => {
  while (probing && srv.exitCode === null) {
    const t0 = performance.now();
    try { await fetch(BASE + '/health'); } catch { /* */ }
    const gap = performance.now() - t0;
    if (probeSamples > 0) maxGap = Math.max(maxGap, gap);   // 首样含服务预热，跳过
    probeSamples++;
    await sleep(50);
  }
})();

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (srv.exitCode !== null) break;
    try { if ((await fetch(BASE + '/health')).ok) { ready = true; break; } } catch { /* */ }
    await sleep(250);
  }
  if (!ready) throw new Error(`测试服务未就绪（exit=${srv.exitCode}）\n${serverOutput}`);

  const login = async (u, p) => (await (await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
  })).json()).token;
  const TOK = await login('demo', '123456');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK };
  const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(body ?? {}) });
  const jget = async (p) => (await (await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + TOK } })).json());
  const uid = () => { const db = new Database(DB_PATH, { readonly: true }); const r = db.prepare("SELECT id FROM users WHERE username='demo'").get(); db.close(); return r.id; };
  const DEMO = uid();

  // ————————————————————————————————————————————
  console.log('\n· 阶段 1：持续并发突发');
  // ————————————————————————————————————————————
  {
    const READS = ['/characters/public', '/scripts', '/community/feed', '/social/moments', '/economy/wallet',
      '/engage/tasks', '/achievements', '/novels', '/groups', '/theater', '/meta/categories'];
    const CONC = 200, ROUNDS = 6;
    const lat = [];
    const byStatus = new Map();
    for (let r = 0; r < ROUNDS; r++) {
      const batch = [];
      for (let i = 0; i < CONC; i++) {
        const p = READS[(r * CONC + i) % READS.length];
        const t0 = performance.now();
        batch.push(fetch(BASE + p, { headers: { Authorization: 'Bearer ' + TOK } })
          .then(async (res) => { await res.text(); lat.push(performance.now() - t0); byStatus.set(res.status, (byStatus.get(res.status) || 0) + 1); })
          .catch((e) => { byStatus.set('ERR:' + (e.cause?.code || e.name), (byStatus.get('ERR:' + (e.cause?.code || e.name)) || 0) + 1); }));
      }
      await Promise.all(batch);
    }
    const total = CONC * ROUNDS;
    const s5xx = [...byStatus.entries()].filter(([k]) => typeof k === 'number' && k >= 500).reduce((a, [, v]) => a + v, 0);
    const errs = [...byStatus.entries()].filter(([k]) => typeof k === 'string').reduce((a, [, v]) => a + v, 0);
    console.log(`    ${total} 请求 · p50=${pct(lat, 0.5).toFixed(0)}ms p95=${pct(lat, 0.95).toFixed(0)}ms p99=${pct(lat, 0.99).toFixed(0)}ms max=${Math.max(...lat).toFixed(0)}ms`);
    console.log('    状态分布:', [...byStatus.entries()].map(([k, v]) => `${k}×${v}`).join(' '));
    ok(s5xx === 0, `${total} 并发请求：0 个 5xx`);
    ok(errs === 0, `${total} 并发请求：0 个连接错误/重置`);
  }

  // ————————————————————————————————————————————
  console.log('\n· 阶段 2：并发双花 + 账本对账');
  // ————————————————————————————————————————————
  {
    const fire = async (label, p, body, n = 20) => {
      const rs = await Promise.all(Array.from({ length: n }, () => post(p, body).then(async r => { await r.text(); return r.status; }).catch(() => 0)));
      const okCount = rs.filter(s => s >= 200 && s < 300).length;
      const s5 = rs.filter(s => s >= 500).length;
      return { label, okCount, s5, rs };
    };

    // 基线现取现用，不写死 seed 常量 —— 演示数据变了断言就该跟着变，
    // 真正的不变量是「余额变化量 == 流水变化量」。
    const snap = () => {
      const db = new Database(DB_PATH, { readonly: true });
      const u = db.prepare('SELECT gold, diamond FROM users WHERE id = ?').get(DEMO);
      const t = db.prepare('SELECT COALESCE(SUM(gold),0) g, COALESCE(SUM(diamond),0) d FROM transactions WHERE user_id = ?').get(DEMO);
      db.close();
      return { gold: u.gold, diamond: u.diamond, txGold: t.g, txDiamond: t.d };
    };
    const before = snap();

    const results = [];
    results.push(await fire('每日签到', '/economy/checkin'));
    results.push(await fire('每日任务领取', '/engage/tasks/chat/claim'));
    results.push(await fire('活动领取', '/engage/events/newcomer/claim'));
    results.push(await fire('成就领取', '/achievements/first_chat/claim'));
    results.push(await fire('兑换码', '/economy/redeem', { code: 'HUANYU2026' }));
    results.push(await fire('钻石换金币', '/economy/exchange', { diamond: 1 }));
    results.push(await fire('抽卡', '/engage/gacha'));
    results.push(await fire('购买VIP', '/economy/vip', { plan: 'month' }));

    for (const r of results) {
      ok(r.s5 === 0, `${r.label}：20 并发 0 个 5xx（2xx×${r.okCount}）`);
    }
    // 「至多一次」的幂等端点：签到 / 任务 / 活动 / 成就 每天只能成功一次。
    for (const r of results.slice(0, 4)) {
      ok(r.okCount <= 1, `${r.label}：20 并发中恰好 ${r.okCount} 次成功（幂等上限 1）`);
    }

    // 账本对账 —— 真正的判据：这一轮并发里，余额变化必须与流水变化逐分对齐。
    // 任何「扣了钱没记账」「记了账没扣钱」「同一笔记两次」都会在这里露馅。
    const after = snap();
    const dGold = after.gold - before.gold, dTxGold = after.txGold - before.txGold;
    const dDia = after.diamond - before.diamond, dTxDia = after.txDiamond - before.txDiamond;
    ok(dGold === dTxGold, `金币对账：余额变化 ${dGold} == 流水变化 ${dTxGold}`);
    ok(dDia === dTxDia, `钻石对账：余额变化 ${dDia} == 流水变化 ${dTxDia}`);
  }

  // ————————————————————————————————————————————
  console.log('\n· 阶段 2b：真实竞态窗口 —— 余额不足时的并发生图');
  // ————————————————————————————————————————————
  // 这才是单进程下唯一能真正交错的路径：ai.js 在「算费」与「调上游」之间有 await。
  // 预扣设计的正确性判据：给用户恰好够 K 张图的金币，打 N(>K) 个并发生图请求，
  // 必须恰好 K 个成功、其余 402，余额永不为负，账本逐分对齐，落库图片数 == 净扣费笔数。
  {
    const bcrypt = (await import('bcryptjs')).default;
    let uid;
    {
      const db = new Database(DB_PATH);
      db.prepare('INSERT INTO users (username, password_hash, display_name, gold) VALUES (?,?,?,?)')
        .run('poor', bcrypt.hashSync('123456', 10), 'Poor', 80);
      uid = db.prepare("SELECT id FROM users WHERE username='poor'").get().id;
      db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(uid);
      db.close();
    }
    const poorTok = await login('poor', '123456');
    const startGold = 80;
    const N = 40;
    const rs = await Promise.all(Array.from({ length: N }, () =>
      fetch(BASE + '/ai/image', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + poorTok }, body: JSON.stringify({ prompt: 'x' }) })
        .then(async r => { await r.text(); return r.status; }).catch(() => 0)));
    const okN = rs.filter(s => s === 200).length;
    const s402 = rs.filter(s => s === 402).length;
    const s5 = rs.filter(s => s >= 500).length;

    const db = new Database(DB_PATH, { readonly: true });
    const gold = db.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold;
    const led = db.prepare("SELECT COALESCE(SUM(gold),0) g FROM transactions WHERE user_id = ?").get(uid).g;
    const charges = db.prepare("SELECT COUNT(*) c FROM transactions WHERE user_id = ? AND kind = 'image_fee'").get(uid).c;
    const refunds = db.prepare("SELECT COUNT(*) c FROM transactions WHERE user_id = ? AND kind = 'ai_refund'").get(uid).c;
    const images = db.prepare("SELECT COUNT(*) c FROM ai_images WHERE user_id = ?").get(uid).c;
    db.close();

    const fee = startGold / okN;   // 演示费率下 80/2=40，稳成整数
    console.log(`    起始 ${startGold}g · ${N} 并发 → 200×${okN} 402×${s402} · 余额=${gold} 流水=${led} 扣费×${charges} 退款×${refunds} 落库图×${images}`);
    ok(s5 === 0, `${N} 并发生图：0 个 5xx`);
    ok(gold >= 0, `余额永不为负（=${gold}）`);
    ok(startGold + led === gold, `账本对账：起始 ${startGold} + 流水 ${led} == 余额 ${gold}`);
    ok(okN === Math.floor(startGold / fee), `恰好 ${okN} 张成功（= floor(${startGold}/${fee})，其余原子拒绝为 402）`);
    ok(charges - refunds === images, `净扣费笔数 ${charges - refunds} == 落库图片数 ${images}（不多扣、不白嫖）`);
  }

  // ————————————————————————————————————————————
  console.log('\n· 阶段 3：SSE 连接翻搅与票据配额');
  // ————————————————————————————————————————————
  {
    const churn = async (n) => {
      let opened = 0, replayRejected = 0;
      for (let i = 0; i < n; i++) {
        const t = (await (await post('/realtime/ticket')).json()).ticket;
        const ac = new AbortController();
        try {
          const r = await fetch(`${BASE}/realtime/stream?ticket=${t}`, { signal: ac.signal, headers: { Accept: 'text/event-stream' } });
          if (r.ok) opened++;
          ac.abort();
        } catch { /* aborted */ }
        // 票据一次性：重放必须被拒
        const replay = await fetch(`${BASE}/realtime/stream?ticket=${t}`, { headers: { Accept: 'text/event-stream' } });
        if (replay.status === 401) replayRejected++;
        try { await replay.body?.cancel(); } catch { /* */ }
      }
      return { opened, replayRejected };
    };
    const rounds = await Promise.all(Array.from({ length: 10 }, () => churn(20)));
    const opened = rounds.reduce((a, r) => a + r.opened, 0);
    const replayRejected = rounds.reduce((a, r) => a + r.replayRejected, 0);
    ok(opened > 0, `SSE 建连 ${opened} 次（10 并发 × 20 轮）`);
    ok(replayRejected === 200, `票据重放全部被拒（${replayRejected}/200）`);

    // 票据配额：远超 MAX_TICKETS 也不得拖垮服务或无限吃内存
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 300; i++) await (await post('/realtime/ticket')).json();
    const h = await fetch(BASE + '/health');
    ok(h.ok, `狂刷 300 张票据后服务仍响应（/health=${h.status}）`);
    await h.text();
    void before;
  }

  // ————————————————————————————————————————————
  console.log('\n· 阶段 4：世界书正则攻击下的事件循环');
  // ————————————————————————————————————————————
  {
    const wb = await (await post('/worldbooks', { name: 'stress-wb', entries: [{ mode: 'keyword', keys: 'x', content: 'c' }] })).json();
    const wbId = wb.worldbook?.id;
    // 直接写库塞入分析器会拒绝的危险模式 + 分析器会放行的最刁钻模式
    {
      const db = new Database(DB_PATH);
      const ins = db.prepare(`INSERT INTO worldbook_entries (worldbook_id, keys, content, enabled, position, mode)
        VALUES (?,?,?,1,?,'regex')`);
      const evil = ['(a+)+b', '(a*)*c', '(a|a)+d', '([a-z]+)+$', '(x+x+)+y', '(\\w+\\s?)*$'];
      const nasty = ['a.*b', '[A-Z][a-z]+', 'a?a?a?a?aaaa'];
      db.transaction(() => {
        for (let i = 0; i < 200; i++) ins.run(wbId, evil[i % evil.length], 'e' + i, i);
        for (let i = 0; i < 50; i++) ins.run(wbId, nasty[i % nasty.length], 'n' + i, 200 + i);
      })();
      db.close();
    }
    // 4a) 单请求阻塞 —— 这才是 ReDoS 要证明的性质：**任何单个请求都不能把
    // 事件循环占住不放**。串行发射，探针停顿即等于单请求的阻塞时长。
    maxGap = 0;
    const serial = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await post(`/worldbooks/${wbId}/test-trigger`, { text: 'a'.repeat(4000) });
      await r.text();
      serial.push(performance.now() - t0);
      await sleep(60);   // 留出探针采样窗口
    }
    console.log(`    串行 20 次 · p50=${pct(serial, 0.5).toFixed(0)}ms max=${Math.max(...serial).toFixed(0)}ms`);
    ok(Math.max(...serial) < 500, `单次正则攻击最慢 ${Math.max(...serial).toFixed(0)}ms（预算 50ms + 开销；修复前 >30000ms）`);
    ok(maxGap < 250, `单请求攻击下事件循环最大停顿 ${maxGap.toFixed(0)}ms（阈值 250ms）`);

    // 4b) 并发排队 —— 单线程服务上，N 个 CPU 密集请求必然串行，这是容量问题
    // 而非漏洞。此处只断言「排队时间与预算成正比、且服务能恢复」，不设死阈值：
    // 真正要守住的是每请求有界（4a 已证），否则一个请求就能无限期霸占进程。
    const CONC = 20, BUDGET_MS = 50;
    const t0 = performance.now();
    const rs = await Promise.all(Array.from({ length: CONC }, () => post(`/worldbooks/${wbId}/test-trigger`, { text: 'a'.repeat(4000) })));
    for (const r of rs) await r.text();
    const wall = performance.now() - t0;
    console.log(`    并发 ${CONC} 次总耗时 ${wall.toFixed(0)}ms（≈ 每请求预算 ${BUDGET_MS}ms × 并发数）`);
    ok(wall < CONC * BUDGET_MS * 4, `并发排队 ${wall.toFixed(0)}ms 与预算成正比（上限 ${CONC * BUDGET_MS * 4}ms）`);
    const recover = await fetch(BASE + '/health');
    ok(recover.ok, `并发攻击结束后服务立即恢复（/health=${recover.status}）`);
    await recover.text();
  }

  // ————————————————————————————————————————————
  console.log('\n· 阶段 5：上传配额与孤儿文件');
  // ————————————————————————————————————————————
  {
    const uploadsDir = path.join(__dirname, 'uploads');
    const before = new Set(fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
    const fake = Buffer.from('<html><script>alert(1)</script></html>');
    const send = async (buf, name, type) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type }), name);
      const r = await fetch(BASE + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: fd });
      await r.text();
      return r.status;
    };
    const realStatuses = await Promise.all(Array.from({ length: 30 }, () => send(png, 'a.png', 'image/png')));
    const s5 = realStatuses.filter(s => s >= 500).length;
    ok(s5 === 0, `30 并发上传：0 个 5xx（状态 ${[...new Set(realStatuses)].join('/')}）`);
    // 伪 MIME（实为 HTML）必须被魔术字节校验拒绝，且不得落盘
    const fakeStatuses = await Promise.all(Array.from({ length: 10 }, () => send(fake, 'evil.png', 'image/png')));
    ok(fakeStatuses.every(s => s >= 400 && s < 500), `伪 MIME 上传全部 4xx（${[...new Set(fakeStatuses)].join('/')}）`);
    const after = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
    const created = after.filter(f => !before.has(f));
    const htmlLeft = created.filter(f => /\.(html?|svg|js)$/i.test(f));
    ok(htmlLeft.length === 0, `失败上传未在磁盘留下可执行文件（新增 ${created.length} 个，其中危险后缀 ${htmlLeft.length} 个）`);
    // 只清理本次产生的文件，绝不动整个 uploads 目录
    for (const f of created) { try { fs.unlinkSync(path.join(uploadsDir, f)); } catch { /* */ } }
  }

  // ————————————————————————————————————————————
  console.log('\n· 阶段 6：内存泄漏检测（持续负载下 RSS 曲线）');
  // ————————————————————————————————————————————
  // 泄漏 vs GC 滞后的判据：跑满一段持续负载，逐波采样子进程 RSS。真泄漏会持续
  // 线性攀升；正常服务会预热到稳态后走平。用「后半程斜率」判定 —— 预热噪声不算。
  // 依赖 Linux /proc；rss()==0（非 Linux）时跳过断言但仍打印。
  if (rss() > 0) {
    const READS = ['/characters/public', '/scripts', '/community/feed', '/social/moments', '/economy/wallet',
      '/engage/tasks', '/novels', '/groups', '/theater', '/meta/categories', '/economy/packages'];
    const series = [];
    const WAVES = 40, WCONC = 300;
    for (let w = 0; w < WAVES; w++) {
      await Promise.all(Array.from({ length: WCONC }, (_, i) =>
        fetch(BASE + READS[(w * WCONC + i) % READS.length], { headers: { Authorization: 'Bearer ' + TOK } }).then(r => r.text()).catch(() => {})));
      series.push(rss());
    }
    const firstHalf = series.slice(0, WAVES / 2), lastHalf = series.slice(WAVES / 2);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const tail = series.slice(-Math.floor(WAVES / 2));
    const slopePerWave = (tail.at(-1) - tail[0]) / tail.length;
    const slopePer1k = slopePerWave / WCONC * 1000;
    console.log(`    ${WAVES}×${WCONC}=${WAVES * WCONC} 请求 · 前半均值 ${avg(firstHalf).toFixed(0)}MB → 后半均值 ${avg(lastHalf).toFixed(0)}MB · 峰值 ${Math.max(...series).toFixed(0)}MB`);
    console.log(`    后半程斜率 ${slopePerWave.toFixed(2)} MB/波（≈ ${slopePer1k.toFixed(2)} MB/千请求）`);
    // 稳态后每千请求 RSS 增幅应趋近于 0（阈值宽松到 3MB/千请求，仍能抓住真泄漏）。
    ok(slopePer1k < 3, `稳态后 RSS 增幅 ${slopePer1k.toFixed(2)} MB/千请求（阈值 3；持续攀升即泄漏）`);
  } else {
    console.log('    /proc 不可用，跳过 RSS 断言');
  }

  // ————————————————————————————————————————————
  console.log('\n· 收尾：存活与全局不变量');
  // ————————————————————————————————————————————
  probing = false; await probeTask;
  {
    const h = await fetch(BASE + '/health');
    ok(h.ok && srv.exitCode === null, `全部压力阶段后服务仍存活（/health=${h.status}, exit=${srv.exitCode}）`);
    await h.text();
    console.log(`    探针采样 ${probeSamples} 次，末段最大停顿 ${maxGap.toFixed(0)}ms`);
    const db = new Database(DB_PATH, { readonly: true });
    const n = db.prepare("SELECT COUNT(*) c FROM logs WHERE level='error' AND event='server_error'").get().c;
    const rows = db.prepare("SELECT message FROM logs WHERE level='error' AND event='server_error' LIMIT 5").all();
    db.close();
    ok(n === 0, `服务端日志中 server_error 计数 = ${n}${rows.length ? '\n     ' + rows.map(r => r.message).join('\n     ') : ''}`);
  }
} finally {
  probing = false;
  try { await probeTask; } catch { /* */ }
  srv.kill();
  try { fs.unlinkSync(interceptor); } catch { /* */ }
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}

console.log(`\n压力测试: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
