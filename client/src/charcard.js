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

// zlib(deflate) 解压 —— 用于 zTXt / 压缩 iTXt 块（浏览器原生 DecompressionStream）。
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };

// —— 读取 PNG 的文本块（tEXt / zTXt / iTXt，关键字 → UTF-8 字符串）——
// 酒馆角色卡多用 tEXt，但也有导出为压缩的 zTXt / iTXt，一并支持，避免「读不到」。
async function readPngTextChunks(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) throw new Error('不是有效的 PNG 文件');
  const dv = new DataView(arrayBuffer);
  const out = {};
  const utf8 = (b) => new TextDecoder('utf-8').decode(b);
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos); pos += 4;
    const type = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]); pos += 4;
    const data = bytes.subarray(pos, pos + len);
    try {
      if (type === 'tEXt') {
        let i = 0; while (i < len && data[i] !== 0) i++;
        out[latin1(data.subarray(0, i))] = latin1(data.subarray(i + 1));
      } else if (type === 'zTXt') {
        let i = 0; while (i < len && data[i] !== 0) i++;
        const kw = latin1(data.subarray(0, i));   // data[i]=0 分隔，data[i+1]=压缩方法(0)
        out[kw] = utf8(await inflate(data.subarray(i + 2)));
      } else if (type === 'iTXt') {
        let i = 0; while (i < len && data[i] !== 0) i++;
        const kw = latin1(data.subarray(0, i));
        const compFlag = data[i + 1];              // 压缩标志；随后 1B 压缩方法
        let j = i + 3;                             // 跳过 language_tag \0
        while (j < len && data[j] !== 0) j++; j++;
        while (j < len && data[j] !== 0) j++; j++; // 跳过 translated_keyword \0
        const textBytes = data.subarray(j);
        out[kw] = compFlag === 1 ? utf8(await inflate(textBytes)) : utf8(textBytes);
      }
    } catch { /* 单个块解析失败不影响其它 */ }
    pos += len + 4;
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
  const book = d.character_book || d.world_info || d.world_book || d.lorebook || null;
  // 酒馆/世界书导出里 entries 可能是数组，也常常是「对象字典」{"0":{...},"1":{...}}（旧 world_info 格式）。
  // 只认数组会导致这类卡片世界书整段读不到 —— 两种都取。
  const rawEntries = book
    ? (Array.isArray(book.entries) ? book.entries
      : (book.entries && typeof book.entries === 'object') ? Object.values(book.entries)
        : Array.isArray(book) ? book : [])
    : [];

  // 参照 SillyTavern：酒馆条目有两种字段命名 ——
  //   · V2 character_book 规范：keys / secondary_keys / insertion_order / enabled / position(字符串 'before_char'|'after_char')
  //   · 内部 world_info 导出：key / keysecondary / order / disable / position(数字 0-4) / extensions
  // 两套都要认。position 数字：0 before_char / 1 after_char / 2 before_AN / 3 after_AN / 4 at_depth。
  const mapped = rawEntries.filter(e => {
    const k = e.keys || e.key; const hasKey = Array.isArray(k) ? k.length : !!k;
    return e && (e.content || hasKey);
  }).map((e, i) => {
    const ext = e.extensions || {};
    const specPos = e.position;                          // 规范：字符串；内部：数字
    const numPos = Number.isFinite(specPos) ? specPos : (Number.isFinite(ext.position) ? ext.position : null);
    const before = specPos === 'before_char' || numPos === 0 || numPos === 2;
    const atDepth = numPos === 4;
    const order = [e.insertion_order, e.order, ext.insertion_order].find(Number.isFinite) ?? i;
    const enabled = e.enabled !== false && e.disable !== true;
    const constant = !!(e.constant ?? ext.constant);
    const useRegex = !!(e.use_regex ?? ext.use_regex ?? e.useRegex);
    return {
      _order: order,
      keys: joinKeys(e.keys || e.key),
      content: e.content || '',
      enabled,
      comment: trimTo(e.comment || e.name || '', 500),
      case_sensitive: !!(e.case_sensitive ?? e.caseSensitive ?? ext.case_sensitive),
      mode: constant ? 'always' : (useRegex ? 'regex' : 'keyword'),
      inject_pos: before ? 'before' : 'after',
      depth: atDepth ? (e.depth ?? ext.depth ?? 4) : (ext.depth ?? 0),
      probability: (ext.useProbability === false || e.useProbability === false) ? 100 : (ext.probability ?? e.probability ?? 100),
      priority: clamp(e.priority ?? ext.priority ?? order, 0, 100),
      // selective + secondary/keysecondary = 必须同时命中 → 幻域 required_keys(AND)
      required_keys: (e.selective !== false && (e.secondary_keys || e.keysecondary)) ? joinKeys(e.secondary_keys || e.keysecondary) : '',
    };
  }).sort((a, b) => a._order - b._order).map(({ _order, ...e }) => e); // 按 order 定序，保持原生顺序/优先级

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
    tagline: trimTo(String(d.creator_notes || d.tagline || d.description || '').split('\n')[0], 200),
    // 公开简介：给其他玩家看的。酒馆卡常无 creator_notes，退回角色描述，避免上架后「没有简介」。
    intro: trimTo(d.creator_notes || d.intro || d.description || '', 4000),
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
    const texts = await readPngTextChunks(buf);
    // 关键字大小写不敏感（对齐 SillyTavern）：ccv3(v3) 优先，chara(v1/v2) 兜底。
    const lower = {}; for (const k in texts) lower[k.toLowerCase()] = texts[k];
    const b64 = lower.ccv3 || lower.chara;
    if (!b64) throw new Error('这张 PNG 未内嵌角色卡数据（不是酒馆角色卡）');
    return { ...normalizeCard(b64ToJson(b64)), imageBlob: file };
  }
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('JSON 格式错误'); }
  return normalizeCard(json);
}
