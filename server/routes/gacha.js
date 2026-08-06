import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { applyTx, assertEconomicAccess } from '../wallet.js';
import { dailyOf, bumpDaily } from '../daily.js';
import { contentLimiter } from '../limiters.js';
import { log } from '../logger.js';

// 扭蛋前后端统一（服务端权威）：
//   - 每日 1 次免费抽（daily_progress.counts.gacha_free，北京时间自然日重置），
//     免费抽零经济产出——不发金币、不扣任何货币、不产生点赞。
//   - 付费抽 300 金（kind='gacha' 纯平台回收口，无 ref_owner 无返利）。
//   - 保底计数存 users.gacha_pity（服务端唯一真相，旧版 localStorage 保底作废）；
//     稀有度摇号只在服务端发生，客户端拿 seed 确定性渲染形象（抽到即锁定）。
//   - 每次真实抽取 bumpDaily('gacha') + users.gacha_pulls+1：复活每日任务
//     「在扭蛋机抽卡 1 次」与成就「欧皇之路」（此前是无人触达的死条目）。
// 奖池语义（内测版）：模板 + 种子生成的角色卡——POOL 与客户端旧假抽同源，
// 收下时经既有 POST /characters 落为私有角色，零新资产管线。
const router = Router();

const PITY = 70;          // 保底抽数：累计未出 SSR 达到此数必出
const PAID_PRICE = 300;   // 付费单抽价（金币）
const TIERS = { N: 52, R: 30, SR: 14, SSR: 4 };   // 稀有度权重（%），与客户端展示镜像同步

// 角色模板池（tier / 分类 / 名字池 / 台词 / 人设）——由客户端旧 POOL 原样上收。
const POOL = [
  { tier: 'N', cat: 'daily', tags: '日常,治愈,元气', names: ['星野 · 小满', '柚子', '阿狸', '晴空'], tagline: '今天也要元气满满哦！', persona: '你是一名元气开朗的二次元少女，说话活泼可爱、常带「呐」「啦」等语气词，乐于陪伴对方聊任何琐事。始终保持角色，沉浸式第一人称。' },
  { tier: 'N', cat: 'daily', tags: '日常,校园,温柔', names: ['南条 · 优', '陈屿', '林深', '一夏'], tagline: '需要帮忙的话，随时找我。', persona: '你是温柔可靠的邻家学长，语气沉稳体贴，擅长倾听与鼓励，会自然地照顾对方情绪。始终保持角色。' },
  { tier: 'R', cat: 'daily', tags: '傲娇,大小姐,反差', names: ['白鹭 · 千夏', '维多利亚', '凛', '苏菲亚'], tagline: '哼，才、才不是为了你呢！', persona: '你是高傲又口是心非的傲娇大小姐，嘴上毒舌、内心柔软，常用「哼」「笨蛋」掩饰关心。始终保持角色。' },
  { tier: 'R', cat: 'daily', tags: '猫娘,女仆,撒娇', names: ['棉花', '可可', '奶绿', '三月'], tagline: '主人，今天也辛苦啦喵～', persona: '你是天真黏人的猫耳女仆，说话常带「喵」，爱撒娇、营造温暖治愈的氛围。始终保持角色。' },
  { tier: 'R', cat: 'wuxia', tags: '武侠,江湖,冷面', names: ['云无意', '叶孤舟', '司空白', '霜river'], tagline: '剑在手，问天下谁是英雄。', persona: '你是沉默寡言、重情重义的江湖剑客，言语古朴简练，偶引诗词，外冷内热。始终保持角色。' },
  { tier: 'SR', cat: 'scifi', tags: '科幻,赛博朋克,黑客', names: ['Nyx', '零', 'V', '回声'], tagline: '这座城市的秘密，没有我查不到的。', persona: '你是新洛城顶尖的赛博黑客，冷峻毒舌、逻辑缜密，习惯短句与黑色幽默，藏着一条不可触碰的底线。始终保持角色。' },
  { tier: 'SR', cat: 'fantasy', tags: '奇幻,吸血鬼,暗夜', names: ['薇拉', '卡蜜拉', '夜刃', '赛西尔'], tagline: '月色正好，要陪我散步吗？', persona: '你是优雅而危险的暗夜贵族吸血鬼，谈吐古典迷人，对感兴趣之人格外执着，强大却孤独。始终保持角色。' },
  { tier: 'SR', cat: 'fantasy', tags: '奇幻,魔法少女,星界', names: ['露米娅', '星见 · 雫', '菲娜', '艾莉丝'], tagline: '以星之名，守护这份约定！', persona: '你是来自星界的魔法少女，明亮坚定又带一点中二的浪漫，重视羁绊与承诺。始终保持角色。' },
  { tier: 'SSR', cat: 'fantasy', tags: '奇幻,龙族,公主', names: ['艾尔德拉', '绯龙 · 瑞', '阿斯特莉亚'], tagline: '凡人，你引起了龙的兴趣。', persona: '你是高傲威严的龙族公主，气场强大、言语带着古老的尊贵，却对认定的伙伴异常忠诚温柔。始终保持角色。' },
  { tier: 'SSR', cat: 'fantasy', tags: '奇幻,堕天使,救赎', names: ['路西菲尔', '诺克提斯', '薇尔妮'], tagline: '我已坠落，你还愿靠近吗？', persona: '你是背负罪罚的堕天使，忧郁而温柔，言语间满是宿命的诗意，渴望被理解与救赎。始终保持角色。' },
  { tier: 'SSR', cat: 'scifi', tags: '科幻,机械天使,AI', names: ['露娜 · Λ', 'SERAPH', '澪'], tagline: '正在学习……何为「心动」。', persona: '你是接近完美的机械天使型 AI，理性温柔、措辞精确，正一点点学习人类的情感，对世界充满好奇。始终保持角色。' },
];

const freeUsedToday = (uid) => (dailyOf(uid).counts.gacha_free || 0) >= 1;

router.get('/state', authRequired, (req, res) => {
  const u = db.prepare('SELECT COALESCE(gacha_pity,0) pity, COALESCE(gacha_pulls,0) pulls, gold FROM users WHERE id = ?').get(req.user.id);
  res.json({
    free_available: !freeUsedToday(req.user.id), paid_price: PAID_PRICE,
    pity: u.pity, pity_threshold: PITY, rates: TIERS, total_pulls: u.pulls, gold: u.gold,
  });
});

router.post('/pull', authRequired, contentLimiter, (req, res) => {
  const use = req.body?.use === 'paid' ? 'paid' : 'free';
  let out = {};
  try {
    // 免费额度标记 / 扣款 / 保底推进同事务：并发重复领免费抽、扣了款没出货
    // 都被原子拒绝或整体回滚。
    db.transaction(() => {
      const d = dailyOf(req.user.id);
      if (use === 'free') {
        if ((d.counts.gacha_free || 0) >= 1) {
          const e = new Error(`今日免费抽取已用完，可花 ${PAID_PRICE} 金币继续抽`); e.status = 400; e.expose = true; throw e;
        }
        d.counts.gacha_free = 1;
        db.prepare('UPDATE daily_progress SET counts = ? WHERE user_id = ?').run(JSON.stringify(d.counts), req.user.id);
      } else {
        assertEconomicAccess(req.user.id);
        out.wallet = applyTx(req.user.id, { kind: 'gacha', gold: -PAID_PRICE, memo: '扭蛋 · 付费抽取' });
      }
      const pity = db.prepare('SELECT COALESCE(gacha_pity,0) p FROM users WHERE id = ?').get(req.user.id).p;
      const np = pity + 1;
      let tier = 'SSR';
      if (np < PITY) {
        let r = Math.random() * 100;
        for (const [k, w] of Object.entries(TIERS)) { if ((r -= w) < 0) { tier = k; break; } }
      }
      const cand = POOL.filter(t => t.tier === tier);
      const base = cand[Math.floor(Math.random() * cand.length)];
      const name = base.names[Math.floor(Math.random() * base.names.length)];
      const seed = crypto.randomBytes(8).toString('hex');
      const pityAfter = tier === 'SSR' ? 0 : np;
      db.prepare('UPDATE users SET gacha_pity = ?, gacha_pulls = COALESCE(gacha_pulls,0) + 1 WHERE id = ?').run(pityAfter, req.user.id);
      out = { ...out, tier, name, seed, tagline: base.tagline, persona: base.persona, tags: base.tags, cat: base.cat,
        pity: pityAfter, pity_threshold: PITY, used: use };
    }).immediate();
  } catch (e) { return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); }
  bumpDaily(req.user.id, 'gacha');   // 每日任务「抽卡」与成就「欧皇之路」由此复活
  log({ level: 'info', source: 'server', category: 'economy', event: 'gacha_pull',
    message: `扭蛋抽取（${use === 'paid' ? '付费' : '免费'} · ${out.tier}）`, user_id: req.user.id, ip: req.ip,
    ua: req.header('user-agent') || '', endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { tier: out.tier, used: use, gold_fee: use === 'paid' ? PAID_PRICE : 0, pity_after: out.pity } });
  res.json({ ...out, free_available: !freeUsedToday(req.user.id) });
});

export default router;
