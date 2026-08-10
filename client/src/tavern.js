// SillyTavern（酒馆）世界书解析 —— 导入链路的单一实现。
//
// —— 为什么要抽出来 ——
// 项目里原本有两份互不相同的解析：
//   · WorldbookEditor.jsx 的 fromSillyTavern —— **写对了**，完整保留
//     secondary_keys / insertion_order / probability / case_sensitive /
//     group / depth / sticky / cooldown。
//   · charcard.js 的 buildWorldEntries —— 只留 keys / content / enabled / constant，
//     其余字段**全部静默丢弃**。
// 而角色卡导入走的恰恰是后者。于是一张精心配置的酒馆卡导进来，选择性触发
// （secondary_keys）、优先级、概率、互斥分组、注入深度全没了，作者却看不到任何提示——
// 只会觉得「这个平台的世界书不好使」。
//
// 现在两条链路共用这一份。改这里等于同时改两处，不会再次分叉。

// 多种来源与两套命名都认：
//   · 独立世界书：entries 为 { uid: {...} } 对象（内部导出）或数组（规范）。
//   · 角色卡内嵌：条目在 data.character_book.entries / character_book.entries。
//   · 命名两套：规范名 keys/secondary_keys/insertion_order/enabled 与
//     内部名 key/keysecondary/order/disable。
export function stEntrySource(d) {
  if (!d || typeof d !== 'object') return null;
  // 角色卡 → 深入 character_book（world_info / world_book / lorebook 是其它导出器的叫法）
  const book = d.character_book || d.data?.character_book || d.world_info || d.world_book || d.lorebook || null;
  const fromBook = book && (Array.isArray(book.entries) ? book.entries
    : (book.entries && typeof book.entries === 'object') ? Object.values(book.entries)
      : Array.isArray(book) ? book : null);
  if (fromBook && fromBook.length) return fromBook;
  if (Array.isArray(d.entries)) return d.entries;
  if (d.entries && typeof d.entries === 'object') return Object.values(d.entries);
  return null;
}

const kstr = (k) => (Array.isArray(k) ? k.filter(Boolean).join(', ') : String(k || ''));
const clampInt = (v, lo, hi, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

// 判定这份 JSON 是否「有酒馆味」。命中才按酒馆映射，避免误吞本平台自有格式。
const stish = (e) => e && (Array.isArray(e.key) || Array.isArray(e.keys)
  || 'constant' in e || 'uid' in e || 'insertion_order' in e || 'secondary_keys' in e || 'keysecondary' in e);

// 解析为本平台的世界书条目。返回 null 表示「这不是酒馆格式」。
export function fromSillyTavern(d) {
  const src = stEntrySource(d);
  if (!src || !src.length || !src.some(stish)) return null;
  return src.map((e) => {
    const ext = e.extensions || {};
    const keys = e.keys != null ? e.keys : e.key;
    const sec = e.secondary_keys != null ? e.secondary_keys : e.keysecondary;
    // 没写 insertion_order 时用默认优先级 50，**不能**拿数组下标兜底：
    // 那会让几乎每张卡的 priority 都变成非默认值，于是朴素的卡也被判成
    // 「用到了内嵌世界书表达不了的能力」，白白多建一堆独立世界书。
    // 条目本身的先后由数组顺序保留，落库时另有 position 字段承载。
    const order = [e.insertion_order, e.order, ext.insertion_order].find(v => Number.isFinite(v));
    const enabled = e.enabled !== false && e.disable !== true;
    // constant（常驻）必须保真：酒馆卡的游戏规则 / 系统指令多为「constant=true 且带关键词」，
    // 丢掉该标记会被降级成关键词触发 → 规则永不注入，卡片引擎当场失效。
    const constant = e.constant === true || ext.constant === true;
    return {
      keys: kstr(keys),
      // selective + secondary_keys = 选择性触发（必须同时命中次要关键词）
      required_keys: (Array.isArray(sec) && (e.selective || sec.length)) ? kstr(sec) : '',
      content: String(e.content || ''),
      comment: String(e.comment || ''),
      enabled,
      constant,
      mode: constant ? 'always' : 'keyword',
      priority: clampInt(order, 0, 100, 50),
      probability: e.useProbability === false ? 100 : clampInt(e.probability ?? 100, 0, 100, 100),
      case_sensitive: !!(e.case_sensitive ?? e.caseSensitive),
      group_name: String(e.group || ext.group || ''),
      depth: clampInt(e.depth ?? ext.depth, 0, 50, 0),
      sticky: clampInt(e.sticky ?? ext.sticky, 0, 99, 0),
      cooldown: clampInt(e.cooldown ?? ext.cooldown, 0, 999, 0),
    };
  }).filter(e => e.content || e.keys);
}

// 这些字段一旦存在，就说明这张卡用到了「内嵌世界书」表达不了的能力
// （内嵌世界书只有 keys / content / constant 三个维度）。
// 命中时应当建独立世界书，而不是降级塞进内嵌。
export const RICH_FIELDS = ['required_keys', 'probability', 'depth', 'sticky', 'cooldown', 'group_name', 'case_sensitive'];

export function needsStandaloneWorldbook(entries) {
  return (entries || []).some(e => (
    e.required_keys
    || (e.probability != null && e.probability !== 100)
    || e.depth
    || e.sticky
    || e.cooldown
    || e.group_name
    || e.case_sensitive
    // 内嵌世界书没有优先级维度，非默认优先级同样表达不了
    || (e.priority != null && e.priority !== 50)
  ));
}

// 逐字段说明「这张卡有什么会被降级」，供导入后如实告知作者。
// 静默降级是最糟的选项——作者看不到，只会以为平台不好使。
export function downgradeNotices(entries) {
  const list = entries || [];
  const out = [];
  const count = (pred) => list.filter(pred).length;
  const pairs = [
    [count(e => e.required_keys), '条使用了选择性触发（次要关键词）'],
    [count(e => e.probability != null && e.probability !== 100), '条设置了触发概率'],
    [count(e => e.depth), '条设置了注入深度'],
    [count(e => e.sticky), '条设置了粘滞轮数'],
    [count(e => e.cooldown), '条设置了冷却轮数'],
    [count(e => e.group_name), '条属于互斥分组'],
    [count(e => e.case_sensitive), '条要求区分大小写'],
    [count(e => e.priority != null && e.priority !== 50), '条设置了非默认优先级'],
  ];
  for (const [n, label] of pairs) if (n) out.push(`${n} ${label}`);
  return out;
}
