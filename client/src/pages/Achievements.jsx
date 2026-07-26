import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, CountUp, CoinIcon } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { AppEmptyArt } from '../art.jsx';
import AppErrorState from '../components/AppErrorState.jsx';
import {
  Trophy, Award, Check, ChevronRight, Lock,
  MessageCircle, MessagesSquare, Send, Heart, Sparkles, UserPlus, Drama, Globe, ScrollText,
  BadgeCheck, Crown, Star, Bookmark, PenLine, Users, UserCheck, Scale, Gavel, CheckSquare,
  Landmark, CalendarCheck, Dices, ArrowLeft,
} from 'lucide-react';

const ICONS = {
  MessageCircle, MessagesSquare, Send, Heart, Sparkles, UserPlus, Drama, Globe, ScrollText,
  BadgeCheck, Crown, Star, Bookmark, PenLine, Users, UserCheck, Scale, Gavel, CheckSquare,
  Landmark, CalendarCheck, Dices, Coins: CoinIcon,
};
const CATS = ['对话', '创作', '社交', '议会', '财富'];
// Honor medal tier by reward magnitude — gives each achievement a sense of rarity.
const medalOf = (reward) => (reward >= 300 ? 'gold' : reward >= 120 ? 'silver' : 'bronze');
const INTRO_KEY = 'huanyu_ach_intro';

export default function Achievements() {
  const toast = useToast();
  const nav = useNavigate();
  const appMode = isAppMode();
  const { refreshUser } = useAuth();
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState('');
  const [appCat, setAppCat] = useState('全部');
  // Ceremonial opening animation — plays once per session.
  const [intro, setIntro] = useState(() => { try { return !sessionStorage.getItem(INTRO_KEY); } catch { return true; } });
  useEffect(() => {
    if (!intro) return;
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* */ }
    const t = setTimeout(() => setIntro(false), 2600);
    return () => clearTimeout(t);
  }, [intro]);

  const load = () => api('/achievements').then(d => { setList(d.achievements || []); setSummary(d.summary); }).catch(e => { toast(e.message, 'err'); setErr(true); }).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const claim = async (a) => {
    setBusy(a.id);
    try { const d = await api(`/achievements/${a.id}/claim`, { method: 'POST' }); toast(`已领取 ${d.reward} 金币`); refreshUser?.(); load(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const claimAll = async () => {
    const claimables = list.filter(a => a.claimable);
    if (!claimables.length) return;
    setBusy('all');
    // 并行结算：十几条逐条 await 时，每条都要吃一次完整往返，
    // 按钮能转上好几秒；一起发出去然后收账，失败的单条跳过即可。
    const results = await Promise.allSettled(
      claimables.map(a => api(`/achievements/${a.id}/claim`, { method: 'POST' }))
    );
    const total = results.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value.reward || 0) : 0), 0);
    toast(`一键领取完成，共 +${total} 金币`); refreshUser?.(); await load(); setBusy('');
  };

  const byCat = useMemo(() => {
    const g = {}; CATS.forEach(c => (g[c] = []));
    list.forEach(a => { (g[a.cat] = g[a.cat] || []).push(a); });
    return g;
  }, [list]);

  const pct = summary ? Math.round((summary.unlocked / summary.total) * 100) : 0;

  if (appMode) {
    const visible = appCat === '全部' ? list : (byCat[appCat] || []);

    return (
      <main className="qa-achievements-page">
        <header className="qa-achievements-head">
          <AppIconButton label="返回" onClick={() => nav(-1)}><ArrowLeft size={21} /></AppIconButton>
          <div className="qa-achievements-head-title"><h1>成就殿堂</h1><span>成长足迹</span></div>
          <span className="qa-achievements-head-spacer" aria-hidden="true" />
        </header>

        <div className="qa-achievements-body">
          <section className="qa-achievements-summary" aria-labelledby="qa-achievements-summary-title">
            <span className="qa-achievements-summary-icon" aria-hidden="true"><Trophy size={25} /></span>
            <div className="qa-achievements-summary-copy">
              <span>整体完成度</span>
              <h2 id="qa-achievements-summary-title"><CountUp value={summary?.unlocked || 0} format={false} /> <small>/ {summary?.total || 0} 项</small></h2>
              <div className="qa-achievements-progress" role="progressbar" aria-label="成就完成度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><span style={{ width: pct + '%' }} /></div>
              <p>{pct}% 已完成{summary?.claimable > 0 ? ` · ${summary.claimable} 项奖励待领取` : ' · 继续探索更多板块'}</p>
            </div>
          </section>

          {summary?.claimable > 0 && (
            <AppButton className="qa-achievements-claim-all" variant="primary" size="lg" loading={busy === 'all'} onClick={claimAll}>
              <CoinIcon size={18} /> 一键领取 {summary.gold_pending} 金币
            </AppButton>
          )}

          <div className="qa-achievements-tabs" role="tablist" aria-label="成就分类">
            {['全部', ...CATS].map(cat => (
              <AppButton key={cat} variant="tertiary" selected={appCat === cat} role="tab" aria-selected={appCat === cat} onClick={() => setAppCat(cat)}>{cat}</AppButton>
            ))}
          </div>

          {loading ? (
            <AppAchievementsLoading />
          ) : err && list.length === 0 ? (
            <AppErrorState kind="achievements" onRetry={() => { setErr(false); setLoading(true); load(); }} />
          ) : visible.length === 0 ? (
            <section className="qa-achievements-empty"><AppEmptyArt kind="achievements" size={104} /><h2>此分类暂无成就</h2><p>去其他板块留下新的足迹吧。</p></section>
          ) : (
            <section className="qa-achievements-list" aria-label={appCat === '全部' ? '全部成就' : `${appCat}成就`}>
              {visible.map(achievement => (
                <AppAchievementCard key={achievement.id} achievement={achievement} busy={busy === achievement.id} onClaim={claim} onGo={(link) => nav(link)} />
              ))}
            </section>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      {intro && createPortal(
        <div className="ach-intro" onClick={() => setIntro(false)}>
          <div className="ach-intro-rays" />
          <div className="ach-intro-core">
            <div className="ach-intro-trophy"><Trophy size={68} /></div>
            <div className="ach-intro-title">成就殿堂</div>
            <div className="ach-intro-sub">已点亮 <b>{summary?.unlocked ?? 0}</b> 项荣耀</div>
          </div>
          <div className="ach-intro-spark" aria-hidden="true">{Array.from({ length: 14 }).map((_, i) => <i key={i} style={{ '--i': i }} />)}</div>
        </div>,
        document.body
      )}

      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1 className="title-glow"><Trophy size={20} style={{ verticalAlign: -3, marginRight: 7 }} />成就殿堂</h1>
          <div className="sub">在各板块留下足迹，点亮荣耀、领取奖励</div>
        </div>
        {summary?.claimable > 0 && (
          <button className="btn primary" disabled={busy === 'all'} onClick={claimAll}>
            <CoinIcon size={16} /> 一键领取 {summary.gold_pending} 金币
          </button>
        )}
      </div>

      <div className="page ach-page" style={{ maxWidth: 980 }}>
        <div className="ach-hall">
          <div className="ach-hall-glow" aria-hidden="true" />
          <div className="ach-hero-ring" style={{ '--p': pct }}>
            <div className="ach-hero-num"><b><CountUp value={summary?.unlocked || 0} format={false} /></b><span>/ {summary?.total || 0}</span></div>
          </div>
          <div className="ach-hero-tx">
            <div className="ach-hall-badge"><Crown size={13} /> 荣誉殿堂</div>
            <b>已铭刻 {summary?.unlocked || 0} 项成就</b>
            <p>横跨对话、创作、社交、议会与财富——每一次足迹都化作殿堂之光。{summary?.claimable > 0 && <span className="ach-pending">　{summary.claimable} 项荣誉奖励待领取！</span>}</p>
            <div className="ach-hero-bar"><span style={{ width: pct + '%' }} /></div>
            <div className="ach-hall-stat"><span>完成度 {pct}%</span><span>·</span><span>金牌 {list.filter(a => a.unlocked && medalOf(a.reward) === 'gold').length}</span><span>银牌 {list.filter(a => a.unlocked && medalOf(a.reward) === 'silver').length}</span><span>铜牌 {list.filter(a => a.unlocked && medalOf(a.reward) === 'bronze').length}</span></div>
          </div>
        </div>

        {loading ? <div className="empty">载入中…</div> : CATS.map(cat => (byCat[cat]?.length ? (
          <section key={cat} className="ach-cat">
            <div className="section-title"><h2>{cat}</h2><span className="muted" style={{ fontSize: 13 }}>{byCat[cat].filter(a => a.unlocked).length}/{byCat[cat].length}</span></div>
            <div className="ach-grid">
              {byCat[cat].map(a => {
                const Ic = ICONS[a.icon] || Award;
                const p = Math.round((a.value / a.goal) * 100);
                const medal = medalOf(a.reward);
                return (
                  <div key={a.id} className={'ach-card medal-' + medal + (a.unlocked ? ' unlocked' : '') + (a.claimed ? ' claimed' : '')}>
                    <span className="ach-ic-wrap">
                      <span className="ach-ic"><Ic size={22} /></span>
                      {a.unlocked && <span className="ach-ic-check"><Check size={11} /></span>}
                    </span>
                    <div className="ach-body">
                      <div className="ach-name">{a.name}{!a.unlocked && <Lock size={12} className="ach-lock" />}</div>
                      <div className="ach-desc">{a.desc}</div>
                      {!a.unlocked && (
                        <div className="ach-prog"><div className="ach-prog-bar"><span style={{ width: p + '%' }} /></div><small>{a.value}/{a.goal}</small></div>
                      )}
                    </div>
                    <div className="ach-side">
                      <span className="ach-reward"><CoinIcon size={12} /> {a.reward}</span>
                      {a.claimed ? <span className="ach-state done"><Check size={13} /> 已领取</span>
                        : a.claimable ? <button className="btn sm primary" disabled={busy === a.id} onClick={() => claim(a)}>领取</button>
                          : <button className="ach-go" onClick={() => nav(a.link)}>去完成 <ChevronRight size={13} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null))}
      </div>
    </>
  );
}

function AppAchievementsLoading() {
  return (
    <section className="qa-achievements-loading" role="status" aria-label="正在载入成就">
      {[0, 1, 2, 3].map(index => (
        <div className="qa-achievements-skeleton" key={index} aria-hidden="true">
          <span className="skel qa-achievements-skeleton-icon" />
          <span className="qa-achievements-skeleton-copy"><i className="skel is-title" /><i className="skel is-line" /><i className="skel is-progress" /></span>
        </div>
      ))}
    </section>
  );
}

function AppAchievementCard({ achievement, busy, onClaim, onGo }) {
  const Icon = ICONS[achievement.icon] || Award;
  const progress = Math.min(100, Math.round((achievement.value / achievement.goal) * 100));

  return (
    <article className={`qa-achievements-card${achievement.unlocked ? ' is-unlocked' : ''}${achievement.claimed ? ' is-claimed' : ''}`}>
      <span className="qa-achievements-card-icon" aria-hidden="true"><Icon size={21} />{achievement.unlocked && <i><Check size={11} /></i>}</span>
      <div className="qa-achievements-card-copy">
        <div className="qa-achievements-card-title"><h2>{achievement.name}</h2>{!achievement.unlocked && <Lock size={13} />}</div>
        <p>{achievement.desc}</p>
        {!achievement.unlocked && (
          <div className="qa-achievements-card-progress">
            <span className="qa-achievements-card-progress-bar"><i style={{ width: progress + '%' }} /></span>
            <small>{achievement.value}/{achievement.goal}</small>
          </div>
        )}
        <div className="qa-achievements-card-foot">
          <span className="qa-achievements-reward"><CoinIcon size={14} /> {achievement.reward} 金币</span>
          {achievement.claimed ? (
            <span className="qa-achievements-claimed"><Check size={14} /> 已领取</span>
          ) : achievement.claimable ? (
            <AppButton variant="primary" loading={busy} onClick={() => onClaim(achievement)}>领取奖励</AppButton>
          ) : (
            <AppButton variant="secondary" onClick={() => onGo(achievement.link)}>去完成 <ChevronRight size={16} /></AppButton>
          )}
        </div>
      </div>
    </article>
  );
}
