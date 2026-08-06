// 对话页共享常量与好感度工具 —— 从 Chat.jsx 抽出，供 Chat / 各子组件复用。

// 「+」面板 · 送礼物：真金币消耗（服务端扣款 + RP 消息 + 加好感同事务）。
// 展示镜像：价格与好感增量以 server/routes/chat.js GIFT_CATALOG 为权威，
// 两边必须同步。好感与对话共享每日配额，打满后礼物照送、好感 +0。
export const GIFTS = [
  { id: 'candy',   e: '🍬', n: '一把水果糖',   price: 10 },
  { id: 'rose',    e: '🌹', n: '一枝红玫瑰',   price: 20 },
  { id: 'coffee',  e: '☕', n: '一杯热咖啡',   price: 30 },
  { id: 'cake',    e: '🍰', n: '一块草莓蛋糕', price: 50 },
  { id: 'letter',  e: '💌', n: '一封手写信',   price: 60 },
  { id: 'bear',    e: '🧸', n: '一只小熊玩偶', price: 100 },
  { id: 'pendant', e: '🌙', n: '一枚月亮吊坠', price: 300 },
  { id: 'mystery', e: '🎁', n: '一份神秘礼物', price: 500 },
];

// 随机事件：注入一个剧情转折，让 AI 顺着演（互动添趣的核心玩法）。
export const RANDOM_EVENTS = [
  '窗外突然下起了倾盆大雨', '远处传来一阵急促的敲门声', '灯光忽然闪烁了几下熄灭了',
  '一只猫不知从哪里跳了进来', '收音机里传来一则奇怪的新闻', '天边划过一道流星',
  '空气中飘来一阵熟悉的香味', '地面轻轻震动了一下', '门缝下被塞进来一张纸条',
  '时钟的指针突然开始倒转',
];

export const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
export const STARTERS = ['你好呀～', '很高兴认识你！', '*微笑着向你打招呼*', '今天过得怎么样？', '我们聊点什么好呢？'];
// 推荐动作短语已按需求移除，表情面板只保留 emoji 快捷插入。
export const QUICK_ACTIONS = ['😊', '😳', '🥰', '😢', '😂', '😮', '🤔', '😴', '❤️', '✨'];

// localStorage 键名（对话页偏好）。
export const LIST_KEY = 'huanyu_chatlist_mini';
export const FONT_KEY = 'huanyu_chat_font';
export const AUTOREAD_KEY = 'huanyu_chat_autoread';
export const BGM_KEY = 'huanyu_chat_bgm';
export const BUBBLE_ALPHA_KEY = 'huanyu_bubble_alpha';

// 触屏设备上不显示「Enter 发送」这类键鼠提示——占位符过长会在窄输入框里折行溢出。
export const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// 关系等级：由累计好感值驱动（每次对话约 +3，每日上限与礼物共享）。
// 展示镜像：阈值与命名以 server/affinity.js AFFINITY_LEVELS 为权威，两边必须同步。
export const AFFINITY_LEVELS = [
  { min: 0, name: '初识', icon: '🌱' }, { min: 10, name: '相识', icon: '🌿' },
  { min: 30, name: '熟悉', icon: '☕' }, { min: 60, name: '友好', icon: '😊' },
  { min: 100, name: '亲近', icon: '💗' }, { min: 160, name: '信赖', icon: '✨' },
  { min: 250, name: '挚爱', icon: '💖' },
];

// 时间分隔：相邻两条消息间隔 > 阈值（默认 10min）时返回分隔标签，否则 null。
// created_at 为服务端 'YYYY-MM-DD HH:MM:SS'（本地化展示只取到分钟；跨天带日期）。
export function timeDivider(prevAt, curAt, gapMin = 10) {
  if (!curAt) return null;
  const cur = new Date(String(curAt).replace(' ', 'T'));
  if (isNaN(cur)) return null;
  const hhmm = String(curAt).slice(11, 16);
  if (!prevAt) return hhmm;   // 会话首条也给一个时间锚
  const prev = new Date(String(prevAt).replace(' ', 'T'));
  if (isNaN(prev)) return null;
  if (cur - prev < gapMin * 60 * 1000) return null;
  const sameDay = String(prevAt).slice(0, 10) === String(curAt).slice(0, 10);
  return sameDay ? hhmm : `${String(curAt).slice(5, 10)} ${hhmm}`;
}

export function affinityInfo(v) {
  v = v || 0; let idx = 0;
  for (let i = 0; i < AFFINITY_LEVELS.length; i++) if (v >= AFFINITY_LEVELS[i].min) idx = i;
  const cur = AFFINITY_LEVELS[idx], next = AFFINITY_LEVELS[idx + 1];
  const pct = next ? Math.min(100, Math.round((v - cur.min) / (next.min - cur.min) * 100)) : 100;
  return { level: idx + 1, name: cur.name, icon: cur.icon, pct, value: v, nextAt: next ? next.min : null };
}
