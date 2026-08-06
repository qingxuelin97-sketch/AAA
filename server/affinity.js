import db from './db.js';
import { dailyOf } from './daily.js';
import { notify } from './wallet.js';

// 关系等级表（服务端权威）。client/src/chat/constants.js AFFINITY_LEVELS 是它的
// 展示镜像，两边阈值必须同步；成就阈值（aff_close 100「亲近」/ aff_love 250
// 「挚爱」，见 routes/achievements.js）也依赖这些命名与档位。
export const AFFINITY_LEVELS = [
  { min: 0, name: '初识' }, { min: 10, name: '相识' }, { min: 30, name: '熟悉' },
  { min: 60, name: '友好' }, { min: 100, name: '亲近' }, { min: 160, name: '信赖' },
  { min: 250, name: '挚爱' },
];

// 每日好感增量上限：对话（+3/条回复）与礼物共享同一配额，防脚本刷好感把
// 成就与后续基于关系的玩法刷穿。已获得量记在 daily_progress.counts.affinity_gain，
// 随日期自然重置（北京时间口径，见 daily.js cnToday）。
export const AFFINITY_DAILY_CAP = 40;

export function affinityLevel(v) {
  let idx = 0;
  for (let i = 0; i < AFFINITY_LEVELS.length; i++) if ((v || 0) >= AFFINITY_LEVELS[i].min) idx = i;
  return { level: idx + 1, name: AFFINITY_LEVELS[idx].name };
}

// 今日剩余可获得好感（对话与礼物共享）。
export function affinityRemainingToday(userId) {
  const gained = dailyOf(userId).counts.affinity_gain || 0;
  return Math.max(0, AFFINITY_DAILY_CAP - gained);
}

// 服务端唯一的好感发放口。日上限内截断发放；跨级时站内信 + SSE 提示。
// 返回 { granted, affinity, level, levelName, levelUp }；granted=0 = 今日配额已满。
export function grantAffinity(userId, convId, amount, characterName = '') {
  let result = null;
  db.transaction(() => {
    const remaining = affinityRemainingToday(userId);
    const granted = Math.max(0, Math.min(Math.floor(amount) || 0, remaining));
    const before = db.prepare('SELECT COALESCE(affinity,0) a FROM conversations WHERE id = ?').get(convId)?.a || 0;
    if (granted > 0) {
      db.prepare('UPDATE conversations SET affinity = COALESCE(affinity,0) + ? WHERE id = ?').run(granted, convId);
      const d = dailyOf(userId);
      d.counts.affinity_gain = (d.counts.affinity_gain || 0) + granted;
      db.prepare('UPDATE daily_progress SET counts = ? WHERE user_id = ?').run(JSON.stringify(d.counts), userId);
    }
    const after = before + granted;
    const lv = affinityLevel(after);
    result = { granted, affinity: after, level: lv.level, levelName: lv.name,
      levelUp: granted > 0 && lv.level > affinityLevel(before).level };
  })();
  // 通知在事务外发（notify 内含 SSE 推送，不应被回滚牵连）。
  if (result.levelUp && characterName) {
    notify(userId, `你与「${characterName}」的关系升级为「${result.levelName}」`, `/chats/${convId}`);
  }
  return result;
}

// 供 buildSystemPrompt 注入：把关系阶段 + 长期记忆折成一段服务端权威的提示词。
// 仅在服务端组装，客户端无法伪造或越级。
export function affinityPromptFor(conv) {
  if (!conv) return [];
  const parts = [];
  const aff = conv.affinity || 0;
  const lv = affinityLevel(aff);
  parts.push(`【关系状态】你与用户当前的关系等级：${lv.level} 级「${lv.name}」（累计好感 ${aff}）。请让称呼、语气与亲密度符合这一阶段：等级低时保持礼貌与适当距离感，等级越高越亲昵、信任、主动，可自然提及你们的共同经历。关系只随长期相处缓慢演进，不要在对话中自行跳级或降级。`);
  let mems = [];
  try { mems = JSON.parse(conv.memories || '[]'); } catch { /* */ }
  if (Array.isArray(mems) && mems.length) {
    const lines = mems.slice(0, 20).map(m => '- ' + String(m?.content || '').slice(0, 300)).filter(l => l.length > 2);
    if (lines.length) parts.push(`【长期记忆】你记得关于用户的这些事，请在合适的时机自然体现（不要机械罗列）：\n${lines.join('\n')}`);
  }
  return parts;
}
