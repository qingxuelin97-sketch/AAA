// 对话页共享常量与好感度工具 —— 从 Chat.jsx 抽出，供 Chat / 各子组件复用。

// 「+」面板 · 送礼物：礼物名 + emoji，选中后以 RP 动作发给角色（角色会在剧情里回应）。
export const GIFTS = [
  { e: '🌹', n: '一枝红玫瑰' }, { e: '🍰', n: '一块草莓蛋糕' }, { e: '☕', n: '一杯热咖啡' },
  { e: '🧸', n: '一只小熊玩偶' }, { e: '💌', n: '一封手写信' }, { e: '🎁', n: '一份神秘礼物' },
  { e: '🌙', n: '一枚月亮吊坠' }, { e: '🍬', n: '一把水果糖' },
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
export const QUICK_ACTIONS = ['*微笑*', '*点头*', '*脸红*', '*轻笑*', '*歪头*', '*叹气*', '*眨眨眼*', '*沉默不语*', '*牵起你的手*', '*轻轻拥抱*', '😊', '😳', '🥰', '😢'];

// localStorage 键名（对话页偏好）。
export const LIST_KEY = 'huanyu_chatlist_mini';
export const FONT_KEY = 'huanyu_chat_font';
export const AUTOREAD_KEY = 'huanyu_chat_autoread';
export const BGM_KEY = 'huanyu_chat_bgm';
export const BUBBLE_ALPHA_KEY = 'huanyu_bubble_alpha';

// 触屏设备上不显示「Enter 发送」这类键鼠提示——占位符过长会在窄输入框里折行溢出。
export const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// 关系等级：由累计好感值驱动（每次对话约 +3）。
export const AFFINITY_LEVELS = [
  { min: 0, name: '初识', icon: '🌱' }, { min: 10, name: '相识', icon: '🌿' },
  { min: 30, name: '熟悉', icon: '☕' }, { min: 60, name: '友好', icon: '😊' },
  { min: 100, name: '亲近', icon: '💗' }, { min: 160, name: '信赖', icon: '✨' },
  { min: 250, name: '挚爱', icon: '💖' },
];

export function affinityInfo(v) {
  v = v || 0; let idx = 0;
  for (let i = 0; i < AFFINITY_LEVELS.length; i++) if (v >= AFFINITY_LEVELS[i].min) idx = i;
  const cur = AFFINITY_LEVELS[idx], next = AFFINITY_LEVELS[idx + 1];
  const pct = next ? Math.min(100, Math.round((v - cur.min) / (next.min - cur.min) * 100)) : 100;
  return { level: idx + 1, name: cur.name, icon: cur.icon, pct, value: v, nextAt: next ? next.min : null };
}
