import db from './db.js';
import { llmOnce } from './llm.js';
import { log } from './logger.js';

// —— 长会话的滚动摘要 ——
//
// 上下文加窗后，被挤出窗口的消息就此从模型视野里消失。对一段几百回合的剧情来说，
// 这等于「AI 突然失忆」——而且是渐进的、没有任何提示的失忆。摘要把窗口外的内容
// 压成一段梗概，注入在 system 之后、history 之前。
//
// 三条硬约束（都是「不能悄悄坑用户」的具体化）：
//   1. 摘要生成**不向用户计费**。用户看不见它，为看不见的东西付钱是不能接受的。
//      成本记 transactions 的 kind='summary'（金额 0，仅留痕），便于日后核算真实开销。
//   2. 摘要失败必须降级为「不摘要、只截断」，绝不能阻塞用户发消息。
//      摘要是增强，不是前置依赖。
//   3. 摘要内容对用户可见（调试台里能读到），不做黑箱。
//
// summary_upto_msg_id 记录「摘要覆盖到哪条消息为止」，单调递增，保证同一段历史
// 不被重复压缩，也保证摘要与窗口之间不出现缝隙。

const SUMMARY_SYSTEM = `你在为一段角色扮演对话做记忆梗概。请用第三人称、客观、精炼地记录：
1) 已经发生的关键事件与转折；2) 人物关系与称呼的变化；3) 已确立的设定与承诺；4) 尚未解决的悬念。
不要评价，不要续写，不要使用第一人称，不要输出与原文无关的内容。控制在 400 字以内。`;

export function getSummary(convId) {
  const row = db.prepare('SELECT summary, summary_upto_msg_id FROM conversations WHERE id = ?').get(convId);
  return { text: row?.summary || '', upto: row?.summary_upto_msg_id || 0 };
}

// 把 [上次摘要覆盖点, 窗口起点) 之间的消息压缩进摘要。
// 返回 true 表示摘要有更新；任何失败都返回 false 并留痕，调用方据此降级为纯截断。
export async function updateSummary({ convId, eff, windowStartId, userId }) {
  if (!eff || !windowStartId) return false;
  const { text: prev, upto } = getSummary(convId);
  const pending = db.prepare(
    'SELECT id, role, content FROM messages WHERE conversation_id = ? AND id > ? AND id < ? ORDER BY id',
  ).all(convId, upto, windowStartId);
  // 少量几条不值得为此调一次模型：它们本来就快被窗口重新覆盖到。
  if (pending.length < 6) return false;

  const transcript = pending
    .map(m => `${m.role === 'user' ? '用户' : '角色'}：${(m.content || '').slice(0, 1200)}`)
    .join('\n')
    .slice(0, 24000);
  const input = prev
    ? `已有梗概：\n${prev}\n\n新增对话：\n${transcript}\n\n请把新增内容合并进梗概，输出合并后的完整梗概。`
    : `对话记录：\n${transcript}`;

  try {
    const out = await llmOnce(eff, SUMMARY_SYSTEM, input, { maxTokens: 700, temperature: 0.3, timeoutMs: 30000 });
    if (!out) throw new Error('模型返回空内容');
    const lastId = pending[pending.length - 1].id;
    db.prepare('UPDATE conversations SET summary = ?, summary_upto_msg_id = ? WHERE id = ? AND COALESCE(summary_upto_msg_id,0) < ?')
      .run(out.slice(0, 4000), lastId, convId, lastId);
    // 计费口径：金额 0，只为把「平台确实花了一次模型调用」记进账本，
    // 便于日后核算真实成本。用户余额不受影响。
    try {
      db.prepare(`INSERT INTO transactions (user_id, kind, gold, diamond, memo, share_eligible)
        VALUES (?, 'summary', 0, 0, ?, 0)`).run(userId, `会话 ${convId} 滚动摘要（${pending.length} 条，平台承担）`);
    } catch { /* 留痕失败不影响摘要本身 */ }
    log({ level: 'info', source: 'server', category: 'chat', event: 'summary_updated',
      message: `会话 ${convId} 摘要已更新（压缩 ${pending.length} 条）`, user_id: userId,
      extra: { conversation_id: convId, compressed: pending.length, upto: lastId, chars: out.length } });
    return true;
  } catch (e) {
    // 关键：不抛出。摘要失败时上层继续按纯截断发送，用户照常能对话。
    log({ level: 'warn', source: 'server', category: 'chat', event: 'summary_failed',
      message: `会话 ${convId} 摘要生成失败，本轮降级为纯截断：${e.message}`, user_id: userId,
      extra: { conversation_id: convId, pending: pending.length } });
    return false;
  }
}
