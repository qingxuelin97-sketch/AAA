// SSRF 防护：校验用户/管理员提供的 base_url 不指向私网/本机/元数据地址。
// 三层防护：①同步主机名预检（含编码型 IP 归一化）②DNS 解析后按真实 IP 复检
// ③safeFetch 逐跳重定向复检 + 请求头超时，杜绝「域名解析到内网」「302 跳内网」两类绕过。
import { URL } from 'url';
import dns from 'dns/promises';
import net from 'net';

const ssrf = (msg = 'Base URL 不合法或指向内网地址，禁止访问') =>
  Object.assign(new Error(msg), { status: 400, expose: true });

// —— 具体 IP 字符串是否属于私网/保留段 ——
function ipIsPrivate(ip) {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped IPv6
  if (m) ip = m[1];
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;              // link-local / 云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
    if (a >= 224) return true;                             // 组播/保留
    return false;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (/^fe[89ab]/.test(l)) return true;                 // link-local
    if (/^f[cd]/.test(l)) return true;                    // ULA
    return false;
  }
  return true; // 未知格式 → 视为不安全
}

// 把编码型 IPv4（十进制 2130706433 / 十六进制 0x7f000001 / 八进制 / 混合点分）归一化为点分十进制；
// 非 IP 主机名原样返回（后续走 DNS 解析）。
function normalizeMaybeIp(h) {
  if (net.isIP(h)) return h;
  if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) {
    const n = h.toLowerCase().startsWith('0x') ? parseInt(h, 16)
      : (/^0[0-7]+$/.test(h) ? parseInt(h, 8) : parseInt(h, 10));
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff)
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  if (/^[0-9a-fx.]+$/i.test(h) && h.split('.').length === 4) {
    const oct = h.split('.').map(p => p.toLowerCase().startsWith('0x') ? parseInt(p, 16)
      : (/^0[0-7]+$/.test(p) ? parseInt(p, 8) : parseInt(p, 10)));
    if (oct.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) return oct.join('.');
  }
  return h;
}

// —— 同步预检（无 DNS）：协议 + 主机名字符串 + 字面/编码 IP —— 供路由做快速拒绝 ——
export function isPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = normalizeMaybeIp(u.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return false;
  if (net.isIP(h)) return !ipIsPrivate(h);
  return true; // 普通域名：同步阶段放行，交由 assertResolvedPublic 做 DNS 复检
}

export function assertPublicUrl(raw, msg) {
  if (!isPublicUrl(raw)) throw ssrf(msg);
}

// —— 异步复检：DNS 解析主机名，任一解析地址落私网即拒绝（防「域名指向内网」） ——
export async function assertResolvedPublic(hostname) {
  const h = normalizeMaybeIp(String(hostname).toLowerCase().replace(/^\[|\]$/g, ''));
  if (!h || h === 'localhost' || h.endsWith('.localhost')) throw ssrf();
  if (net.isIP(h)) { if (ipIsPrivate(h)) throw ssrf(); return; }
  let addrs;
  try { addrs = await dns.lookup(h, { all: true }); } catch { throw ssrf('无法解析目标主机'); }
  if (!addrs.length) throw ssrf('无法解析目标主机');
  for (const a of addrs) if (ipIsPrivate(a.address)) throw ssrf();
}

// —— 安全出站请求：预检 + DNS 复检 + 逐跳重定向复检 + 请求头超时。
// 与 fetch 同签名，返回原始 Response（流式 body 不受超时影响：超时仅守到响应头到达）。
// 调用方可通过 opts.signal 传入自身 AbortSignal（如 res 关闭时中止上游）——与内部的
// 首字节超时链在一起：超时仅守到响应头到达（到达后 clearTimeout，流式 body 不受限），
// 而调用方 signal 在整个请求生命周期保持有效，故客户端断开能中止仍在流式的 body。
const oversized = (limit) => Object.assign(new Error(`上游响应体超过安全上限（${Math.ceil(limit / 1024 / 1024)}MB）`), {
  status: 502, expose: true,
});

function limitResponseBody(res, ac, callerSignal, onCaller, maxBodyBytes) {
  const cleanup = () => callerSignal?.removeEventListener('abort', onCaller);
  const contentLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    ac.abort();
    cleanup();
    throw oversized(maxBodyBytes);
  }
  if (!res.body) { cleanup(); return res; }
  const reader = res.body.getReader();
  let total = 0;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { cleanup(); controller.close(); return; }
        total += value.byteLength;
        if (total > maxBodyBytes) {
          ac.abort();
          cleanup();
          try { await reader.cancel(); } catch { /* */ }
          controller.error(oversized(maxBodyBytes));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    async cancel(reason) {
      cleanup();
      ac.abort();
      try { await reader.cancel(reason); } catch { /* */ }
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export async function safeFetch(rawUrl, opts = {}, { maxRedirects = 4, timeoutMs = 20000, maxBodyBytes = 32 * 1024 * 1024 } = {}) {
  let url = String(rawUrl);
  const callerSignal = opts.signal;
  const rest = { ...opts }; delete rest.signal;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw ssrf();
    await assertResolvedPublic(u.hostname);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onCaller = () => ac.abort();
    if (callerSignal) { if (callerSignal.aborted) ac.abort(); else callerSignal.addEventListener('abort', onCaller); }
    let res;
    try {
      res = await fetch(url, { ...rest, redirect: 'manual', signal: ac.signal });
    } catch (e) {
      if (callerSignal) callerSignal.removeEventListener('abort', onCaller);
      throw e;
    } finally { clearTimeout(timer); }
    const loc = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (loc) {
      if (callerSignal) callerSignal.removeEventListener('abort', onCaller);
      try { await res.body?.cancel(); } catch { /* release socket */ }
      url = new URL(loc, url).toString();
      continue;
    }
    // 命中最终响应：保留 callerSignal 监听，使断开后仍能中止流式 body（onCaller → ac.abort）。
    return limitResponseBody(res, ac, callerSignal, onCaller, maxBodyBytes);
  }
  throw Object.assign(new Error('重定向次数过多'), { status: 502, expose: true });
}
