// 一次性脚本：创建指定账号并赋予 100 金币（默认注册流程给 300，此处按需覆盖）。
// 幂等：若账号已存在则更新密码并将金币重置为 100，不影响其它字段与关联数据。
//
// 用法（项目根目录）：
//   node server/scripts/add-account.mjs
//   ACCOUNT_USER=xxx ACCOUNT_PASS=yyy ACCOUNT_GOLD=100 node server/scripts/add-account.mjs
//
// 默认账号（未传环境变量时）：
//   用户名：biyue
//   密码：  Biyue@2026
//   金币：  100

import db from '../db.js';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
const DEFAULT_USERNAME = 'biyue';
const DEFAULT_PASSWORD = 'Biyue@2026';
const DEFAULT_GOLD = 100;

const username = String(process.env.ACCOUNT_USER || DEFAULT_USERNAME).trim();
const password = String(process.env.ACCOUNT_PASS || DEFAULT_PASSWORD);
const gold = Number(process.env.ACCOUNT_GOLD || DEFAULT_GOLD);

if (!/^[A-Za-z0-9_]{2,20}$|^[\u4e00-\u9fa5\w]{2,20}$/.test(username)) {
  console.error('用户名需 2-20 位，仅限字母、数字、下划线或中文');
  process.exit(1);
}
if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
  console.error('密码需为 8-72 位');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);

const tx = db.transaction(() => {
  const existing = db.prepare('SELECT id, gold FROM users WHERE username = ?').get(username);
  if (existing) {
    // 已存在：重置密码 + 调整金币到目标值；token 版本 +1 使旧会话失效。
    db.prepare('UPDATE users SET password_hash = ?, gold = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?')
      .run(passwordHash, gold, existing.id);
    console.log(`账号已存在：${username} (id=${existing.id})，已重置密码并将金币设为 ${gold}（原 ${existing.gold}）；旧登录态已失效。`);
  } else {
    const info = db.prepare(`INSERT INTO users
      (username, password_hash, display_name, gold, reg_trust)
      VALUES (?, ?, ?, ?, 'legacy')`)
      .run(username, passwordHash, username.slice(0, 30), gold);
    const userId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
    console.log(`已创建账号：${username} (id=${userId})，初始金币 ${gold}。`);
  }
});
tx();
