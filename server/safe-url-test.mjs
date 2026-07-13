import assert from 'node:assert/strict';
import { safeFetch } from './safeUrl.js';

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
} finally {
  globalThis.fetch = realFetch;
}

console.log('Safe outbound fetch validation: 4 passed, 0 failed');
