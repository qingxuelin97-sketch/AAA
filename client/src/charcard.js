// 角色卡导入解析 —— 支持多来源格式，尽量完整地映射到幻域数据模型。
// 支持：
//   · 幻域原生 JSON（{ character, world } 或裸 character 对象）
//   · 酒馆(SillyTavern/TavernAI) JSON —— v1 扁平 / v2·v3 规范（字段在 json.data）
//   · 酒馆 PNG 角色卡 —— 图片内嵌 tEXt chunk（关键字 chara=v1/v2、ccv3=v3，值为 base64 JSON）
//
// 关于「完整适配酒馆」的取舍（幻域数据模型对照）：
//   · character_book（世界书）：**不再降级**塞进简易 world_entries，而是产出一份富世界书
//     （worldbook_entries 支持 keys/内容/启用/顺序 position、priority 优先级、inject_pos 注入位置、
//      probability 概率、depth 深度、required_keys(=酒馆 selective+secondary_keys 的 AND)、
//      case_sensitive、constant→mode:always、use_regex→mode:regex、comment），由上层建为独立世界书
//      并关联到角色 —— 触发/优先级与原生世界书一致。
//   · system_prompt / post_history_instructions（越狱/后置指令）→ 世界书 prompt_overlay（提示词叠加）。
//   · extensions.regex_scripts（酒馆正则）→ 本平台无「对输出做正则替换」的引擎，故**保留不丢**：
//     转为禁用的 regex 条目（附查找/替换原文）并在导入时提示，避免静默丢失、便于人工迁移。
//   · 前端内容（HTML/CSS）：条目正文内的 HTML 原样保留（聊天按富文本渲染）；卡片级自定义前端
//     （extensions.frontend/html）→ 世界书 front_schema（自构前端，服务端会做消毒）。

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || 0));
const trimTo = (v, n) => (v == null ? '' : String(v).slice(0, n));
const joinKeys = (k) => Array.isArray(k) ? k.filter(Boolean).join(',') : (k || '');

// —— 读取 PNG 的 tEXt 文本块（关键字 → 原始字符串）——
function readPngTextChunks(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) throw new Error('不是有效的 PNG 文件');
  const dv = new DataView(arrayBuffer);
  const out = {};
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos); pos += 4;
    const type = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]); pos += 4;
    const dataStart = pos;
    if (type === 'tEXt') {
      let i = dataStart; let kw = '';
      while (i < dataStart + len && bytes[i] !== 0) { kw += String.fromCharCode(bytes[i]); i++; }
      let s = '';
      for (let j = i + 1; j < dataStart + len; j++) s += String.fromCharCode(bytes[j]);
      out[kw] = s;
    }
    pos = dataStart + len + 4;
    if (type === 'IEND') break;
  }
  return out;
}

function b64ToJson(b64) {
  const bin = atob(String(b64).trim());
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder('utf-8').decode(arr));
}

// 酒馆 character_book / 正则 → 幻域富世界书 { name, ...opts, entries } + notices。
function buildWorldbook(d, charName, notices) {
  const book = d.character_book || d.world_info || null;
  const rawEntries = book && Array.isArray(book.entries) ? book.entries : [];

  const mapped = rawEntries.filter(e => e && (e.content || (e.keys && e.keys.length))).map((e, i) => {
    const ext = e.extensions || {};
    const stPos = e.position ?? ext.position;           // 0 before_char / 1 after_char / 4 at_depth
    const order = Number.isFinite(e.insertion_order) ? e.insertion_order : (Number.isFinite(ext.insertion_order) ? ext.insertion_order : i);
    return {
      _order: order,
      keys: joinKeys(e.keys || e.key),
      content: e.content || '',
      enabled: e.enabled !== false,
      comment: trimTo(e.comment || e.name || '', 500),
      case_sensitive: !!(e.case_sensitive ?? ext.case_sensitive),
      mode: e.constant ? 'always' : ((e.use_regex ?? ext.use_regex) ? 'regex' : 'keyword'),
      inject_pos: (stPos === 0) ? 'before' : 'after',
      depth: (stPos === 4) ? (ext.depth ?? 4) : (ext.depth ?? 0),
      probability: (ext.useProbability === false) ? 100 : (ext.probability ?? e.probability ?? 100),
      priority: clamp(e.priority ?? ext.priority ?? order, 0, 100),
      // 酒馆 selective + secondary_keys 语义 = 必须同时命中 → 幻域 required_keys(AND)
      required_keys: (e.selective && Array.isArray(e.secondary_keys)) ? joinKeys(e.secondary_keys) : '',
    };
  }).sort((a, b) => a._order - b._order).map(({ _order, ...e }) => e); // 按 insertion_order 定序，保持原生顺序

  // 酒馆正则脚本 → 禁用的 regex 条目（保留不丢），并提示。
  const regexScripts = (d.extensions && Array.isArray(d.extensions.regex_scripts)) ? d.extensions.regex_scripts : [];
  const regexEntries = regexScripts.map(r => ({
    keys: trimTo(r.scriptName || '正则脚本', 500),
    content: `【酒馆正则 · 本平台暂不自动应用，仅存档】\n查找：${r.findRegex || ''}\n替换：${r.replaceString || ''}`,
    enabled: false, mode: 'regex', comment: '从酒馆导入的正则脚本',
  }));
  if (regexScripts.length) notices.push(`含 ${regexScripts.length} 条酒馆正则脚本：本平台无输出正则替换引擎，已作为禁用条目存档，可在世界书中手动迁移。`);

  const entries = [...mapped, ...regexEntries];
  if (!entries.length) return null;

  const overlay = [d.system_prompt, d.post_history_instructions].filter(Boolean).join('\n\n');
  const frontend = (d.extensions && (d.extensions.frontend || d.extensions.html)) || '';
  return {
    name: trimTo((charName || '角色') + ' 的世界书', 60),
    scan_depth: book && book.scan_depth ? clamp(book.scan_depth, 1, 50) : 4,
    token_budget: book && book.token_budget ? clamp(book.token_budget, 0, 8000) : 0,
    recursion: book && book.recursive_scanning ? 1 : 0,
    prompt_overlay: trimTo(overlay, 2000),
    front_schema: trimTo(frontend, 8000),
    entries,
  };
}

// 任意卡片 JSON → { character, world, worldbook, notices }
export function normalizeCard(json) {
  if (!json || typeof json !== 'object') throw new Error('角色卡内容无效');
  const notices = [];

  // 幻域原生：显式 { character, world }
  if (json.character && typeof json.character === 'object') {
    return { character: json.character, world: Array.isArray(json.world) ? json.world : [], worldbook: null, notices };
  }

  const d = (json.data && typeof json.data === 'object') ? json.data : json;
  const isTavern = ['first_mes', 'mes_example', 'personality', 'scenario', 'description', 'character_book'].some(k => k in d) || 'spec' in json;

  // 幻域裸对象（已有 persona/greeting 且非酒馆标记）—— 直接用
  if (!isTavern && (d.persona || d.greeting || d.tagline)) {
    return { character: d, world: Array.isArray(json.world) ? json.world : [], worldbook: null, notices };
  }

  // 酒馆 → 幻域：描述/性格/场景/示例 拼成人设
  const parts = [];
  if (d.description) parts.push(String(d.description));
  if (d.personality) parts.push('性格：' + d.personality);
  if (d.scenario) parts.push('场景：' + d.scenario);
  if (d.mes_example) parts.push('对话示例：\n' + d.mes_example);
  const character = {
    name: trimTo(d.name || json.name || '未命名角色', 60),
    persona: trimTo(parts.join('\n\n'), 8000),
    greeting: trimTo(d.first_mes || d.greeting || '', 4000),
    tagline: trimTo(String(d.creator_notes || d.tagline || '').split('\n')[0], 200),
    intro: trimTo(d.creator_notes || d.intro || '', 4000),
    tags: trimTo(Array.isArray(d.tags) ? d.tags.join(',') : (d.tags || ''), 200),
    avatar: (typeof d.avatar === 'string' && /^(https?:|data:)/.test(d.avatar)) ? d.avatar : '',
    nsfw: d.nsfw ? 1 : 0,
  };
  if (Array.isArray(d.alternate_greetings) && d.alternate_greetings.length) {
    notices.push(`含 ${d.alternate_greetings.length} 条备用开场白：幻域单开场白，已保留主开场白（其余可在编辑页手动取用）。`);
  }

  const worldbook = buildWorldbook(d, character.name, notices);
  // 有富世界书就走世界书（避免与 world_entries 重复注入）；否则简易 world 兜底（一般为空）。
  return { character, world: worldbook ? [] : [], worldbook, notices };
}

// 入口：File → { character, world, worldbook, notices, imageBlob? }
export async function parseCharacterCard(file) {
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (isPng) {
    const buf = await file.arrayBuffer();
    const texts = readPngTextChunks(buf);
    const b64 = texts.ccv3 || texts.chara;
    if (!b64) throw new Error('这张 PNG 未内嵌角色卡数据（不是酒馆角色卡）');
    return { ...normalizeCard(b64ToJson(b64)), imageBlob: file };
  }
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('JSON 格式错误'); }
  return normalizeCard(json);
}
