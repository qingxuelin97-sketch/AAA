// 浏览器版（静态/GitHub Pages）小说创作板块体检：在 Node 里桩接 window/localStorage，
// 用假 LLM 充当 realFetch 上游，驱动 mock backend 的 /api/novels/* 全链路。
//   运行：node server/novel-mock-test.mjs
import http from 'node:http';

const LLM_PORT = 4321;
const PROSE = '雨丝斜斜地落在霓虹上，赛博侦探 K 点燃一支烟，望着空荡的街角，等一个不会来的委托人。';

// 假 LLM（OpenAI 兼容，流式 + 非流式）
const llm = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    let p = {}; try { p = JSON.parse(body); } catch { /* */ }
    const sys = (p.messages || []).map(m => m.content).join('\n');
    if (p.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = PROSE.match(/.{1,6}/g) || [PROSE]; let i = 0;
      const tick = () => { if (i < ch.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch[i++] } }] })}\n\n`); setTimeout(tick, 3); } else { res.write('data: [DONE]\n\n'); res.end(); } };
      tick(); return;
    }
    let content = '';
    if (/小说企划/.test(sys)) content = JSON.stringify({ title: '霓虹挽歌', logline: '雨夜侦探的最后一案', genre: '赛博朋克', synopsis: '新洛城永远在下雨。', tags: '赛博朋克,悬疑' });
    else if (/世界观架构师/.test(sys)) content = JSON.stringify([{ title: '新洛城', category: 'location', content: '永远下雨的巨型都市。', keys: '新洛城,城市', trigger: 'keyword' }, { title: '侦探K', category: 'character', content: '义体改造的私家侦探。', keys: 'K,侦探', trigger: 'keyword' }]);
    else if (/连续性编辑/.test(sys)) content = JSON.stringify([{ title: '消失的委托人', category: 'plot', content: '委托人始终没有出现。', keys: '委托人', trigger: 'keyword' }]);
    else if (/小说策划/.test(sys)) content = JSON.stringify([{ label: '追查线索', prompt: '让K从烟头里发现端倪' }, { label: '不速之客', prompt: '一个陌生女人撑伞走近' }]);
    else if (/前情提要/.test(sys)) content = '侦探K在雨夜苦等一个失约的委托人。';
    else content = '（改写）霓虹在雨里晕开，K 吐出一口烟，街角空无一人。';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise(r => llm.listen(LLM_PORT, r));

// —— 桩接浏览器环境 ——
const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const realFetch = globalThis.fetch;
globalThis.window = { fetch: (...a) => realFetch(...a), addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { href: 'http://localhost/', origin: 'http://localhost' };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null, addEventListener() {}, removeEventListener() {} };

const { installMockBackend } = await import('../client/src/mock/backend.js');
installMockBackend();
const fetch = globalThis.window.fetch; // 路由后的 fetch

let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✅ ' + m); else { failed++; console.log('  ❌ ' + m); } };
const api = async (path, method = 'GET', body, tok) => {
  const headers = { 'Content-Type': 'application/json' }; if (tok) headers.Authorization = 'Bearer ' + tok;
  const r = await fetch('http://localhost/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

try {
  // 登录 demo
  const login = await api('/auth/login', 'POST', { username: 'demo', password: '123456' });
  const tok = login.body.token; ok(!!tok, '登录 demo');

  // 平台 LLM 指向假服务（GM 后台）
  await api('/admin/platform', 'PUT', { base_url: `http://localhost:${LLM_PORT}/v1`, model: 'fake', key: 'sk-test' }, tok);
  ok(true, '平台 LLM 指向假服务');

  // brainstorm
  let r = await api('/novels/brainstorm', 'POST', { seed: '雨夜侦探' }, tok);
  ok(r.status === 200 && r.body.draft?.title, '灵感开局：' + (r.body.draft?.title || ''));

  // create
  r = await api('/novels', 'POST', { title: '霓虹挽歌', genre: '赛博朋克', codex: [{ title: '基调', category: 'world', trigger: 'always', content: '永远下雨。' }] }, tok);
  ok(r.status === 200 && r.body.novel?.id, '创建小说'); const nid = r.body.novel.id;

  r = await api(`/novels/${nid}`, 'GET', null, tok);
  ok(r.body.runs?.length === 1, '自动开主线'); const rid = r.body.runs[0].id;

  r = await api(`/novels/${nid}/codex/generate`, 'POST', {}, tok);
  ok(r.body.generated >= 2, 'AI 生成局外设定 ' + r.body.generated + ' 条');

  // 流式续写
  const wr = await fetch(`http://localhost/api/novels/runs/${rid}/write`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ directive: '开场，雨夜街角' }) });
  const reader = wr.body.getReader(); const dec = new TextDecoder(); let buf = '', full = '', bid = null;
  while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || ''; for (const l of lines) { const t = l.trim(); if (t.startsWith('data:') && t.slice(5).trim() !== '[DONE]') { try { const j = JSON.parse(t.slice(5).trim()); if (j.delta) full += j.delta; if (j.beat_id) bid = j.beat_id; } catch { /* */ } } } }
  ok(full.length > 10 && bid, '流式续写：' + full.length + ' 字');

  r = await api(`/novels/runs/${rid}`, 'GET', null, tok);
  ok(r.body.beats?.length === 1 && r.body.run.words > 0, '正文落库，字数 ' + r.body.run.words);
  const canonBefore = r.body.run.canon.length;

  r = await api(`/novels/runs/${rid}/sync-canon`, 'POST', {}, tok);
  ok((r.body.added + r.body.updated) >= 1, '自动沉淀设定 +' + r.body.added);
  ok(r.body.run.canon.length > canonBefore, '局内设定生长 ' + canonBefore + ' → ' + r.body.run.canon.length);

  r = await api(`/novels/runs/${rid}/suggest`, 'POST', {}, tok);
  ok(r.body.suggestions?.length >= 2, '续写灵感 ' + (r.body.suggestions?.length || 0) + ' 条');

  r = await api(`/novels/runs/${rid}/recap`, 'POST', {}, tok);
  ok(!!r.body.run?.summary, '前情提要');

  r = await api(`/novels/runs/${rid}/branch/${bid}`, 'POST', { name: '支线' }, tok);
  ok(r.body.run?.id, '开分支');

  r = await api(`/novels/runs/${rid}/export?format=md`, 'GET', null, tok);
  ok(/霓虹挽歌/.test(r.body.text || ''), '导出 Markdown');

  r = await api(`/novels/${nid}`, 'DELETE', null, tok);
  ok(r.body.ok, '删除小说');

  console.log(failed === 0 ? '\n✅ 浏览器版小说板块体检通过' : `\n❌ ${failed} 项异常`);
} catch (e) { console.error(e); failed++; }
finally { llm.close(); }
process.exit(failed === 0 ? 0 : 1);
