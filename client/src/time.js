// Shared timestamp formatting.
//
// The server (SQLite `datetime('now')`) and the offline mock both store
// timestamps as UTC wall-clock strings like "2026-07-01 03:54:52" — no zone
// suffix. `new Date("2026-07-01 03:54:52")` parses that as *local* time, so a
// UTC+8 viewer sees every time 8 hours in the past. Parse it explicitly as UTC
// (append 'Z') so the browser renders it back in the viewer's own timezone.
export function parseTime(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  // Already carries zone info (…Z or +hh:mm / -hh:mm) → trust it as-is.
  const iso = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

// Compact "time since" for feeds/notifications: 刚刚 · N 分钟前 · N 小时前 ·
// 昨天 · then a calendar date. Falls back to '' on unparseable input.
export function timeAgo(s) {
  const d = parseTime(s);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' 小时前';
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 7) return day + ' 天前';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

// Absolute local date-time, e.g. "7月1日 11:54" — for places that want the exact
// moment rather than a relative phrase.
export function fmtDateTime(s) {
  const d = parseTime(s);
  if (!d) return s || '';
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Clock only ("14:05"), in the viewer's timezone — for chat/DM bubbles.
export function fmtClock(s) {
  const d = parseTime(s);
  if (!d) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
