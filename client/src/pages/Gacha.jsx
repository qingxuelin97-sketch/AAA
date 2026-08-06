import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Modal, CoinIcon } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { seededAnimeAvatar, seededBg } from '../faces.js';
import ShareCardSheet from '../components/ShareCardSheet.jsx';
import { Dices, Sparkles, MessageCircle, Save, ArrowLeft, X, ShieldCheck, Eye, ImagePlus, RefreshCw } from 'lucide-react';

// Rarity tiers（展示镜像）：权重与保底、模板池、摇号全部在服务端
// server/routes/gacha.js —— 客户端只负责标签与光效，抽取结果由 seed 确定性渲染。
const TIERS = {
  N: { label: 'N · 常见', weight: 52, cls: 'gx-n' },
  R: { label: 'R · 稀有', weight: 30, cls: 'gx-r' },
  SR: { label: 'SR · 史诗', weight: 14, cls: 'gx-sr' },
  SSR: { label: 'SSR · 传说', weight: 4, cls: 'gx-ssr' }
};

const CONFETTI_COLORS = ['#ffd24a', '#ff8a3c', '#e2885f', '#b07cff', '#5ad2ff', '#7fb487', '#ff6fa8'];

export default function Gacha() {
  const toast = useToast();
  const nav = useNavigate();
  const appMode = isAppMode();
  const { refreshUser } = useAuth();
  const [gstate, setGstate] = useState(null);  // 服务端抽取状态：免费额度 / 保底 / 单价 / 概率
  const [result, setResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [shareOpen, setShareOpen] = useState(false); // S7-G10 抽卡晒卡（App）
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [confetti, setConfetti] = useState(false);
  const [createError, setCreateError] = useState(null); // Web：收下失败原地重试（{ msg, thenChat }）

  // 保底与免费额度均以服务端为准；旧版 localStorage 假保底作废并清掉残留。
  const pity = gstate?.pity ?? 0;
  const PITY = gstate?.pity_threshold ?? 70;
  const freeAvailable = !!gstate?.free_available;
  const price = gstate?.paid_price ?? 300;
  useEffect(() => {
    try { localStorage.removeItem('huanyu_gacha_pity'); } catch { /* */ }
    api('/gacha/state').then(setGstate).catch(() => {});
  }, []);

  const draw = async () => {
    if (rolling) return;
    setRolling(true); setResult(null); setShowResult(false);
    if (!appMode) setCreateError(null);
    const revealAt = Date.now() + 620; // brief suspense before the reveal
    try {
      // 摇号在服务端：免费额度用完自动转付费档（按钮文案已明示价格）。
      const d = await api('/gacha/pull', { method: 'POST', body: { use: freeAvailable ? 'free' : 'paid' } });
      const r = { tier: d.tier, cat: d.cat, tags: d.tags, name: d.name, tagline: d.tagline, persona: d.persona,
        avatar: seededAnimeAvatar(d.seed), background: seededBg(d.seed) };
      setGstate(s => (s ? { ...s, pity: d.pity, free_available: d.free_available } : s));
      if (d.used === 'paid') { toast(`已消耗 ${price} 金币`); refreshUser?.(); }
      setTimeout(() => {
        setResult(r); setRolling(false); setShowResult(true); setCount(c => c + 1);
        if (d.tier === 'SSR') { setConfetti(false); requestAnimationFrame(() => setConfetti(true)); setTimeout(() => setConfetti(false), 2400); }
      }, Math.max(0, revealAt - Date.now()));
    } catch (e) { setRolling(false); toast(e.message, 'err'); }
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
          <div className="qa-gacha-head-title"><h1>角色扭蛋机</h1><span>每日免费一抽</span></div>
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

          <AppButton className="qa-gacha-draw" variant="primary" size="lg" loading={rolling} disabled={busy || !gstate} onClick={draw}>
            <Dices size={19} /> {freeAvailable ? '今日免费抽一次' : <>用 <CoinIcon size={15} /> {price} 抽一次</>}
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
                {Object.entries(TIERS).map(([key, item]) => <li key={key} data-tier={key}><span>{key}</span><b>{gstate?.rates?.[key] ?? item.weight}%</b></li>)}
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
              {isAppMode() && (
                <AppButton variant="tertiary" disabled={busy} onClick={() => setShareOpen(true)}><ImagePlus size={16} /> 晒出这张卡</AppButton>
              )}
            </footer>
          </Modal>
        )}
        {isAppMode() && shareOpen && result && (
          <ShareCardSheet
            kind="character"
            payload={{
              name: result.name,
              tagline: result.tagline,
              category: result.cat,
              avatar: result.avatar ? assetUrl(result.avatar) : '',
              cover: result.background ? assetUrl(result.background) : '',
              path: '/gacha',
            }}
            onClose={() => setShareOpen(false)}
          />
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
          <button className="btn primary lg" onClick={draw} disabled={rolling || busy || !gstate}>
            <Dices size={18} /> {freeAvailable ? '抽一张（今日免费）' : <>用 <CoinIcon size={14} /> {price} 抽一张</>}
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
