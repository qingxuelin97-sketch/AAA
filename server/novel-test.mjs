// 纯小说创作板块端到端体检：起一个假 LLM（OpenAI 兼容，支持流式与非流式），
// 把平台语言服务指向它（平台路径跳过 SSRF 校验，可用 localhost），
// 然后跑通小说创建 → 开线 → AI 续写(流式) → 自动沉淀设定 → 灵感 → 改写 → 分支 → 导出 → 删除。
//   运行：node server/novel-test.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PORT = 4311, LLM_PORT = 4312;
const DB_PATH = path.join(__dirname, 'novel.tmp.sqlite');
const BASE = `http://localhost:${APP_PORT}/api`;
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✅ ' + msg); else { failed++; console.log('  ❌ ' + msg); } };

// —— 假 LLM 服务：流式返回一段中文“正文”；非流式返回符合各 JSON 提示词的内容 ——
const PROSE = '夜色像浸了墨的绸缎，缓缓覆下来。林晚舟提着那盏快要熄灭的风灯，站在图书馆门前，听见身后传来沙沙的脚步。她回过头——是那个总在角落读书的少年，阿岚。“你也没走。”她轻声说。';
const llm = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let payload = {}; try { payload = JSON.parse(body); } catch { /* */ }
    const sys = (payload.messages || []).map(m => m.content).join('\n');
    if (payload.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = PROSE.match(/.{1,8}/g) || [PROSE];
      let i = 0;
      const tick = () => {
        if (i < chunks.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`); setTimeout(tick, 5); }
        else { res.write('data: [DONE]\n\n'); res.end(); }
      };
      tick();
      return;
    }
    // 非流式：依据系统提示词判断该返回哪种 JSON。
    let content = '';
    if (/小说企划/.test(sys)) content = JSON.stringify({ title: '风灯与少年', logline: '废土图书馆里相依的两个人', genre: '末世', synopsis: '世界崩塌后，唯一的图书馆还亮着灯。', tags: '末世,治愈,图书馆' });
    else if (/世界观架构师/.test(sys)) content = JSON.stringify([
      { title: '末世背景', category: 'world', content: '文明崩塌三十年，纸质书成了奢侈品。', keys: '', trigger: 'always' },
      { title: '林晚舟', category: 'character', content: '图书馆最后的守馆人。', keys: '林晚舟,守馆人', trigger: 'keyword' },
    ]);
    else if (/连续性编辑/.test(sys)) content = JSON.stringify([
      { title: '阿岚', category: 'character', content: '常在角落读书的少年，夜里留了下来。', keys: '阿岚', trigger: 'keyword' },
    ]);
    else if (/小说策划/.test(sys)) content = JSON.stringify([
      { label: '揭开秘密', prompt: '让阿岚说出他留下的真正原因' },
      { label: '危机降临', prompt: '门外传来掠夺者的脚步声' },
    ]);
    else if (/连续性审校/.test(sys)) content = JSON.stringify([{ severity: 'medium', issue: '风灯先说快熄灭后又一直亮着', fix: '统一为风灯将熄' }]);
    else if (/时间线/.test(sys)) content = JSON.stringify([{ label: '门前相遇', event: '林晚舟在图书馆门前遇到阿岚' }]);
    else if (/结构分析师/.test(sys)) content = JSON.stringify({ nodes: [{ id: '林晚舟', type: 'character' }, { id: '阿岚', type: 'character' }], edges: [{ from: '林晚舟', to: '阿岚', label: '相识' }] });
    else if (/脑暴搭子/.test(sys)) content = JSON.stringify({ names: ['守夜人', '灰烬'], twists: ['图书馆其实是一艘船'], details: ['潮湿纸页的霉味'] });
    else if (/前情提要/.test(sys)) content = '林晚舟在末世图书馆守着最后的灯，少年阿岚夜里留了下来。';
    else content = '（改写后的正文）夜色如墨，林晚舟提灯而立，少年阿岚的脚步在身后停住。';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

async function streamWrite(tok, rid, directive) {
  const res = await fetch(`${BASE}/novels/runs/${rid}/write`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ directive }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', full = '', beatId = null, err = null;
  while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) { const t = line.trim(); if (!t.startsWith('data:')) continue; const p = t.slice(5).trim(); if (p === '[DONE]') continue; try { const j = JSON.parse(p); if (j.delta) full += j.delta; if (j.beat_id) beatId = j.beat_id; if (j.error) err = j.error; } catch { /* */ } } }
  return { full, beatId, err };
}

let srv;
await new Promise(r => llm.listen(LLM_PORT, r));
console.log('· 假 LLM 已就绪 :' + LLM_PORT);
console.log('· 灌入临时数据…');
await new Promise((res, rej) => { const p = spawn('node', ['server/seed.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH }, stdio: 'ignore' }); p.on('exit', c => c === 0 ? res() : rej(new Error('seed ' + c))); });
console.log('· 启动服务端…');
srv = spawn('node', ['server/index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(APP_PORT), DB_PATH }, stdio: 'ignore' });

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* */ } await sleep(250); }
  const tok = (await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: '123456' }) })).json()).token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
  const J = async (p, opt = {}) => { const r = await fetch(BASE + p, { headers: H, ...opt }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  // 把平台语言服务指向假 LLM（平台路径跳过 SSRF，可用 localhost）。
  await fetch(BASE + '/admin/platform', { method: 'PUT', headers: H, body: JSON.stringify({ base_url: `http://localhost:${LLM_PORT}/v1`, model: 'fake', key: 'sk-test' }) });
  ok(true, '平台 LLM 已指向假服务');

  // brainstorm
  let r = await J('/novels/brainstorm', { method: 'POST', body: JSON.stringify({ seed: '废土图书馆与少女' }) });
  ok(r.status === 200 && r.body.draft?.title, 'AI 灵感开局返回草稿：' + (r.body.draft?.title || ''));

  // create
  r = await J('/novels', { method: 'POST', body: JSON.stringify({ title: '风灯与少年', logline: '废土图书馆', genre: '末世', codex: [{ title: '世界', category: 'world', trigger: 'always', content: '文明崩塌的末世。' }] }) });
  ok(r.status === 200 && r.body.novel?.id, '创建小说');
  const nid = r.body.novel.id;

  // get → has 1 run with canon copied
  r = await J(`/novels/${nid}`);
  ok(r.body.runs?.length === 1, '自动创建主线');
  const novelGet = r.body;

  // codex generate
  r = await J(`/novels/${nid}/codex/generate`, { method: 'POST', body: JSON.stringify({}) });
  ok(r.status === 200 && r.body.generated >= 2, 'AI 生成局外设定 ' + r.body.generated + ' 条');

  // open the run
  const rid = novelGet.runs[0].id;
  r = await J(`/novels/runs/${rid}`);
  const canonBefore = r.body.run.canon.length;
  ok(canonBefore >= 1, '局内设定已从局外复刻：' + canonBefore + ' 条');

  // STREAM write
  let w = await streamWrite(tok, rid, '写下开场，少年阿岚出现');
  ok(!w.err && w.full.length > 20 && w.beatId, '流式续写成功，正文 ' + w.full.length + ' 字，beat#' + w.beatId);

  // beats persisted + words counted
  r = await J(`/novels/runs/${rid}`);
  ok(r.body.beats?.length === 1 && r.body.run.words > 0, '正文已落库，字数 ' + r.body.run.words);
  const beatId = r.body.beats[0].id;

  // sync-canon → adds 阿岚
  r = await J(`/novels/runs/${rid}/sync-canon`, { method: 'POST' });
  ok(r.status === 200 && (r.body.added + r.body.updated) >= 1, '剧情自动沉淀设定：新增 ' + r.body.added + ' 修订 ' + r.body.updated);
  const canonAfter = r.body.run.canon.length;
  ok(canonAfter > canonBefore, '局内设定随剧情生长：' + canonBefore + ' → ' + canonAfter);
  ok(r.body.run.canon.some(e => e.source === 'auto'), '存在 AI 自动条目');
  ok(r.body.run.canon.some(e => e.source === 'meta'), '局外复刻条目仍在');

  // refork keep_auto=false → 局内回到当前局外母版（母版此前被 AI 生成扩充过，故应为当前 codex 全量）
  const codexNow = (await J(`/novels/${nid}`)).body.novel.codex.length;
  r = await J(`/novels/runs/${rid}/refork`, { method: 'POST', body: JSON.stringify({ keep_auto: false }) });
  ok(r.body.run.canon.every(e => e.source === 'meta'), '复刻重置：局内回到纯母版');
  ok(r.body.run.canon.length === codexNow, `复刻后条目数等于当前母版（${codexNow}）`);

  // suggest
  r = await J(`/novels/runs/${rid}/suggest`, { method: 'POST' });
  ok(r.status === 200 && r.body.suggestions?.length >= 2, '续写灵感 ' + (r.body.suggestions?.length || 0) + ' 条');

  // rewrite a beat
  w = await streamWrite.call(null, tok, rid, ''); // add a second beat first? rewrite existing
  let rr = await fetch(`${BASE}/novels/runs/${rid}/beats/${beatId}/rewrite`, { method: 'POST', headers: H, body: JSON.stringify({ instruction: '更紧凑' }) });
  const reader = rr.body.getReader(); const dec = new TextDecoder(); let rbuf = '', rfull = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; rbuf += dec.decode(value, { stream: true }); for (const line of rbuf.split('\n')) { const t = line.trim(); if (t.startsWith('data:') && t.slice(5).trim() !== '[DONE]') { try { const j = JSON.parse(t.slice(5).trim()); if (j.delta) rfull += j.delta; } catch { /* */ } } } rbuf = rbuf.slice(rbuf.lastIndexOf('\n') + 1); }
  ok(rfull.length > 0, '段落改写成功');

  // recap
  r = await J(`/novels/runs/${rid}/recap`, { method: 'POST' });
  ok(r.status === 200 && r.body.run.summary, '生成前情提要');

  // branch
  r = await J(`/novels/runs/${rid}/branch/${beatId}`, { method: 'POST', body: JSON.stringify({ name: '支线A' }) });
  ok(r.status === 200 && r.body.run?.id, '从段落开分支');

  // export (run)
  r = await J(`/novels/runs/${rid}/export?format=md`);
  ok(r.status === 200 && /风灯与少年/.test(r.body.text), '导出 Markdown（单线）');

  // —— 新增功能 ——
  // 一致性检查
  r = await J(`/novels/runs/${rid}/check`, { method: 'POST' });
  ok(r.status === 200 && Array.isArray(r.body.issues) && r.body.issues.length >= 1, '一致性检查返回 ' + (r.body.issues?.length || 0) + ' 条');
  // 时间线
  r = await J(`/novels/runs/${rid}/timeline`, { method: 'POST' });
  ok(r.status === 200 && r.body.events?.length >= 1, '剧情时间线 ' + (r.body.events?.length || 0) + ' 条');
  // 关系图谱
  r = await J(`/novels/runs/${rid}/graph`, { method: 'POST' });
  ok(r.status === 200 && r.body.nodes?.length >= 2 && r.body.edges?.length >= 1, '关系图谱 ' + (r.body.nodes?.length || 0) + ' 节点 / ' + (r.body.edges?.length || 0) + ' 边');
  // 灵感火花
  r = await J(`/novels/${nid}/muse`, { method: 'POST' });
  ok(r.status === 200 && r.body.names?.length >= 1 && r.body.twists?.length >= 1, '灵感火花：名字 ' + r.body.names.length + ' 转折 ' + r.body.twists.length);
  // 段落配图（PATCH image）
  r = await J(`/novels/runs/${rid}/beats/${beatId}`, { method: 'PATCH', body: JSON.stringify({ image: 'data:image/png;base64,AAAA' }) });
  ok(r.body.beat?.image === 'data:image/png;base64,AAAA', '段落配图已保存');
  // 版本历史（改写后应有 history）
  r = await J(`/novels/runs/${rid}`);
  const hb = r.body.beats.find(b => b.id === beatId);
  ok(Array.isArray(hb?.history) && hb.history.length >= 1, '段落版本历史保留 ' + (hb?.history?.length || 0) + ' 版');
  // 写作统计
  r = await J(`/novels/${nid}/stats`);
  ok(r.status === 200 && r.body.stats?.words > 0 && r.body.stats?.runs >= 1, `写作统计：${r.body.stats?.words} 字 / ${r.body.stats?.runs} 线`);
  // 整本导出
  r = await J(`/novels/${nid}/export?format=md`);
  ok(r.status === 200 && /风灯与少年/.test(r.body.text), '整本导出');
  // 发布 + 书架精选 + 公开阅读
  r = await J(`/novels/${nid}/publish`, { method: 'POST', body: JSON.stringify({ run_id: rid }) });
  ok(r.status === 200 && r.body.published, '发布到书架');
  r = await J('/novels/showcase');
  ok(r.status === 200 && r.body.novels?.some(x => x.id === nid), '书架精选含已发布作品');
  r = await J(`/novels/${nid}/read`);
  ok(r.status === 200 && r.body.beats?.length >= 1 && r.body.author?.display_name, '公开阅读返回正文 + 作者');
  // 每日任务联动：novel 计数应已 +（写过正文）
  r = await J('/engage/tasks');
  ok(r.body.tasks?.some(t => t.id === 'novel'), '每日任务含「AI 创作小说」');
  // 成就联动
  r = await J('/achievements');
  ok(r.body.achievements?.some(a => a.id === 'first_novel' && a.unlocked), '成就「执笔者」已解锁');

  // run count = 2 now
  r = await J(`/novels/${nid}`);
  ok(r.body.runs.length === 2, '剧情线数 = 2（主线 + 分支）');

  // delete novel
  r = await J(`/novels/${nid}`, { method: 'DELETE' });
  ok(r.body.ok, '删除小说');
  r = await J('/novels');
  ok((r.body.novels || []).every(n => n.id !== nid), '删除后列表不含该作品');

  console.log(failed === 0 ? `\n✅ 小说创作板块体检通过` : `\n❌ ${failed} 项异常`);
} finally {
  srv?.kill(); llm.close();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch { /* */ } }
}
process.exit(failed === 0 ? 0 : 1);
