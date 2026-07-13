export function messageId(message) {
  const n = Number(message?.id);
  return Number.isFinite(n) ? n : 0;
}

export function mergeMessages(current, incoming) {
  const byId = new Map();
  for (const message of [...current, ...(incoming || [])]) {
    const key = message?.id != null
      ? String(message.id)
      : `${message?.user_id || ''}:${message?.created_at || ''}:${message?.content || ''}`;
    byId.set(key, { ...(byId.get(key) || {}), ...message });
  }
  return [...byId.values()].sort((a, b) => {
    const ai = messageId(a), bi = messageId(b);
    if (ai && bi && ai !== bi) return ai - bi;
    const at = Date.parse(a.created_at || 0), bt = Date.parse(b.created_at || 0);
    return at - bt || String(a.id || '').localeCompare(String(b.id || ''));
  });
}
