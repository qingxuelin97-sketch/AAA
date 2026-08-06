// 漏洞回归测试（攻击者视角，确定性，进 CI 门禁）。
// 三轮审计确认后端无可利用越权/注入/鉴权绕过/提权/SSRF/密钥泄露 —— 本套件把
// 每一条安全边界**固化成永久断言**，让将来任何重构都无法悄悄把它改松。
// 覆盖现有套件（sec/payment/safe-url/abuse/stress）未覆盖的 6 个缺口：
//   ① 跨账号越权 IDOR   ② 批量赋值/提权   ③ JWT 篡改
//   ④ SSRF 编码 IP 全矩阵   ⑤ 注入探针   ⑥ 密钥泄露
// 运行：npm run test:vuln
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4193;                                   // 4196-4199 已被其他套件占用
const DB_PATH = path.join(__dirname, 'vuln-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
const SECRET = 'vuln-test-jwt-secret-at-least-32-chars-long';  // 显式固定，供伪造令牌
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const run = (cmd, args, env) => new Promise((res, rej) => { const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' }); p.on('exit', c => c === 0 ? res() : rej(new Error(cmd + ' ' + c))); });

console.log('· 灌入临时演示数据…');
await run('node', ['server/seed.js'], { DB_PATH });

console.log('· 启动服务端（固定 JWT_SECRET，抬高限流）…');
const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env, NODE_ENV: 'test', PORT: String(PORT), DB_PATH, JWT_SECRET: SECRET,
    API_ANON_RATE_LIMIT: '1000000', API_AUTH_RATE_LIMIT: '1000000',
    AI_RATE_LIMIT: '1000000', CONTENT_RATE_LIMIT: '1000000', UPLOAD_RATE_LIMIT: '1000000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
srv.stdout.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });
srv.stderr.on('data', c => { serverOutput = (serverOutput + c).slice(-8000); });

const db = () => new Database(DB_PATH);
const dbRO = () => new Database(DB_PATH, { readonly: true });

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (srv.exitCode !== null) break;
    try { if ((await fetch(BASE + '/health')).ok) { ready = true; break; } } catch { /* */ }
    await sleep(250);
  }
  if (!ready) throw new Error(`测试服务未就绪（exit=${srv.exitCode}）\n${serverOutput}`);

  // —— 建三个账号：victim（受害者）/ attacker（攻击者）/ gm ——
  {
    const d = db();
    const mk = (u, gm = 0) => {
      d.prepare('INSERT INTO users (username, password_hash, display_name, is_gm, gold, diamond) VALUES (?,?,?,?,?,?)')
        .run(u, bcrypt.hashSync('123456', 10), u, gm, 1000, 10);
      const id = d.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
      d.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);
      return id;
    };
    global.__ids = { victim: mk('vt_victim'), attacker: mk('vt_attacker'), gm: mk('vt_gm', 1), third: mk('vt_third') };
    d.close();
  }
  const IDS = global.__ids;
  const login = async (u) => (await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: '123456' }) })).json()).token;
  const VIC = await login('vt_victim'), ATK = await login('vt_attacker'), GM = await login('vt_gm');
  const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
  const req = (method, p, body, t) => fetch(BASE + p, { method, headers: t ? H(t) : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const status = async (method, p, body, t) => { const r = await req(method, p, body, t); await r.text().catch(() => {}); return r.status; };
  const json = async (method, p, body, t) => { const r = await req(method, p, body, t); return { s: r.status, b: await r.json().catch(() => ({})) }; };

  // —— victim 建一批私有资源 ——
  const vChar = (await json('POST', '/characters', { name: 'victim-char', is_public: false }, VIC)).b.character?.id;
  const vWb = (await json('POST', '/worldbooks', { name: 'victim-wb', is_public: false }, VIC)).b.worldbook?.id;
  const vScript = (await json('POST', '/scripts', { title: 'victim-script' }, VIC)).b.script?.id;
  const vNovel = (await json('POST', '/novels', { title: 'victim-novel' }, VIC)).b.novel?.id;
  // 私有剧场用 victim 自己的私有卡（允许）；单次创建。
  const vTheaterPriv = (await json('POST', '/theater', { name: 'victim-theater', is_public: false, cast: [vChar] }, VIC)).b.theater?.id;
  const vGroupPriv = (await json('POST', '/groups', { name: 'victim-group', is_public: false }, VIC)).b.group?.id;
  const vGroupPub = (await json('POST', '/groups', { name: 'victim-group-pub', is_public: true }, VIC)).b.group?.id;
  const vConv = (await json('POST', '/chat/conversations', { character_id: vChar }, VIC)).b.conversation?.id;
  // 直接写库拿子资源 id / 造 AI 图 / 造 DM / 造议案评论（避开 AI/councilor 流程）
  let vRun, vMsg, vImg, vBeat, vProposal, vComment;
  {
    const d = db();
    vRun = d.prepare('SELECT id FROM novel_runs WHERE novel_id = ? ORDER BY id LIMIT 1').get(vNovel)?.id;
    d.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)').run(vConv, 'user', 'victim-secret-msg');
    vMsg = d.prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(vConv).id;
    d.prepare('INSERT INTO novel_beats (run_id, seq, content) VALUES (?,?,?)').run(vRun, 0, 'victim-beat');
    vBeat = d.prepare('SELECT id FROM novel_beats WHERE run_id = ? ORDER BY id DESC LIMIT 1').get(vRun).id;
    d.prepare('INSERT INTO ai_images (user_id, prompt, size, url) VALUES (?,?,?,?)').run(IDS.victim, 'p', '1024x1024', 'u');
    vImg = d.prepare('SELECT id FROM ai_images WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(IDS.victim).id;
    // victim → third 的私信（用于第三方隔离测试）
    d.prepare('INSERT INTO dm_messages (from_id, to_id, text) VALUES (?,?,?)').run(IDS.victim, IDS.third, 'victim-to-third-secret');
    // 议案 + victim 的评论（测 DELETE comments 的 :id 松散不可利用）
    try {
      d.prepare("INSERT INTO proposals (author_id, title, body, status) VALUES (?,?,?,'pending')").run(IDS.victim, 'p', 'b');
      vProposal = d.prepare('SELECT id FROM proposals ORDER BY id DESC LIMIT 1').get().id;
      d.prepare('INSERT INTO proposal_comments (proposal_id, user_id, text) VALUES (?,?,?)').run(vProposal, IDS.victim, 'victim-comment');
      vComment = d.prepare('SELECT id FROM proposal_comments ORDER BY id DESC LIMIT 1').get().id;
    } catch { /* 表结构差异则跳过该子用例 */ }
    d.close();
  }

  // ============================================================
  console.log('\n① 跨账号越权（IDOR）—— attacker 对 victim 私有资源的读/改/删');
  // ============================================================
  // 私有读
  ok(await status('GET', `/characters/${vChar}`, undefined, ATK) === 403, '读他人私有角色 → 403');
  ok(await status('GET', `/worldbooks/${vWb}`, undefined, ATK) === 403, '读他人私有世界书 → 403');
  ok(await status('GET', `/chat/conversations/${vConv}`, undefined, ATK) === 403, '读他人会话 → 403');
  ok(await status('GET', `/theater/${vTheaterPriv}`, undefined, ATK) === 403, '读他人私有剧场 → 403');
  ok(await status('GET', `/groups/${vGroupPriv}`, undefined, ATK) === 403, '读他人私有群 → 403');
  ok(await status('GET', `/groups/${vGroupPriv}/messages`, undefined, ATK) === 403, '读他人私有群消息 → 403');
  ok(await status('GET', `/theater/${vTheaterPriv}/messages`, undefined, ATK) === 403, '读他人私有剧场消息 → 403');
  // 改
  ok(await status('PUT', `/characters/${vChar}`, { name: 'hacked' }, ATK) === 403, '改他人角色 → 403');
  ok(await status('PUT', `/worldbooks/${vWb}`, { name: 'hacked' }, ATK) === 403, '改他人世界书 → 403');
  ok(await status('PUT', `/scripts/${vScript}`, { title: 'hacked' }, ATK) === 403, '改他人剧本 → 403');
  ok(await status('PATCH', `/chat/conversations/${vConv}`, { title: 'hacked' }, ATK) === 403, '改他人会话 → 403');
  ok(await status('PATCH', `/chat/conversations/${vConv}/messages/${vMsg}`, { content: 'hacked' }, ATK) === 403, '改他人会话消息 → 403');
  ok(await status('PATCH', `/theater/${vTheaterPriv}`, { name: 'hacked' }, ATK) === 403, '改他人剧场（导演台）→ 403');
  ok(await status('POST', `/theater/${vTheaterPriv}/chapter`, { title: 'x' }, ATK) === 403, '推进他人剧场章节 → 403');
  if (vRun) ok(await status('PATCH', `/novels/runs/${vRun}`, { name: 'hacked' }, ATK) === 403, '改他人小说剧情线 → 403');
  if (vBeat) ok(await status('PATCH', `/novels/runs/${vRun}/beats/${vBeat}`, { content: 'hacked' }, ATK) === 403, '改他人小说节拍 → 403');
  ok(await status('POST', `/worldbooks/${vWb}/attach/${vChar}`, {}, ATK) === 403, '把他人世界书挂到角色 → 403');
  // 删
  ok(await status('DELETE', `/characters/${vChar}`, undefined, ATK) === 403, '删他人角色 → 403');
  ok(await status('DELETE', `/worldbooks/${vWb}`, undefined, ATK) === 403, '删他人世界书 → 403');
  ok(await status('DELETE', `/scripts/${vScript}`, undefined, ATK) === 403, '删他人剧本 → 403');
  ok(await status('DELETE', `/chat/conversations/${vConv}`, undefined, ATK) === 403, '删他人会话 → 403');
  if (vRun) ok(await status('DELETE', `/novels/runs/${vRun}`, undefined, ATK) === 403, '删他人小说剧情线 → 403');
  // AI 图删除仅靠 WHERE id=? AND user_id=? —— 跨用户删应为 no-op（不报错、目标仍在）
  const imgDel = await status('DELETE', `/ai/images/${vImg}`, undefined, ATK);
  const imgStill = dbRO(); const imgExists = imgStill.prepare('SELECT 1 FROM ai_images WHERE id = ?').get(vImg); imgStill.close();
  ok(imgDel < 500 && !!imgExists, `删他人 AI 图 no-op（status=${imgDel}，目标仍在）`);
  // 全部改删后，victim 资源应原样存活
  {
    const d = dbRO();
    const chName = d.prepare('SELECT name FROM characters WHERE id = ?').get(vChar)?.name;
    const scriptAlive = d.prepare('SELECT deleted_at FROM scripts WHERE id = ?').get(vScript)?.deleted_at;
    const convAlive = d.prepare('SELECT 1 FROM conversations WHERE id = ?').get(vConv);
    d.close();
    ok(chName === 'victim-char' && !scriptAlive && !!convAlive, '越权尝试后 victim 资源全部原样存活');
  }

  // 公开 vs 私有房间读边界（一字符改动即翻车，必须钉死）
  ok(await status('GET', `/groups/${vGroupPub}/messages`, undefined, ATK) === 200, '公开群消息：非成员可读 → 200（设计如此）');
  ok(await status('POST', `/groups/${vGroupPriv}/messages`, { content: 'x' }, ATK) === 403, '私有群发言：非成员 → 403');
  ok(await status('POST', `/groups/${vGroupPub}/messages`, { content: 'x' }, ATK) === 403, '公开群发言：仍需先加入 → 403');

  // DM 三方隔离：attacker 读 attacker↔third 线，绝不含 victim→third 的私信
  const dmView = await json('GET', `/dm/${IDS.third}`, undefined, ATK);
  ok(!JSON.stringify(dmView.b).includes('victim-to-third-secret'), 'DM 三方隔离：attacker 读不到 victim↔third 的私信');

  // parliament 评论删除：:id 松散但受 user_id 保护 —— attacker 删不掉 victim 的评论
  if (vComment) {
    const delWrong = await status('DELETE', `/parliament/proposals/999999/comments/${vComment}`, undefined, ATK);
    const cStill = dbRO(); const cExists = cStill.prepare('SELECT 1 FROM proposal_comments WHERE id = ?').get(vComment); cStill.close();
    ok(delWrong === 403 && !!cExists, `攻击者删他人评论（即便错配 :id）→ ${delWrong}，评论仍在`);
  }

  // ============================================================
  console.log('\n② 批量赋值 / 提权 —— 私有字段应被忽略');
  // ============================================================
  const PRIV = { gold: 9999999, diamond: 9999999, is_gm: 1, svip: 1, verified: 1, vip_until: '2099-01-01', is_banned: 0, token_version: 99 };
  // 建角色时塞 owner_id / 私有字段
  const maCreate = await json('POST', '/characters', { name: 'ma', owner_id: IDS.victim, id: 1, ...PRIV }, ATK);
  {
    const d = dbRO();
    const u = d.prepare('SELECT gold, diamond, is_gm, svip, verified FROM users WHERE id = ?').get(IDS.attacker);
    const chOwner = d.prepare('SELECT owner_id FROM characters WHERE id = ?').get(maCreate.b.character?.id)?.owner_id;
    d.close();
    ok(u.gold === 1000 && u.diamond === 10 && u.is_gm === 0 && u.svip === 0 && u.verified === 0, '建角色带私有字段：用户 gold/diamond/is_gm/svip/verified 未被改写');
    ok(chOwner === IDS.attacker, '建角色带 owner_id：仍强制归属调用者');
  }
  // PUT /auth/me 塞私有字段
  await status('PUT', '/auth/me', { display_name: 'ma2', ...PRIV }, ATK);
  // PUT /settings 塞私有字段
  await status('PUT', '/settings', { theme: 'dark', ...PRIV }, ATK);
  {
    const d = dbRO();
    const u = d.prepare('SELECT gold, diamond, is_gm, svip, verified, is_banned, token_version FROM users WHERE id = ?').get(IDS.attacker);
    d.close();
    ok(u.gold === 1000 && u.is_gm === 0 && u.svip === 0 && u.verified === 0 && u.is_banned === 0,
      'PUT /auth/me 与 /settings 带私有字段：全部被忽略（未提权、未改余额、未改封禁）');
  }
  // Web 端无法自授 GM（既有 sec-test 已覆盖此专用路由，这里再钉一次跨路径不可行）
  ok(await status('POST', `/admin/users/${IDS.attacker}/gm`, { is_gm: 1 }, ATK) === 403, '普通用户调 /admin/* → 403（非 GM）');

  // ============================================================
  console.log('\n③ JWT 篡改');
  // ============================================================
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const noneTok = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: IDS.victim, username: 'victim', tv: 0 })}.`;
  const validVic = jwt.sign({ id: IDS.victim, username: 'victim', tv: 0 }, SECRET, { algorithm: 'HS256', expiresIn: '14d' });
  const tampered = validVic.slice(0, -3) + (validVic.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  const wrongSecret = jwt.sign({ id: IDS.victim, username: 'victim', tv: 0 }, 'totally-wrong-secret-also-32-chars-xx', { algorithm: 'HS256' });
  const expired = jwt.sign({ id: IDS.victim, username: 'victim', tv: 0 }, SECRET, { algorithm: 'HS256', expiresIn: '-1h' });
  ok(await status('GET', '/auth/me', undefined, noneTok) === 401, 'alg:none 令牌 → 401');
  ok(await status('GET', '/auth/me', undefined, tampered) === 401, '签名被篡改 → 401');
  ok(await status('GET', '/auth/me', undefined, wrongSecret) === 401, '错误密钥签发（伪造他人身份）→ 401');
  ok(await status('GET', '/auth/me', undefined, expired) === 401, '过期令牌 → 401');
  ok(await status('GET', '/auth/me', undefined, 'not.a.jwt') === 401, '畸形令牌 → 401');
  // token_version 吊销：victim 改密后旧令牌失效
  const oldVic = await login('victim');
  await status('PUT', '/password', { old_password: '123456', new_password: 'Passw0rd!New' }, oldVic);
  ok(await status('GET', '/auth/me', undefined, oldVic) === 401, '改密后旧令牌（token_version 提升）→ 401');

  // ============================================================
  console.log('\n④ SSRF 编码 IP 全矩阵（经真实用户路由 /settings/test-llm）');
  // ============================================================
  const SSRF_HOSTS = [
    'http://127.0.0.1/v1', 'http://localhost/v1', 'http://evil.localhost/v1',
    'http://2130706433/v1', 'http://0x7f000001/v1', 'http://0177.0.0.1/v1', 'http://127.1/v1',
    'http://[::1]/v1', 'http://[::ffff:127.0.0.1]/v1', 'http://0.0.0.0/v1',
    'http://169.254.169.254/v1', 'http://100.64.0.1/v1', 'http://192.168.0.1/v1', 'http://10.0.0.1/v1',
  ];
  let ssrfBlocked = 0;
  for (const h of SSRF_HOSTS) {
    const r = await json('POST', '/settings/test-llm', { base_url: h, api_key: 'sk-probe', model: 'gpt-4o-mini' }, ATK);
    // 拒绝 = 非 2xx，且响应不含成功回复。全部内网/编码目标都应在出站前或 DNS 复检时被拒。
    const blocked = r.s >= 400 && !r.b.reply;
    if (blocked) ssrfBlocked++; else console.log(`     漏网: ${h} → ${r.s} ${JSON.stringify(r.b).slice(0, 80)}`);
  }
  ok(ssrfBlocked === SSRF_HOSTS.length, `SSRF 矩阵：${SSRF_HOSTS.length}/${SSRF_HOSTS.length} 个内网/编码目标全部被拒`);

  // ============================================================
  console.log('\n⑤ 注入探针（搜索端点）');
  // ============================================================
  const beforeUsers = (() => { const d = dbRO(); const n = d.prepare('SELECT COUNT(*) c FROM users').get().c; d.close(); return n; })();
  const SQLI = ["' OR '1'='1", "'; DROP TABLE users;--", "1' UNION SELECT password_hash FROM users--", '%', "\\'; DELETE FROM users;--", "admin'--"];
  let inj5xx = 0, injLeak = 0;
  for (const q of SQLI) {
    const enc = encodeURIComponent(q);
    for (const ep of [`/users/search?q=${enc}`, `/characters/public?q=${enc}`, `/admin/users?q=${enc}`]) {
      const t = ep.startsWith('/admin') ? GM : ATK;
      const r = await json('GET', ep, undefined, t);
      if (r.s >= 500) inj5xx++;
      if (JSON.stringify(r.b).includes('password_hash') || JSON.stringify(r.b).match(/\$2[aby]\$/)) injLeak++;
    }
  }
  const afterUsers = (() => { const d = dbRO(); const n = d.prepare('SELECT COUNT(*) c FROM users').get().c; d.close(); return n; })();
  ok(inj5xx === 0, `注入探针：搜索端点 0 个 5xx（${SQLI.length}×3 组载荷）`);
  ok(afterUsers === beforeUsers, `注入探针：users 表未被破坏（${beforeUsers} → ${afterUsers}）`);
  ok(injLeak === 0, '注入探针：响应中无 password_hash / bcrypt 串泄露');

  // ============================================================
  console.log('\n⑥ 密钥 / 敏感字段泄露');
  // ============================================================
  // /settings 只回布尔，不回密钥明文
  await status('PUT', '/settings', { llm_api_key: 'sk-USER-SECRET-KEY', voice_api_key: 'sk-VOICE-SECRET' }, ATK);
  const setResp = await json('GET', '/settings', undefined, ATK);
  const setStr = JSON.stringify(setResp.b);
  ok(!setStr.includes('sk-USER-SECRET-KEY') && !setStr.includes('sk-VOICE-SECRET'), '/settings 不回显用户 API Key 明文');
  ok(setStr.includes('llm_api_key_set') || setResp.b.settings?.llm_api_key_set !== undefined, '/settings 只回 *_set 布尔标记');
  // /admin/platform 只回掩码
  await status('PUT', '/admin/platform', { key: 'sk-PLATFORM-SECRET-KEY', base_url: 'https://api.example.com/v1', model: 'x' }, GM);
  const plat = await json('GET', '/admin/platform', undefined, GM);
  const platView = plat.b.platform || plat.b;
  ok(!JSON.stringify(plat.b).includes('sk-PLATFORM-SECRET-KEY'), '/admin/platform 不回显平台 Key 明文（仅掩码）');
  ok(platView.key_masked !== undefined || platView.key_set !== undefined, '/admin/platform 返回掩码/key_set');
  // /users/:id 不含 email / password_hash
  const pub = await json('GET', `/users/${IDS.victim}`, undefined, ATK);
  ok(!JSON.stringify(pub.b).match(/@/) && !JSON.stringify(pub.b).includes('password_hash'), '公开资料不含 email / password_hash');
  // 跨用户响应绝不携带 email（publicUser 只应用于自身）
  const search = await json('GET', `/users/search?q=vt_victim`, undefined, ATK);
  ok(!JSON.stringify(search.b).match(/[\w.]+@[\w.]+/), '用户搜索结果不含任何 email');

  // ============================================================
  console.log('\n收尾：存活与全局零 5xx 不变量');
  // ============================================================
  const h = await fetch(BASE + '/health');
  ok(h.ok && srv.exitCode === null, `跑完全部攻击用例后服务仍存活（/health=${h.status}, exit=${srv.exitCode}）`);
  await h.text();
  {
    const d = dbRO();
    const n = d.prepare("SELECT COUNT(*) c FROM logs WHERE level='error' AND event='server_error'").get().c;
    const rows = d.prepare("SELECT message FROM logs WHERE level='error' AND event='server_error' LIMIT 5").all();
    d.close();
    ok(n === 0, `攻击流量未触发任何 server_error（=${n}）${rows.length ? '\n     ' + rows.map(r => r.message).join('\n     ') : ''}`);
  }
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}

console.log(`\n漏洞回归: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
