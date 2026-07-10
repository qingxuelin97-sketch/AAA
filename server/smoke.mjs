// 全站接口体检：起一个临时数据库的服务端，登录后遍历前端会用到的接口，
// 任一返回非 200 即判定失败（exit 1）。用于每次改动后快速验证服务端没有掉接口。
//   运行：npm run smoke
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4199;
const DB_PATH = path.join(__dirname, 'smoke.tmp.sqlite');
const BASE = `http://localhost:${PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const run = (cmd, args, env) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? res() : rej(new Error(cmd + ' exited ' + code))));
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('· 灌入临时演示数据…');
await run('node', ['server/seed.js'], { DB_PATH });

console.log('· 启动服务端…');
const srv = spawn('node', ['server/index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH }, stdio: 'ignore' });

let failed = 0;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* */ } await sleep(250); }
  const tok = (await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: '123456' }) })).json()).token;
  const H = { Authorization: 'Bearer ' + tok };
  const j = async (p) => (await (await fetch(BASE + p, { headers: H })).json());
  const cid = (await j('/characters/public')).characters?.[0]?.id;
  const sid = (await j('/scripts')).scripts?.[0]?.id;
  const convId = (await j('/chat/conversations')).conversations?.[0]?.id;
  const pid = (await j('/parliament/proposals')).proposals?.[0]?.id;

  const endpoints = [
    '/auth/me', '/meta/categories', '/settings', '/economy/wallet', '/economy/packages', '/economy/transactions',
    '/characters/public', '/characters/mine', '/characters/recommended', '/characters/favorites/list', cid && `/characters/${cid}`,
    '/scripts', '/scripts/mine', sid && `/scripts/${sid}`, '/chat/conversations', convId && `/chat/conversations/${convId}`,
    '/community/feed', '/community/inbox', '/social/moments', '/social/suggested', '/social/notifications',
    '/groups', '/theater', '/novels', '/announcements', '/engage/tasks', '/engage/events', '/engage/leaderboard', '/achievements', '/me/studio', '/me/insights',
    '/parliament/overview', '/parliament/proposals', '/parliament/councilors', pid && `/parliament/proposals/${pid}/comments`,
    '/friends', '/friends/requests', '/friends/state/2', '/dm', '/users/search?q=a', '/users/2', '/ai/images',
    '/admin/check', '/admin/stats', '/admin/users', '/admin/characters', '/admin/scripts', '/admin/codes',
    '/admin/reports', '/admin/platform', '/admin/council', '/admin/councilors',
    '/asr/status',
  ].filter(Boolean);

  for (const p of endpoints) {
    let s; try { s = (await fetch(BASE + p, { headers: H })).status; } catch (e) { s = 'ERR'; }
    if (s !== 200) { failed++; console.log(`  !!! ${s}  ${p}`); }
  }
  console.log(failed === 0 ? `\n✅ 体检通过：${endpoints.length} 个接口全部 200` : `\n❌ ${failed} 个接口异常`);

  // —— MiniMax TTS 试听链路验证（mock fetch，确保 synthesize 的 minimax 分支真返回可播放音频）
  console.log('· 验证 MiniMax TTS 试听链路…');
  const { synthesize } = await import('./routes/chat.js');
  const fakeMp3 = Buffer.from([0xFF, 0xFB, 0x90, 0x64, ...Array(196).fill(0)]);
  const fakeHex = fakeMp3.toString('hex');
  let mmReq = null, mmStrategy = 'success';
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, opts = {}) => {
    mmReq = { url, auth: opts.headers?.Authorization, body: opts.body ? JSON.parse(opts.body) : null };
    if (mmStrategy === 'httpErr') return Promise.resolve({ ok: false, status: 401, text: async () => 'unauthorized' });
    if (mmStrategy === 'voiceNotFound') return Promise.resolve({ ok: true, status: 200, json: async () => ({ base_resp: { status_code: 1004, status_msg: 'voice_id not found' } }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { audio: fakeHex }, base_resp: { status_code: 0, status_msg: 'success' } }) });
  };
  try {
    const MM = 'https://api.minimax.chat/v1'; // 公网域名过 SSRF；fetch 已被 mock 拦截不发真实请求
    const r1 = await synthesize({ proto: 'minimax', base: `${MM}?GroupId=12345`, key: 'testapikey', model: 'speech-02-hd', voice: 'male-qn-qingse', text: '试听', speed: 1, pitch: 1 });
    if (!r1.ok || r1.contentType !== 'audio/mpeg' || r1.buffer[0] !== 0xFF) { failed++; console.log('  !!! MiniMax 合成失败或返回非 mp3'); }
    else if (!mmReq.url.includes('GroupId=12345') || mmReq.body?.output_format !== 'hex' || mmReq.auth !== 'Bearer testapikey') { failed++; console.log('  !!! MiniMax 请求构造错误'); }
    else console.log('  ✅ 合成返回', r1.buffer.length, '字节 audio/mpeg，请求参数正确');

    const r2 = await synthesize({ proto: 'minimax', base: MM, key: '12345:testapikey', text: 'x' }); // GroupId:APIKey
    if (!r2.ok || !mmReq.url.includes('GroupId=12345') || mmReq.auth !== 'Bearer testapikey') { failed++; console.log('  !!! GroupId:APIKey 解析错误'); }
    else console.log('  ✅ GroupId:APIKey 解析正确');

    mmStrategy = 'voiceNotFound';
    const r3 = await synthesize({ proto: 'minimax', base: `${MM}?GroupId=12345`, key: 'testapikey', text: 'x' });
    if (r3.ok || !/voice_id not found/.test(r3.error)) { failed++; console.log('  !!! 失败响应未识别'); }
    else console.log('  ✅ 失败响应正确识别 base_resp 错误');
  } finally { globalThis.fetch = origFetch; }
  console.log(failed === 0 ? `\n✅ MiniMax 试听链路通过` : `\n❌ MiniMax 试听链路异常`);

  // —— 安全回归：跨域计费头暴露 + SSRF 拒绝（覆盖 P0/P2 修复，防回退）——
  console.log('· 验证安全加固（exposedHeaders / SSRF）…');
  {
    // 1) CORS exposedHeaders 必须同时含 X-Request-Id 与计费头（历史 bug：链路中间件覆盖了 cors 值）
    const hr = await fetch(BASE + '/health', { headers: { Origin: 'http://localhost:8080' } });
    const exp = (hr.headers.get('access-control-expose-headers') || '').toLowerCase();
    const need = ['x-request-id', 'x-gold-fee', 'x-gold-balance'];
    const missing = need.filter(h => !exp.includes(h));
    if (missing.length) { failed++; console.log('  !!! exposedHeaders 缺失：' + missing.join(',') + '（实际：' + exp + '）'); }
    else console.log('  ✅ 跨域 exposedHeaders 含 X-Request-Id + 计费头');

    // 2) SSRF：把 llm_base_url 指向内网/元数据地址，novels/theater 的出站创作接口必须拒绝。
    const putSettings = (url) => fetch(BASE + '/settings', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ llm_base_url: url, llm_api_key: 'sk-smoke', llm_model: 'gpt-x', llm_provider: 'custom', llm_protocol: 'openai' }) });
    const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, text: await r.text().catch(() => '') }; };
    const ssrfRejected = (r) => r.status === 400 && /内网|不合法|禁止/.test(r.text);
    await putSettings('http://169.254.169.254/v1');   // 云元数据地址（字面 IP，同步预检即拒）
    const nov = await post('/novels/brainstorm', { seed: '一句创意' });
    if (!ssrfRejected(nov)) { failed++; console.log('  !!! novels/brainstorm 未拒绝元数据地址：' + nov.status + ' ' + nov.text.slice(0, 80)); }
    else console.log('  ✅ novels 出站拒绝内网/元数据地址');
    // theater/:id/act 需要一个剧场；取种子里的第一个（无则跳过该子断言）
    const tId = (await j('/theater')).theaters?.[0]?.id;
    if (tId) {
      const th = await post(`/theater/${tId}/act`, {});
      if (!ssrfRejected(th)) { failed++; console.log('  !!! theater/act 未拒绝元数据地址：' + th.status + ' ' + th.text.slice(0, 80)); }
      else console.log('  ✅ theater 出站拒绝内网/元数据地址');
    }
    // 复原设置，避免影响后续（本进程随即退出，稳妥起见仍还原）
    await putSettings('https://api.example.com/v1');
  }
  console.log(failed === 0 ? `\n✅ 安全加固回归通过` : `\n❌ 安全加固回归异常`);
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
process.exit(failed === 0 ? 0 : 1);
