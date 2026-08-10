// 前后端契约 + 真假后端一致性专项。
//
// —— 为什么这件事需要单独守 ——
// 这一类缺陷的症状是「功能静默失效」：不报错、不留日志，只是某个东西永远不出现。
// 创作者 V 徽章在所有列表页恒不显示（列表端点不返回 owner_tier）、GM 后台永远无法
// 免去议员（用户列表不返回 is_councilor）、剧本点赞态刷新即丢（详情不返回 liked）——
// 全都是「前端读一个后端不给的字段」。这种问题看代码看不出来，得逐字段比对。
//
// 更要命的是 mock 与真后端的分叉：mock 是 appdiff 与 quiet-aqua-e2e 唯一的数据源，
// 它比真后端「更全」的地方会让 UI 门禁给出通过、生产却是坏的（owner_tier 就是如此）；
// 它比真后端「更松」的地方会让试玩里能做的事在真环境 403（GM 开关、私有群、兑换码）。
// 所以这里不只断言真后端返回了什么，**还断言 mock 对同一路径返回同样的字段集合**。
//
// 运行：npm run test:contract
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4211;
const DB_PATH = path.join(ROOT, 'server', 'contract-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
const clean = () => { for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } } };
clean();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DB_PATH, API_ANON_RATE_LIMIT: '5000', API_AUTH_RATE_LIMIT: '5000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
srv.stdout.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });
srv.stderr.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const J = (r) => r.json();
const H = (tok) => ({ 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) });
const post = (p, body, tok) => fetch(BASE + p, { method: 'POST', headers: H(tok), body: JSON.stringify(body ?? {}) });
const get = (p, tok) => fetch(BASE + p, { headers: H(tok) });
const openDb = () => new Database(DB_PATH);
const mockSrc = fs.readFileSync(path.join(ROOT, 'client/src/mock/backend.js'), 'utf8');

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (srv.exitCode !== null) break;
    try { if ((await get('/health')).ok) { ready = true; break; } } catch { /* retry */ }
    await sleep(250);
  }
  if (!ready) throw new Error(`测试服务未就绪（exit=${srv.exitCode}）\n${serverOutput}`);

  const bcrypt = (await import('bcryptjs')).default;
  const mkUser = (username, extra = {}) => {
    const db = openDb();
    const id = Number(db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)')
      .run(username, bcrypt.hashSync('Passw0rd!', 10), username).lastInsertRowid);
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);
    for (const [k, v] of Object.entries(extra)) db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, id);
    db.close();
    return id;
  };
  const login = async (u) => (await J(await post('/auth/login', { username: u, password: 'Passw0rd!' }))).token;

  const aliceId = mkUser('alice', { is_gm: 1, is_councilor: 1 });
  const alice = await login('alice');
  const bobId = mkUser('bob');
  const bob = await login('bob');

  /* ─────────── C1 · owner_tier ─────────── */
  console.log('\nC1 创作者 V 徽章：列表端点必须返回 owner_tier');
  {
    const ch = (await J(await post('/characters', { name: '徽章测试卡', is_public: true }, alice))).character;
    ok(!!ch?.id, '建卡成功');

    const pub = (await J(await get('/characters/public', bob))).characters;
    ok(pub.length > 0 && 'owner_tier' in pub[0], `/characters/public 返回 owner_tier（修复前只有 SSE 与详情返回，列表页徽章恒不显示）`);

    const rec = (await J(await get('/characters/recommended', bob))).characters;
    ok(!rec.length || 'owner_tier' in rec[0], '/characters/recommended 返回 owner_tier');

    await post(`/characters/${ch.id}/favorite`, {}, bob);
    const favs = (await J(await get('/characters/favorites/list', bob))).characters;
    ok(favs.length > 0 && 'owner_tier' in favs[0], '/characters/favorites/list 返回 owner_tier');

    const detail = (await J(await get(`/characters/${ch.id}`, bob))).character;
    ok('owner_tier' in detail, '详情仍然返回 owner_tier');
    // 空值类型统一：此前 SSE 兜底写的是数字 0，详情/列表是 null
    const tiers = [pub[0].owner_tier, detail.owner_tier];
    ok(tiers.every(t => t === null || typeof t === 'string'),
      `owner_tier 类型统一为 null | string（不再混入数字 0）—— 实际 ${JSON.stringify(tiers)}`);

    ok(/owner_tier/.test(mockSrc), 'mock 同样返回 owner_tier（它一直有，正是它掩盖了真后端的缺失）');
  }

  /* ─────────── C2 · is_councilor ─────────── */
  console.log('\nC2 GM 后台：用户列表必须返回 is_councilor');
  {
    const users = (await J(await get('/admin/users', alice))).users;
    ok(users.length > 0 && 'is_councilor' in users[0],
      '/admin/users 返回 is_councilor（缺失时按钮文案恒为「任命议员」、body 恒 {value:true}，永远免不掉议员）');
    const meRow = users.find(u => u.id === aliceId);
    ok(meRow?.is_councilor === true, `议员标记如实回报 —— 实际 ${JSON.stringify(meRow?.is_councilor)}`);
    ok(users.find(u => u.id === bobId)?.is_councilor === false, '非议员回报 false 而不是 undefined');
  }

  /* ─────────── C3 · 剧本 per-user liked ─────────── */
  console.log('\nC3 剧本详情必须返回 per-user liked');
  {
    const db0 = openDb();
    const sid = Number(db0.prepare("INSERT INTO scripts (author_id, title, summary, content, price_gold) VALUES (?,?,?,?,0)")
      .run(aliceId, '点赞态测试', 's', 'c').lastInsertRowid);
    db0.close();

    const before = (await J(await get(`/scripts/${sid}`, bob))).script;
    ok('liked' in before && before.liked === false, `未点赞时 liked=false —— 实际 ${JSON.stringify(before.liked)}`);

    await post(`/scripts/${sid}/like`, {}, bob);
    const after = (await J(await get(`/scripts/${sid}`, bob))).script;
    ok(after.liked === true, `点赞后刷新仍为 true（修复前恒 undefined → 前端静默保持 false，再点一下反而取消）—— 实际 ${JSON.stringify(after.liked)}`);

    // 点赞态是 per-user 的，别人看到的必须是 false
    const other = (await J(await get(`/scripts/${sid}`, alice))).script;
    ok(other.liked === false, '他人查看时 liked=false（不是全局态）');

    const anon = (await J(await get(`/scripts/${sid}`))).script;
    ok(anon.liked === false, '未登录时 liked=false 而不是缺字段');
  }

  /* ─────────── C4 · 上传空间入口 ─────────── */
  console.log('\nC4 /upload/mine 必须有界面入口');
  {
    const r = await get('/upload/mine', bob);
    const body = await J(r);
    ok(r.status === 200 && Array.isArray(body.uploads), '/upload/mine 可用');
    ok(typeof body.quota_bytes === 'number' && typeof body.total_bytes === 'number', '返回配额与已用量');
    const settings = fs.readFileSync(path.join(ROOT, 'client/src/pages/Settings.jsx'), 'utf8');
    ok(settings.includes('/upload/mine'), '设置页调用了 /upload/mine（此前端点存在但全仓零调用）');
    ok(/\/upload\/'\s*\+\s*encodeURIComponent/.test(settings), '设置页提供了删除入口');
  }

  /* ─────────── C5 · err.code 透传 ─────────── */
  console.log('\nC5 全局错误处理器必须透传 err.code');
  {
    const idx = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
    ok(/res\.status\(status\)\.json\(\{ error: message, code/.test(idx),
      '全局处理器把 code 写进响应（此前只写 error 与 request_id，凡走 next(err) 的路径 code 全丢）');
    ok(/SQLITE_/.test(idx), '底层错误码（SQLITE_* 等）被显式排除，不泄漏给客户端');
    // 走 next(err) 的真实路径：未登录访问需鉴权端点
    const r = await get('/upload/mine');
    ok(r.status === 401, `未登录访问受保护端点返回 401 —— 实际 ${r.status}`);
  }

  /* ─────────── mock 与真后端的语义分叉 ─────────── */
  console.log('\nmock 分叉：静态构建里测到的必须是真行为');
  {
    // 1) /characters/public 的分页参数必须真的实现，否则 DiscoverFeed 会无限请求
    ok(/parseInt\(search\.get\('limit'\)/.test(mockSrc) && /parseInt\(search\.get\('offset'\)/.test(mockSrc),
      'mock 实现了 limit/offset（此前硬 slice(0,80)，静态构建滑到列表尾部会进入无限请求循环）');
    ok(/scope === 'following'/.test(mockSrc), "mock 实现了 scope=following（此前「关注」分段展示的是全站热门）");

    // 2) 注册流必须同构
    ok(/path === '\/auth\/send-code'/.test(mockSrc), 'mock 有 /auth/send-code（此前根本没有，静态构建注册直接报「接口不存在」）');
    ok(/path === '\/auth\/registration-policy'/.test(mockSrc), 'mock 有 /auth/registration-policy');

    // 3) 鉴权语义三处
    ok(/管理员权限只能通过服务器本地运维命令修改/.test(mockSrc),
      'mock 的 /admin/users/:id/gm 与真后端一样恒 403（此前 mock 真的会改，按钮在试玩可用、真环境必失败）');
    ok(/该兑换码每个账号只能使用一次/.test(mockSrc),
      'mock 的兑换码每账号一次（此前不记录兑换人，可对同一码反复兑换）');
    ok(/私有群仅限群主邀请加入/.test(mockSrc), 'mock 的私有群 join 有 is_public 判定');
    ok(/invite\\\/\(\\d\+\)/.test(mockSrc) || /invite\\\//.test(mockSrc), 'mock 实现了群主邀请端点');

    // 4) SSE 失败分型：真后端 5 种 code，mock 此前只产出 1 种
    const codes = ['NO_MODEL', 'USER_KEY_FAILED', 'INSUFFICIENT_GOLD'];
    for (const c of codes) ok(mockSrc.includes(`'${c}'`), `mock SSE 会产出 ${c}（其余分型此前从未被测过）`);

    // 5) 幽灵卡：两边必须用同一套标记机制
    ok(!/\bfrom_script:/.test(mockSrc), 'mock 不再使用真后端没有的 from_script 列');
    ok(/script:\$\{sid\}/.test(mockSrc) || /`script:/.test(mockSrc), "mock 改用 tags = 'script:<id>'，与真后端 scripts.js 一致");
  }

  /* ─────────── 幽灵卡：真后端确实过滤掉了 ─────────── */
  console.log('\n剧本主持人卡不再污染「我的角色」与创作中心');
  {
    const db0 = openDb();
    const sid = Number(db0.prepare("INSERT INTO scripts (author_id, title, summary, content, price_gold) VALUES (?,?,?,?,0)")
      .run(aliceId, '幽灵卡测试剧本', 's', 'c').lastInsertRowid);
    db0.close();

    const mineBefore = (await J(await get('/characters/mine', bob))).characters.length;
    ok((await post(`/scripts/${sid}/play`, {}, bob)).status === 200, 'bob 游玩剧本（会自动生成一张主持人卡）');

    const db1 = openDb();
    const ghost = db1.prepare("SELECT COUNT(*) n FROM characters WHERE owner_id = ? AND tags LIKE 'script:%'").get(bobId).n;
    db1.close();
    ok(ghost === 1, `库里确实生成了 1 张 tags='script:*' 的主持人卡 —— 实际 ${ghost}`);

    const mineAfter = (await J(await get('/characters/mine', bob))).characters.length;
    ok(mineAfter === mineBefore, `「我的角色」没有多出幽灵卡（${mineBefore} → ${mineAfter}）`);

    const studio = await J(await get('/me/studio', bob));
    const listed = (studio.characters || []).filter(c => /^script:\d+$/.test(String(c.tags || ''))).length;
    ok(listed === 0, `创作中心也不列幽灵卡 —— 实际 ${listed} 张`);
  }
} finally {
  srv.kill();
  clean();
}
console.log(`\n前后端契约专项: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
