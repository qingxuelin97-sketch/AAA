import React, { useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { randomAnimeAvatar, randomBg } from '../faces.js';
import { Dices, Sparkles, MessageCircle, Save } from 'lucide-react';

// Rarity tiers (draw weights). Higher tiers are rarer and glow stronger.
const TIERS = {
  N: { label: 'N · 常见', weight: 52, cls: 'gx-n' },
  R: { label: 'R · 稀有', weight: 30, cls: 'gx-r' },
  SR: { label: 'SR · 史诗', weight: 14, cls: 'gx-sr' },
  SSR: { label: 'SSR · 传说', weight: 4, cls: 'gx-ssr' }
};

// Archetype pool — each draw assembles a fresh character from one of these,
// with a random locked avatar + scenery background.
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
  { tier: 'SSR', cat: 'scifi', tags: '科幻,机械天使,AI', names: ['露娜 · Λ', 'SERAPH', '澪'], tagline: '正在学习……何为「心动」。', persona: '你是接近完美的机械天使型 AI，理性温柔、措辞精确，正一点点学习人类的情感，对世界充满好奇。始终保持角色。' }
];

const PITY = 70; // 保底抽数：累计未出 SSR 达到此数则必出
const CONFETTI_COLORS = ['#ffd24a', '#ff8a3c', '#e2885f', '#b07cff', '#5ad2ff', '#7fb487', '#ff6fa8'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function rollTier() {
  const total = Object.values(TIERS).reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const [k, t] of Object.entries(TIERS)) { if ((r -= t.weight) < 0) return k; }
  return 'N';
}

export default function Gacha() {
  const toast = useToast();
  const nav = useNavigate();
  const [result, setResult] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [pity, setPity] = useState(() => +(localStorage.getItem('huanyu_gacha_pity') || 0));
  const [confetti, setConfetti] = useState(false);

  const draw = () => {
    setRolling(true); setResult(null);
    const np = pity + 1;
    const tier = np >= PITY ? 'SSR' : rollTier(); // 保底：第 PITY 抽必出 SSR
    const cand = POOL.filter(p => p.tier === tier);
    const base = pick(cand.length ? cand : POOL);
    const r = { ...base, name: pick(base.names), avatar: randomAnimeAvatar(), background: randomBg() };
    api('/engage/track', { method: 'POST', body: { action: 'gacha' } }).catch(() => {}); // 每日任务计数
    // brief suspense before the reveal
    setTimeout(() => {
      setResult(r); setRolling(false); setCount(c => c + 1);
      const newPity = tier === 'SSR' ? 0 : np;
      setPity(newPity); localStorage.setItem('huanyu_gacha_pity', String(newPity));
      if (tier === 'SSR') { setConfetti(false); requestAnimationFrame(() => setConfetti(true)); setTimeout(() => setConfetti(false), 2400); }
    }, 620);
  };

  const create = async (thenChat) => {
    if (!result || busy) return;
    setBusy(true);
    try {
      const body = {
        name: result.name, avatar: result.avatar, background: result.background, background_type: 'image',
        tagline: result.tagline, intro: result.tagline, greeting: '', persona: result.persona,
        category: result.cat, tags: result.tags, is_public: false, nsfw: false, world: []
      };
      const d = await api('/characters', { method: 'POST', body });
      const cid = d.character?.id;
      if (thenChat && cid) {
        const cv = await api('/chat/conversations', { method: 'POST', body: { character_id: cid } });
        nav('/chats/' + cv.conversation.id);
      } else {
        toast('已存入「我的角色」');
        nav('/library');
      }
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const tier = result ? TIERS[result.tier] : null;

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>角色扭蛋机</h1><div className="sub">投币一抽，邂逅命中注定的二次元伙伴 · 抽到即锁定，永不变化</div></div>
      </div>
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="gx-stage">
          {confetti && (
            <div className="gx-confetti" aria-hidden="true">
              {Array.from({ length: 38 }).map((_, i) => (
                <span key={i} style={{ left: Math.random() * 100 + '%', background: CONFETTI_COLORS[i % CONFETTI_COLORS.length], animationDelay: (Math.random() * 0.35).toFixed(2) + 's', animationDuration: (1.4 + Math.random() * 0.9).toFixed(2) + 's' }} />
              ))}
            </div>
          )}
          <div className={'gx-orb' + (rolling ? ' rolling' : '')}>
            {!result && !rolling && <div className="gx-hint"><Sparkles size={40} /><p>点击下方按钮，开始你的抽卡</p></div>}
            {rolling && <div className="gx-spin"><Dices size={46} /></div>}
            {result && !rolling && (
              <div className={'gx-card ' + tier.cls}>
                <span className="gx-rarity">{tier.label}</span>
                <div className="gx-cover">
                  <img src={assetUrl(result.background)} alt="" />
                  <img className="gx-face" src={assetUrl(result.avatar)} alt={result.name} />
                </div>
                <div className="gx-meta">
                  <b>{result.name}</b>
                  <p>{result.tagline}</p>
                  <div className="gx-tags">{result.tags.split(',').map(t => <span key={t}>{t}</span>)}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="gx-actions">
          <button className="btn primary lg" onClick={draw} disabled={rolling || busy}>
            <Dices size={18} /> {result ? '再抽一次' : '抽一张（免费）'}
          </button>
          {result && !rolling && (
            <>
              <button className="btn lg" onClick={() => create(true)} disabled={busy}><MessageCircle size={17} /> 收下并开聊</button>
              <button className="btn ghost lg" onClick={() => create(false)} disabled={busy}><Save size={17} /> 存入我的角色</button>
            </>
          )}
        </div>
        <div className="gx-pity">
          <div className="gx-pity-bar"><span style={{ width: Math.min(100, pity / PITY * 100) + '%' }} /></div>
          <p className="muted">保底进度 {pity}/{PITY} · 再 {Math.max(0, PITY - pity)} 抽内必出 SSR{count > 0 ? ` · 已抽 ${count} 次` : ''}</p>
        </div>
      </div>
    </>
  );
}
