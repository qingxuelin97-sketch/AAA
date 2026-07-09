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
