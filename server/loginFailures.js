import crypto from 'node:crypto';
import db from './db.js';

const WINDOW_MS = 60_000;
const ACCOUNT_IP_LIMIT = Math.max(1, Number(process.env.LOGIN_ACCOUNT_IP_LIMIT) || 10);
const IP_LIMIT = Math.max(ACCOUNT_IP_LIMIT, Number(process.env.LOGIN_IP_LIMIT) || 100);

const digest = (secret, scope, value) => crypto.createHmac('sha256', secret)
  .update(`${scope}\0${value}`)
  .digest('hex');

function keys(username, ip, secret) {
  const account = String(username || '').normalize('NFKC').trim().toLowerCase().slice(0, 256);
  const source = String(ip || 'unknown').slice(0, 256);
  return {
    accountIp: digest(secret, 'login-account-ip', `${account}\0${source}`),
    ip: digest(secret, 'login-ip', source),
  };
}

function bucketState(accountIp, ip, now) {
  const cutoff = now - WINDOW_MS;
  const account = db.prepare(`SELECT COUNT(*) AS n, MIN(failed_at) AS oldest
    FROM auth_login_failures WHERE account_ip_key = ? AND failed_at >= ?`).get(accountIp, cutoff);
  const source = db.prepare(`SELECT COUNT(*) AS n, MIN(failed_at) AS oldest
    FROM auth_login_failures WHERE ip_key = ? AND failed_at >= ?`).get(ip, cutoff);
  const accountBlocked = account.n >= ACCOUNT_IP_LIMIT;
  const ipBlocked = source.n >= IP_LIMIT;
  if (!accountBlocked && !ipBlocked) return { blocked: false, retryAfter: 0 };
  const waits = [];
  if (accountBlocked) waits.push((account.oldest || now) + WINDOW_MS - now);
  if (ipBlocked) waits.push((source.oldest || now) + WINDOW_MS - now);
  return { blocked: true, retryAfter: Math.max(1, Math.ceil(Math.max(...waits) / 1000)) };
}

export function getLoginThrottle({ username, ip, secret, now = Date.now() }) {
  const k = keys(username, ip, secret);
  return { ...bucketState(k.accountIp, k.ip, now), keys: k };
}

// Rechecks and records under BEGIN IMMEDIATE so concurrent failures cannot all
// slip past a stale count. The throttled (11th by default) request is not
// inserted and therefore cannot extend the rolling window indefinitely.
export function recordLoginFailure({ username, ip, secret, now = Date.now() }) {
  const k = keys(username, ip, secret);
  return db.transaction(() => {
    db.prepare('DELETE FROM auth_login_failures WHERE failed_at < ?').run(now - WINDOW_MS);
    const before = bucketState(k.accountIp, k.ip, now);
    if (before.blocked) return before;
    db.prepare(`INSERT INTO auth_login_failures (account_ip_key, ip_key, failed_at)
      VALUES (?,?,?)`).run(k.accountIp, k.ip, now);
    return { blocked: false, retryAfter: 0 };
  }).immediate();
}

export function clearLoginFailures({ username, ip, secret }) {
  const k = keys(username, ip, secret);
  // Clearing the account+source rows also removes their contribution to the
  // broader IP bucket, but leaves failures against other accounts intact.
  return db.prepare('DELETE FROM auth_login_failures WHERE account_ip_key = ?').run(k.accountIp).changes;
}

export const loginFailurePolicy = Object.freeze({
  windowMs: WINDOW_MS,
  accountIpLimit: ACCOUNT_IP_LIMIT,
  ipLimit: IP_LIMIT,
});
