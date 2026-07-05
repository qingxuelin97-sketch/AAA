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

// 酒馆 character_book / 正则 → 幻域「内嵌世界书」条目（简易 {keys,content,enabled}）+ 系统指令。
// 说明：聊天注入会同时读取「角色内嵌 world_entries」与「关联独立世界书」——为避免重复注入，
// 且让编辑页「世界书(N)」直接可见、计数正确（不再出现「只有壳」），一律落到内嵌世界书。
// 顺序按 insertion_order/order 保留；正则脚本转为禁用条目存档；上限 1000（大 lorebook 不再被 200 卡死）。
const WORLD_LIMIT = 1000;
function buildWorldEntries(d, notices) {
  const book = d.character_book || d.world_info || d.world_book || d.lorebook || null;
  const rawEntries = book
    ? (Array.isArray(book.entries) ? book.entries
      : (book.entries && typeof book.entries === 'object') ? Object.values(book.entries)
        : Array.isArray(book) ? book : [])
    : [];
  // 参照 SillyTavern：V2 规范(keys/secondary_keys/insertion_order/enabled/position字符串) 与
  // 内部导出(key/keysecondary/order/disable/position数字/extensions) 两套命名都认。
  const mapped = rawEntries.filter(e => {
    if (!e) return false;
    const k = e.keys || e.key; const hasKey = Array.isArray(k) ? k.length : !!k;
    return e.content || hasKey;
  }).map((e, i) => {
    const ext = e.extensions || {};
    const order = [e.insertion_order, e.order, ext.insertion_order].find(Number.isFinite) ?? i;
    const enabled = e.enabled !== false && e.disable !== true;
    // constant（常驻）必须保真：酒馆卡的游戏规则/系统指令多为「constant=true 且带关键词」，
    // 若丢掉该标记会被降级成关键词触发 → 规则永不注入、卡片引擎失效。
    const constant = e.constant === true || ext.constant === true;
    return { _order: order, keys: joinKeys(e.keys || e.key), content: e.content || '', enabled, constant };
  }).sort((a, b) => a._order - b._order).map(({ _order, ...e }) => e);

  let entries = mapped;
  if (entries.length > WORLD_LIMIT) { notices.push(`世界书条目 ${entries.length} 条，已保留前 ${WORLD_LIMIT} 条。`); entries = entries.slice(0, WORLD_LIMIT); }
  const overlay = [d.system_prompt, d.post_history_instructions].filter(Boolean).join('\n\n');
  return { entries, overlay };
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

  // 世界书条目（内嵌，可见/可用）+ 系统指令。
  const { entries, overlay } = buildWorldEntries(d, notices);

  // 酒馆 → 幻域：描述/性格/场景/示例（+系统指令）拼成人设
  const parts = [];
  if (d.description) parts.push(String(d.description));
  if (d.personality) parts.push('性格：' + d.personality);
  if (d.scenario) parts.push('场景：' + d.scenario);
  if (d.mes_example) parts.push('对话示例：\n' + d.mes_example);
  if (overlay) parts.push('【系统指令】\n' + overlay);  // system_prompt / 越狱后置指令 折入人设，避免丢失
  const character = {
    name: trimTo(d.name || json.name || '未命名角色', 60),
    // 上限放宽：酒馆开场白/人设常达数千~上万字（本卡开场白 5772），4000 会截断
    persona: trimTo(parts.join('\n\n'), 24000),
    greeting: trimTo(d.first_mes || d.greeting || '', 24000),
    tagline: trimTo(String(d.creator_notes || d.tagline || d.description || '').split('\n')[0], 200),
    // 公开简介：给其他玩家看的。酒馆卡常无 creator_notes，退回角色描述，避免上架后「没有简介」。
    intro: trimTo(d.creator_notes || d.intro || d.description || '', 8000),
    tags: trimTo(Array.isArray(d.tags) ? d.tags.join(',') : (d.tags || ''), 200),
    avatar: (typeof d.avatar === 'string' && /^(https?:|data:)/.test(d.avatar)) ? d.avatar : '',
    nsfw: d.nsfw ? 1 : 0,
  };
  // 备用开场白完整导入（酒馆 alternate_greetings）：聊天页可随时切换开场。
  // 凡人修仙传这类卡的「游戏开始」入口就在备用开场白里（主开场白只是说明书），丢弃会导致玩不了。
  if (Array.isArray(d.alternate_greetings) && d.alternate_greetings.length) {
    character.alt_greetings = d.alternate_greetings.filter(g => typeof g === 'string' && g.trim()).slice(0, 10).map(g => trimTo(g, 24000));
    notices.push(`含 ${character.alt_greetings.length} 条备用开场白：已完整导入，聊天页可切换开场。`);
  }

  // 酒馆前端显示正则（extensions.regex_scripts）→ 角色 front_regex：
  // 对「显示」层做 find→replace（本卡即 lucklyjkop → 沉浸式 HTML 面板）。跳过 disabled 与 promptOnly（后者只改提示词）。
  const scripts = (d.extensions && Array.isArray(d.extensions.regex_scripts)) ? d.extensions.regex_scripts : [];
  const frontRegex = scripts.filter(r => r && r.findRegex != null && !r.disabled && !r.promptOnly).map(r => ({
    name: String(r.scriptName || '').slice(0, 120),
    find: String(r.findRegex),
    replace: String(r.replaceString ?? ''),
    trim: Array.isArray(r.trimStrings) ? r.trimStrings.map(String) : [],
    placement: Array.isArray(r.placement) ? r.placement : [1, 2],   // 1=用户消息 2=AI消息
    minDepth: Number.isFinite(r.minDepth) ? r.minDepth : null,
    maxDepth: Number.isFinite(r.maxDepth) ? r.maxDepth : null,
  }));
  character.front_regex = frontRegex;
  if (frontRegex.length) notices.push(`含 ${frontRegex.length} 条前端显示正则：已作为「专家前端」适配，回复中的对应标记将渲染为 HTML 面板。`);

  // 世界书条目落到「内嵌世界书」（编辑页可见、计数正确、单一注入源）。
  return { character, world: entries, notices };
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
