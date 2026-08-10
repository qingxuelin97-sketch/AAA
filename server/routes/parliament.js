import { Router } from 'express';
import db from '../db.js';
import { authRequired, requireGm } from '../auth.js';
import { notify } from '../wallet.js';
import { creatorTier } from '../creator.js';
import { councilCfg, councilSeats, councilSize, parliamentLocked } from '../council.js';
import { log } from '../logger.js';

const router = Router();
const meRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// —— 计票口径（对外公示 / 实时进度条 / 最终判定共用这一个函数）——
//
// 两处与原实现不同，都是把代码改成与已经对外公示的规则一致：
//
// ① 阈值用 >=，不是 >。/overview 一直对外公示 { general: 0.5, special: 2/3 }，
//    前端 Parliament.jsx 也按这两个数画刻度。而判定写的是严格大于，于是
//    6 人 4 赞成（恰好 2/3）会被判成一般决议、4 人 2 赞成（恰好一半）直接算否决，
//    而用户看到的进度条明明是满格。公示了阈值就要按阈值算。
//
// ② 分母是「赞成 + 反对」，不含弃权。原来 total = votes.length 把弃权算进分母，
//    等于弃权在算术上与反对完全等价 —— 那三选一的 UI 就是在骗人。弃权的含义是
//    出席但不表态，不构成表决基数。
//
// 提案表没有决议类型列（db.js:309-315），「特别/一般」本来就是事后按比例分类，
// 判定顺序不变：先看够不够 2/3，再看够不够半数。
export const THRESHOLDS = { general: 0.5, special: 2 / 3 };

export function tallyVotes(votes) {
  const counts = { for: 0, against: 0, abstain: 0 };
  votes.forEach((v) => { if (counts[v.choice] !== undefined) counts[v.choice] += 1; });
  const cast = counts.for + counts.against;      // 表决基数：弃权不计入
  const ratio = cast ? counts.for / cast : 0;
  let status = 'failed';
  if (cast > 0 && ratio >= THRESHOLDS.special) status = 'passed_special';
  else if (cast > 0 && ratio >= THRESHOLDS.general) status = 'passed_general';
  // total 保留为「投票总人次」供展示（含弃权），cast 才是算比例用的分母。
  return { ...counts, total: votes.length, cast, ratio, status };
}

function proposalView(p, meId) {
  const votes = db.prepare('SELECT user_id, choice FROM proposal_votes WHERE proposal_id = ?').all(p.id);
  const live = tallyVotes(votes);
  const endorses = db.prepare('SELECT user_id FROM proposal_endorse WHERE proposal_id = ?').all(p.id);
  const author = db.prepare('SELECT display_name, avatar, verified FROM users WHERE id = ?').get(p.author_id);
  let tally = null; try { tally = p.tally ? JSON.parse(p.tally) : null; } catch { /* */ }
  return {
    id: p.id, title: p.title, body: p.body, status: p.status,
    author_id: p.author_id, author_name: author?.display_name || '已注销', author_avatar: author?.avatar, author_verified: !!author?.verified,
    created_at: p.created_at, adopted_at: p.adopted_at || null, decided_at: p.decided_at || null,
    live_tally: live, tally, council_size: councilSize(),
    my_vote: meId ? (votes.find(v => v.user_id === meId)?.choice || null) : null,
    endorsements: endorses.length, my_endorsed: meId ? endorses.some(e => e.user_id === meId) : false,
    comment_count: db.prepare('SELECT COUNT(*) n FROM proposal_comments WHERE proposal_id = ?').get(p.id).n,
  };
}

router.get('/overview', authRequired, (req, res) => {
  const me = meRow(req.user.id); const c = councilCfg();
  res.json({ is_councilor: !!me.is_councilor, is_gm: !!me.is_gm, council_size: councilSize(), seats: councilSeats(),
    term: c.term || 1, locked: !!c.locked, locked_at: c.locked_at || null, me_id: me.id,
    // 分母口径一并公示：前端据此写文案，免得用户以为弃权不影响结果。
    thresholds: { ...THRESHOLDS, basis: 'for_plus_against' } });
});

router.get('/councilors', authRequired, (req, res) => {
  const rows = db.prepare('SELECT id, display_name, avatar, verified FROM users WHERE is_councilor = 1').all()
    .map(u => ({ id: u.id, display_name: u.display_name, avatar: u.avatar, verified: !!u.verified, creator_tier: creatorTier(u.id) }));
  res.json({ councilors: rows, seats: councilSeats() });
});

router.get('/proposals', authRequired, (req, res) => {
  const order = { pending: 0, voting: 1, passed_special: 2, passed_general: 3, failed: 4, rejected: 5 };
  const rows = db.prepare('SELECT * FROM proposals').all()
    .sort((a, b) => ((order[a.status] ?? 9) - (order[b.status] ?? 9)) || b.id - a.id)
    .map(p => proposalView(p, req.user.id));
  res.json({ proposals: rows });
});

router.post('/proposals', authRequired, (req, res) => {
  const me = meRow(req.user.id);
  if (!me.is_councilor) return res.status(403).json({ error: '仅议员可提交提案' });
  const title = String(req.body?.title || '').trim(); const text = String(req.body?.body || '').trim();
  if (!title) return res.status(400).json({ error: '请填写提案标题' });
  if (!text) return res.status(400).json({ error: '请填写提案内容' });
  const info = db.prepare('INSERT INTO proposals (author_id, title, body, status) VALUES (?,?,?,?)').run(me.id, title.slice(0, 80), text.slice(0, 2000), 'pending');
  db.prepare('SELECT id FROM users WHERE is_gm = 1').all().forEach(g => notify(g.id, `议员「${me.display_name}」提交了新提案，待采纳：${title.slice(0, 20)}`, '/parliament'));
  log({
    level: 'info', category: 'parliament', event: 'proposal_submit',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { proposal_id: Number(info.lastInsertRowid), author_id: me.id, title: title.slice(0, 80) },
    message: `议员 ${me.id} 提交提案 ${info.lastInsertRowid}：${title.slice(0, 20)}`,
  });
  res.json({ proposal: proposalView(db.prepare('SELECT * FROM proposals WHERE id = ?').get(info.lastInsertRowid), me.id) });
});

// ---- comments (议论) — open even while the chamber is locked ----
router.get('/proposals/:id/comments', authRequired, (req, res) => {
  const p = db.prepare('SELECT id FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '议案不存在' });
  const rows = db.prepare('SELECT * FROM proposal_comments WHERE proposal_id = ? ORDER BY id').all(p.id).map(c => {
    const u = db.prepare('SELECT display_name, avatar, is_councilor FROM users WHERE id = ?').get(c.user_id);
    return { id: c.id, text: c.text, created_at: c.created_at, user_id: c.user_id, author_name: u?.display_name || '已注销', author_avatar: u?.avatar, author_councilor: !!u?.is_councilor, author_tier: creatorTier(c.user_id) };
  });
  res.json({ comments: rows });
});
router.post('/proposals/:id/comments', authRequired, (req, res) => {
  const me = meRow(req.user.id);
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '议案不存在' });
  const text = String(req.body?.text || '').trim(); if (!text) return res.status(400).json({ error: '议论内容不能为空' });
  const info = db.prepare('INSERT INTO proposal_comments (proposal_id, user_id, text) VALUES (?,?,?)').run(p.id, me.id, text.slice(0, 600));
  if (p.author_id !== me.id) notify(p.author_id, `${me.display_name} 在你的议案「${p.title.slice(0, 16)}」下发表了议论`, '/parliament');
  res.json({ comment: { id: info.lastInsertRowid, text: text.slice(0, 600), created_at: new Date().toISOString(), user_id: me.id, author_name: me.display_name, author_avatar: me.avatar, author_councilor: !!me.is_councilor, author_tier: creatorTier(me.id) } });
});
router.delete('/proposals/:id/comments/:cid', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM proposal_comments WHERE id = ?').get(req.params.cid);
  if (!c) return res.status(404).json({ error: '议论不存在' });
  if (c.user_id !== req.user.id && !req.user.is_gm) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM proposal_comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---- mutations blocked while locked (except comments above) ----
function ensureUnlocked(req, res, next) { if (parliamentLocked()) return res.status(403).json({ error: '议会休会中，暂停一切议事' }); next(); }

router.post('/proposals/:id/endorse', authRequired, ensureUnlocked, (req, res) => {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '提案不存在' });
  const ex = db.prepare('SELECT id FROM proposal_endorse WHERE proposal_id = ? AND user_id = ?').get(p.id, req.user.id);
  if (ex) db.prepare('DELETE FROM proposal_endorse WHERE id = ?').run(ex.id);
  else db.prepare('INSERT INTO proposal_endorse (proposal_id, user_id) VALUES (?,?)').run(p.id, req.user.id);
  res.json({ proposal: proposalView(p, req.user.id) });
});

router.post('/proposals/:id/vote', authRequired, ensureUnlocked, (req, res) => {
  const me = meRow(req.user.id);
  if (!me.is_councilor) return res.status(403).json({ error: '仅议员可参与表决' });
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '提案不存在' });
  if (p.status !== 'voting') return res.status(400).json({ error: '该提案当前不在表决阶段' });
  const choice = req.body?.choice;
  if (!['for', 'against', 'abstain'].includes(choice)) return res.status(400).json({ error: '无效的表决选项' });
  const ex = db.prepare('SELECT id FROM proposal_votes WHERE proposal_id = ? AND user_id = ?').get(p.id, me.id);
  if (ex) db.prepare('UPDATE proposal_votes SET choice = ? WHERE id = ?').run(choice, ex.id);
  else db.prepare('INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?,?,?)').run(p.id, me.id, choice);
  res.json({ proposal: proposalView(p, me.id) });
});

router.post('/proposals/:id/adopt', authRequired, requireGm, ensureUnlocked, (req, res) => {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '提案不存在' });
  if (p.status !== 'pending') return res.status(400).json({ error: '只有「待采纳」状态的提案可被采纳' });
  db.prepare("UPDATE proposals SET status='voting', adopted_at=datetime('now') WHERE id=?").run(p.id);
  notify(p.author_id, `你的提案「${p.title.slice(0, 20)}」已被采纳，进入议会表决阶段。`, '/parliament');
  db.prepare('SELECT id FROM users WHERE is_councilor = 1').all().forEach(c => notify(c.id, `新提案进入表决：「${p.title.slice(0, 20)}」，请前往议会投票。`, '/parliament'));
  log({
    level: 'info', category: 'parliament', event: 'proposal_adopt',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { proposal_id: p.id, author_id: p.author_id, title: p.title.slice(0, 80) },
    message: `GM ${req.user.id} 采纳提案 ${p.id} 进入表决`,
  });
  res.json({ proposal: proposalView(db.prepare('SELECT * FROM proposals WHERE id=?').get(p.id), req.user.id) });
});

router.post('/proposals/:id/reject', authRequired, requireGm, ensureUnlocked, (req, res) => {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '提案不存在' });
  if (p.status !== 'pending' && p.status !== 'voting') return res.status(400).json({ error: '该提案无法驳回' });
  db.prepare("UPDATE proposals SET status='rejected', decided_at=datetime('now') WHERE id=?").run(p.id);
  notify(p.author_id, `你的提案「${p.title.slice(0, 20)}」未获采纳。`, '/parliament');
  log({
    level: 'info', category: 'parliament', event: 'proposal_reject',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { proposal_id: p.id, author_id: p.author_id, title: p.title.slice(0, 80) },
    message: `GM ${req.user.id} 驳回提案 ${p.id}`,
  });
  res.json({ proposal: proposalView(db.prepare('SELECT * FROM proposals WHERE id=?').get(p.id), req.user.id) });
});

router.post('/proposals/:id/close', authRequired, requireGm, ensureUnlocked, (req, res) => {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '提案不存在' });
  if (p.status !== 'voting') return res.status(400).json({ error: '只有表决中的提案可以计票结束' });
  const votes = db.prepare('SELECT choice FROM proposal_votes WHERE proposal_id = ?').all(p.id);
  const tally = tallyVotes(votes);
  const { status, ratio, total } = tally;
  db.prepare("UPDATE proposals SET status=?, tally=?, decided_at=datetime('now') WHERE id=?").run(status, JSON.stringify(tally), p.id);
  const label = status === 'passed_special' ? '特别决议通过' : status === 'passed_general' ? '一般决议通过' : '未获通过';
  notify(p.author_id, `提案「${p.title.slice(0, 20)}」表决结束：${label}（赞成率 ${Math.round(ratio * 100)}%）。`, '/parliament');
  log({
    level: 'info', category: 'parliament', event: 'proposal_close',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { proposal_id: p.id, author_id: p.author_id, status, tally, title: p.title.slice(0, 80) },
    message: `GM ${req.user.id} 计票结束提案 ${p.id}：${label}（赞成率 ${Math.round(ratio * 100)}%）`,
  });
  res.json({ proposal: proposalView(db.prepare('SELECT * FROM proposals WHERE id=?').get(p.id), req.user.id) });
});

router.delete('/proposals/:id', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '提案不存在' });
  if (!req.user.is_gm && !(p.author_id === req.user.id && p.status === 'pending')) return res.status(403).json({ error: '无权删除该提案' });
  db.prepare('DELETE FROM proposals WHERE id = ?').run(p.id);
  db.prepare('DELETE FROM proposal_votes WHERE proposal_id = ?').run(p.id);
  db.prepare('DELETE FROM proposal_endorse WHERE proposal_id = ?').run(p.id);
  db.prepare('DELETE FROM proposal_comments WHERE proposal_id = ?').run(p.id);
  res.json({ ok: true });
});

export default router;
