// 安全加固专项测试：注册 IP 日配额 / 邮箱别名去重 / 新号购买冷静期 / 匿名限流分档
// / 任务进度不信任客户端上报 / 设备注册配额 / CORS 默认白名单 / AI 预扣-退款。
// 运行：npm run test:sec
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4198;
const DB_PATH = path.join(ROOT, 'server', 'sec-test.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 邮件拦截 preload（与 reg-flow 相同机制，独立生成避免顺序依赖）
const interceptor = path.join(__dirname, 'sec-test.interceptor.mjs');
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
  cwd: ROOT, env: { ...process.env, NODE_ENV: 'test', TEST_EXPOSE_EMAIL_CODES: '1',
    PORT: String(PORT), DB_PATH, MAIL_CODE_IP_LIMIT: '50', AUTH_RATE_LIMIT: '50' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
srv.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });
srv.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const J = (r) => r.json();
const post = (p, body, tok, extraHeaders = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...extraHeaders }, body: JSON.stringify(body) });

// 服务端从邮件拦截器读不到 —— 但验证码写库了；直接读临时库拿 code（测试环境专用）。
import Database from 'better-sqlite3';
const codeOf = (email) => {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT code FROM email_codes WHERE email = ? AND consumed = 0 ORDER BY id DESC LIMIT 1').get(email);
  db.close();
  return row?.code;
};

const register = async (username, email, extraHeaders = {}) => {
  const sc = await post('/auth/send-code', { email });
  const scBody = await J(sc);
  if (!sc.ok) return { status: sc.status, ...scBody };
  const code = scBody.test_code;
  const r = await post('/auth/register', { username, password: 'Passw0rd!', email, code }, null, extraHeaders);
  return { status: r.status, ...(await J(r)) };
};
// 把既有用户的注册时间挪出 24h IP 配额窗（30 天设备窗不受影响），供后续注册用例隔离。
const backdateAll = () => {
  const db = new Database(DB_PATH);
  db.prepare("UPDATE users SET created_at = datetime('now', '-2 days')").run();
  db.close();
};

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (srv.exitCode !== null) break;
    try { if ((await fetch(BASE + '/health')).ok) { ready = true; break; } } catch { /* retry */ }
    await sleep(250);
  }
  if (!ready) throw new Error(`测试服务未就绪（exit=${srv.exitCode}）\n${serverOutput}`);

  // GM 用户 + SMTP 配置（mock 拦截后任意配置可用）—— 同 reg-flow 的做法
  {
    const db = new Database(DB_PATH);
    const bcrypt = (await import('bcryptjs')).default;
    db.prepare('INSERT INTO users (username, password_hash, display_name, is_gm) VALUES (?,?,?,1)')
      .run('gm', bcrypt.hashSync('123456', 10), 'GM');
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(db.prepare("SELECT id FROM users WHERE username='gm'").get().id);
    db.prepare("INSERT INTO email_whitelist (email, kind, note) VALUES ('@test.dev', 'domain', 'security regression fixture')").run();
    db.close();
  }
  const gmTok = (await J(await post('/auth/login', { username: 'gm', password: '123456' }))).token;
  await fetch(BASE + '/admin/mail', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gmTok }, body: JSON.stringify({ host: 'smtp.mock.com', port: 465, secure: true, user: 'u@mock.com', pass: 'p', from: '"T" <u@mock.com>' }) });

  // Registration is restricted by default. Invite validation and code
  // consumption must be one atomic operation, and codes must not be stored as
  // reusable plaintext secrets.
  const policy = await J(await fetch(BASE + '/auth/registration-policy'));
  ok(policy.mode === 'restricted', `注册默认处于受限模式（mode=${policy.mode}）`);
  const ungated = await post('/auth/send-code', { email: 'ungated@outside.example', username: 'ungated' });
  ok(ungated.status === 403, `非白名单、无邀请注册被拒绝 → ${ungated.status}`);
  {
    const db = new Database(DB_PATH);
    db.prepare("INSERT INTO invite_keys (code, max_uses, grant_gold, note) VALUES ('SEC-INVITE-TX', 1, 7, 'transaction regression')").run();
    db.close();
  }
  const inviteMail = await post('/auth/send-code', {
    email: 'invited@outside.example', username: 'invited_user', invite: 'SEC-INVITE-TX',
  });
  const inviteMailBody = await J(inviteMail);
  let inviteCodeRow;
  {
    const db = new Database(DB_PATH, { readonly: true });
    inviteCodeRow = db.prepare("SELECT id, code, consumed FROM email_codes WHERE email='invited@outside.example' ORDER BY id DESC LIMIT 1").get();
    db.close();
  }
  ok(inviteMail.ok && /^\d{6}$/.test(inviteMailBody.test_code || ''), `受邀用户可获取一次性验证码 → ${inviteMail.status}`);
  ok(inviteCodeRow?.code?.startsWith('h1:') && inviteCodeRow.code !== inviteMailBody.test_code,
    '邮箱验证码以 HMAC 摘要存储，不在数据库保留明文');
  const badInviteRegister = await post('/auth/register', {
    username: 'invited_user', password: 'Passw0rd!', email: 'invited@outside.example',
    code: inviteMailBody.test_code, invite: 'WRONG-INVITE',
  });
  let afterBadInvite;
  {
    const db = new Database(DB_PATH, { readonly: true });
    afterBadInvite = db.prepare('SELECT consumed FROM email_codes WHERE id=?').get(inviteCodeRow.id);
    db.close();
  }
  ok(badInviteRegister.status === 400 && afterBadInvite?.consumed === 0,
    `无效邀请不会吞掉验证码 → ${badInviteRegister.status}`);
  const invitedRegister = await post('/auth/register', {
    username: 'invited_user', password: 'Passw0rd!', email: 'invited@outside.example',
    code: inviteMailBody.test_code, invite: 'SEC-INVITE-TX',
  });
  const invitedBody = await J(invitedRegister);
  {
    const db = new Database(DB_PATH);
    const state = db.prepare(`SELECT u.reg_trust, k.used,
      (SELECT COUNT(*) FROM code_redemptions cr WHERE cr.code=k.code AND cr.user_id=u.id) AS redemptions
      FROM users u JOIN invite_keys k ON k.code='SEC-INVITE-TX' WHERE u.username='invited_user'`).get();
    ok(invitedRegister.ok && invitedBody.token && state?.reg_trust === 'invite' && state.used === 1 && state.redemptions === 1,
      '注册、邀请消费、兑换记录在同一事务内落账');
    db.prepare("UPDATE users SET created_at=datetime('now','-2 days') WHERE username='invited_user'").run();
    db.close();
  }

  // 1) 同 IP 连注 3 个成功，第 4 个 429
  const r1 = await register('sec_u1', 'sec1@test.dev');
  const r2 = await register('sec_u2', 'sec2@test.dev');
  const r3 = await register('sec_u3', 'sec3@test.dev');
  ok(r1.token && r2.token && r3.token, `同 IP 前 3 个注册成功 (${r1.status}/${r2.status}/${r3.status})`);
  const r4 = await register('sec_u4', 'sec4@test.dev');
  ok(r4.status === 429, `同 IP 第 4 个注册被日配额拦截 → ${r4.status} ${r4.error || ''}`);

  // Long-lived JWTs must never be accepted in an SSE URL. The replacement
  // ticket is short-lived, random, and consumed by the first stream attempt.
  const ticketRes = await post('/realtime/ticket', {}, r1.token);
  const ticketBody = await J(ticketRes);
  const jwtInQuery = await fetch(BASE + '/realtime/stream?token=' + encodeURIComponent(r1.token));
  const streamAbort = new AbortController();
  const streamRes = await fetch(BASE + '/realtime/stream?ticket=' + encodeURIComponent(ticketBody.ticket), { signal: streamAbort.signal });
  streamAbort.abort();
  const ticketReplay = await fetch(BASE + '/realtime/stream?ticket=' + encodeURIComponent(ticketBody.ticket));
  ok(ticketRes.ok && jwtInQuery.status === 401 && streamRes.ok && ticketReplay.status === 401,
    `实时连接仅接受一次性票据，拒绝 URL JWT 与票据重放 → ${jwtInQuery.status}/${streamRes.status}/${ticketReplay.status}`);

  // MIME headers are attacker-controlled; a script disguised as PNG must be
  // removed before it receives a public /uploads URL or quota ledger entry.
  const fakeImage = new FormData();
  fakeImage.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'avatar.png');
  const fakeUpload = await fetch(BASE + '/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + r1.token }, body: fakeImage,
  });
  let uploadRows;
  {
    const db = new Database(DB_PATH, { readonly: true });
    uploadRows = db.prepare('SELECT COUNT(*) n FROM user_uploads WHERE user_id=?').get(r1.user.id).n;
    db.close();
  }
  ok(fakeUpload.status === 400 && uploadRows === 0,
    `伪装 MIME 的上传被拒绝且未写入资源账本 → ${fakeUpload.status}`);

  // Emergency controls: a client cannot mint recharge currency, private groups
  // cannot be self-joined, and a GM token cannot grant new GM privileges.
  const oldRecharge = await post('/economy/recharge', { package_id: 'p1' }, r1.token);
  ok(oldRecharge.status === 410, `旧充值直发接口已永久停用 → ${oldRecharge.status}`);
  const orderWithoutProvider = await post('/economy/recharge/orders', { package_id: 'p1', idempotency_key: 'sec-order-0001' }, r1.token);
  ok(orderWithoutProvider.status === 503, `未配置支付通道时无法创建可入账订单 → ${orderWithoutProvider.status}`);
  {
    const db = new Database(DB_PATH, { readonly: true });
    const wallet = db.prepare("SELECT diamond FROM users WHERE username='sec_u1'").get();
    db.close();
    ok(wallet?.diamond === 0, `伪造充值请求后钻石余额保持不变（diamond=${wallet?.diamond}）`);
  }

  const privateCreate = await post('/groups', { name: 'private-sec', is_public: false }, r1.token);
  const privateBody = await J(privateCreate);
  const privateJoin = await post(`/groups/${privateBody.group?.id}/join`, {}, r2.token);
  ok(privateJoin.status === 403, `非受邀用户无法自行加入私有群 → ${privateJoin.status}`);

  let r1Id;
  {
    const db = new Database(DB_PATH, { readonly: true });
    r1Id = db.prepare("SELECT id FROM users WHERE username='sec_u1'").get().id;
    db.close();
  }
  const gmChange = await post(`/admin/users/${r1Id}/gm`, { value: true }, gmTok);
  ok(gmChange.status === 403, `Web 管理端不能授予 GM 权限 → ${gmChange.status}`);
  const negativeGift = await post('/admin/gift', { user_id: r1Id, gold: -1 }, gmTok);
  ok(negativeGift.status === 400, `管理员赠送接口拒绝负数余额变更 → ${negativeGift.status}`);

  // 2) 邮箱别名去重：sec1+alt@test.dev 与 sec1@test.dev 同规范形 → 409（send-code 即拦）
  const alias = await post('/auth/send-code', { email: 'sec1+alt@test.dev' });
  const aliasBody = await J(alias);
  ok(alias.status === 409, `别名邮箱 send-code 被拦 → ${alias.status} ${aliasBody.error || ''}`);

  // A valid session alone is insufficient to replace the account email.
  const emailWithoutCode = await fetch(BASE + '/auth/me', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r3.token },
    body: JSON.stringify({ email: 'sec3-new@test.dev' }),
  });
  ok(emailWithoutCode.status === 400, `仅凭登录态不能换绑邮箱 → ${emailWithoutCode.status}`);
  const emailCodeRes = await post('/auth/email/send-code', { email: 'sec3-new@test.dev' }, r3.token);
  const emailCodeBody = await J(emailCodeRes);
  const emailChanged = await fetch(BASE + '/auth/me', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r3.token },
    body: JSON.stringify({ email: 'sec3-new@test.dev', email_code: emailCodeBody.test_code }),
  });
  const emailChangedBody = await J(emailChanged);
  ok(emailCodeRes.ok && emailChanged.ok && emailChangedBody.user?.email === 'sec3-new@test.dev',
    `新邮箱验证成功后才完成换绑 → ${emailChanged.status}`);

  // 3) 新号 24h 内禁止购买付费剧本：u1 发布付费剧本，u2（刚注册）购买 → 403
  const pub = await post('/scripts', { title: '防刷测试剧本', summary: 't', content: '正文', price_gold: 100 }, r1.token);
  const pubBody = await J(pub);
  const sid = pubBody.script?.id || pubBody.id;
  ok(pub.ok && sid, `发布付费剧本 → ${pub.status} id=${sid}`);
  const buy = await post(`/scripts/${sid}/buy`, {}, r2.token);
  const buyBody = await J(buy);
  ok(buy.status === 403, `新号购买付费剧本被冷静期拦截 → ${buy.status} ${buyBody.error || ''}`);
  // 账龄改到 25h 前 → 可以买（策略只拦新号）
  {
    const db = new Database(DB_PATH);
    db.prepare("UPDATE users SET created_at = datetime('now', '-25 hours') WHERE username = 'sec_u2'").run();
    db.close();
  }
  const buy2 = await post(`/scripts/${sid}/buy`, {}, r2.token);
  ok(buy2.ok, `满 24h 账号购买放行 → ${buy2.status}`);
  {
    const db = new Database(DB_PATH, { readonly: true });
    const author = db.prepare("SELECT gold FROM users WHERE username='sec_u1'").get();
    db.close();
    ok(author?.gold === 300, `退款窗口内货款处于平台托管，作者未提前到账（gold=${author?.gold}）`);
  }
  const refunded = await post(`/scripts/${sid}/refund`, {}, r2.token);
  const refundReplay = await post(`/scripts/${sid}/refund`, {}, r2.token);
  {
    const db = new Database(DB_PATH, { readonly: true });
    const buyer = db.prepare("SELECT gold FROM users WHERE username='sec_u2'").get();
    const author = db.prepare("SELECT gold FROM users WHERE username='sec_u1'").get();
    db.close();
    ok(refunded.ok && !refundReplay.ok && buyer?.gold === 300 && author?.gold === 300,
      `托管退款精确一次且不依赖作者余额（buyer=${buyer?.gold}, author=${author?.gold}）`);
  }
  const buyAfterRefund = await post(`/scripts/${sid}/buy`, {}, r2.token);
  {
    const db = new Database(DB_PATH);
    const buyerId = db.prepare("SELECT id FROM users WHERE username='sec_u2'").get().id;
    db.prepare('UPDATE script_purchases SET settlement_due_at=0 WHERE script_id=? AND user_id=? AND refunded=0').run(sid, buyerId);
    db.close();
  }
  await fetch(BASE + '/scripts');
  await fetch(BASE + '/scripts');
  {
    const db = new Database(DB_PATH, { readonly: true });
    const author = db.prepare("SELECT gold FROM users WHERE username='sec_u1'").get();
    const sales = db.prepare(`SELECT COUNT(*) n FROM transactions t JOIN users u ON u.id=t.user_id
      WHERE u.username='sec_u1' AND t.kind='sell_script' AND t.gold=100`).get();
    db.close();
    ok(buyAfterRefund.ok && author?.gold === 400 && sales.n === 1,
      `托管到期后仅结算一次（gold=${author?.gold}, ledger=${sales.n}）`);
  }
  const negativePrice = await post('/scripts', { title: 'invalid-price', price_gold: -1 }, r1.token);
  const invalidUpdate = await fetch(BASE + `/scripts/${sid}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r1.token },
    body: JSON.stringify({ price_gold: 'not-a-number' }),
  });
  ok(negativePrice.status === 400 && invalidUpdate.status === 400,
    `剧本价格拒绝负数和非数值 → ${negativePrice.status}/${invalidUpdate.status}`);

  // 5) 每日任务进度不再信任客户端上报：/track 报 chat 无效（服务端真实动作才计数），gacha 仍有效（纯前端玩法）
  await post('/engage/track', { action: 'chat' }, r1.token);
  await post('/engage/track', { action: 'gacha' }, r1.token);
  const tasks = await J(await fetch(BASE + '/engage/tasks', { headers: { Authorization: 'Bearer ' + r1.token } }));
  const chatT = tasks.tasks.find(t => t.id === 'chat' || t.name.includes('对话') || t.name.includes('聊'));
  const gachaT = tasks.tasks.find(t => t.id === 'gacha');
  ok(chatT && chatT.progress === 0, `客户端上报 chat 不计任务进度（progress=${chatT?.progress}）`);
  ok(gachaT && gachaT.progress >= 1, `扭蛋机 gacha 上报仍计数（progress=${gachaT?.progress}）`);

  // 6) 同设备注册配额：同 X-Device-Id 30 天内 3 号封顶（IP 窗每轮回拨隔离）
  const DEV = 'devicequota-test-0001';
  backdateAll();
  const d1 = await register('dev_u1', 'dev1@test.dev', { 'X-Device-Id': DEV });
  const d2 = await register('dev_u2', 'dev2@test.dev', { 'X-Device-Id': DEV });
  const d3 = await register('dev_u3', 'dev3@test.dev', { 'X-Device-Id': DEV });
  ok(d1.token && d2.token && d3.token, `同设备前 3 个注册成功 (${d1.status}/${d2.status}/${d3.status})`);
  backdateAll(); // 让 IP 日配额出窗，只留设备 30 天窗生效
  const d4 = await register('dev_u4', 'dev4@test.dev', { 'X-Device-Id': DEV });
  ok(d4.status === 429 && /设备/.test(d4.error || ''), `同设备第 4 个注册被设备配额拦截 → ${d4.status} ${d4.error || ''}`);
  const d5 = await register('dev_u5', 'dev5@test.dev', { 'X-Device-Id': 'another-device-000042' });
  ok(!!d5.token, `换设备注册放行 → ${d5.status}`);
  const dBad = await register('dev_u6', 'dev6@test.dev', { 'X-Device-Id': 'x'.repeat(200) });
  ok(!!dBad.token, `非法格式设备头被忽略、注册照常 → ${dBad.status}`);

  // 7) CORS 默认白名单：localhost 放行、陌生 origin 不下发 ACAO
  const cOk = await fetch(BASE + '/health', { headers: { Origin: 'http://localhost:8080' } });
  ok(cOk.headers.get('access-control-allow-origin'), 'localhost 来源下发 ACAO');
  const cBad = await fetch(BASE + '/health', { headers: { Origin: 'https://evil.example' } });
  ok(!cBad.headers.get('access-control-allow-origin'), '陌生来源不下发 ACAO（浏览器侧拒读）');

  // 8) AI 生图预扣-退款：平台生图指向不可达上游 → 502，余额分文不少，流水留下 image_fee/ai_refund 对
  await fetch(BASE + '/admin/platform', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gmTok },
    body: JSON.stringify({ image: { provider: 'openai', base_url: 'https://unreachable-upstream.invalid', key: 'test-key', model: 'test' } }) });
  {
    const db = new Database(DB_PATH);
    db.prepare("UPDATE users SET gold = 1000 WHERE username = 'sec_u1'").run();
    db.close();
  }
  const imgRes = await post('/ai/image', { prompt: '测试' }, r1.token);
  ok(imgRes.status === 502, `不可达上游生图失败 → ${imgRes.status}`);
  const meAfter = await J(await fetch(BASE + '/auth/me', { headers: { Authorization: 'Bearer ' + r1.token } }));
  ok(meAfter.user.gold === 1000, `预扣已退款，余额分文不少（gold=${meAfter.user.gold}）`);
  {
    const db = new Database(DB_PATH, { readonly: true });
    const uid = db.prepare("SELECT id FROM users WHERE username='sec_u1'").get().id;
    const fee = db.prepare("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND kind='image_fee' AND gold<0").get(uid).n;
    const refund = db.prepare("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND kind='ai_refund' AND gold>0").get(uid).n;
    db.close();
    ok(fee === 1 && refund === 1, `流水留下预扣/退款对（image_fee×${fee} ai_refund×${refund}）`);
  }

  // 9) 匿名限流分档：60/min。快速打 70 发匿名请求，出现 429；带合法 token 同量不拦。
  // 放最后：爆掉匿名配额后 send-code 等匿名接口在窗口内都会 429，会污染前面的注册用例。
  let anon429 = 0;
  for (let i = 0; i < 70; i++) { const r = await fetch(BASE + '/economy/packages'); if (r.status === 429) anon429++; }
  ok(anon429 > 0, `匿名请求超 60/min 触发限流（429 × ${anon429}）`);
  let auth429 = 0;
  for (let i = 0; i < 70; i++) { const r = await fetch(BASE + '/economy/packages', { headers: { Authorization: 'Bearer ' + r1.token } }); if (r.status === 429) auth429++; }
  ok(auth429 === 0, `登录用户同量请求不受匿名档限制（429 × ${auth429}）`);
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
console.log(`\n安全加固专项: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
