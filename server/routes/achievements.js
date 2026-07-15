import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, isVip, notify } from '../wallet.js';

const router = Router();

// Mirrors the browser build's achievement set; progress is computed live from the DB.
const ACHIEVEMENTS = [
  { id: 'first_chat', name: '初次邂逅', desc: '发起你的第一次角色对话', icon: 'MessageCircle', cat: '对话', goal: 1, reward: 50, metric: 'chats', link: '/library' },
  { id: 'chat_10', name: '健谈之人', desc: '累计发起 10 次对话', icon: 'MessagesSquare', cat: '对话', goal: 10, reward: 150, metric: 'chats', link: '/chats' },
  { id: 'msg_100', name: '妙语连珠', desc: '累计发送 100 条消息', icon: 'Send', cat: '对话', goal: 100, reward: 220, metric: 'messages', link: '/chats' },
  { id: 'aff_close', name: '心有灵犀', desc: '与角色好感度达到「亲近」', icon: 'Heart', cat: '对话', goal: 100, reward: 180, metric: 'affinity_max', link: '/chats' },
  { id: 'aff_love', name: '情比金坚', desc: '与角色好感度达到「挚爱」', icon: 'Sparkles', cat: '对话', goal: 250, reward: 420, metric: 'affinity_max', link: '/chats' },
  { id: 'first_char', name: '造物之始', desc: '创建你的第一个角色', icon: 'UserPlus', cat: '创作', goal: 1, reward: 80, metric: 'characters', link: '/character/new' },
  { id: 'char_5', name: '角色匠人', desc: '创建 5 个角色', icon: 'Drama', cat: '创作', goal: 5, reward: 240, metric: 'characters', link: '/character/new' },
  { id: 'go_public', name: '广场首秀', desc: '公开 1 个角色到发现广场', icon: 'Globe', cat: '创作', goal: 1, reward: 60, metric: 'public_characters', link: '/publish' },
  { id: 'first_script', name: '编剧入门', desc: '创作你的第一个剧本', icon: 'ScrollText', cat: '创作', goal: 1, reward: 80, metric: 'scripts', link: '/script/new' },
  { id: 'first_novel', name: '执笔者', desc: '在小说工坊开启你的第一部作品', icon: 'Feather', cat: '创作', goal: 1, reward: 80, metric: 'novels', link: '/atelier' },
  { id: 'novel_words_5k', name: '初成卷帙', desc: 'AI 协作累计写下 5000 字小说', icon: 'BookText', cat: '创作', goal: 5000, reward: 260, metric: 'novel_words', link: '/atelier' },
  { id: 'novel_words_50k', name: '著作等身', desc: 'AI 协作累计写下 5 万字小说', icon: 'Library', cat: '创作', goal: 50000, reward: 900, metric: 'novel_words', link: '/atelier' },
  { id: 'creator_v', name: '创作者认证', desc: '获得创作者 V 认证', icon: 'BadgeCheck', cat: '创作', goal: 1, reward: 120, metric: 'creator_bronze', link: '/studio' },
  // Ranking remains a visible honor, but has no real-time currency payout.
  // Mutable likes/plays are not a safe server-authoritative money source.
  { id: 'creator_hall', name: '殿堂创作者', desc: '登顶创作者榜成为 TOP 1', icon: 'Crown', cat: '创作', goal: 1, reward: 0, honor: true, metric: 'creator_gold', link: '/leaderboard' },
  { id: 'first_fav', name: '一见倾心', desc: '收藏 1 个喜欢的角色', icon: 'Star', cat: '社交', goal: 1, reward: 20, metric: 'favorites', link: '/' },
  { id: 'fav_10', name: '收藏家', desc: '收藏 10 个角色', icon: 'Bookmark', cat: '社交', goal: 10, reward: 120, metric: 'favorites', link: '/favorites' },
  { id: 'first_moment', name: '初次发声', desc: '在社区发布 1 条动态', icon: 'PenLine', cat: '社交', goal: 1, reward: 40, metric: 'moments', link: '/community' },
  { id: 'first_group', name: '群英荟萃', desc: '加入 1 个群聊', icon: 'Users', cat: '社交', goal: 1, reward: 50, metric: 'groups', link: '/groups' },
  { id: 'first_theater', name: '登台亮相', desc: '参与 1 次剧场联机', icon: 'Drama', cat: '社交', goal: 1, reward: 60, metric: 'theaters', link: '/theater' },
  { id: 'fans_5', name: '小有名气', desc: '获得 5 位粉丝', icon: 'UserCheck', cat: '社交', goal: 5, reward: 150, metric: 'followers', link: '/profile' },
  { id: 'checkin_7', name: '持之以恒', desc: '连续签到 7 天', icon: 'CalendarCheck', cat: '财富', goal: 7, reward: 200, metric: 'checkin_streak', link: '/wallet' },
  { id: 'gold_10k', name: '腰缠万贯', desc: '累计赚取 10000 金币', icon: 'Coins', cat: '财富', goal: 10000, reward: 300, metric: 'gold_earned', link: '/wallet' },
  { id: 'gacha_10', name: '欧皇之路', desc: '在扭蛋机抽卡 10 次', icon: 'Dices', cat: '财富', goal: 10, reward: 160, metric: 'gacha_pulls', link: '/gacha' },
  { id: 'become_vip', name: '尊享会员', desc: '开通 VIP 会员', icon: 'Crown', cat: '财富', goal: 1, reward: 120, metric: 'vip', link: '/wallet' },
];

// One COUNT query, swallowing "no such table/column" so partial schemas never 500.
const count = (sql, ...args) => { try { return db.prepare(sql).get(...args)?.n || 0; } catch { return 0; } };

function creatorScore(uid) {
  const c = count('SELECT COALESCE(SUM(uses),0)+COALESCE(SUM(likes)*2,0) n FROM characters WHERE owner_id=? AND is_public=1', uid);
  const s = count('SELECT COALESCE(SUM(plays),0)+COALESCE(SUM(likes)*2,0) n FROM scripts WHERE author_id=? AND deleted_at IS NULL', uid);
  return c + s;
}
function creatorWorks(uid) {
  return count('SELECT COUNT(*) n FROM characters WHERE owner_id=? AND is_public=1', uid) + count('SELECT COUNT(*) n FROM scripts WHERE author_id=? AND deleted_at IS NULL', uid);
}
function isTopCreator(uid) {
  if (creatorWorks(uid) === 0) return false;
  const mine = creatorScore(uid);
  let best = 0;
  for (const u of db.prepare('SELECT id FROM users WHERE is_banned=0').all()) { if (creatorWorks(u.id) > 0) best = Math.max(best, creatorScore(u.id)); }
  return mine >= best && mine > 0;
}

function metric(u, m) {
  const uid = u.id;
  switch (m) {
    case 'chats': return count('SELECT COUNT(*) n FROM conversations WHERE user_id=?', uid);
    case 'messages': return count("SELECT COUNT(*) n FROM messages WHERE role='user' AND conversation_id IN (SELECT id FROM conversations WHERE user_id=?)", uid);
    case 'affinity_max': return count('SELECT COALESCE(MAX(affinity),0) n FROM conversations WHERE user_id=?', uid);
    case 'characters': return count('SELECT COUNT(*) n FROM characters WHERE owner_id=?', uid);
    case 'public_characters': return count('SELECT COUNT(*) n FROM characters WHERE owner_id=? AND is_public=1', uid);
    case 'scripts': return count('SELECT COUNT(*) n FROM scripts WHERE author_id=? AND deleted_at IS NULL', uid);
    case 'novels': return count('SELECT COUNT(*) n FROM novels WHERE owner_id=?', uid);
    case 'novel_words': return count('SELECT COALESCE(SUM(words),0) n FROM novel_runs WHERE owner_id=?', uid);
    case 'creator_bronze': return creatorWorks(uid) > 0 ? 1 : 0;
    case 'creator_gold': return isTopCreator(uid) ? 1 : 0;
    case 'favorites': return count('SELECT COUNT(*) n FROM favorites WHERE user_id=?', uid);
    case 'moments': return count('SELECT COUNT(*) n FROM moments WHERE user_id=?', uid);
    case 'groups': return count('SELECT COUNT(*) n FROM group_members WHERE user_id=?', uid);
    case 'theaters': return count('SELECT COUNT(*) n FROM theater_members WHERE user_id=?', uid);
    case 'followers': return count('SELECT COUNT(*) n FROM follows WHERE following_id=?', uid);
    case 'checkin_streak': return u.checkin_streak || 0;
    // Count only server-authoritative earnings. Refunds, exchanges, recharges
    // and GM adjustments are explicitly excluded from achievement progress.
    case 'gold_earned': return count(`SELECT COALESCE(SUM(gold),0) n FROM transactions
      WHERE user_id=? AND gold>0 AND kind IN
      ('sell_script','revenue_share','checkin','reward','event','achievement','invite')`, uid);
    case 'gacha_pulls': return u.gacha_pulls || 0;
    case 'vip': return isVip(u) ? 1 : 0;
    default: return 0;
  }
}

const claimedOf = (u) => { try { return JSON.parse(u.ach_claimed || '[]'); } catch { return []; } };

router.get('/', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const claimed = claimedOf(u);
  const list = ACHIEVEMENTS.map(a => {
    const raw = metric(u, a.metric); const unlocked = raw >= a.goal;
    const isClaimed = a.honor ? unlocked : claimed.includes(a.id);
    return { id: a.id, name: a.name, desc: a.desc, icon: a.icon, cat: a.cat, goal: a.goal, reward: a.reward, honor: !!a.honor, link: a.link,
      value: Math.min(raw, a.goal), unlocked, claimed: isClaimed, claimable: !a.honor && unlocked && !isClaimed };
  });
  res.json({ achievements: list, summary: {
    unlocked: list.filter(x => x.unlocked).length, total: list.length,
    claimable: list.filter(x => x.claimable).length, gold_pending: list.filter(x => x.claimable).reduce((s, x) => s + x.reward, 0) } });
});

router.post('/:id/claim', authRequired, (req, res) => {
  const a = ACHIEVEMENTS.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: '成就不存在' });
  if (a.honor) return res.status(400).json({ error: '该成就是荣誉徽章，不发放实时排名奖金' });
  let w;
  try {
    // IMMEDIATE 事务内重读 ach_claimed 再判定：并发/多进程下第二次领取会读到已含该成就的
    // 快照而拒绝，杜绝重复发奖；发奖与写回一并原子提交。
    db.transaction(() => {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      const claimed = claimedOf(u);
      if (claimed.includes(a.id)) throw Object.assign(new Error('该成就奖励已领取'), { status: 400, expose: true });
      if (metric(u, a.metric) < a.goal) throw Object.assign(new Error('成就尚未达成'), { status: 400, expose: true });
      claimed.push(a.id);
      db.prepare('UPDATE users SET ach_claimed = ? WHERE id = ?').run(JSON.stringify(claimed), u.id);
      w = applyTx(u.id, { kind: 'achievement', gold: a.reward, memo: `成就奖励 · ${a.name}` });
    }).immediate();
  } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  notify(req.user.id, `🏆 达成成就「${a.name}」，奖励 ${a.reward} 金币已入账！`, '/achievements');
  res.json({ ok: true, reward: a.reward, gold: w.gold });
});

export default router;
