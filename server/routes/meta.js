import { Router } from 'express';
const router = Router();

export const CATEGORIES = [
  { slug: 'fantasy', name: '奇幻', icon: '🪄' },
  { slug: 'scifi', name: '科幻', icon: '🚀' },
  { slug: 'romance', name: '恋爱', icon: '💗' },
  { slug: 'healing', name: '治愈', icon: '🌿' },
  { slug: 'mystery', name: '悬疑', icon: '🔍' },
  { slug: 'history', name: '历史', icon: '🏯' },
  { slug: 'game', name: '游戏', icon: '🎮' },
  { slug: 'anime', name: '二次元', icon: '🌸' },
  { slug: 'daily', name: '日常', icon: '☕' },
  { slug: 'horror', name: '惊悚', icon: '👻' },
  { slug: 'wuxia', name: '武侠', icon: '⚔️' },
  { slug: 'other', name: '其他', icon: '✨' }
];

router.get('/categories', (req, res) => res.json({ categories: CATEGORIES }));

export default router;
