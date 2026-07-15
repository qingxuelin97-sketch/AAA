export const MAX_RECONNECT_DELAY_MS = 30000;

// Realtime never gives up permanently. Exponential backoff is capped for
// battery/network safety, while a small jitter prevents a device fleet from
// reconnecting in lockstep after an outage.
export function reconnectDelay(attempt, random = Math.random) {
  const safeAttempt = Math.max(1, Math.min(Number(attempt) || 1, 6));
  const base = Math.min(1000 * (2 ** safeAttempt), MAX_RECONNECT_DELAY_MS);
  const jitter = 0.85 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.3;
  return Math.round(base * jitter);
}
