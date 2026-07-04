// 角色卡导入解析 —— 支持多种来源格式，统一映射为幻域字段 { character, world }。
// 支持：
//   · 幻域原生 JSON（{ character, world } 或裸 character 对象）
//   · 酒馆(SillyTavern/TavernAI) JSON —— v1 扁平 / v2·v3 规范（字段在 json.data）
//   · 酒馆 PNG 角色卡 —— 图片内嵌 tEXt chunk（关键字 chara=v1/v2、ccv3=v3，值为 base64 JSON）
// PNG 情形下额外返回 imageBlob（图片本身即立绘，供上层上传为头像）。

// —— 读取 PNG 的 tEXt 文本块（关键字 → 原始字符串）——
function readPngTextChunks(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error('不是有效的 PNG 文件');
  }
  const dv = new DataView(arrayBuffer);
  const out = {};
  let pos = 8; // 跳过 8 字节签名
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
    pos = dataStart + len + 4; // 数据 + 4 字节 CRC
    if (type === 'IEND') break;
  }
  return out;
}

// base64（可能含 UTF-8 中文）→ 对象
function b64ToJson(b64) {
  const bin = atob(String(b64).trim());
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder('utf-8').decode(arr));
}

const trimTo = (v, n) => (v == null ? '' : String(v).slice(0, n));

// 任意卡片 JSON → 幻域 { character, world }
export function normalizeCard(json) {
  if (!json || typeof json !== 'object') throw new Error('角色卡内容无效');

  // 幻域原生：显式 { character, world }
  if (json.character && typeof json.character === 'object') {
    return { character: json.character, world: Array.isArray(json.world) ? json.world : [] };
  }

  // v2/v3 规范字段在 json.data；v1 与幻域裸对象在顶层
  const d = (json.data && typeof json.data === 'object') ? json.data : json;
  const isTavern = ['first_mes', 'mes_example', 'personality', 'scenario', 'description'].some(k => k in d) || 'spec' in json;

  // 幻域裸对象（已有 persona/greeting 且非酒馆标记）—— 直接用
  if (!isTavern && (d.persona || d.greeting || d.tagline)) {
    return { character: d, world: Array.isArray(json.world) ? json.world : [] };
  }

  // 酒馆 → 幻域：把 描述/性格/场景/对话示例 拼成人设(persona)
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

  // character_book / world_info → 世界书条目
  const book = d.character_book || json.character_book;
  let world = [];
  if (book && Array.isArray(book.entries)) {
    world = book.entries.slice(0, 200).map(e => ({
      keys: Array.isArray(e.keys) ? e.keys.join(',') : (e.keys || e.key || ''),
      content: trimTo(e.content, 4000),
      enabled: e.enabled !== false,
    })).filter(w => w.content || w.keys);
  }
  return { character, world };
}

// 入口：File → { character, world, imageBlob? }
export async function parseCharacterCard(file) {
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (isPng) {
    const buf = await file.arrayBuffer();
    const texts = readPngTextChunks(buf);
    const b64 = texts.ccv3 || texts.chara;
    if (!b64) throw new Error('这张 PNG 未内嵌角色卡数据（不是酒馆角色卡）');
    const json = b64ToJson(b64);
    return { ...normalizeCard(json), imageBlob: file };
  }
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('JSON 格式错误'); }
  return normalizeCard(json);
}
