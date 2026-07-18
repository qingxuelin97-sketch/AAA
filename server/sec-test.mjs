// 安全加固专项测试：邮箱别名去重 / 新号购买冷静期 / 匿名限流分档
// / 任务进度不信任客户端上报 / 开放注册政策（IP/设备不限额）/ CORS 默认白名单 / AI 预扣-退款。
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
    PORT: String(PORT), DB_PATH, MAIL_CODE_IP_LIMIT: '50',
    API_ANON_RATE_LIMIT: '120', API_AUTH_RATE_LIMIT: '1000' }, stdio: ['ignore', 'pipe', 'pipe'],
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

  // Login throttling is failure-based and temporary: ten failures are normal
  // 401 responses, the eleventh request inside 60 seconds is throttled, and a
  // successful login clears only the matching account+source bucket.
  const loginStatuses = [];
  let loginRetryAfter = 0;
  for (let i = 0; i < 11; i++) {
    const attempt = await post('/auth/login', { username: 'rate-probe', password: 'wrong-password' });
    loginStatuses.push(attempt.status);
    loginRetryAfter = Number(attempt.headers.get('retry-after') || loginRetryAfter || 0);
    await attempt.text();
  }
  ok(loginStatuses.slice(0, 10).every(s => s === 401) && loginStatuses[10] === 429 && loginRetryAfter >= 1 && loginRetryAfter <= 60,
    `登录前 10 次失败为 401、第 11 次为 429（${loginStatuses.join('/')}，Retry-After=${loginRetryAfter}）`);
  {
    const db = new Database(DB_PATH);
    db.prepare('UPDATE auth_login_failures SET failed_at = 0').run();
    db.close();
  }
  const afterWindow = await post('/auth/login', { username: 'rate-probe', password: 'wrong-password' });
  ok(afterWindow.status === 401, `60 秒窗口过期后可继续尝试且不永久锁号 → ${afterWindow.status}`);
  await afterWindow.text();
  await (await post('/auth/login', { username: 'gm', password: 'wrong-password' })).text();
  const gmRelogin = await post('/auth/login', { username: 'gm', password: '123456' });
  const gmReloginBody = await J(gmRelogin);
  const afterSuccessFailure = await post('/auth/login', { username: 'gm', password: 'wrong-password' });
  ok(gmRelogin.ok && gmReloginBody.token && afterSuccessFailure.status === 401,
    `成功登录清除同账号失败桶，下一次错误仍从 401 开始 → ${afterSuccessFailure.status}`);
  await afterSuccessFailure.text();

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

  // 1) 开放策略：同 IP 注册不再设日配额——4 个注册全部成功
  const r1 = await register('sec_u1', 'sec1@test.dev');
  const r2 = await register('sec_u2', 'sec2@test.dev');
  const r3 = await register('sec_u3', 'sec3@test.dev');
  ok(r1.token && r2.token && r3.token, `同 IP 前 3 个注册成功 (${r1.status}/${r2.status}/${r3.status})`);
  const r4 = await register('sec_u4', 'sec4@test.dev');
  ok(!!r4.token, `开放策略：同 IP 第 4 个注册照常放行 → ${r4.status} ${r4.error || ''}`);

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

  // Cross-account authorization: a private character cannot be favorited or
  // smuggled into a theater, and a private theater cannot be joined by ID.
  const privateCharacterRes = await post('/characters', {
    name: 'private-owner-card', persona: 'PRIVATE_PERSONA_MUST_NOT_LEAK', is_public: false,
  }, r1.token);
  const privateCharacter = (await J(privateCharacterRes)).character;
  const publicCharacterRes = await post('/characters', {
    name: 'public-gacha-card', persona: 'public', is_public: true,
  }, r1.token);
  const publicCharacter = (await J(publicCharacterRes)).character;
  const ttsCharacterRes = await post('/characters', {
    name: 'creator-voice-card', persona: 'creator', is_public: true,
  }, r2.token);
  const ttsCharacter = (await J(ttsCharacterRes)).character;
  ok(privateCharacterRes.ok && publicCharacterRes.ok && ttsCharacterRes.ok,
    '建立私有角色、公开角色与创作者语音角色安全夹具');

  const privateFavorite = await post(`/characters/${privateCharacter.id}/favorite`, {}, r2.token);
  {
    const db = new Database(DB_PATH);
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, character_id) VALUES (?,?)').run(r2.user.id, privateCharacter.id);
    db.close();
  }
  const favoritesAfterLegacyLeak = await J(await fetch(BASE + '/characters/favorites/list', {
    headers: { Authorization: 'Bearer ' + r2.token },
  }));
  ok(privateFavorite.status === 404 && !favoritesAfterLegacyLeak.characters.some(c => c.id === privateCharacter.id),
    `他人私有角色不可收藏，历史脏收藏也不回显 → ${privateFavorite.status}`);

  const privateTheaterRes = await post('/theater', {
    name: 'private-stage', scene: 'secret stage', cast: [privateCharacter.id], is_public: false,
  }, r1.token);
  const privateTheater = (await J(privateTheaterRes)).theater;
  const guessedJoin = await post(`/theater/${privateTheater.id}/join`, {}, r2.token);
  const guessedRead = await fetch(BASE + `/theater/${privateTheater.id}`, {
    headers: { Authorization: 'Bearer ' + r2.token },
  });
  const ownerTheaterRead = await fetch(BASE + `/theater/${privateTheater.id}`, {
    headers: { Authorization: 'Bearer ' + r1.token },
  });
  const ownerTheaterBody = await J(ownerTheaterRead);
  const publicPrivateCast = await post('/theater', {
    name: 'public-private-cast', cast: [privateCharacter.id], is_public: true,
  }, r1.token);
  const stolenPrivateCast = await post('/theater', {
    name: 'stolen-private-cast', cast: [privateCharacter.id], is_public: false,
  }, r2.token);
  ok(privateTheaterRes.ok && guessedJoin.status === 403 && guessedRead.status === 403,
    `猜测 ID 不能加入或读取私有剧场 → ${guessedJoin.status}/${guessedRead.status}`);
  ok(publicPrivateCast.status === 403 && stolenPrivateCast.status === 403,
    `公开剧场不能夹带私有角色，私有剧场不能盗用他人私有角色 → ${publicPrivateCast.status}/${stolenPrivateCast.status}`);
  ok(ownerTheaterRead.ok && ownerTheaterBody.cast?.length === 1 && ownerTheaterBody.cast[0].persona === undefined,
    '剧场响应使用角色字段白名单，不再通过 c.* 泄露 persona');

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

  const deleteScript = await fetch(BASE + `/scripts/${sid}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + r1.token },
  });
  const marketAfterDelete = await J(await fetch(BASE + '/scripts'));
  const purchasedAfterDeleteRes = await fetch(BASE + `/scripts/${sid}`, {
    headers: { Authorization: 'Bearer ' + r2.token },
  });
  const purchasedAfterDelete = await J(purchasedAfterDeleteRes);
  const buyDeleted = await post(`/scripts/${sid}/buy`, {}, r3.token);
  let preservedPurchase;
  {
    const db = new Database(DB_PATH, { readonly: true });
    preservedPurchase = db.prepare(`SELECT s.deleted_at, COUNT(sp.id) AS purchases,
      MAX(CASE WHEN COALESCE(sp.snapshot_content,'') != '' THEN 1 ELSE 0 END) AS has_snapshot
      FROM scripts s LEFT JOIN script_purchases sp ON sp.script_id=s.id WHERE s.id=?`).get(sid);
    db.close();
  }
  ok(deleteScript.ok && !marketAfterDelete.scripts.some(s => s.id === sid) && buyDeleted.status === 404,
    `剧本删除改为下架：市场隐藏且禁止新购买 → ${deleteScript.status}/${buyDeleted.status}`);
  ok(purchasedAfterDeleteRes.ok && purchasedAfterDelete.script?.content && purchasedAfterDelete.script?.deleted &&
      preservedPurchase?.deleted_at && preservedPurchase.purchases >= 2 && preservedPurchase.has_snapshot === 1,
    '已购内容继续使用不可变快照，购买与结算记录未被级联删除');

  // 5) 每日任务进度不再信任客户端上报；真实抽卡提交后才计数。
  await post('/engage/track', { action: 'chat' }, r1.token);
  await post('/engage/track', { action: 'gacha' }, r1.token);
  const tasksBeforeRealGacha = await J(await fetch(BASE + '/engage/tasks', { headers: { Authorization: 'Bearer ' + r1.token } }));
  const chatT = tasksBeforeRealGacha.tasks.find(t => t.id === 'chat' || t.name.includes('对话') || t.name.includes('聊'));
  const fakeGachaT = tasksBeforeRealGacha.tasks.find(t => t.id === 'gacha');
  ok(chatT && chatT.progress === 0, `客户端上报 chat 不计任务进度（progress=${chatT?.progress}）`);
  ok(fakeGachaT && fakeGachaT.progress === 0, `客户端伪造 gacha 上报不计任务进度（progress=${fakeGachaT?.progress}）`);
  {
    const db = new Database(DB_PATH);
    db.prepare("UPDATE users SET diamond=100 WHERE username='sec_u1'").run();
    db.close();
  }
  const realGacha = await post('/engage/gacha', {}, r1.token);
  const tasksAfterRealGacha = await J(await fetch(BASE + '/engage/tasks', { headers: { Authorization: 'Bearer ' + r1.token } }));
  const realGachaT = tasksAfterRealGacha.tasks.find(t => t.id === 'gacha');
  ok(realGacha.ok && realGachaT?.progress === 1,
    `服务器完成真实抽卡后才推进 gacha 任务（progress=${realGachaT?.progress}）`);
  {
    const db = new Database(DB_PATH);
    db.prepare('UPDATE characters SET uses=10 WHERE id=?').run(publicCharacter.id);
    db.close();
  }
  const achievements = await J(await fetch(BASE + '/achievements', {
    headers: { Authorization: 'Bearer ' + r1.token },
  }));
  const creatorHall = achievements.achievements.find(a => a.id === 'creator_hall');
  const creatorHallClaim = await post('/achievements/creator_hall/claim', {}, r1.token);
  ok(creatorHall?.unlocked && creatorHall.honor && creatorHall.reward === 0 && !creatorHall.claimable && creatorHallClaim.status === 400,
    '实时创作者排名仅授予荣誉徽章，不再成为可刷取的货币奖励');

  // 6) 开放策略：同设备注册不再设配额——同 X-Device-Id 4 个注册全部成功
  const DEV = 'devicequota-test-0001';
  backdateAll();
  const d1 = await register('dev_u1', 'dev1@test.dev', { 'X-Device-Id': DEV });
  const d2 = await register('dev_u2', 'dev2@test.dev', { 'X-Device-Id': DEV });
  const d3 = await register('dev_u3', 'dev3@test.dev', { 'X-Device-Id': DEV });
  ok(d1.token && d2.token && d3.token, `同设备前 3 个注册成功 (${d1.status}/${d2.status}/${d3.status})`);
  backdateAll();
  const d4 = await register('dev_u4', 'dev4@test.dev', { 'X-Device-Id': DEV });
  ok(!!d4.token, `开放策略：同设备第 4 个注册照常放行 → ${d4.status} ${d4.error || ''}`);
  const d5 = await register('dev_u5', 'dev5@test.dev', { 'X-Device-Id': 'another-device-000042' });
  ok(!!d5.token, `换设备注册放行 → ${d5.status}`);
  const dBad = await register('dev_u6', 'dev6@test.dev', { 'X-Device-Id': 'x'.repeat(200) });
  ok(!!dBad.token, `非法格式设备头被忽略、注册照常 → ${dBad.status}`);

  // 7) CORS 默认白名单：localhost 放行、陌生 origin 不下发 ACAO
  const cOk = await fetch(BASE + '/health', { headers: { Origin: 'http://localhost:8080' } });
  ok(cOk.headers.get('access-control-allow-origin'), 'localhost 来源下发 ACAO');
  const cBad = await fetch(BASE + '/health', { headers: { Origin: 'https://evil.example' } });
  ok(!cBad.headers.get('access-control-allow-origin'), '陌生来源不下发 ACAO（浏览器侧拒读）');

  // 8) Repeated TTS failures must create linked net-zero reversals and must
  // never increase the referenced creator's revenue-share pool.
  await fetch(BASE + '/admin/platform', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gmTok },
    body: JSON.stringify({ voice: {
      provider: 'openai', protocol: 'openai', base_url: 'https://unreachable-voice.invalid',
      key: 'test-voice-key', model: 'tts-1', voice_name: 'alloy',
    } }),
  });
  {
    const db = new Database(DB_PATH);
    db.prepare("UPDATE users SET gold=1000 WHERE username='sec_u1'").run();
    db.close();
  }
  const failedTts1 = await post('/chat/tts', { text: 'refund-one', character_id: ttsCharacter.id }, r1.token);
  const failedTts2 = await post('/chat/tts', { text: 'refund-two', character_id: ttsCharacter.id }, r1.token);
  await failedTts1.text();
  await failedTts2.text();
  const creatorPlanRes = await fetch(BASE + '/me/revenue-plan', {
    headers: { Authorization: 'Bearer ' + r2.token },
  });
  const creatorPlanText = await creatorPlanRes.text();
  let creatorPlan = {};
  try { creatorPlan = JSON.parse(creatorPlanText); } catch { creatorPlan = { error: creatorPlanText }; }
  let voiceLedger;
  {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(`SELECT id, kind, gold, ref_owner, reversal_of, share_eligible
      FROM transactions WHERE user_id=? AND kind IN ('voice_fee','voice_refund') ORDER BY id`).all(r1.user.id);
    const fees = rows.filter(r => r.kind === 'voice_fee');
    const refunds = rows.filter(r => r.kind === 'voice_refund');
    voiceLedger = {
      fees: fees.length,
      refunds: refunds.length,
      net: rows.reduce((n, r) => n + r.gold, 0),
      linked: refunds.every(r => fees.some(f => f.id === r.reversal_of && f.ref_owner === r.ref_owner)),
      visible: rows.every(r => r.share_eligible === 1),
    };
    db.close();
  }
  ok(failedTts1.status === 502 && failedTts2.status === 502 && voiceLedger.fees === 2 &&
      voiceLedger.refunds === 2 && voiceLedger.net === 0 && voiceLedger.linked && voiceLedger.visible,
    `TTS 失败扣费均精确冲正并继承创作者归属（fee=${voiceLedger.fees}, refund=${voiceLedger.refunds}, net=${voiceLedger.net}）`);
  ok(creatorPlanRes.ok && creatorPlan.plan?.pool_total === 0 && creatorPlan.plan?.claimable_amount === 0,
    `失败 TTS 不增加创作者分成池（status=${creatorPlanRes.status}, pool=${creatorPlan.plan?.pool_total}）`);

  // 9) AI 生图预扣-退款：平台生图指向不可达上游 → 502，余额分文不少，流水留下 image_fee/ai_refund 对
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

  let normalUserAi429 = 0;
  for (let i = 0; i < 14; i++) {
    const limited = await post('/ai/image', {}, r3.token);
    if (limited.status === 429) normalUserAi429++;
    await limited.text();
  }
  ok(normalUserAi429 > 0, `普通登录用户同样受 AI 12/min 限流保护（429 × ${normalUserAi429}）`);

  // 10) 匿名限流分档。测试进程将匿名档提高到 120 以免前置注册夹具污染，
  // 末尾快速打 130 发仍应出现 429；登录档单独提高后同量不拦。
  // 放最后：爆掉匿名配额后 send-code 等匿名接口在窗口内都会 429，会污染前面的注册用例。
  let anon429 = 0;
  for (let i = 0; i < 130; i++) { const r = await fetch(BASE + '/economy/packages'); if (r.status === 429) anon429++; }
  ok(anon429 > 0, `匿名请求超过测试配额触发限流（429 × ${anon429}）`);
  let auth429 = 0;
  for (let i = 0; i < 130; i++) { const r = await fetch(BASE + '/economy/packages', { headers: { Authorization: 'Bearer ' + r1.token } }); if (r.status === 429) auth429++; }
  ok(auth429 === 0, `登录用户同量请求不受匿名档限制（429 × ${auth429}）`);
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
console.log(`\n安全加固专项: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
