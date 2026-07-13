import db from '../db.js';

const [subject, action] = process.argv.slice(2);
if (!subject || !['--grant', '--revoke'].includes(action) || process.env.CONFIRM_LOCAL_GM_CHANGE !== 'YES') {
  console.error('Usage: CONFIRM_LOCAL_GM_CHANGE=YES node server/scripts/set-gm.mjs <username-or-id> --grant|--revoke');
  process.exit(2);
}

const user = /^\d+$/.test(subject)
  ? db.prepare('SELECT id, username, is_gm FROM users WHERE id = ?').get(Number(subject))
  : db.prepare('SELECT id, username, is_gm FROM users WHERE username = ?').get(subject);
if (!user) {
  console.error('User not found');
  process.exit(1);
}

const value = action === '--grant' ? 1 : 0;
if (!value && user.is_gm) {
  const gmCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_gm = 1 AND is_banned = 0').get().n;
  if (gmCount <= 1) {
    console.error('Refusing to revoke the last active GM account');
    process.exit(1);
  }
}

db.transaction(() => {
  db.prepare('UPDATE users SET is_gm = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(value, user.id);
}).immediate();

console.log(`${value ? 'Granted' : 'Revoked'} GM for ${user.username} (id=${user.id}); existing sessions were revoked.`);
