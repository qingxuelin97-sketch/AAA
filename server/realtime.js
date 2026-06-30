// 实时推送中心（SSE）—— 单进程内存路由表，零依赖。
//
// 每个在线用户持有一条 SSE 长连接（见 routes/realtime.js 的 /stream）。
// 业务路由在产生事件时调用 push / broadcast，秒级下发到在线客户端：
//   · 私聊 DM：发消息后 push 给收件人
//   · 好友：申请 / 通过时 push 给对方
//   · 通知：notify() 写库后 push 给本人
//   · 新角色卡：发布公开角色时 broadcast 给所有人
//
// 不在线的用户不会有连接，push 直接返回 false —— 业务侧无需关心对方是否在线，
// 通知仍已落库，下次拉取 / 打开页面时仍能看到。SSE 只负责「即时触达」。

import db from './db.js';

// userId -> Set<res>。同一用户多标签页会有多条连接。
const clients = new Map();
const touchStmt = db.prepare('UPDATE users SET last_active = ? WHERE id = ?');

// 注入一条 SSE 连接，返回 detach 函数（连接关闭时调用以清理）。
export function attach(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  const set = clients.get(userId);
  set.add(res);
  // 心跳：每 25s 写一条 SSE 注释行，防代理/浏览器闲置断连；
  // 同时刷新 last_active，让好友看到的在线状态与 SSE 连接同寿命。
  const hb = setInterval(() => {
    try { res.write(': hb\n\n'); } catch { /* socket gone */ }
    try { touchStmt.run(Date.now(), userId); } catch { /* */ }
  }, 25000);
  return () => {
    clearInterval(hb);
    const s = clients.get(userId);
    if (!s) return;
    s.delete(res);
    if (!s.size) clients.delete(userId);
  };
}

// 给单个用户推送事件。返回是否触达（在线即 true）。
export function push(userId, event, data) {
  const set = clients.get(userId);
  if (!set || !set.size) return false;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* drop stale */ }
  }
  return true;
}

// 广播给所有在线用户（可排除某个用户，如发布者本人）。
export function broadcast(event, data, exceptUserId = null) {
  if (!clients.size) return 0;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
  let n = 0;
  for (const [uid, set] of clients) {
    if (exceptUserId != null && uid === exceptUserId) continue;
    for (const res of set) {
      try { res.write(payload); n++; } catch { /* drop stale */ }
    }
  }
  return n;
}

export function onlineCount() { return clients.size; }
export function isUserOnline(userId) {
  const s = clients.get(userId);
  return !!(s && s.size);
}
