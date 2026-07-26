import React, { useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { randomAnimeAvatar, randomBg } from '../faces.js';
import { Dices, Sparkles, MessageCircle, Save, ArrowLeft, X, ShieldCheck, Eye, RefreshCw } from 'lucide-react';

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
  const appMode = isAppMode();
  const [result, setResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [pity, setPity] = useState(() => +(localStorage.getItem('huanyu_gacha_pity') || 0));
  const [confetti, setConfetti] = useState(false);
  const [createError, setCreateError] = useState(null); // Web：收下失败原地重试（{ msg, thenChat }）

  const draw = () => {
    setRolling(true); setResult(null); setShowResult(false);
    if (!appMode) setCreateError(null);
    const np = pity + 1;
    const tier = np >= PITY ? 'SSR' : rollTier(); // 保底：第 PITY 抽必出 SSR
    const cand = POOL.filter(p => p.tier === tier);
    const base = pick(cand.length ? cand : POOL);
    const r = { ...base, name: pick(base.names), avatar: randomAnimeAvatar(), background: randomBg() };
    api('/engage/track', { method: 'POST', body: { action: 'gacha' } }).catch(() => {}); // 每日任务计数
    // brief suspense before the reveal
    setTimeout(() => {
      setResult(r); setRolling(false); setShowResult(true); setCount(c => c + 1);
      const newPity = tier === 'SSR' ? 0 : np;
      setPity(newPity); localStorage.setItem('huanyu_gacha_pity', String(newPity));
      if (tier === 'SSR') { setConfetti(false); requestAnimationFrame(() => setConfetti(true)); setTimeout(() => setConfetti(false), 2400); }
    }, 620);
  };

  const create = async (thenChat) => {
    if (!result || busy) return;
    setBusy(true);
    if (!appMode) setCreateError(null);
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
    } catch (e) { toast(e.message, 'err'); if (!appMode) setCreateError({ msg: e.message || '保存失败，请稍后重试', thenChat }); } finally { setBusy(false); }
  };

  const tier = result ? TIERS[result.tier] : null;

  if (appMode) {
    return (
      <main className="qa-gacha-page">
        <header className="qa-gacha-head">
          <AppIconButton label="返回" onClick={() => nav(-1)}><ArrowLeft size={21} /></AppIconButton>
          <div className="qa-gacha-head-title"><h1>角色扭蛋机</h1><span>免费邂逅</span></div>
          <span className="qa-gacha-head-spacer" aria-hidden="true" />
        </header>

        <div className="qa-gacha-body">
          <section className={`qa-gacha-machine${rolling ? ' is-rolling' : ''}`} aria-labelledby="qa-gacha-machine-title">
            <span className="qa-gacha-machine-icon" aria-hidden="true">{rolling ? <Dices size={38} /> : <Sparkles size={34} />}</span>
            <span className="qa-gacha-kicker"><Dices size={13} /> 今日邂逅</span>
            <h2 id="qa-gacha-machine-title">{rolling ? '正在寻找与你相遇的角色…' : result ? `已抽到 ${result.name}` : '下一位伙伴，会是谁？'}</h2>
            <p>{rolling ? '请稍候片刻。' : result ? result.tagline : '每次抽取都会锁定一位全新的角色，形象与性格不会改变。'}</p>
            {result && !rolling && (
              <AppButton className="qa-gacha-view-result" variant="secondary" onClick={() => setShowResult(true)}><Eye size={17} /> 查看抽取结果</AppButton>
            )}
          </section>

          <AppButton className="qa-gacha-draw" variant="primary" size="lg" loading={rolling} disabled={busy} onClick={draw}>
            <Dices size={19} /> {result ? '再抽一次' : '免费抽取一次'}
          </AppButton>

          <section className="qa-gacha-facts" aria-label="抽取规则">
            <div className="qa-gacha-pity" aria-labelledby="qa-gacha-pity-title">
              <div className="qa-gacha-pity-head"><span id="qa-gacha-pity-title"><ShieldCheck size={17} /> 传说保底</span><b>{pity}/{PITY}</b></div>
              <div className="qa-gacha-pity-bar" role="progressbar" aria-label="SSR 保底进度" aria-valuemin="0" aria-valuemax={PITY} aria-valuenow={pity}><span style={{ width: Math.min(100, pity / PITY * 100) + '%' }} /></div>
              <p>再 {Math.max(0, PITY - pity)} 抽内必出 SSR{count > 0 ? ` · 本次已抽 ${count} 次` : ''}</p>
            </div>

            <div className="qa-gacha-rates" aria-labelledby="qa-gacha-rates-title">
              <div><h2 id="qa-gacha-rates-title">稀有度概率</h2><span>每抽独立计算</span></div>
              <ul>
                {Object.entries(TIERS).map(([key, item]) => <li key={key} data-tier={key}><span>{key}</span><b>{item.weight}%</b></li>)}
              </ul>
            </div>
          </section>
        </div>

        {result && !rolling && showResult && (
          <Modal onClose={() => setShowResult(false)} className="qa-gacha-result-modal" backdropClassName="qa-gacha-result-backdrop">
            <header className="qa-gacha-result-head">
              <div><span><Sparkles size={13} /> 抽取结果</span><h2>新的角色已出现</h2></div>
              <AppIconButton label="收起抽取结果" onClick={() => setShowResult(false)}><X size={20} /></AppIconButton>
            </header>

            <div className="qa-gacha-result-body">
              <article className="qa-gacha-result-card" data-tier={result.tier}>
                <div className="qa-gacha-result-cover">
                  <img src={assetUrl(result.background)} alt="" />
                  <img className="qa-gacha-result-avatar" src={assetUrl(result.avatar)} alt={result.name} />
                  <span>{tier.label}</span>
                </div>
                <div className="qa-gacha-result-copy">
                  <h3>{result.name}</h3>
                  <p>{result.tagline}</p>
                  <div>{result.tags.split(',').map(tag => <span key={tag}>{tag}</span>)}</div>
                </div>
              </article>
              <p className="qa-gacha-result-note">角色已锁定；收下后会作为私有角色保存。</p>
            </div>

            <footer className="qa-gacha-result-actions">
              <AppButton variant="primary" size="lg" loading={busy} onClick={() => create(true)}><MessageCircle size={18} /> 收下并开聊</AppButton>
              <AppButton variant="secondary" size="lg" disabled={busy} onClick={() => create(false)}><Save size={18} /> 存入我的角色</AppButton>
            </footer>
          </Modal>
        )}
      </main>
    );
  }

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
        {createError && result && !rolling && (
          <div className="lgw-error-inline" role="alert" style={{ marginTop: 12 }}>
            <span>没能收下「{result.name}」：{createError.msg}</span>
            <button className="btn sm primary" disabled={busy} onClick={() => create(createError.thenChat)}><RefreshCw size={14} /> 重试</button>
          </div>
        )}
        <div className="gx-pity">
          <div className="gx-pity-bar"><span style={{ width: Math.min(100, pity / PITY * 100) + '%' }} /></div>
          <p className="muted">保底进度 {pity}/{PITY} · 再 {Math.max(0, PITY - pity)} 抽内必出 SSR{count > 0 ? ` · 已抽 ${count} 次` : ''}</p>
        </div>
      </div>
    </>
  );
}
