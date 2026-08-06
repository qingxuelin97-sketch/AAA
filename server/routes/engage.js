import { Router } from 'express';
import db from '../db.js';
import { authRequired, authOptional } from '../auth.js';
import { contentLimiter } from '../limiters.js';
import { applyTx, notify } from '../wallet.js';
import { DAILY_TASKS, dailyOf, saveClaimed } from '../daily.js';
import { creatorTier } from '../creator.js';

const router = Router();
const TT = (t) => (t === 'script' ? 'script' : 'character');

// ---- daily tasks ----
// Compatibility no-op: no client-declared action may advance an economic
// reward. Every supported task, including gacha, is bumped by its authoritative
// server route after the real operation commits.
router.post('/track', authRequired, contentLimiter, (req, res) => {
  res.json({ ok: true });
});
router.get('/tasks', authRequired, (req, res) => {
  const d = dailyOf(req.user.id);
  const tasks = DAILY_TASKS.map(t => {
    const cnt = d.counts[t.key] || 0;
    return { id: t.id, name: t.name, target: t.target, reward: t.reward, progress: Math.min(cnt, t.target), done: cnt >= t.target, claimed: d.claimed.includes(t.id) };
  });
  res.json({ tasks, all_claimed: tasks.every(t => t.claimed), claimable: tasks.filter(t => t.done && !t.claimed).length });
});
router.post('/tasks/:id/claim', authRequired, (req, res) => {
  const t = DAILY_TASKS.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  // 用事务包住「检查-标记-发奖」，防并发重复领取。
  let result = null;
  const tx = db.transaction(() => {
    const d = dailyOf(req.user.id);
    if ((d.counts[t.key] || 0) < t.target) return res.status(400).json({ error: '任务尚未完成' });
    if (d.claimed.includes(t.id)) return res.status(400).json({ error: '该奖励已领取' });
    d.claimed.push(t.id); saveClaimed(req.user.id, d.claimed);
    applyTx(req.user.id, { kind: 'reward', gold: t.reward, memo: `每日任务：${t.name}` });
    result = { ok: true, reward: t.reward };
  });
  tx();
  if (result) res.json(result);
});

// ---- events ----
const EVENTS = [
  { id: 'newbie', kind: 'claim', tag: '新人', title: '新人见面礼', desc: '初入幻域，领取启程礼包：200 金币 + 10 钻石，开启你的第一段角色扮演。', reward: { gold: 200, diamond: 10 }, accent: '#d97757' },
  { id: 'coop_carnival', kind: 'claim', tag: '联机', title: '限时联机狂欢', desc: '进入「剧场」与多位 AI 角色同台即兴演出，领取联机狂欢礼：60 钻石，并解锁多人同屏剧情。', reward: { gold: 0, diamond: 60 }, link: '/theater', linkText: '前往联机剧场', accent: '#7c5cff' },
  { id: 'group_party', kind: 'link', tag: '联机', title: '创作者联机大厅', desc: '加入群聊与其他创作者实时联机交流、互相导入角色、组队共创剧本。', link: '/groups', linkText: '进入联机大厅', accent: '#3f8195' },
  { id: 'checkin', kind: 'link', tag: '日常', title: '每日签到瓜分金币', desc: '连续签到奖励翻倍递增，VIP 再享双倍。坚持登录，金币越攒越多。', link: '/wallet', linkText: '去签到', accent: '#b3892f' },
  { id: 'bugbounty', kind: 'info', tag: '赏金', title: 'Bug 赏金猎人', desc: '发现任何 bug 或体验问题，请联系管理员提交反馈，一经采纳奖励 100 金币起，重大问题另有钻石与 VIP 加码。', accent: '#5c8a63' },
  { id: 'invite', kind: 'info', tag: '裂变', title: '邀请好友共创', desc: '在「设置 / 钱包」使用邀请密钥，邀请越多奖励越丰厚。与好友一起把幻域写满故事。', link: '/wallet', linkText: '查看兑换码', accent: '#c25a38' },
];
router.get('/events', authOptional, (req, res) => {
  const claims = req.user ? db.prepare('SELECT event_id FROM event_claims WHERE user_id = ?').all(req.user.id).map(c => c.event_id) : [];
  res.json({ events: EVENTS.map(e => ({ id: e.id, kind: e.kind, tag: e.tag, title: e.title, desc: e.desc, reward: e.reward || null, link: e.link || '', linkText: e.linkText || '', accent: e.accent, claimed: claims.includes(e.id) })) });
});
router.post('/events/:id/claim', authRequired, (req, res) => {
  const ev = EVENTS.find(e => e.id === req.params.id);
  if (!ev || ev.kind !== 'claim') return res.status(400).json({ error: '该活动无可领取奖励' });
  let w;
  try {
    // Claim marker and wallet credit commit together. A crash cannot consume a
    // claim without paying it, or pay it without the unique marker.
    db.transaction(() => {
      const ins = db.prepare('INSERT OR IGNORE INTO event_claims (user_id, event_id) VALUES (?,?)').run(req.user.id, ev.id);
      if (ins.changes === 0) throw Object.assign(new Error('该活动奖励已领取'), { status: 400, expose: true });
      w = applyTx(req.user.id, { kind: 'event', gold: ev.reward?.gold || 0, diamond: ev.reward?.diamond || 0, memo: `活动奖励 · ${ev.title}` });
    }).immediate();
  } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  notify(req.user.id, `已领取活动「${ev.title}」奖励`, '/events');
  res.json({ ok: true, wallet: w });
});

// ---- views ----
// 校验目标存在且公开，防对任意 id 刷浏览量。
router.post('/view', authRequired, (req, res) => {
  const { type, id } = req.body || {};
  const isScript = TT(type) === 'script';
  const tbl = isScript ? 'scripts' : 'characters';
  const row = isScript
    ? db.prepare('SELECT 1 FROM scripts WHERE id = ? AND deleted_at IS NULL').get(id)
    : db.prepare('SELECT 1 FROM characters WHERE id = ? AND is_public = 1').get(id);
  if (!row) return res.json({ ok: true }); // 静默忽略，避免泄露目标是否存在
  db.prepare(`UPDATE ${tbl} SET views = views + 1 WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ---- reviews / ratings ----
router.get('/reviews/:type/:id', authOptional, (req, res) => {
  const type = TT(req.params.type), id = +req.params.id;
  const rows = db.prepare(`SELECT r.*, u.display_name AS author_name, u.avatar AS author_avatar
    FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.target_type = ? AND r.target_id = ? ORDER BY r.id DESC`).all(type, id);
  const agg = db.prepare('SELECT AVG(rating) avg, COUNT(*) n FROM reviews WHERE target_type=? AND target_id=?').get(type, id);
  const mine = req.user ? db.prepare('SELECT * FROM reviews WHERE target_type=? AND target_id=? AND user_id=?').get(type, id, req.user.id) : null;
  res.json({ reviews: rows, avg: agg.avg || 0, count: agg.n || 0, mine });
});
router.post('/reviews/:type/:id', authRequired, (req, res) => {
  const type = TT(req.params.type), id = +req.params.id;
  // 校验目标存在且公开，防对私有/他人资源刷评分。
  const target = type === 'script'
    ? db.prepare('SELECT 1 FROM scripts WHERE id = ? AND deleted_at IS NULL').get(id)
    : db.prepare('SELECT 1 FROM characters WHERE id = ? AND is_public = 1').get(id);
  if (!target) return res.status(404).json({ error: '目标不存在或不可评价' });
  const rating = Math.min(5, Math.max(1, parseInt(req.body?.rating, 10) || 5));
  const text = (req.body?.text || '').slice(0, 500);
  const ex = db.prepare('SELECT id FROM reviews WHERE target_type=? AND target_id=? AND user_id=?').get(type, id, req.user.id);
  if (ex) db.prepare('UPDATE reviews SET rating=?, text=?, created_at=datetime(\'now\') WHERE id=?').run(rating, text, ex.id);
  else db.prepare('INSERT INTO reviews (target_type, target_id, user_id, rating, text) VALUES (?,?,?,?,?)').run(type, id, req.user.id, rating, text);
  res.json({ ok: true });
});
router.delete('/reviews/:id', authRequired, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!r || r.user_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

// ---- reports ----
// 支持 character / script / moment / user 四类举报，与 reports 表 target_type 设计一致，
// 也与前端 ReportButton 的 type 取值（character|script|user）对齐。
router.post('/report', authRequired, (req, res) => {
  const { type, id, reason } = req.body || {};
  if (!type || !id) return res.status(400).json({ error: '参数不全' });
  const tbl = type === 'script' ? 'scripts'
    : type === 'character' ? 'characters'
    : type === 'moment' ? 'moments'
    : type === 'user' ? 'users'
    : null;
  if (!tbl) return res.status(400).json({ error: '不支持的举报类型' });
  // 校验目标存在，防对不存在的 id 提举报污染队列。
  if (!db.prepare(`SELECT 1 FROM ${tbl} WHERE id = ?`).get(id)) return res.status(404).json({ error: '目标不存在' });
  db.prepare('INSERT INTO reports (target_type, target_id, reporter_id, reason) VALUES (?,?,?,?)').run(type, id, req.user.id, (reason || '').slice(0, 500));
  res.json({ ok: true });
});

// ---- leaderboard ----
router.get('/leaderboard', authOptional, (req, res) => {
  const characters = db.prepare(`SELECT c.id, c.name, c.avatar, c.likes, c.uses, c.views, u.display_name owner_name
    FROM characters c JOIN users u ON u.id=c.owner_id WHERE c.is_public=1 ORDER BY c.likes DESC, c.uses DESC LIMIT 20`).all();
  const scripts = db.prepare(`SELECT s.id, s.title, s.cover, s.plays, s.likes, s.price_gold, u.display_name author_name
    FROM scripts s JOIN users u ON u.id=s.author_id WHERE s.deleted_at IS NULL
    ORDER BY s.plays DESC, s.likes DESC LIMIT 20`).all();
  const authors = db.prepare(`SELECT u.id, u.display_name, u.avatar,
      (SELECT COALESCE(SUM(likes),0) FROM characters WHERE owner_id=u.id) +
      (SELECT COALESCE(SUM(likes),0) FROM scripts WHERE author_id=u.id AND deleted_at IS NULL) AS score,
      (SELECT COUNT(*) FROM characters WHERE owner_id=u.id AND is_public=1) AS chars,
      (SELECT COUNT(*) FROM scripts WHERE author_id=u.id AND deleted_at IS NULL) AS scripts
    FROM users u WHERE u.is_banned=0 ORDER BY score DESC LIMIT 20`)
    .all().map(a => ({ ...a, creator_tier: creatorTier(a.id) }));
  // S7-G10 我的名次：登录用户附带自己的创作声望与全站排位（榜外也可见）
  let mine = null;
  if (req.user) {
    const myScore = db.prepare(`SELECT
        (SELECT COALESCE(SUM(likes),0) FROM characters WHERE owner_id=?) +
        (SELECT COALESCE(SUM(likes),0) FROM scripts WHERE author_id=? AND deleted_at IS NULL) AS score`)
      .get(req.user.id, req.user.id).score || 0;
    const higher = db.prepare(`SELECT COUNT(*) n FROM users u WHERE u.is_banned=0 AND u.id != ? AND (
        (SELECT COALESCE(SUM(likes),0) FROM characters WHERE owner_id=u.id) +
        (SELECT COALESCE(SUM(likes),0) FROM scripts WHERE author_id=u.id AND deleted_at IS NULL)) > ?`)
      .get(req.user.id, myScore).n;
    mine = { rank: higher + 1, score: myScore };
  }
  res.json({ characters, scripts, authors, me: mine });
});

// 旧「50 钻直抽公开角色入收藏」端点已废弃：前端从未接入，且发金币返利 +
// 点赞污染都与扭蛋统一版语义冲突。真实抽取一律走 /api/gacha（routes/gacha.js，
// 服务端权威保底 + 每日免费 + 付费金币抽）。

export default router;
