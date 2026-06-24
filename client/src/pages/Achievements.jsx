import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, CountUp } from '../ui.jsx';
import {
  Trophy, Award, Coins, Check, ChevronRight, Lock,
  MessageCircle, MessagesSquare, Send, Heart, Sparkles, UserPlus, Drama, Globe, ScrollText,
  BadgeCheck, Crown, Star, Bookmark, PenLine, Users, UserCheck, Scale, Gavel, CheckSquare,
  Landmark, CalendarCheck, Dices,
} from 'lucide-react';

const ICONS = {
  MessageCircle, MessagesSquare, Send, Heart, Sparkles, UserPlus, Drama, Globe, ScrollText,
  BadgeCheck, Crown, Star, Bookmark, PenLine, Users, UserCheck, Scale, Gavel, CheckSquare,
  Landmark, CalendarCheck, Dices, Coins,
};
const CATS = ['对话', '创作', '社交', '议会', '财富'];
// Honor medal tier by reward magnitude — gives each achievement a sense of rarity.
const medalOf = (reward) => (reward >= 300 ? 'gold' : reward >= 120 ? 'silver' : 'bronze');
const INTRO_KEY = 'huanyu_ach_intro';

export default function Achievements() {
  const toast = useToast();
  const nav = useNavigate();
  const { refreshUser } = useAuth();
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  // Ceremonial opening animation — plays once per session.
  const [intro, setIntro] = useState(() => { try { return !sessionStorage.getItem(INTRO_KEY); } catch { return true; } });
  useEffect(() => {
    if (!intro) return;
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* */ }
    const t = setTimeout(() => setIntro(false), 2600);
    return () => clearTimeout(t);
  }, [intro]);

  const load = () => api('/achievements').then(d => { setList(d.achievements || []); setSummary(d.summary); }).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
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
    let total = 0;
    for (const a of claimables) { try { const d = await api(`/achievements/${a.id}/claim`, { method: 'POST' }); total += d.reward; } catch { /* skip */ } }
    toast(`一键领取完成，共 +${total} 金币`); refreshUser?.(); await load(); setBusy('');
  };

  const byCat = useMemo(() => {
    const g = {}; CATS.forEach(c => (g[c] = []));
    list.forEach(a => { (g[a.cat] = g[a.cat] || []).push(a); });
    return g;
  }, [list]);

  const pct = summary ? Math.round((summary.unlocked / summary.total) * 100) : 0;

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
            <Coins size={16} /> 一键领取 {summary.gold_pending} 金币
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
                      <span className="ach-reward"><Coins size={12} /> {a.reward}</span>
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
