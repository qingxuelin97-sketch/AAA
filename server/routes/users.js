import { Router } from 'express';
import db from '../db.js';
import { authOptional } from '../auth.js';
import { isVip } from '../wallet.js';

const router = Router();

// Search users by numeric ID or username / display name.
router.get('/search', authOptional, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  let rows;
  if (/^\d+$/.test(q)) {
    rows = db.prepare('SELECT id, username, display_name, avatar, bio FROM users WHERE id = ?').all(Number(q));
  } else {
    const k = `%${q}%`;
    rows = db.prepare('SELECT id, username, display_name, avatar, bio FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 30').all(k, k);
  }
  res.json({ users: rows });
});

// Public profile: user info + public characters + scripts + moments + stats
router.get('/:id', authOptional, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, avatar, banner, bio, vip_until, is_gm, svip, verified, verified_note, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  u.vip = isVip(u);
  u.is_gm = !!u.is_gm; u.svip = !!u.svip; u.verified = !!u.verified;
  const characters = db.prepare('SELECT * FROM characters WHERE owner_id = ? AND is_public = 1 ORDER BY created_at DESC').all(u.id);
  const scripts = db.prepare('SELECT * FROM scripts WHERE author_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(u.id);
  const moments = db.prepare('SELECT * FROM moments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(u.id);
  const stats = {
    characters: db.prepare('SELECT COUNT(*) n FROM characters WHERE owner_id = ?').get(u.id).n,
    scripts: scripts.length,
    followers: db.prepare('SELECT COUNT(*) n FROM follows WHERE following_id = ?').get(u.id).n,
    following: db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id = ?').get(u.id).n
  };
  let following = false;
  if (req.user) following = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, u.id);
  res.json({ user: u, characters, scripts, moments, stats, following });
});

// 粉丝 / 关注列表：供个人主页弹窗展示。每项含 followInList 所需的字段。
function followsList(req, res, dir) {
  const u = db.prepare('SELECT id, username, display_name, avatar, bio, vip_until, svip, verified FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  // dir === 'followers' => 关注了 :id 的人；dir === 'following' => :id 关注的人。
  const joinCol = dir === 'followers' ? 'follower_id' : 'following_id';
  const targetCol = dir === 'followers' ? 'following_id' : 'follower_id';
  const rows = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.vip_until, u.svip, u.verified
    FROM follows f JOIN users u ON u.id = f.${joinCol}
    WHERE f.${targetCol} = ? ORDER BY f.rowid DESC LIMIT 200`).all(u.id);
  const meId = req.user?.id;
  const users = rows.map(r => ({
    id: r.id, username: r.username, display_name: r.display_name, avatar: r.avatar, bio: r.bio || '',
    vip: isVip(r), svip: !!r.svip, verified: !!r.verified,
    following: meId ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(meId, r.id) : false,
  }));
  res.json({ users });
}
router.get('/:id/followers', authOptional, (req, res) => followsList(req, res, 'followers'));
router.get('/:id/following', authOptional, (req, res) => followsList(req, res, 'following'));

export default router;
