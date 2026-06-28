import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx } from '../wallet.js';
import { getPlatform, platformFee } from '../platform.js';
import { assertPublicUrl } from '../safeUrl.js';
import { aiLimiter } from '../limiters.js';
import { bumpDaily } from '../daily.js';

const router = Router();

/* ───────────────────────── LLM plumbing ─────────────────────────
   纯小说创作复用「用户自带 Key 优先、否则走平台服务（按金币计费）」的同一套逻辑。
   写作温度默认偏高（更有文采），可被设置里的 llm_temperature 覆盖。 */
function getSettings(userId) { return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId); }
function effectiveLLM(settings) {
  if (settings?.llm_api_key) {
    return { base_url: settings.llm_base_url, api_key: settings.llm_api_key, model: settings.llm_model,
      temperature: settings.llm_temperature, max_tokens: settings.llm_max_tokens, system_prompt: '', platform: false };
  }
  const p = getPlatform();
  if (p.key && p.base_url) {
    return { base_url: p.base_url, api_key: p.key, model: p.model,
      temperature: settings?.llm_temperature ?? 0.9, max_tokens: Math.max(settings?.llm_max_tokens || 0, 1600),
      system_prompt: p.system_prompt || '', platform: true };
  }
  return null;
}

// One-shot (non-streaming) completion — used for brainstorm / codex generation /
// canon extraction / next-beat suggestions. Returns trimmed text or throws.
async function llmOnce(eff, system, user, { maxTokens = 1200, temperature } = {}) {
  const r = await fetch(eff.base_url.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
    body: JSON.stringify({
      model: eff.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: temperature ?? eff.temperature ?? 0.8, max_tokens: maxTokens, stream: false,
    }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`模型服务返回 ${r.status}：${t.slice(0, 160)}`); }
  const d = await r.json().catch(() => ({}));
  return (d.choices?.[0]?.message?.content || '').trim();
}

// Pull the first JSON value out of a model reply (handles ```json fences / prose wrapping).
function extractJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through to bracket scan */ }
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const a = s.indexOf(open), b = s.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* */ } }
  }
  return null;
}

/* ───────────────────────── shapes & sanitizers ───────────────────────── */
const TRIGGERS = new Set(['always', 'keyword', 'scene']);
const CATEGORIES = new Set(['world', 'character', 'relationship', 'faction', 'location', 'item', 'lore', 'rule', 'timeline', 'plot', 'other']);
const SOURCES = new Set(['meta', 'manual', 'auto']);
const clampStr = (v, n) => String(v == null ? '' : v).slice(0, n);

let _eid = Date.now();
const newId = () => 'e' + (++_eid).toString(36) + Math.random().toString(36).slice(2, 6);

// Normalise one codex/canon entry into the canonical shape.
function cleanEntry(e, { defaultSource = 'manual' } = {}) {
  if (!e || typeof e !== 'object') return null;
  const title = clampStr(e.title, 80).trim();
  const content = clampStr(e.content, 4000).trim();
  if (!title && !content) return null;
  const trigger = TRIGGERS.has(e.trigger) ? e.trigger : 'keyword';
  return {
    id: clampStr(e.id, 40) || newId(),
    title: title || '未命名设定',
    category: CATEGORIES.has(e.category) ? e.category : 'other',
    trigger,
    keys: clampStr(e.keys, 240),
    content,
    source: SOURCES.has(e.source) ? e.source : defaultSource,
    locked: e.locked ? 1 : 0,
    enabled: e.enabled === false ? 0 : 1,
    updated_at: clampStr(e.updated_at, 30) || new Date().toISOString(),
  };
}
function cleanEntries(arr, opts) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const e of arr.slice(0, 200)) {
    const c = cleanEntry(e, opts);
    if (!c) continue;
    if (seen.has(c.id)) c.id = newId();
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

const POV = { first: '第一人称（“我”）', second: '第二人称（“你”）', third_limited: '第三人称限知视角', third_omni: '第三人称全知视角' };
const TENSE = { past: '过去时叙述', present: '现在进行时叙述' };
const PACING = { slow: '舒缓细腻、重氛围与心理', medium: '张弛有度', fast: '快节奏、强情节驱动' };
const PARA = { short: '短段落、留白多', medium: '中等段落', long: '长段落、绵密铺陈' };
const DLG = { low: '以叙述与描写为主，少对白', balanced: '叙述与对白均衡', high: '以对白和人物交锋为主' };
const RATING = { all: '全年龄向，避免露骨描写', teen: '可含轻度暴力与情感张力', mature: '成人向，可含强烈情感、暴力与黑暗主题（仍须文学化处理）' };
const LENGTH = { short: '约 200–350 字', medium: '约 400–700 字', long: '约 800–1200 字' };

const DEFAULT_STYLE = {
  pov: 'third_limited', tense: 'past', pacing: 'medium', paragraph: 'medium',
  dialogue: 'balanced', rating: 'all', beat_length: 'medium',
  tone: '', influences: '', forbidden: '', custom: '',
};
function cleanStyle(s) {
  const o = { ...DEFAULT_STYLE };
  if (s && typeof s === 'object') {
    if (POV[s.pov]) o.pov = s.pov;
    if (TENSE[s.tense]) o.tense = s.tense;
    if (PACING[s.pacing]) o.pacing = s.pacing;
    if (PARA[s.paragraph]) o.paragraph = s.paragraph;
    if (DLG[s.dialogue]) o.dialogue = s.dialogue;
    if (RATING[s.rating]) o.rating = s.rating;
    if (LENGTH[s.beat_length]) o.beat_length = s.beat_length;
    o.tone = clampStr(s.tone, 200);
    o.influences = clampStr(s.influences, 200);
    o.forbidden = clampStr(s.forbidden, 400);
    o.custom = clampStr(s.custom, 1200);
  }
  return o;
}
// Render style settings into a directive block for the writer system prompt.
function styleDirectives(style) {
  const s = cleanStyle(style);
  const lines = [
    `· 叙述视角：${POV[s.pov]}`,
    `· 时态：${TENSE[s.tense]}`,
    `· 节奏：${PACING[s.pacing]}`,
    `· 段落：${PARA[s.paragraph]}`,
    `· 对白比重：${DLG[s.dialogue]}`,
    `· 尺度：${RATING[s.rating]}`,
  ];
  if (s.tone) lines.push(`· 语气基调：${s.tone}`);
  if (s.influences) lines.push(`· 笔法参照：${s.influences}（仅借鉴气质，不得抄袭原文）`);
  if (s.forbidden) lines.push(`· 须避免：${s.forbidden}`);
  if (s.custom) lines.push(`· 作者额外指令：${s.custom}`);
  return lines.join('\n');
}

/* ───────────────────────── canon trigger evaluation ─────────────────────────
   设定触发分三类：always 随时常驻 / keyword 关键提示词触发 / scene 关键场合触发。
   keyword 命中「用户提示词 + 近期正文」；scene 仅命中「近期正文」（即剧情场合）。 */
function splitKeys(k) { return String(k || '').split(/[,，、]/).map(x => x.trim().toLowerCase()).filter(Boolean); }
function triggeredEntries(canon, { directive = '', sceneText = '' } = {}) {
  const promptHay = (directive + ' ' + sceneText).toLowerCase();
  const sceneHay = sceneText.toLowerCase();
  const hit = [];
  for (const e of canon) {
    if (!e.enabled) continue;
    if (e.trigger === 'always') { hit.push(e); continue; }
    const keys = splitKeys(e.keys);
    if (!keys.length) { hit.push(e); continue; } // 无关键词的非常驻条目当作常驻
    const hay = e.trigger === 'scene' ? sceneHay : promptHay;
    if (keys.some(k => hay.includes(k))) hit.push(e);
  }
  return hit;
}
const CAT_LABEL = { world: '世界观', character: '角色', relationship: '关系', faction: '势力', location: '地点', item: '物品', lore: '设定', rule: '规则', timeline: '时间线', plot: '剧情', other: '其他' };
function renderCanon(entries) {
  if (!entries.length) return '';
  return entries.map(e => `【${CAT_LABEL[e.category] || '设定'}·${e.title}】${e.content}`).join('\n');
}

// Build the full system prompt for writing the next passage.
function buildWriterSystem(novel, style, canon, run, directive, recentText, isOpening) {
  const hits = triggeredEntries(canon, { directive, sceneText: recentText });
  const parts = [];
  parts.push('你是一位顶尖的中文小说家，正在与作者协作创作一部连载小说。作者给出方向，你负责把它写成富有文学性、画面感和情感张力的正文。');
  parts.push(`【作品】《${novel.title}》${novel.genre ? '｜类型：' + novel.genre : ''}${novel.logline ? '\n内核：' + novel.logline : ''}`);
  // 故事梗概 / 起点：开篇时这是 AI 唯一的依据，务必注入；连载中作为整体基调参考。
  if (novel.synopsis && novel.synopsis.trim()) parts.push(`【故事梗概 / 起点${isOpening ? '（本次为开篇，请据此展开）' : ''}】\n${novel.synopsis.trim()}`);
  parts.push('【文风要求】\n' + styleDirectives(style));
  if (run.summary) parts.push('【前情提要（务必保持连贯）】\n' + run.summary);
  const canonText = renderCanon(hits);
  if (canonText) parts.push('【当前生效设定（局内·须严格遵守，不得自相矛盾）】\n' + canonText);
  const s = cleanStyle(style);
  parts.push([
    '【写作守则】',
    `1. 只输出小说正文本身，不要任何解释、标题、小标题、序号或「好的」之类的话。`,
    `2. 本次篇幅约束：${LENGTH[s.beat_length]}。在自然的情节落点收束，不要烂尾也不要强行收尾。`,
    '3. 严格延续前文的人物、时间、地点与已发生的事件，不要重写已写过的情节。',
    '4. 用具体的动作、感官细节与对白推进，避免空泛概述与“总结式”叙述。',
    '5. 始终贴合作者本次给出的方向；若方向与既有设定冲突，以作者方向为先并自然圆场。',
  ].join('\n'));
  return parts.join('\n\n');
}

/* ───────────────────────── row helpers ───────────────────────── */
const parseJSON = (s, fb) => { try { const v = JSON.parse(s); return v == null ? fb : v; } catch { return fb; } };
function shapeNovel(row) {
  if (!row) return row;
  return { ...row, style: cleanStyle(parseJSON(row.style, {})), codex: cleanEntries(parseJSON(row.codex, [])) };
}
function shapeRun(row) {
  if (!row) return row;
  return { ...row, canon: cleanEntries(parseJSON(row.canon, [])), vars: parseJSON(row.vars, {}) };
}
const ownNovel = (req, res) => {
  const n = db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id);
  if (!n) { res.status(404).json({ error: '小说不存在' }); return null; }
  if (n.owner_id !== req.user.id) { res.status(403).json({ error: '无权访问' }); return null; }
  return n;
};
const ownRun = (req, res) => {
  const r = db.prepare('SELECT * FROM novel_runs WHERE id = ?').get(req.params.rid);
  if (!r) { res.status(404).json({ error: '剧情线不存在' }); return null; }
  if (r.owner_id !== req.user.id) { res.status(403).json({ error: '无权访问' }); return null; }
  return r;
};
const touchNovel = (id) => db.prepare("UPDATE novels SET updated_at = datetime('now') WHERE id = ?").run(id);
const touchRun = (id) => db.prepare("UPDATE novel_runs SET updated_at = datetime('now') WHERE id = ?").run(id);

/* ═══════════════════════════ NOVELS CRUD ═══════════════════════════ */
router.get('/', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM novels WHERE owner_id = ? ORDER BY pinned DESC, updated_at DESC').all(req.user.id);
  const novels = rows.map(n => {
    const runs = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(words),0) w FROM novel_runs WHERE novel_id = ?').get(n.id);
    const s = shapeNovel(n);
    return { ...s, codex_count: s.codex.length, run_count: runs.c, words: runs.w };
  });
  res.json({ novels });
});

router.post('/', authRequired, (req, res) => {
  const b = req.body || {};
  const title = clampStr(b.title, 80).trim();
  if (!title) return res.status(400).json({ error: '请填写作品名' });
  const info = db.prepare(`INSERT INTO novels (owner_id, title, logline, synopsis, cover, genre, tags, style, codex)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    req.user.id, title, clampStr(b.logline, 200), clampStr(b.synopsis, 4000), b.cover || null,
    clampStr(b.genre, 40), clampStr(b.tags, 200),
    JSON.stringify(cleanStyle(b.style)), JSON.stringify(cleanEntries(b.codex, { defaultSource: 'meta' })));
  // 自动开一条主线，并把局外设定复刻进局内。
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(info.lastInsertRowid);
  forkRun(novel, '主线');
  res.json({ novel: shapeNovel(novel) });
});

// 书架精选：所有已发布作品（公开只读列表）。必须定义在 /:id 之前，避免被其捕获。
router.get('/showcase', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT n.id, n.title, n.logline, n.cover, n.genre, n.tags, n.owner_id, n.published_run_id, n.updated_at,
    u.display_name AS author_name, u.avatar AS author_avatar
    FROM novels n JOIN users u ON u.id = n.owner_id
    WHERE n.published = 1 ORDER BY n.updated_at DESC LIMIT 60`).all();
  const novels = rows.map(n => ({ ...n, words: db.prepare('SELECT COALESCE(words,0) w FROM novel_runs WHERE id = ?').get(n.published_run_id)?.w || 0,
    beats: db.prepare('SELECT COUNT(*) c FROM novel_beats WHERE run_id = ?').get(n.published_run_id)?.c || 0, mine: n.owner_id === req.user.id }));
  res.json({ novels });
});

router.get('/:id', authRequired, (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const runs = db.prepare('SELECT id, name, words, archived, summary, created_at, updated_at FROM novel_runs WHERE novel_id = ? ORDER BY archived, updated_at DESC').all(n.id)
    .map(r => ({ ...r, beats: db.prepare('SELECT COUNT(*) c FROM novel_beats WHERE run_id = ?').get(r.id).c }));
  res.json({ novel: shapeNovel(n), runs });
});

router.patch('/:id', authRequired, (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const b = req.body || {};
  const sets = [], vals = [];
  const put = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if (typeof b.title === 'string' && b.title.trim()) put('title', clampStr(b.title, 80).trim());
  if (typeof b.logline === 'string') put('logline', clampStr(b.logline, 200));
  if (typeof b.synopsis === 'string') put('synopsis', clampStr(b.synopsis, 4000));
  if (b.cover !== undefined) put('cover', b.cover || null);
  if (typeof b.genre === 'string') put('genre', clampStr(b.genre, 40));
  if (typeof b.tags === 'string') put('tags', clampStr(b.tags, 200));
  if (b.style !== undefined) put('style', JSON.stringify(cleanStyle(b.style)));
  // 局外设定可被作者随时编辑（这是创作母版）；但它永远不会被剧情自动改动。
  if (b.codex !== undefined) put('codex', JSON.stringify(cleanEntries(b.codex, { defaultSource: 'meta' })));
  if (b.pinned !== undefined) put('pinned', b.pinned ? 1 : 0);
  if (!sets.length) return res.json({ novel: shapeNovel(n) });
  vals.push(n.id);
  db.prepare(`UPDATE novels SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals);
  res.json({ novel: shapeNovel(db.prepare('SELECT * FROM novels WHERE id = ?').get(n.id)) });
});

router.delete('/:id', authRequired, (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  db.prepare('DELETE FROM novels WHERE id = ?').run(n.id); // runs + beats cascade
  res.json({ ok: true });
});

/* ═══════════════════════════ RUNS（剧情线 / 局内设定） ═══════════════════════════ */
// Fork: copy the immutable 局外 codex into a fresh run's 局内 canon (source becomes 'meta').
function forkRun(novel, name) {
  const codex = cleanEntries(parseJSON(novel.codex, []));
  const canon = codex.map(e => ({ ...e, source: 'meta', updated_at: new Date().toISOString() }));
  const info = db.prepare('INSERT INTO novel_runs (novel_id, owner_id, name, canon) VALUES (?,?,?,?)')
    .run(novel.id, novel.owner_id, clampStr(name, 40).trim() || '新线', JSON.stringify(canon));
  return db.prepare('SELECT * FROM novel_runs WHERE id = ?').get(info.lastInsertRowid);
}

router.post('/:id/runs', authRequired, (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const run = forkRun(n, req.body?.name || `第 ${db.prepare('SELECT COUNT(*) c FROM novel_runs WHERE novel_id = ?').get(n.id).c + 1} 线`);
  res.json({ run: shapeRun(run) });
});

router.get('/runs/:rid', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const beats = db.prepare('SELECT * FROM novel_beats WHERE run_id = ? ORDER BY seq, id').all(r.id)
    .map(x => ({ ...x, meta: parseJSON(x.meta, {}), history: parseJSON(x.history, []) }));
  res.json({ run: shapeRun(r), novel: shapeNovel(novel), beats });
});

router.patch('/runs/:rid', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const b = req.body || {};
  const sets = [], vals = [];
  const put = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if (typeof b.name === 'string' && b.name.trim()) put('name', clampStr(b.name, 40).trim());
  // 局内设定可手动编辑（作者校正）；自动更新走专门的 sync-canon 接口。
  if (b.canon !== undefined) put('canon', JSON.stringify(cleanEntries(b.canon)));
  if (b.vars !== undefined && b.vars && typeof b.vars === 'object') put('vars', JSON.stringify(b.vars));
  if (typeof b.summary === 'string') put('summary', clampStr(b.summary, 6000));
  if (b.archived !== undefined) put('archived', b.archived ? 1 : 0);
  if (!sets.length) return res.json({ run: shapeRun(r) });
  vals.push(r.id);
  db.prepare(`UPDATE novel_runs SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals);
  res.json({ run: shapeRun(db.prepare('SELECT * FROM novel_runs WHERE id = ?').get(r.id)) });
});

router.delete('/runs/:rid', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const left = db.prepare('SELECT COUNT(*) c FROM novel_runs WHERE novel_id = ?').get(r.novel_id).c;
  if (left <= 1) return res.status(400).json({ error: '至少保留一条剧情线' });
  db.prepare('DELETE FROM novel_runs WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

// Re-fork: reset this run's 局内 canon back to the pristine 局外 codex template.
router.post('/runs/:rid/refork', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const codex = cleanEntries(parseJSON(novel.codex, []));
  const keepAuto = !!req.body?.keep_auto;
  const cur = cleanEntries(parseJSON(r.canon, []));
  let canon = codex.map(e => ({ ...e, source: 'meta', updated_at: new Date().toISOString() }));
  if (keepAuto) canon = canon.concat(cur.filter(e => e.source === 'auto' || e.source === 'manual'));
  db.prepare("UPDATE novel_runs SET canon = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(cleanEntries(canon)), r.id);
  res.json({ run: shapeRun(db.prepare('SELECT * FROM novel_runs WHERE id = ?').get(r.id)) });
});

/* ───────────────────────── beats: edit / delete / pin ───────────────────────── */
router.patch('/runs/:rid/beats/:bid', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const beat = db.prepare('SELECT * FROM novel_beats WHERE id = ? AND run_id = ?').get(req.params.bid, r.id);
  if (!beat) return res.status(404).json({ error: '段落不存在' });
  const b = req.body || {};
  if (typeof b.content === 'string' && b.content !== beat.content) {
    pushHistory(beat.id, beat.content); // 手动编辑前留存旧版
    db.prepare('UPDATE novel_beats SET content = ? WHERE id = ?').run(clampStr(b.content, 12000), beat.id);
  }
  if (typeof b.directive === 'string') db.prepare('UPDATE novel_beats SET directive = ? WHERE id = ?').run(clampStr(b.directive, 2000), beat.id);
  if (b.pinned !== undefined) db.prepare('UPDATE novel_beats SET pinned = ? WHERE id = ?').run(b.pinned ? 1 : 0, beat.id);
  if (b.image !== undefined) db.prepare('UPDATE novel_beats SET image = ? WHERE id = ?').run(clampStr(b.image, 600), beat.id);
  recountWords(r.id);
  const fresh = db.prepare('SELECT * FROM novel_beats WHERE id = ?').get(beat.id);
  res.json({ beat: { ...fresh, meta: parseJSON(fresh.meta, {}), history: parseJSON(fresh.history, []) } });
});

router.delete('/runs/:rid/beats/:bid', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  db.prepare('DELETE FROM novel_beats WHERE id = ? AND run_id = ?').run(req.params.bid, r.id);
  recountWords(r.id);
  res.json({ ok: true });
});

function recountWords(runId) {
  const rows = db.prepare('SELECT content FROM novel_beats WHERE run_id = ?').all(runId);
  const words = rows.reduce((s, x) => s + (x.content || '').replace(/\s/g, '').length, 0);
  db.prepare('UPDATE novel_runs SET words = ? WHERE id = ?').run(words, runId);
  return words;
}
// 版本历史：把旧正文压入 history（最多保留 12 版，最新在前），供一键回退。
function pushHistory(beatId, prevContent) {
  if (!prevContent || !prevContent.trim()) return;
  const row = db.prepare('SELECT history FROM novel_beats WHERE id = ?').get(beatId);
  let hist = parseJSON(row?.history, []);
  if (hist[0]?.content === prevContent) return; // 无变化不重复记
  hist.unshift({ content: prevContent, at: new Date().toISOString() });
  hist = hist.slice(0, 12);
  db.prepare('UPDATE novel_beats SET history = ? WHERE id = ?').run(JSON.stringify(hist), beatId);
}

// Branch: fork a NEW run that contains beats up to (and including) a chosen beat,
// carrying over the current 局内 canon snapshot. Lets the author explore alternatives.
router.post('/runs/:rid/branch/:bid', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const pivot = db.prepare('SELECT * FROM novel_beats WHERE id = ? AND run_id = ?').get(req.params.bid, r.id);
  if (!pivot) return res.status(404).json({ error: '段落不存在' });
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const name = clampStr(req.body?.name, 40).trim() || (r.name + ' · 分支');
  const info = db.prepare('INSERT INTO novel_runs (novel_id, owner_id, name, canon, vars, summary) VALUES (?,?,?,?,?,?)')
    .run(novel.id, novel.owner_id, name, r.canon, r.vars, r.summary);
  const kept = db.prepare('SELECT * FROM novel_beats WHERE run_id = ? AND seq <= ? ORDER BY seq, id').all(r.id, pivot.seq);
  const ins = db.prepare('INSERT INTO novel_beats (run_id, seq, directive, content, meta, image, pinned, created_at) VALUES (?,?,?,?,?,?,?,?)');
  kept.forEach((bt, i) => ins.run(info.lastInsertRowid, i, bt.directive, bt.content, bt.meta, bt.image || '', bt.pinned, bt.created_at));
  recountWords(info.lastInsertRowid);
  res.json({ run: shapeRun(db.prepare('SELECT * FROM novel_runs WHERE id = ?').get(info.lastInsertRowid)) });
});

/* ═══════════════════════════ AI: streaming write ═══════════════════════════ */
router.post('/runs/:rid/write', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const settings = getSettings(req.user.id);
  const directive = clampStr(req.body?.directive, 2000).trim();
  const beats = db.prepare('SELECT * FROM novel_beats WHERE run_id = ? ORDER BY seq, id').all(r.id);
  await streamWrite(res, { run: r, novel, settings, directive, beats, userId: req.user.id });
});

// Rewrite an existing beat with an instruction (e.g. polish, shorten, intensify).
router.post('/runs/:rid/beats/:bid/rewrite', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const beat = db.prepare('SELECT * FROM novel_beats WHERE id = ? AND run_id = ?').get(req.params.bid, r.id);
  if (!beat) return res.status(404).json({ error: '段落不存在' });
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const settings = getSettings(req.user.id);
  const instruction = clampStr(req.body?.instruction, 600).trim();
  const before = db.prepare('SELECT * FROM novel_beats WHERE run_id = ? AND seq < ? ORDER BY seq, id').all(r.id, beat.seq);
  await streamWrite(res, { run: r, novel, settings, beats: before, userId: req.user.id, rewrite: beat, instruction });
});

async function streamWrite(res, { run, novel, settings, directive, beats, userId, rewrite, instruction }) {
  const me = db.prepare('SELECT id, gold, vip_until, svip FROM users WHERE id = ?').get(userId);
  const eff = effectiveLLM(settings);
  if (eff && !eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sse = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  if (!eff) { sse({ error: '尚未配置语言模型 API，且平台服务未开启。请前往「设置 → 语言模型」填写 API Key。' }); sse('[DONE]'); return res.end(); }

  const style = cleanStyle(parseJSON(novel.style, {}));
  const canon = cleanEntries(parseJSON(run.canon, []));
  const recentText = beats.slice(-4).map(b => b.content).join('\n\n');
  const isOpening = !rewrite && beats.length === 0;
  const system = buildWriterSystem(novel, style, canon, run, directive || (rewrite ? rewrite.directive : ''), recentText + ' ' + (directive || ''), isOpening);

  // 上下文消息：把已有节拍折叠成 assistant 正文 + user 方向，保持模型“接着写”。
  const ctx = [];
  for (const b of beats.slice(-8)) {
    if (b.directive) ctx.push({ role: 'user', content: b.directive });
    if (b.content) ctx.push({ role: 'assistant', content: b.content });
  }
  let task;
  if (rewrite) {
    task = `请改写下面这段正文${instruction ? '，要求：' + instruction : '，让它更精彩、更具文学性，但保持情节与设定不变'}。只输出改写后的正文：\n\n${rewrite.content}`;
  } else if (isOpening) {
    task = directive
      ? `作者方向：${directive}\n\n请据此写下这部小说的开篇正文，立刻把读者带入情境。`
      : '请据「故事梗概 / 起点」写下这部小说富有画面感的开篇正文，立刻把读者带入情境。';
  } else {
    task = directive
      ? `作者方向：${directive}\n\n请据此写出接下来的正文。`
      : '请顺着前文，自然地写出接下来的正文（推进一个有张力的小情节）。';
  }
  const messages = [{ role: 'system', content: eff.platform && eff.system_prompt ? eff.system_prompt + '\n\n' + system : system }, ...ctx, { role: 'user', content: task }];

  // 平台计费：与对话一致，先验余额，成功后扣费。
  let feeDue = 0;
  if (eff.platform) {
    feeDue = platformFee(me, beats.length);
    if (me.gold < feeDue) { sse({ error: `金币不足，本次平台 AI 创作需 ${feeDue} 金币（当前 ${me.gold}）。可前往钱包签到/兑换，或在设置中填写自己的 API。` }); sse('[DONE]'); return res.end(); }
  }

  let full = '';
  try {
    const upstream = await fetch(eff.base_url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eff.api_key}` },
      body: JSON.stringify({ model: eff.model, messages, temperature: eff.temperature ?? 0.9, max_tokens: eff.max_tokens || 1600, stream: true }),
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      console.error('[novels] 上游模型错误', upstream.status, text.slice(0, 200));
      sse({ error: '模型服务暂不可用，请稍后再试' }); sse('[DONE]'); return res.end();
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try { const j = JSON.parse(data); const delta = j.choices?.[0]?.delta?.content || ''; if (delta) { full += delta; sse({ delta }); } }
        catch { /* partial */ }
      }
    }
  } catch (err) {
    console.error('[novels] 连接模型失败', err.message);
    sse({ error: '模型服务暂不可用，请稍后再试' });
  }

  full = full.trim();
  if (full) {
    if (rewrite) {
      pushHistory(rewrite.id, rewrite.content);
      db.prepare('UPDATE novel_beats SET content = ? WHERE id = ?').run(full, rewrite.id);
      sse({ beat_id: rewrite.id });
    } else {
      const seq = (db.prepare('SELECT COALESCE(MAX(seq), -1) m FROM novel_beats WHERE run_id = ?').get(run.id).m) + 1;
      const meta = { triggered: triggeredEntries(canon, { directive, sceneText: recentText }).map(e => e.id) };
      const info = db.prepare('INSERT INTO novel_beats (run_id, seq, directive, content, meta) VALUES (?,?,?,?,?)')
        .run(run.id, seq, directive, full, JSON.stringify(meta));
      sse({ beat_id: info.lastInsertRowid, seq });
    }
    recountWords(run.id);
    touchRun(run.id); touchNovel(run.novel_id);
    try { bumpDaily(userId, 'novel'); } catch { /* */ }
    if (feeDue) { try { const w = applyTx(me.id, { kind: 'ai_fee', gold: -feeDue, memo: `AI 创作 ·《${novel.title}》` }); sse({ fee: feeDue, balance: w.gold }); } catch { /* */ } }
  }
  sse('[DONE]');
  res.end();
}

/* ═══════════════════════════ AI: JSON helpers ═══════════════════════════ */
// 自动把剧情推进沉淀进「局内设定」：提取本线最新进展里新增/变化的持久事实，合并进 canon。
router.post('/runs/:rid/sync-canon', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }

  const beats = db.prepare('SELECT content FROM novel_beats WHERE run_id = ? ORDER BY seq DESC LIMIT 3').all(r.id).reverse();
  const recent = beats.map(b => b.content).join('\n\n');
  if (!recent.trim()) return res.json({ run: shapeRun(r), added: 0, updated: 0 });
  const canon = cleanEntries(parseJSON(r.canon, []));
  const known = canon.map(e => `- ${e.title}（${CAT_LABEL[e.category]}）：${e.content.slice(0, 60)}`).join('\n') || '（暂无）';

  const system = '你是小说连续性编辑。任务：从最新正文中提炼出「应当长期记住的设定事实」（新出场角色、关系变化、地点、物品、势力、世界规则、关键剧情状态），用于维护设定库，保证后续创作不矛盾。只提炼确实在正文中发生/确立的事实，不要臆造、不要写转瞬即逝的细节。';
  const user = `已知设定：\n${known}\n\n最新正文：\n${recent}\n\n请输出一个 JSON 数组，每个元素形如 {"title":"简短条目名","category":"world|character|relationship|faction|location|item|lore|rule|timeline|plot","content":"一句到两句话的设定描述","keys":"触发关键词，逗号分隔","trigger":"keyword 或 scene 或 always"}。\n- 若是对已知条目的更新，请沿用同名 title。\n- 若没有任何值得沉淀的新设定，输出空数组 []。\n只输出 JSON，不要其它文字。`;

  let arr;
  try { arr = extractJSON(await llmOnce(eff, system, user, { maxTokens: 900, temperature: 0.3 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!Array.isArray(arr)) arr = [];

  let added = 0, updated = 0;
  const byTitle = new Map(canon.map(e => [e.title.trim(), e]));
  for (const raw of arr.slice(0, 24)) {
    const c = cleanEntry({ ...raw, source: 'auto' }, { defaultSource: 'auto' });
    if (!c) continue;
    const exist = byTitle.get(c.title.trim());
    if (exist) {
      if (exist.locked || exist.source === 'meta') continue; // 局外复刻条目与锁定条目不被自动覆盖
      exist.content = c.content || exist.content;
      if (c.keys) exist.keys = c.keys;
      exist.updated_at = new Date().toISOString();
      updated++;
    } else {
      canon.push(c); byTitle.set(c.title.trim(), c); added++;
    }
  }
  if (added || updated) db.prepare("UPDATE novel_runs SET canon = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(cleanEntries(canon)), r.id);
  res.json({ run: shapeRun(db.prepare('SELECT * FROM novel_runs WHERE id = ?').get(r.id)), added, updated });
});

// 滚动剧情摘要：把整线压缩成「前情提要」，作为长篇记忆喂回写作。
router.post('/runs/:rid/recap', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const beats = db.prepare('SELECT content FROM novel_beats WHERE run_id = ? ORDER BY seq, id').all(r.id);
  const text = beats.map(b => b.content).join('\n\n');
  if (!text.trim()) return res.json({ run: shapeRun(r) });
  const system = '你是小说编辑，请把以下连载内容压缩成简洁连贯的「前情提要」，覆盖关键人物、已发生的核心事件、当前局势与悬念，控制在 300 字内。只输出提要本身。';
  let recap;
  try { recap = await llmOnce(eff, system, text.slice(-8000), { maxTokens: 600, temperature: 0.4 }); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  db.prepare("UPDATE novel_runs SET summary = ?, updated_at = datetime('now') WHERE id = ?").run(clampStr(recap, 6000), r.id);
  res.json({ run: shapeRun(db.prepare('SELECT * FROM novel_runs WHERE id = ?').get(r.id)) });
});

// 续写灵感：给出几条下一步可走的方向，作者一键采用。
router.post('/runs/:rid/suggest', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const beats = db.prepare('SELECT content FROM novel_beats WHERE run_id = ? ORDER BY seq DESC LIMIT 3').all(r.id).reverse();
  const recent = beats.map(b => b.content).join('\n\n') || novel.synopsis || novel.logline || '故事尚未开始。';
  const system = `你是资深小说策划，为《${novel.title}》构思接下来的剧情走向。给出 4 个差异明显、各有张力的方向（有的推进主线、有的制造冲突或转折、有的深化人物或埋伏笔）。`;
  const user = `当前进展：\n${recent}\n\n请输出 JSON 数组，每个元素 {"label":"6字内方向标签","prompt":"可直接作为创作指令的一句话方向（30字内）"}。只输出 JSON。`;
  let arr;
  try { arr = extractJSON(await llmOnce(eff, system, user, { maxTokens: 700, temperature: 0.95 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!Array.isArray(arr)) arr = [];
  const suggestions = arr.slice(0, 6).map(x => ({ label: clampStr(x.label, 24), prompt: clampStr(x.prompt, 200) })).filter(x => x.prompt);
  res.json({ suggestions });
});

// AI 灵感开局：从一句创意生成 标题/内核/类型/梗概/标签。
router.post('/brainstorm', authRequired, aiLimiter, async (req, res) => {
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const seed = clampStr(req.body?.seed, 600).trim();
  if (!seed) return res.status(400).json({ error: '请先写一句你的创意' });
  const system = '你是小说企划。根据用户的一句创意，构思一部有吸引力的小说雏形。';
  const user = `创意：${seed}\n\n输出 JSON：{"title":"作品名","logline":"一句话故事内核(40字内)","genre":"类型","synopsis":"100-200字开篇梗概","tags":"逗号分隔的3-5个标签"}。只输出 JSON。`;
  let obj;
  try { obj = extractJSON(await llmOnce(eff, system, user, { maxTokens: 800, temperature: 0.95 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!obj || typeof obj !== 'object') return res.status(502).json({ error: 'AI 返回格式异常，请重试' });
  res.json({ draft: {
    title: clampStr(obj.title, 80), logline: clampStr(obj.logline, 200), genre: clampStr(obj.genre, 40),
    synopsis: clampStr(obj.synopsis, 4000), tags: clampStr(obj.tags, 200),
  } });
});

// AI 生成局外设定：从作品梗概自动起一套世界观/角色/势力等设定母版。
router.post('/:id/codex/generate', authRequired, aiLimiter, async (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const focus = clampStr(req.body?.focus, 300).trim();
  const base = `《${n.title}》${n.genre ? '（' + n.genre + '）' : ''}\n内核：${n.logline || '—'}\n梗概：${n.synopsis || '—'}`;
  const system = '你是世界观架构师。为这部小说搭建一套可落地的「设定母版」：涵盖世界观背景、核心主角与重要配角、关键关系、主要势力/地点、独特设定或规则、以及悬而未决的核心剧情线。条目精炼、彼此自洽。';
  const user = `${base}\n${focus ? '侧重：' + focus + '\n' : ''}\n请输出 JSON 数组（8-14 条），每个元素 {"title":"条目名","category":"world|character|relationship|faction|location|item|lore|rule|timeline|plot","content":"1-3句设定","keys":"触发关键词,逗号分隔","trigger":"always|keyword|scene"}。\n世界观/基调类用 always；具体人物地点物品用 keyword 或 scene。只输出 JSON。`;
  let arr;
  try { arr = extractJSON(await llmOnce(eff, system, user, { maxTokens: 1800, temperature: 0.85 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!Array.isArray(arr)) return res.status(502).json({ error: 'AI 返回格式异常，请重试' });
  const generated = cleanEntries(arr.map(x => ({ ...x, source: 'meta' })), { defaultSource: 'meta' });
  const append = req.body?.append !== false;
  const existing = append ? cleanEntries(parseJSON(n.codex, [])) : [];
  const codex = cleanEntries(existing.concat(generated), { defaultSource: 'meta' });
  db.prepare("UPDATE novels SET codex = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(codex), n.id);
  res.json({ novel: shapeNovel(db.prepare('SELECT * FROM novels WHERE id = ?').get(n.id)), generated: generated.length });
});

// 导出整线为纯文本 / Markdown。
router.get('/runs/:rid/export', authRequired, (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(r.novel_id);
  const beats = db.prepare('SELECT * FROM novel_beats WHERE run_id = ? ORDER BY seq, id').all(r.id);
  const md = req.query.format === 'md';
  let out = md ? `# ${novel.title}\n\n${novel.logline ? '> ' + novel.logline + '\n\n' : ''}` : `${novel.title}\n${novel.logline || ''}\n\n`;
  beats.forEach((b, i) => { out += (md ? `### ${i + 1}\n\n` : `\n— ${i + 1} —\n\n`) + (b.content || '') + '\n\n'; });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.json({ text: out, words: recountWords(r.id) });
});

// 一致性检查：扫描最新正文与局内设定，找出潜在矛盾 / 断裂，给出修正建议。
router.post('/runs/:rid/check', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const beats = db.prepare('SELECT content FROM novel_beats WHERE run_id = ? ORDER BY seq DESC LIMIT 5').all(r.id).reverse();
  const recent = beats.map(b => b.content).join('\n\n');
  if (!recent.trim()) return res.json({ issues: [] });
  const canon = cleanEntries(parseJSON(r.canon, []));
  const setText = canon.map(e => `- ${e.title}（${CAT_LABEL[e.category]}）：${e.content}`).join('\n') || '（暂无设定）';
  const system = '你是严谨的小说连续性审校。对照设定库检查正文是否存在自相矛盾、人物/地点/时间错乱、设定违背或前后断裂。只报真正的问题，没有就返回空数组。';
  const user = `设定库：\n${setText}\n\n最新正文：\n${recent}\n\n输出 JSON 数组，每个元素 {"severity":"high|medium|low","issue":"问题描述","fix":"修正建议"}。只输出 JSON。`;
  let arr;
  try { arr = extractJSON(await llmOnce(eff, system, user, { maxTokens: 900, temperature: 0.2 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!Array.isArray(arr)) arr = [];
  const issues = arr.slice(0, 12).map(x => ({ severity: ['high', 'medium', 'low'].includes(x.severity) ? x.severity : 'medium', issue: clampStr(x.issue, 300), fix: clampStr(x.fix, 300) })).filter(x => x.issue);
  res.json({ issues });
});

// 剧情时间线：把整线正文提炼成按顺序的关键事件流（派生视图，非创作大纲）。
router.post('/runs/:rid/timeline', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const text = db.prepare('SELECT content FROM novel_beats WHERE run_id = ? ORDER BY seq, id').all(r.id).map(b => b.content).join('\n\n');
  if (!text.trim()) return res.json({ events: [] });
  const system = '你是小说编辑，把连载正文梳理成「关键事件时间线」，按发生顺序列出，每条聚焦一个推动剧情的事件。';
  const user = `正文：\n${text.slice(-9000)}\n\n输出 JSON 数组，每个元素 {"label":"阶段/场景短名","event":"该事件一句话"}。最多 12 条。只输出 JSON。`;
  let arr;
  try { arr = extractJSON(await llmOnce(eff, system, user, { maxTokens: 1000, temperature: 0.4 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!Array.isArray(arr)) arr = [];
  res.json({ events: arr.slice(0, 20).map(x => ({ label: clampStr(x.label, 30), event: clampStr(x.event, 240) })).filter(x => x.event) });
});

// 设定关系图谱：基于局内设定 + 近期正文，推断角色/势力/地点之间的关系，生成可视化节点与连线。
router.post('/runs/:rid/graph', authRequired, aiLimiter, async (req, res) => {
  const r = ownRun(req, res); if (!r) return;
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const canon = cleanEntries(parseJSON(r.canon, []));
  const setText = canon.map(e => `- ${e.title}（${CAT_LABEL[e.category]}）：${e.content}`).join('\n');
  if (!setText.trim()) return res.json({ nodes: [], edges: [] });
  const recent = db.prepare('SELECT content FROM novel_beats WHERE run_id = ? ORDER BY seq DESC LIMIT 3').all(r.id).reverse().map(b => b.content).join('\n');
  const system = '你是故事结构分析师。根据设定库与正文，提炼主要实体（人物/势力/地点）及它们之间的关系，用于绘制关系图谱。';
  const user = `设定库：\n${setText}\n\n近期正文：\n${recent}\n\n输出 JSON：{"nodes":[{"id":"名字","type":"character|faction|location|other"}],"edges":[{"from":"名字","to":"名字","label":"关系，如 师徒/敌对/同伴"}]}。节点不超过 12 个。只输出 JSON。`;
  let obj;
  try { obj = extractJSON(await llmOnce(eff, system, user, { maxTokens: 1100, temperature: 0.4 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!obj || typeof obj !== 'object') obj = {};
  const nodes = Array.isArray(obj.nodes) ? obj.nodes.slice(0, 16).map(n => ({ id: clampStr(n.id, 30), type: ['character', 'faction', 'location', 'other'].includes(n.type) ? n.type : 'other' })).filter(n => n.id) : [];
  const ids = new Set(nodes.map(n => n.id));
  const edges = Array.isArray(obj.edges) ? obj.edges.slice(0, 30).map(e => ({ from: clampStr(e.from, 30), to: clampStr(e.to, 30), label: clampStr(e.label, 20) })).filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to) : [];
  res.json({ nodes, edges });
});

// 卡文急救 / 灵感火花：随机给出人名、转折、细节，帮作者突破写作瓶颈。
router.post('/:id/muse', authRequired, aiLimiter, async (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const settings = getSettings(req.user.id);
  const eff = effectiveLLM(settings);
  if (!eff) return res.status(400).json({ error: '尚未配置语言模型 API' });
  if (!eff.platform) { try { assertPublicUrl(eff.base_url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const system = `你是脑暴搭子，为《${n.title}》${n.genre ? '（' + n.genre + '）' : ''}提供即兴灵感火花，贴合其题材气质。`;
  const user = `${n.logline ? '内核：' + n.logline + '\n' : ''}请输出 JSON：{"names":["契合世界观的人名/称号，4个"],"twists":["出人意料的剧情转折，3个，每条一句"],"details":["可增强画面感的具体细节/意象，3个"]}。只输出 JSON。`;
  let obj;
  try { obj = extractJSON(await llmOnce(eff, system, user, { maxTokens: 800, temperature: 1.0 })); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!obj || typeof obj !== 'object') obj = {};
  const arr = (a, n2, len) => (Array.isArray(a) ? a : []).slice(0, n2).map(x => clampStr(x, len)).filter(Boolean);
  res.json({ names: arr(obj.names, 8, 40), twists: arr(obj.twists, 6, 160), details: arr(obj.details, 6, 160) });
});

// 写作统计：字数 / 段落 / 剧情线 / 设定条目，按线汇总。
router.get('/:id/stats', authRequired, (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const runs = db.prepare('SELECT id, name, words, archived FROM novel_runs WHERE novel_id = ?').all(n.id).map(r => ({
    ...r, beats: db.prepare('SELECT COUNT(*) c FROM novel_beats WHERE run_id = ?').get(r.id).c,
    canon: cleanEntries(parseJSON(db.prepare('SELECT canon FROM novel_runs WHERE id = ?').get(r.id).canon, [])).length,
  }));
  const totalWords = runs.reduce((s, r) => s + (r.words || 0), 0);
  const totalBeats = runs.reduce((s, r) => s + r.beats, 0);
  res.json({ stats: { words: totalWords, beats: totalBeats, runs: runs.length, codex: cleanEntries(parseJSON(n.codex, [])).length, per_run: runs } });
});

// 整本导出（所有未归档剧情线，或指定一条）。
router.get('/:id/export', authRequired, (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const md = req.query.format === 'md';
  const runs = req.query.run_id
    ? db.prepare('SELECT * FROM novel_runs WHERE id = ? AND novel_id = ?').all(req.query.run_id, n.id)
    : db.prepare('SELECT * FROM novel_runs WHERE novel_id = ? AND archived = 0 ORDER BY id').all(n.id);
  let out = md ? `# ${n.title}\n\n${n.logline ? '> ' + n.logline + '\n\n' : ''}` : `${n.title}\n${n.logline || ''}\n\n`;
  for (const r of runs) {
    if (runs.length > 1) out += md ? `\n## ${r.name}\n\n` : `\n【${r.name}】\n\n`;
    const beats = db.prepare('SELECT content FROM novel_beats WHERE run_id = ? ORDER BY seq, id').all(r.id);
    beats.forEach((b, i) => { out += (md ? `### ${i + 1}\n\n` : `\n— ${i + 1} —\n\n`) + (b.content || '') + '\n\n'; });
  }
  res.json({ text: out, words: n ? db.prepare('SELECT COALESCE(SUM(words),0) w FROM novel_runs WHERE novel_id = ?').get(n.id).w : 0 });
});

// 发布到「书架精选」：选一条剧情线对外只读展示（或取消发布）。
router.post('/:id/publish', authRequired, (req, res) => {
  const n = ownNovel(req, res); if (!n) return;
  const publish = req.body?.publish !== false;
  if (publish) {
    const runId = req.body?.run_id;
    const run = runId ? db.prepare('SELECT * FROM novel_runs WHERE id = ? AND novel_id = ?').get(runId, n.id) : db.prepare('SELECT * FROM novel_runs WHERE novel_id = ? AND archived = 0 ORDER BY words DESC LIMIT 1').get(n.id);
    if (!run) return res.status(400).json({ error: '请选择要展示的剧情线' });
    const beatCount = db.prepare('SELECT COUNT(*) c FROM novel_beats WHERE run_id = ?').get(run.id).c;
    if (!beatCount) return res.status(400).json({ error: '该剧情线还没有正文，先写一点再发布吧' });
    db.prepare("UPDATE novels SET published = 1, published_run_id = ?, updated_at = datetime('now') WHERE id = ?").run(run.id, n.id);
  } else {
    db.prepare("UPDATE novels SET published = 0 WHERE id = ?").run(n.id);
  }
  res.json({ novel: shapeNovel(db.prepare('SELECT * FROM novels WHERE id = ?').get(n.id)), published: publish });
});

// 公开阅读：已发布作品（任何登录用户可读）或作者本人。
router.get('/:id/read', authRequired, (req, res) => {
  const n = db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id);
  if (!n) return res.status(404).json({ error: '作品不存在' });
  const isOwner = n.owner_id === req.user.id;
  if (!n.published && !isOwner) return res.status(403).json({ error: '该作品未公开' });
  const runId = req.query.run_id && isOwner ? req.query.run_id : n.published_run_id;
  const run = db.prepare('SELECT * FROM novel_runs WHERE id = ? AND novel_id = ?').get(runId, n.id) || db.prepare('SELECT * FROM novel_runs WHERE novel_id = ? ORDER BY id LIMIT 1').get(n.id);
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(n.owner_id);
  const beats = run ? db.prepare('SELECT id, content, image FROM novel_beats WHERE run_id = ? ORDER BY seq, id').all(run.id) : [];
  res.json({
    novel: { id: n.id, title: n.title, logline: n.logline, cover: n.cover, genre: n.genre, tags: n.tags, published: n.published, mine: isOwner },
    author: author ? { id: author.id, display_name: author.display_name, avatar: author.avatar } : null,
    run: run ? { id: run.id, name: run.name, words: run.words, summary: run.summary } : null,
    beats,
  });
});

export default router;
