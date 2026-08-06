// 通用输入校验 / 规整小工具——替代各路由里重复手写的 str / clampInt / csv 等，
// 行为与原有内联实现等价（不改变对外语义），仅收敛为单一实现便于一致维护。

// 字符串裁剪：null/undefined → ''，否则转字符串并截断到 max 长度。
export const str = (v, max = 500) => (v == null ? '' : String(v).slice(0, max));

// 整数夹紧：解析失败回落 def；否则夹到 [lo, hi]。
export const clampInt = (v, lo, hi, def = lo) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

// 宽松布尔：true / 1 / '1' / 'true' 视为真。
export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

// CSV（逗号分隔标签/关键词）→ 数组：拆分、去空白、去空项（保持原顺序与重复，与旧实现一致）。
export const csv = (v) => String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);

// —— 以下为防呆加固新增原语。上方四个导出的语义保持不变（47 处调用依赖其确切行为）。——

// 客户端错误：带 expose 标记，交由 index.js 的统一错误处理返回 400 而非通用 500。
export const badRequest = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });

// 枚举收敛：不在白名单内一律回落默认值。用于 privacy_profile / allow_dm 这类
// 由迁移添加、无 DB 约束、存量行可能是任意字符串的列。
export const oneOf = (v, allowed, def) => (allowed.includes(v) ? v : def);

// 数值夹紧（区别于 clampInt：保留小数，用于 temperature 这类浮点配置）。
// 关键：不能用裸 Number(v) —— Number([]) === 0、Number(null) === 0 会让
// `llm_temperature: []` 静默通过。只接受真数字或非空白数字字符串。
export const num = (v, lo, hi, def) => {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim() !== '') n = Number(v);
  else return def;
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
};

// 用户对象 → JSON 文本，带体积上限。
// 裸 JSON.stringify 对深层嵌套会抛 RangeError（V8 约 2 万层），对循环引用会抛
// TypeError —— 未捕获即变成 500。这里统一转成 400，杜绝「离谱 JSON 打崩接口」。
export const jsonText = (v, maxBytes = 32768) => {
  if (v == null) return '';
  let s;
  try { s = JSON.stringify(v); } catch { throw badRequest('数据结构过于复杂或含循环引用'); }
  if (typeof s !== 'string') return '';
  if (Buffer.byteLength(s, 'utf8') > maxBytes) throw badRequest(`数据过大（上限 ${Math.floor(maxBytes / 1024)}KB）`);
  return s;
};

// —— 正则安全（ReDoS 防护）——
// 世界书 regex 键由角色/世界书作者自填，对所有与之聊天的用户生效；灾难性回溯
// 的模式（如 (a+)+b）能把 Node 单线程的事件循环钉死数十秒 —— 实测 Node 22 上
// /(a+)+b/i.test('a'.repeat(24)+'!') 30 秒未返回。try/catch 只能挡语法错误，
// 挡不住回溯。这里用「保守白名单式静态分析 + 经验探针」双保险，不引入 RE2。

const REGEX_MAX_SOURCE = 120;   // 模式长度上限
const REGEX_MAX_DEPTH = 3;      // 分组嵌套深度上限
const REGEX_MAX_UNBOUNDED = 3;  // 无界量词（* + {n,}）总数上限
const REGEX_MAX_REPEAT = 100;   // {n,m} 的 n / m 上限

// —— 粗粒度字符集模型（仅用于「相邻量词是否真的有歧义」判定）——
// ASCII 用位表；非 ASCII 统一压成一个 other 标志。宁可判「可能相交」（保守）
// 也不漏判：相交 → 拒绝，不相交 → 放行。
const csNew = () => ({ a: new Uint8Array(128), other: false });
const csAll = () => { const s = csNew(); s.a.fill(1); s.other = true; return s; };
const csAddChar = (s, code) => { if (code < 128) s.a[code] = 1; else s.other = true; };
const csAddRange = (s, lo, hi) => { for (let c = lo; c <= hi && c < 128; c++) s.a[c] = 1; };
const csUnion = (dst, src) => { for (let c = 0; c < 128; c++) if (src.a[c]) dst.a[c] = 1; if (src.other) dst.other = true; };
const csNegate = (s) => { const r = csNew(); for (let c = 0; c < 128; c++) r.a[c] = s.a[c] ? 0 : 1; r.other = true; return r; };
// 两个字符集是否可能相交。双方都可能匹配非 ASCII 时保守判定为相交。
const csIntersects = (x, y) => {
  if (x.other && y.other) return true;
  for (let c = 0; c < 128; c++) if (x.a[c] && y.a[c]) return true;
  return false;
};
// 转义序列在字符类外/内的字面码点（用于 [a-z] 这类区间端点）。
const ESC_LITERAL = { n: 10, r: 13, t: 9, f: 12, v: 11, 0: 0 };
// 转义序列 → 字符集。未知/零宽/Unicode 转义一律按「全集」处理（保守）。
function escCharset(e) {
  const s = csNew();
  switch (e) {
    case 'd': csAddRange(s, 48, 57); return s;
    case 'D': return csNegate(escCharset('d'));
    case 'w': csAddRange(s, 48, 57); csAddRange(s, 65, 90); csAddRange(s, 97, 122); csAddChar(s, 95); return s;
    case 'W': return csNegate(escCharset('w'));
    case 's': for (const c of [9, 10, 11, 12, 13, 32]) csAddChar(s, c); s.other = true; return s; // Unicode 空白
    case 'S': return csNegate(escCharset('s'));
    case 'b': case 'B':                       // 零宽断言：无法归约为字符集
    case 'u': case 'x': case 'p': case 'P': case 'k': return csAll();
    default:
      csAddChar(s, e in ESC_LITERAL ? ESC_LITERAL[e] : e.charCodeAt(0));
      return s;
  }
}
// 解析字符类 [...] 的字符集。start 指向 '['，返回 { set, end }（end 指向 ']' 之后）。
function classCharset(src, start) {
  const s = csNew();
  let j = start + 1;
  const neg = src[j] === '^';
  if (neg) j++;
  let first = true;
  // 读一个类内原子，返回 { set, code }；code < 0 表示不是单字符（不能作区间端点）。
  const takeAtom = () => {
    if (src[j] === '\\' && j + 1 < src.length) {
      const e = src[j + 1]; j += 2;
      const isClass = 'dDwWsSbBuxpPk'.includes(e);
      return { set: escCharset(e), code: isClass ? -1 : (e in ESC_LITERAL ? ESC_LITERAL[e] : e.charCodeAt(0)) };
    }
    const code = src.charCodeAt(j); j += 1;
    const one = csNew(); csAddChar(one, code);
    return { set: one, code };
  };
  while (j < src.length && !(src[j] === ']' && !first)) {
    first = false;
    const a = takeAtom();
    if (src[j] === '-' && j + 1 < src.length && src[j + 1] !== ']' && a.code >= 0) {
      j++;
      const b = takeAtom();
      if (b.code >= 0 && b.code >= a.code) { csAddRange(s, a.code, b.code); continue; }
      csUnion(s, a.set); csAddChar(s, 45); csUnion(s, b.set); continue;
    }
    csUnion(s, a.set);
  }
  return { set: neg ? csNegate(s) : s, end: j + 1 };
}

// 静态分析：只放行能确定为线性时间的模式，无法分析的一律拒绝。
// 灾难性回溯需要三种形状之一：
//   ① 量词作用在「内部含量词或含 | 的分组」上 —— (a+)+ / (a|a)+ / (a|ab)*
//      这是唯一能造成「指数级」爆炸的形状，无条件拒绝。
//   ② 相邻的被量词修饰、且字符集相交的原子 —— a+a+ / \w+\d+
//      仅当字符集真的相交才有歧义；\s*\d+ 这类不相交的组合是线性的，放行。
//      （相交时最坏是多项式 O(n²)，配合 2000 字扫描上限与总预算仍可控，但拒绝更稳。）
//   ③ 巨大的有界重复 —— a{5000}
export function isLinearRegex(source) {
  if (typeof source !== 'string') return false;
  if (source.length < 1 || source.length > REGEX_MAX_SOURCE) return false;
  // 无法静态推理的构造：前后瞻、命名组、反向引用。
  if (/\(\?<?[=!]/.test(source)) return false;
  if (/\(\?<[A-Za-z_$]/.test(source)) return false;
  if (/\\[1-9]/.test(source)) return false;
  if (/\\k</.test(source)) return false;

  let unbounded = 0;
  const frame = () => ({ hasQuant: false, hasAlt: false, prevQuantified: false, prevAtom: null, curAtom: null, curQuantified: false });
  const stack = [frame()];
  const top = () => stack[stack.length - 1];
  // 收束一个原子：把「当前原子及其是否被量词修饰」左移一位，供相邻量词检测使用。
  const pushAtom = (atom) => {
    const f = top();
    f.prevQuantified = f.curQuantified;
    f.prevAtom = f.curAtom;
    f.curAtom = atom;
    f.curQuantified = false;
  };
  // 应用一个量词到当前原子。返回 false 表示判定为危险/非法。
  const applyQuant = (isUnbounded) => {
    const f = top();
    if (!f.curAtom) return false;                                   // 形如 *abc，非法
    if (f.curQuantified) return false;                              // a++ 之类（惰性 ? 已在调用处单独处理）
    if (f.curAtom.isGroup && f.curAtom.groupHadQuantOrAlt) return false; // ① (a+)+ / (a|a)+
    // ② 相邻量词：仅当两者字符集可能相交才有歧义。\s*\d+ 不相交 → 放行。
    if (f.prevQuantified && f.prevAtom && csIntersects(f.prevAtom.set, f.curAtom.set)) return false;
    if (isUnbounded && ++unbounded > REGEX_MAX_UNBOUNDED) return false;
    f.curQuantified = true;
    f.hasQuant = true;
    return true;
  };

  let i = 0;
  while (i < source.length) {
    const c = source[i];

    if (c === '\\') {                       // 转义序列：整体视为一个原子
      if (i + 1 >= source.length) return false;
      const set = escCharset(source[i + 1]);
      i += 2; pushAtom({ isGroup: false, set }); continue;
    }
    if (c === '[') {                        // 字符类：整体视为一个原子
      const { set, end } = classCharset(source, i);
      if (end > source.length) return false; // 未闭合
      i = end; pushAtom({ isGroup: false, set }); continue;
    }
    if (c === '(') {
      let j = i + 1;
      if (source[j] === '?') {              // 仅允许非捕获组；其余 (?...) 前面已拒
        if (source[j + 1] !== ':') return false;
        j += 2;
      }
      stack.push(frame());
      if (stack.length - 1 > REGEX_MAX_DEPTH) return false;
      i = j; continue;
    }
    if (c === ')') {
      if (stack.length === 1) return false; // 括号不配对
      const g = stack.pop();
      // 分组内容不做字符集归约 —— 按全集处理（保守：与任何量词原子相邻都判相交）。
      pushAtom({ isGroup: true, groupHadQuantOrAlt: g.hasQuant || g.hasAlt, set: csAll() });
      i++; continue;
    }
    if (c === '|') {
      const f = top();
      f.hasAlt = true; f.prevQuantified = false; f.prevAtom = null; f.curAtom = null; f.curQuantified = false;
      i++; continue;
    }
    if (c === '*' || c === '+') {
      if (!applyQuant(true)) return false;
      i++; continue;
    }
    if (c === '?') {
      const f = top();
      // 紧跟量词的 ? 是惰性修饰符（a*?），不构成新的量词。
      if (f.curQuantified) { i++; continue; }
      if (!applyQuant(false)) return false;
      i++; continue;
    }
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (!m) { const s = csNew(); csAddChar(s, 123); i++; pushAtom({ isGroup: false, set: s }); continue; } // 非量词形态的 { 当字面量
      const lo = parseInt(m[1], 10);
      const hi = m[2] === undefined ? lo : (m[3] === '' ? Infinity : parseInt(m[3], 10));
      if (lo > REGEX_MAX_REPEAT) return false;
      if (Number.isFinite(hi) && hi > REGEX_MAX_REPEAT) return false;
      if (!applyQuant(!Number.isFinite(hi))) return false;
      i += m[0].length; continue;
    }
    // 普通字符 / . / ^ / $：'.' 视为全集，其余为该字面字符。
    {
      const s = c === '.' ? csAll() : csNew();
      if (c !== '.') csAddChar(s, source.charCodeAt(i));
      i++; pushAtom({ isGroup: false, set: s });
    }
  }
  return stack.length === 1;                // 括号必须闭合
}

// 编译缓存：值为 RegExp 或 null（null = 已判定不安全）。
// 键用 flags + '/' + source —— flags 取值域是 [dgimsuvy]，绝不含 '/'，故无歧义。
const RE_CACHE = new Map();
const RE_CACHE_MAX = 2000;
// 探针串：末尾的 '!' 让 (a+)+b 这类模式必然失配，从而走满回溯路径。
// n=22 时即便完全指数级也只有约 4M 步 —— 探针自身永不挂住；线性模式则是微秒级。
const CANARY = 'a'.repeat(22) + '!' + 'ab'.repeat(11) + '!';
const CANARY_BUDGET_MS = 50;

// 安全编译：静态分析 + 语法校验 + 经验探针。任一不过返回 null（调用方按「不命中」处理）。
export function compileSafeRegex(source, flags = '') {
  const key = flags + '/' + source;
  if (RE_CACHE.has(key)) return RE_CACHE.get(key);
  let re = null;
  if (isLinearRegex(source)) {
    try {
      const candidate = new RegExp(source, flags);
      // 兜住静态分析的漏网之鱼：实测一次，超时即判定不安全。
      const t0 = performance.now();
      candidate.test(CANARY);
      if (performance.now() - t0 <= CANARY_BUDGET_MS) re = candidate;
    } catch { re = null; }                 // 语法错误 —— 与旧行为一致，视为不命中
  }
  if (RE_CACHE.size >= RE_CACHE_MAX) RE_CACHE.delete(RE_CACHE.keys().next().value);
  RE_CACHE.set(key, re);
  return re;
}

// —— 运行时预算：静态分析之外的第二道闸 ——
// 分析器只保证「不是指数级」，不保证「便宜」：a.*b 这类模式在 n 长的文本上是
// O(n²)（4000 字 ≈ 1600 万步）。单条不致命，但一本世界书可以有几百条 —— 累加
// 起来足以让单个请求把事件循环占住数秒（压测实测 6.9s）。
// 因此每次请求共享一份「条数上限 + 墙钟预算」，超出即停止匹配（按不命中处理）。
export function regexBudget({ maxEvals = 64, budgetMs = 25 } = {}) {
  const t0 = performance.now();
  let evals = 0, blown = false;
  const rejected = [];
  return {
    // 返回 true=命中；不安全模式、超预算一律 false。
    test(key, text, flags = '') {
      if (!key) return false;
      if (++evals > maxEvals || performance.now() - t0 > budgetMs) { blown = true; return false; }
      const re = compileSafeRegex(key, flags);
      if (!re) { rejected.push(key); return false; }
      return re.test(text);
    },
    get blown() { return blown; },
    get rejected() { return rejected; },
  };
}
