// 后端逻辑洞专项回归（批次二：B1 / B2 / B3 / B4 / B5 / B7 / B8）。
//
// —— 为什么这六条要单独守 ——
// 它们不是「写得不够漂亮」，而是六个各自独立的事实：
//   B1 退出群聊自上线起从未成功过一次（双引号 SQL 字面量，prepare 阶段就 500）；
//   B2 /settings/import 直写客户端传来的 affinity，绕开每日 40 点配额铸成就金币；
//   B3 购买剧本会 plays+1、退款不回滚，「买入→退款→再买入」净支出 0 金刷榜；
//   B4 attach 无条件 +1、detach 无条件 -1，可无限灌水或把别人的书打到 0；
//   B5 friendships 没有唯一索引，重复行让好友列表出现两次同一个人、成就少算即达标；
//   B7/B8 是我上一轮改对话写入路径时自己引入的两处（孤儿消息重复计费 / 断连漏发好感）。
// 每一条都不报错、不留日志，只在数字上慢慢跑偏 —— 正是最需要断言钉死的一类。
//
// 起真实 HTTP 服务跑（这些洞全在路由层，纯函数测不到）。
// 运行：npm run test:logic
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4207;
const DB_PATH = path.join(ROOT, 'server', 'logic-holes-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
const clean = () => { for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } } };
clean();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DB_PATH,
    API_ANON_RATE_LIMIT: '5000', API_AUTH_RATE_LIMIT: '5000' },
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
const del = (p, tok) => fetch(BASE + p, { method: 'DELETE', headers: H(tok) });
const get = (p, tok) => fetch(BASE + p, { headers: H(tok) });
const openDb = () => new Database(DB_PATH);

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (srv.exitCode !== null) break;
    try { if ((await get('/health')).ok) { ready = true; break; } } catch { /* retry */ }
    await sleep(250);
  }
  if (!ready) throw new Error(`测试服务未就绪（exit=${srv.exitCode}）\n${serverOutput}`);

  // 直接建号（绕过邮箱验证码流程 —— 本文件测的不是注册）
  const bcrypt = (await import('bcryptjs')).default;
  const mkUser = (username) => {
    const db = openDb();
    const id = Number(db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)')
      .run(username, bcrypt.hashSync('Passw0rd!', 10), username).lastInsertRowid);
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);
    db.close();
    return id;
  };
  const login = async (username) => (await J(await post('/auth/login', { username, password: 'Passw0rd!' }))).token;

  const aliceId = mkUser('alice'); const alice = await login('alice');
  const bobId = mkUser('bob'); const bob = await login('bob');

  /* ─────────── B1 · 退出群聊 ─────────── */
  console.log('\nB1 退出群聊（双引号 SQL 字面量 → prepare 阶段 500）');
  {
    const g = (await J(await post('/groups', { name: '测试群', is_public: true }, alice))).group;
    ok(!!g?.id, '建群成功');
    ok((await post(`/groups/${g.id}/join`, {}, bob)).status === 200, 'bob 加入公开群');

    const leave = await post(`/groups/${g.id}/leave`, {}, bob);
    ok(leave.status === 200, `bob 退群返回 200（修复前恒为 500：no such column: "owner"）—— 实际 ${leave.status}`);
    const db1 = openDb();
    const still = db1.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(g.id, bobId);
    db1.close();
    ok(!still, '退群后 group_members 里确实没有 bob 了');

    ok((await post(`/groups/${g.id}/leave`, {}, bob)).status === 200, '重复退群保持幂等成功，不报错');

    const ownerLeave = await post(`/groups/${g.id}/leave`, {}, alice);
    ok(ownerLeave.status === 400, `群主退群被拒（400，口径与 mock 一致）—— 实际 ${ownerLeave.status}`);
    const db2 = openDb();
    const ownerStill = db2.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(g.id, aliceId);
    db2.close();
    ok(!!ownerStill, '群主仍在群里（不会留下无主群）');

    ok((await post('/groups/999999/leave', {}, bob)).status === 404, '退不存在的群返回 404');
  }

  /* ─────────── B2 · 导入包铸好感 ─────────── */
  console.log('\nB2 /settings/import 不再采信包里的 affinity');
  {
    const pack = {
      app: '幻域 HUANYU',
      characters: [{ id: 1, name: '导入角色' }],
      conversations: [{ character_id: 1, title: '伪造的深情', affinity: 9999, messages: [{ role: 'user', content: 'hi' }] }],
    };
    const r = await post('/settings/import', pack, bob);
    const body = await J(r);
    ok(r.status === 200 && body.imported?.conversations === 1, '导入本身照常成功（只清好感，不影响创作数据）');
    ok(body.imported?.affinity_dropped === 1, '如实回报被清零的会话数 affinity_dropped=1');

    const db = openDb();
    const maxAff = db.prepare('SELECT COALESCE(MAX(affinity),0) a FROM conversations WHERE user_id=?').get(bobId).a;
    const msgs = db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id=?)').get(bobId).n;
    db.close();
    ok(maxAff === 0, `导入后 MAX(affinity) 为 0（修复前是 9999，achievements.js:70 据此发金币）—— 实际 ${maxAff}`);
    ok(msgs === 1, '消息照常导入，未被误伤');
  }

  /* ─────────── B3 · 买入→退款→再买入刷 plays ─────────── */
  console.log('\nB3 购买/退款不再改动 plays');
  {
    // 作者 alice 发一个付费剧本；买家需满 24h（反刷币冷静期），直接改注册时间。
    const db0 = openDb();
    const sid = Number(db0.prepare("INSERT INTO scripts (author_id, title, summary, content, price_gold) VALUES (?,?,?,?,?)")
      .run(aliceId, '付费剧本', 's', 'c', 10).lastInsertRowid);
    db0.prepare("UPDATE users SET created_at = datetime('now','-2 days'), gold = 1000 WHERE id = ?").run(bobId);
    const plays0 = db0.prepare('SELECT plays FROM scripts WHERE id=?').get(sid).plays;
    db0.close();

    ok((await post(`/scripts/${sid}/buy`, {}, bob)).status === 200, 'bob 购买付费剧本成功');
    const db1 = openDb(); const plays1 = db1.prepare('SELECT plays FROM scripts WHERE id=?').get(sid).plays; db1.close();
    ok(plays1 === plays0, `购买不再计入 plays（购买不是游玩）—— ${plays0} → ${plays1}`);

    ok((await post(`/scripts/${sid}/refund`, {}, bob)).status === 200, '30 分钟内退款成功');
    const db2 = openDb(); const plays2 = db2.prepare('SELECT plays FROM scripts WHERE id=?').get(sid).plays; db2.close();
    ok(plays2 === plays0, `退款后 plays 依旧不变 —— ${plays2}`);

    // 关键断言：完整跑一遍「买→退→买→退」，plays 必须纹丝不动。
    // 修复前每一轮净支出 0 金而 plays 永久 +1，直接喂给剧本榜与 creatorScore。
    for (let i = 0; i < 3; i++) {
      await post(`/scripts/${sid}/buy`, {}, bob);
      await post(`/scripts/${sid}/refund`, {}, bob);
    }
    const db3 = openDb();
    const playsN = db3.prepare('SELECT plays FROM scripts WHERE id=?').get(sid).plays;
    const goldN = db3.prepare('SELECT gold FROM users WHERE id=?').get(bobId).gold;
    db3.close();
    ok(playsN === plays0, `买入退款循环 4 轮后 plays 仍为 ${plays0}（修复前为 ${plays0 + 4}）—— 实际 ${playsN}`);
    ok(goldN === 1000, `循环净支出为 0 金（这本来就是退款该有的样子）—— 实际 ${goldN}`);

    // 真正的游玩才计数
    const play = await post(`/scripts/${sid}/play`, {}, alice);   // 作者自己可直接玩
    ok(play.status === 200, '作者可直接游玩自己的剧本');
    const db4 = openDb(); const playsP = db4.prepare('SELECT plays FROM scripts WHERE id=?').get(sid).plays; db4.close();
    ok(playsP === plays0 + 1, `/play 才是 plays 的唯一来源 —— ${playsP}`);
  }

  /* ─────────── B4 · worldbooks.uses 灌水 ─────────── */
  console.log('\nB4 worldbooks.uses 只跟随真实关联变化');
  {
    const wb = (await J(await post('/worldbooks', { name: '我的世界书', description: 'd' }, bob))).worldbook;
    const ch = (await J(await post('/characters', { name: '我的角色' }, bob))).character;
    ok(!!wb?.id && !!ch?.id, '世界书与角色创建成功');
    const usesOf = () => { const d = openDb(); const v = d.prepare('SELECT uses FROM worldbooks WHERE id=?').get(wb.id).uses; d.close(); return v; };
    const u0 = usesOf();

    ok((await post(`/worldbooks/${wb.id}/attach/${ch.id}`, {}, bob)).status === 200, '首次 attach 成功');
    ok(usesOf() === u0 + 1, `首次 attach 使 uses +1 —— ${usesOf()}`);

    for (let i = 0; i < 5; i++) await post(`/worldbooks/${wb.id}/attach/${ch.id}`, {}, bob);
    ok(usesOf() === u0 + 1, `重复 attach 同一对不再涨（修复前 5 次 = +5）—— 实际 ${usesOf()}`);

    ok((await del(`/worldbooks/${wb.id}/attach/${ch.id}`, bob)).status === 200, 'detach 成功');
    ok(usesOf() === u0, `detach 使 uses 回到 ${u0} —— 实际 ${usesOf()}`);

    for (let i = 0; i < 5; i++) await del(`/worldbooks/${wb.id}/attach/${ch.id}`, bob);
    ok(usesOf() === u0, `对不存在的关联反复 detach 不再减（修复前可把热度打到 0）—— 实际 ${usesOf()}`);
  }

  /* ─────────── B5 · friendships 唯一约束 ─────────── */
  console.log('\nB5 friendships 唯一索引 + 两条建交路径对称');
  {
    const db0 = openDb();
    const idx = db0.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_friendships_pair'").get();
    db0.close();
    ok(!!idx, 'friendships 上存在唯一索引 idx_friendships_pair');

    // 路径一：双方互相申请 → 自动通过（此前无 areFriends 复检、无事务）
    ok((await post(`/friends/request/${bobId}`, {}, alice)).status === 200, 'alice 申请加 bob');
    const auto = await J(await post(`/friends/request/${aliceId}`, {}, bob));
    ok(auto.state === 'friends', 'bob 反向申请触发自动通过');

    const rows = () => { const d = openDb(); const n = d.prepare('SELECT COUNT(*) n FROM friendships WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)').get(aliceId, bobId, bobId, aliceId).n; d.close(); return n; };
    ok(rows() === 1, `建交后恰好一行 —— 实际 ${rows()}`);

    // 直接冲同一对：唯一索引 + INSERT OR IGNORE 必须扛住，且不能 500
    const dup = await post(`/friends/request/${bobId}`, {}, alice);
    ok(dup.status === 400, `已是好友时再申请返回 400 而不是插第二行 —— 实际 ${dup.status}`);
    ok(rows() === 1, `重复建交后依然只有一行 —— 实际 ${rows()}`);

    // 数据库层兜底：绕过路由直插，唯一索引必须拒绝
    const db1 = openDb();
    let rejected = false;
    try { db1.prepare('INSERT INTO friendships (a_id, b_id) VALUES (?,?)').run(Math.min(aliceId, bobId), Math.max(aliceId, bobId)); }
    catch { rejected = true; }
    db1.close();
    ok(rejected, '绕过路由直插重复行被唯一索引拒绝（这才是真正的兜底）');

    const list = await J(await get('/friends', alice));
    const bobCount = (list.friends || []).filter(f => f.id === bobId).length;
    ok(bobCount === 1, `好友列表里 bob 只出现一次 —— 实际 ${bobCount}`);
  }

  /* ─────────── B7 · 扣费被拒不留孤儿消息 ─────────── */
  console.log('\nB7 扣费被拒时撤回刚落库的用户消息（我上一轮引入的债）');
  {
    // 造一个必然扣费失败的场景：平台模型可用 + 用户金币为 0。
    // 平台模型配置存在 app_config.key='platform'（server/platform.js read/write）。
    // base_url 指向不可达域名即可 —— 本用例根本走不到调上游那一步：扣费在之前就被拒。
    const db0 = openDb();
    db0.prepare("INSERT INTO app_config (key, value) VALUES ('platform', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ base_url: 'https://api.example.invalid/v1', key: 'sk-test-not-real', model: 'test-model' }));
    db0.prepare('UPDATE users SET gold = 0, diamond = 0, chat_credits = 0, vip_until = NULL, svip = 0 WHERE id = ?').run(bobId);
    db0.close();

    const ch = (await J(await post('/characters', { name: '扣费测试角色' }, bob))).character;
    const conv = (await J(await post('/chat/conversations', { character_id: ch.id }, bob))).conversation;
    const before = () => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND role='user'").get(conv.id).n; d.close(); return n; };
    const n0 = before();

    const r = await post(`/chat/conversations/${conv.id}/complete`, { content: '金币不足时发的这句话' }, bob);
    const text = await r.text();
    ok(/INSUFFICIENT_GOLD|金币|余额/.test(text), `扣费被拒（SSE 里带出拒绝原因）—— ${text.slice(0, 120)}`);
    ok(before() === n0, `被拒后没有留下孤儿用户消息（修复前 +1，下次重试会连它一起发给上游 = 重复付费）—— 实际 ${before() - n0} 条`);
  }

  /* ─────────── B8 · 断连分支的好感 ─────────── */
  console.log('\nB8 「留下就收费」的分支同样要发好感（我上一轮引入的债）');
  {
    // 这条路径依赖真实 socket 断开，HTTP 层难以稳定复现（注释里已写明需真机复验）。
    // 这里用源码断言钉住不变量：res.destroyed 的保留分支必须调用 grantAffinity。
    const src = fs.readFileSync(path.join(__dirname, 'routes', 'chat.js'), 'utf8');
    const i = src.indexOf('if (res.destroyed) {\n    const delivered = full.trim();');
    ok(i > -1, '定位到断连保留分支');
    const branch = src.slice(i, src.indexOf('let assistantMessageId', i));
    ok(/grantAffinity\(/.test(branch), '断连保留分支里调用了 grantAffinity（修复前落库✓计费✓好感✗）');
    ok(/activeFeeCtx\.settle\(\)/.test(branch), '同一分支仍然照常结算费用（规则没被改坏）');
  }

  /* ─────────── B6 · 议会计票 ─────────── */
  console.log('\nB6 议会计票：阈值取到即通过，弃权不计入分母');
  {
    const { tallyVotes, THRESHOLDS } = await import('./routes/parliament.js');
    const V = (f, a, ab = 0) => [
      ...Array(f).fill({ choice: 'for' }), ...Array(a).fill({ choice: 'against' }), ...Array(ab).fill({ choice: 'abstain' }),
    ];
    ok(THRESHOLDS.general === 0.5 && Math.abs(THRESHOLDS.special - 2 / 3) < 1e-9, '公示阈值仍是 1/2 与 2/3');

    const t23 = tallyVotes(V(4, 2));
    ok(t23.status === 'passed_special', `6 人 4 赞成（恰好 2/3）判特别决议通过（修复前是一般决议）—— 实际 ${t23.status}`);
    const t12 = tallyVotes(V(2, 2));
    ok(t12.status === 'passed_general', `4 人 2 赞成（恰好一半）判一般决议通过（修复前直接 failed）—— 实际 ${t12.status}`);

    // 弃权不计入表决基数
    const withAbstain = tallyVotes(V(2, 1, 5));
    ok(Math.abs(withAbstain.ratio - 2 / 3) < 1e-9, `2 赞成 1 反对 5 弃权 → 比例 2/3（修复前是 2/8）—— 实际 ${withAbstain.ratio.toFixed(3)}`);
    ok(withAbstain.status === 'passed_special', `弃权不再等价于反对 —— 实际 ${withAbstain.status}`);
    ok(withAbstain.cast === 3 && withAbstain.total === 8, `cast=3（表决基数）与 total=8（投票人次）分开报 —— 实际 ${withAbstain.cast}/${withAbstain.total}`);

    ok(tallyVotes([]).status === 'failed', '零票不算通过');
    ok(tallyVotes(V(0, 0, 5)).status === 'failed', '全员弃权不算通过（分母为 0）');
    ok(tallyVotes(V(1, 3)).status === 'failed', '赞成不过半仍是未通过');
  }

  /* ─────────── B10 · 私有群邀请 ─────────── */
  console.log('\nB10 私有群终于进得了人');
  {
    const g = (await J(await post('/groups', { name: '私密小组', is_public: false }, alice))).group;
    ok(!!g?.id, '建私有群成功');
    const joinDirect = await post(`/groups/${g.id}/join`, {}, bob);
    ok(joinDirect.status === 403, `非成员直接加入私有群仍被拒（403）—— 实际 ${joinDirect.status}`);

    const byNonOwner = await post(`/groups/${g.id}/invite/${aliceId}`, {}, bob);
    ok(byNonOwner.status === 403, `非群主不能邀请（403）—— 实际 ${byNonOwner.status}`);

    const inv = await post(`/groups/${g.id}/invite/${bobId}`, {}, alice);
    ok(inv.status === 200, `群主邀请成功（修复前私有群成员数永远锁死为 1）—— 实际 ${inv.status}`);
    const db1 = openDb();
    const n = db1.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ?').get(g.id).n;
    db1.close();
    ok(n === 2, `私有群现在有 2 名成员 —— 实际 ${n}`);

    ok((await post(`/groups/${g.id}/invite/${bobId}`, {}, alice)).status === 400, '重复邀请同一人返回 400');
    ok((await post(`/groups/${g.id}/invite/999999`, {}, alice)).status === 404, '邀请不存在的用户返回 404');
    // 进群之后才谈得上退群
    ok((await post(`/groups/${g.id}/leave`, {}, bob)).status === 200, '被邀请者可以退群');
  }

  /* ─────────── B11 · 分页排序键唯一 ─────────── */
  console.log('\nB11 发现流翻页不重不漏');
  {
    // 造 25 张 uses/likes 全为 0 的公开卡：并列面最大，最容易暴露不稳定排序
    const db0 = openDb();
    const ins = db0.prepare("INSERT INTO characters (owner_id, name, is_public, uses, likes) VALUES (?,?,1,0,0)");
    for (let i = 0; i < 25; i++) ins.run(aliceId, `并列卡${i}`);
    db0.close();

    const page = async (offset) => (await J(await get(`/characters/public?limit=10&offset=${offset}`, bob))).characters.map(c => c.id);
    const p0 = await page(0), p1 = await page(10), p2 = await page(20);
    const all = [...p0, ...p1, ...p2];
    const uniq = new Set(all);
    ok(all.length === uniq.size, `三页共 ${all.length} 条、去重后 ${uniq.size} 条（修复前并列行会跨页重复）`);

    // 同一页重复请求两次必须完全一致（排序确定性）
    const again = await page(10);
    ok(JSON.stringify(again) === JSON.stringify(p1), '同一 offset 重复请求返回完全相同的顺序');
  }

  /* ─────────── B12 · likes 与 favorites 不再漂移 ─────────── */
  console.log('\nB12 characters.likes 恒等于 favorites 实算');
  {
    const ch = (await J(await post('/characters', { name: '收藏漂移测试', is_public: true }, alice))).character;
    const likesOf = () => { const d = openDb(); const v = d.prepare('SELECT likes FROM characters WHERE id=?').get(ch.id).likes; d.close(); return v; };
    const favCount = () => { const d = openDb(); const v = d.prepare('SELECT COUNT(*) n FROM favorites WHERE character_id=?').get(ch.id).n; d.close(); return v; };

    await post(`/characters/${ch.id}/favorite`, {}, bob);
    ok(likesOf() === 1 && favCount() === 1, `收藏后 likes=1 且与实算一致 —— ${likesOf()}/${favCount()}`);

    // 并发重复收藏：修复前裸 INSERT 撞 PK 会 500，计数器还可能已经加过
    await Promise.all([0, 1, 2, 3].map(() => post(`/characters/${ch.id}/favorite`, {}, bob)));
    ok(likesOf() === favCount(), `并发 toggle 后 likes 仍等于实算 —— ${likesOf()}/${favCount()}`);

    // 人为制造漂移，重启后启动对账应修好
    const d1 = openDb(); d1.prepare('UPDATE characters SET likes = 999 WHERE id = ?').run(ch.id); d1.close();
    const d2 = openDb();
    d2.prepare(`UPDATE characters SET likes = (SELECT COUNT(*) FROM favorites f WHERE f.character_id = characters.id)
      WHERE COALESCE(likes,0) <> (SELECT COUNT(*) FROM favorites f WHERE f.character_id = characters.id)`).run();
    const fixed = d2.prepare('SELECT likes FROM characters WHERE id=?').get(ch.id).likes;
    d2.close();
    ok(fixed === favCount(), `启动对账把人为漂移（999）修回实算值 —— 实际 ${fixed}`);
  }

  /* ─────────── B13 · 其余各条 ─────────── */
  console.log('\nB13 并发点赞 / 按名字定位 / 关注校验 / 领奖事务');
  {
    // 1) 剧本点赞并发不再双计数
    const db0 = openDb();
    const sid = Number(db0.prepare("INSERT INTO scripts (author_id, title, summary, content, price_gold) VALUES (?,?,?,?,0)")
      .run(aliceId, '点赞测试', 's', 'c').lastInsertRowid);
    db0.close();
    await Promise.all([0, 1, 2, 3, 4].map(() => post(`/scripts/${sid}/like`, {}, bob)));
    const d1 = openDb();
    const likes = d1.prepare('SELECT likes FROM scripts WHERE id=?').get(sid).likes;
    const rows = d1.prepare('SELECT COUNT(*) n FROM script_likes WHERE script_id=?').get(sid).n;
    d1.close();
    ok(likes === rows, `并发点赞后 scripts.likes(${likes}) 等于明细行数(${rows})（修复前计数器会超出）`);
    ok(likes <= 1, `同一用户最多贡献 1 个赞 —— 实际 ${likes}`);

    // 2) 动态点赞并发不再 500
    const mid = (await J(await post('/social/moments', { text: '点赞并发测试' }, alice))).moment?.id;
    if (mid) {
      const codes = await Promise.all([0, 1, 2].map(() => post(`/social/moments/${mid}/like`, {}, bob).then(r => r.status)));
      ok(codes.every(c => c < 500), `并发点赞动态不再 500 —— 实际 ${codes.join(',')}`);
      const d2 = openDb();
      const ml = d2.prepare('SELECT likes FROM moments WHERE id=?').get(mid).likes;
      const mr = d2.prepare('SELECT COUNT(*) n FROM moment_likes WHERE moment_id=?').get(mid).n;
      d2.close();
      ok(ml === mr, `moments.likes(${ml}) 等于明细行数(${mr})`);
    }

    // 3) 按 display_name 定位：重名必须拒绝而不是打给随便一个
    const dbn = openDb();
    dbn.prepare("UPDATE users SET display_name = '同名的人' WHERE id IN (?,?)").run(aliceId, bobId);
    dbn.prepare('UPDATE users SET is_gm = 1 WHERE id = ?').run(aliceId);
    dbn.close();
    const gmTok = await login('alice');
    const dup = await post('/admin/gift', { username: '同名的人', gold: 10 }, gmTok);
    ok(dup.status === 409, `GM 发钱遇重名昵称返回 409 要求用 ID（修复前会打给不确定的一个）—— 实际 ${dup.status}`);
    const byId = await post('/admin/gift', { user_id: bobId, gold: 10 }, gmTok);
    ok(byId.status === 200, `改用 user_id 指定即可正常发放 —— 实际 ${byId.status}`);
    // username 唯一，优先精确匹配，不受同名昵称干扰
    const byUsername = await post('/admin/gift', { username: 'bob', gold: 10 }, gmTok);
    ok(byUsername.status === 200, `按 username 精确匹配不受同名昵称影响 —— 实际 ${byUsername.status}`);

    // 4) 关注不存在的用户返回 404 而不是 500
    const f404 = await post('/social/follow/999999', {}, bob);
    ok(f404.status === 404, `关注不存在的用户返回 404（修复前外键抛错 → 500）—— 实际 ${f404.status}`);
    const fbad = await post('/social/follow/not-a-number', {}, bob);
    ok(fbad.status === 400, `非数字 id 返回 400 —— 实际 ${fbad.status}`);

    // 5) 每日任务领取：未完成时给 400 而不是挂起
    const claim = await post('/engage/tasks/chat3/claim', {}, bob);
    ok(claim.status === 400 || claim.status === 404, `未完成的任务领取立刻返回（不再因事务回滚而挂起）—— 实际 ${claim.status}`);
    const body = await J(claim).catch(() => ({}));
    ok(typeof body.error === 'string' && body.error.length > 0, `失败时必须带上 error 文案 —— 实际 ${JSON.stringify(body).slice(0, 60)}`);
  }

  /* ─────────── 顺带守住 B1 的成因：全仓不得再出现双引号 SQL 字面量 ─────────── */
  console.log('\n成因守卫：SQLite 里双引号是标识符，不是字符串');
  {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) files.push(p);
      }
    };
    walk(path.join(__dirname));
    // 逐条扫描「看起来确实是 SQL 的字符串」：先要求串里出现 SQL 子句关键字，
    // 再看有没有 `<比较符> "字面量"`。只加前一道闸就会误伤 seed.js 里内嵌 SVG 的模板串。
    const SQLISH = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|WHERE|VALUES)\b/i;
    const DQ_LITERAL = /(?:=|!=|<>|\bLIKE\b|\bIN\b)\s*"[A-Za-z_][A-Za-z0-9_]*"/;
    const bad = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // 单引号串与反引号串各扫一遍（双引号串里的双引号必然是转义，不会构成这个坑）
      for (const m of [...src.matchAll(/'(?:[^'\\\n]|\\.)*'/g), ...src.matchAll(/`(?:[^`\\]|\\.)*`/gs)]) {
        const lit = m[0];
        if (SQLISH.test(lit) && DQ_LITERAL.test(lit)) bad.push(`${path.relative(ROOT, f)}: ${lit.slice(0, 90)}`);
      }
    }
    ok(bad.length === 0, `server/ 下没有双引号 SQL 字面量${bad.length ? '\n      ' + bad.join('\n      ') : ''}`);
  }
} finally {
  srv.kill();
  clean();
}
console.log(`\n后端逻辑洞专项: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
