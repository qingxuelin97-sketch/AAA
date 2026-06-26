// SSRF 防护：校验用户提供的 base_url 不指向私网/本机/元数据地址。
import { URL } from 'url';

const PRIVATE_HOST = [
  /^127\./, /^10\./, /^0\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./,
  /^::1?$/, /^::ffff:/, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
];

// 返回 true 表示 URL 安全（公网 http/https）；false 表示危险或非法。
export function isPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return false;
  return !PRIVATE_HOST.some(re => re.test(h));
}

// 断言式：不安全则抛错（供路由层直接使用）。
export function assertPublicUrl(raw, msg = 'Base URL 不合法或指向内网地址，禁止访问') {
  if (!isPublicUrl(raw)) throw Object.assign(new Error(msg), { status: 400, expose: true });
}
