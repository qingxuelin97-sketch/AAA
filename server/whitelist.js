import db from './db.js';

// 注册邮箱白名单：仅白名单内邮箱允许注册。
//   kind='exact' 精确邮箱匹配；kind='domain' 整域放行（存为 @example.com 形式）。
// 所有存储与比较统一小写，杜绝大小写绕过。

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// 邮箱规范形（反批量注册）：`user+tag@x.com` → `user@x.com`；gmail 系再去掉
// 本地段的点并归并 googlemail → gmail。同一真实邮箱的无限别名（+1、+2、
// u.s.e.r@gmail）在规范形上都是同一条，注册去重按它比对。
// 展示/通知仍用用户填写的原始邮箱，规范形只做唯一性判定。
export function canonicalEmail(email) {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

// 存量用户回填规范形（模块加载一次；db.js 的列迁移先于本模块执行）。
try {
  const rows = db.prepare("SELECT id, email FROM users WHERE (email_canon IS NULL OR email_canon = '') AND email IS NOT NULL AND email != ''").all();
  if (rows.length) {
    const upd = db.prepare('UPDATE users SET email_canon = ? WHERE id = ?');
    for (const r of rows) upd.run(canonicalEmail(r.email), r.id);
  }
} catch { /* 极老库缺列时静默；正常流程 db.js 已迁移 */ }

// 判断邮箱是否在白名单内。
export function isWhitelisted(email) {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return false;
  const domain = e.slice(e.lastIndexOf('@'));
  // 精确匹配优先，整域次之。
  const hit = db.prepare(
    "SELECT 1 FROM email_whitelist WHERE (kind='exact' AND email=?) OR (kind='domain' AND email=?) LIMIT 1"
  ).get(e, domain);
  return !!hit;
}

// 列出白名单（带可选搜索）。
export function listWhitelist(q = '') {
  const k = `%${String(q || '').trim().toLowerCase()}%`;
  return db.prepare(
    "SELECT id, email, kind, note, created_at FROM email_whitelist WHERE email LIKE ? OR note LIKE ? ORDER BY id DESC LIMIT 200"
  ).all(k, k);
}

// 新增白名单条目。返回 { ok, error? }。
export function addWhitelist(email, kind = 'exact', note = '') {
  const e = normalizeEmail(email);
  if (!e) return { ok: false, error: '邮箱不能为空' };
  if (kind === 'domain') {
    if (!e.startsWith('@') || e.length < 3) return { ok: false, error: '整域白名单需以 @ 开头，如 @example.com' };
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: '邮箱格式不正确' };
  }
  try {
    db.prepare('INSERT INTO email_whitelist (email, kind, note) VALUES (?, ?, ?)').run(e, kind, String(note || '').slice(0, 200));
    return { ok: true };
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) return { ok: false, error: '该白名单条目已存在' };
    return { ok: false, error: e.message };
  }
}

// 批量导入白名单（一行一个邮箱；以 @ 开头视为整域）。
export function importWhitelist(text) {
  const lines = String(text || '').split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  for (const line of lines) {
    const kind = line.startsWith('@') ? 'domain' : 'exact';
    const r = addWhitelist(line, kind, '批量导入');
    if (r.ok) added++; else skipped++;
  }
  return { added, skipped, total: lines.length };
}

export function removeWhitelist(id) {
  db.prepare('DELETE FROM email_whitelist WHERE id = ?').run(id);
  return { ok: true };
}

export function clearWhitelist() {
  db.prepare('DELETE FROM email_whitelist').run();
  return { ok: true };
}

// 白名单是否启用：只要有任意一条记录，就视为白名单政策生效。
export const whitelistEnabled = () => !!db.prepare('SELECT 1 FROM email_whitelist LIMIT 1').get();
