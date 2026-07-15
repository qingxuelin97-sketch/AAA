import { Router } from'express';
import db from'../db.js';
const router = Router();

export const CATEGORIES = [
  { slug:'fantasy', name:'奇幻', icon:'' },
  { slug:'scifi', name:'科幻', icon:'' },
  { slug:'romance', name:'恋爱', icon:'' },
  { slug:'healing', name:'治愈', icon:'' },
  { slug:'mystery', name:'悬疑', icon:'' },
  { slug:'history', name:'历史', icon:'' },
  { slug:'game', name:'游戏', icon:'' },
  { slug:'anime', name:'二次元', icon:'' },
  { slug:'daily', name:'日常', icon:'' },
  { slug:'horror', name:'惊悚', icon:'' },
  { slug:'wuxia', name:'武侠', icon:'' },
  { slug:'other', name:'其他', icon:'' }
];

router.get('/categories', (req, res) => res.json({ categories: CATEGORIES }));

// 标签云聚合：从公开角色与全部剧本的 tags 字段（逗号分隔）统计热门标签。
// 数据量可控（tags 字段短），内存聚合即可，避免递归 CTE 的复杂度。
router.get('/tags', (req, res) => {
  const rows = [
    ...db.prepare("SELECT tags FROM characters WHERE is_public = 1 AND tags IS NOT NULL AND tags != ''").all(),
    ...db.prepare("SELECT tags FROM scripts WHERE deleted_at IS NULL AND tags IS NOT NULL AND tags != ''").all(),
  ];
  const counts = {};
  for (const row of rows) {
    for (const t of String(row.tags).split(',').map(s => s.trim()).filter(Boolean)) {
      const k = t.slice(0, 20); // 截断过长标签，防异常
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  const tags = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);
  res.json({ tags });
});

export default router;
