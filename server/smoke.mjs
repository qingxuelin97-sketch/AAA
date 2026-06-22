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
    '/groups', '/theater', '/announcements', '/engage/tasks', '/engage/events', '/engage/leaderboard', '/achievements', '/me/studio',
    '/parliament/overview', '/parliament/proposals', '/parliament/councilors', pid && `/parliament/proposals/${pid}/comments`,
    '/friends', '/friends/requests', '/friends/state/2', '/dm', '/users/search?q=a', '/users/2', '/ai/images',
    '/admin/check', '/admin/stats', '/admin/users', '/admin/characters', '/admin/scripts', '/admin/codes',
    '/admin/reports', '/admin/platform', '/admin/council', '/admin/councilors',
  ].filter(Boolean);

  for (const p of endpoints) {
    let s; try { s = (await fetch(BASE + p, { headers: H })).status; } catch (e) { s = 'ERR'; }
    if (s !== 200) { failed++; console.log(`  !!! ${s}  ${p}`); }
  }
  console.log(failed === 0 ? `\n✅ 体检通过：${endpoints.length} 个接口全部 200` : `\n❌ ${failed} 个接口异常`);
} finally {
  srv.kill();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
process.exit(failed === 0 ? 0 : 1);
