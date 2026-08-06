import assert from 'node:assert/strict';
import dnsCb from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { safeFetch } from './safeUrl.js';

let passed = 4;
const realFetch = globalThis.fetch;
try {
  let called = 0;
  globalThis.fetch = async () => {
    called++;
    return new Response(new Uint8Array(1024), { headers: { 'Content-Length': '1024' } });
  };
  await assert.rejects(() => safeFetch('http://127.0.0.1/secret'), /内网/);
  assert.equal(called, 0, 'private target must be rejected before fetch');
  await assert.rejects(() => safeFetch('https://93.184.216.34/data', {}, { maxBodyBytes: 100 }), /安全上限/);

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(60));
      controller.enqueue(new Uint8Array(60));
      controller.close();
    },
  }));
  const streamed = await safeFetch('https://93.184.216.34/chunked', {}, { maxBodyBytes: 100 });
  await assert.rejects(() => streamed.arrayBuffer(), /安全上限/);

  // —— 302 跳内网：逐跳复检必须在真正连内网前拦下 ——
  // 首跳返回公网响应但 Location 指向 127.0.0.1；safeFetch 的下一跳会对新目标重新
  // 校验，应在连接内网前抛 SSRF，且绝不对内网主机发起 fetch。
  {
    let internalHit = false;
    globalThis.fetch = async (url) => {
      const h = new URL(url).hostname;
      if (h === '127.0.0.1' || h === 'localhost') { internalHit = true; return new Response('SECRET'); }
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } });
    };
    await assert.rejects(() => safeFetch('https://93.184.216.34/redir'), /内网|不合法|禁止/);
    assert.equal(internalHit, false, '302 → 127.0.0.1 must be blocked before the internal host is fetched');
    passed++;
  }

  // —— DNS 重绑定防护：证明「校验通过的 IP」确实被钉给了这次连接 ——
  // 若将来某个 Node 版本不再经由 dns.lookup 解析出站连接，这里会大声失败，
  // 而不是静默失去防护（safeUrl.js 的钉扎依赖该路径）。
  const HOST = 'rebind-probe.example';
  const VALIDATED = '93.184.216.34';
  const realPromiseLookup = dnsPromises.lookup;
  // 校验阶段：让该主机名看起来解析到公网地址（模拟攻击者第一次返回公网 IP）。
  dnsPromises.lookup = async (h, o) => (h === HOST
    ? [{ address: VALIDATED, family: 4 }]
    : realPromiseLookup(h, o));

  let seenAll = null, seenSingle = null;
  globalThis.fetch = async (url) => {
    const h = new URL(url).hostname;
    // fetch 内部的第二次解析 —— 攻击者本想在这里返回 127.0.0.1。
    seenAll = await new Promise(r => dnsCb.lookup(h, { all: true }, (e, a) => r(a)));
    seenSingle = await new Promise(r => dnsCb.lookup(h, (e, a, f) => r({ address: a, family: f })));
    return new Response('ok');
  };

  try {
    await safeFetch(`http://${HOST}/v1/models`);
    // all:true 必须返回 [{address,family}] 数组，且只含校验通过的地址。
    assert.deepEqual(seenAll, [{ address: VALIDATED, family: 4 }], 'pinned lookup must honour options.all');
    passed++;
    // 非 all 形态必须返回 (address, family)，否则 undici 报 Invalid IP address。
    assert.deepEqual(seenSingle, { address: VALIDATED, family: 4 }, 'pinned lookup must honour single-address form');
    passed++;
    // 请求结束后钉扎必须释放：该主机名回落到真实解析（此域名不存在 → 报错）。
    const afterRelease = await new Promise(r => dnsCb.lookup(HOST, { all: true }, (e, a) => r(e ? 'err' : a)));
    assert.equal(afterRelease, 'err', 'pin must be released after the request completes');
    passed++;
  } finally {
    dnsPromises.lookup = realPromiseLookup;
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`Safe outbound fetch validation: ${passed} passed, 0 failed`);
