import React, { useEffect, useMemo, useState } from 'react';
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

export default function Achievements() {
  const toast = useToast();
  const nav = useNavigate();
  const { refreshUser } = useAuth();
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

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
    for (const a of claimables) {
      try { const d = await api(`/achievements/${a.id}/claim`, { method: 'POST' }); total += d.reward; } catch { /* skip */ }
    }
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
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1><Trophy size={20} style={{ verticalAlign: -3, marginRight: 7 }} />成就殿堂</h1>
          <div className="sub">在各板块留下足迹，解锁成就、领取金币</div>
        </div>
        {summary?.claimable > 0 && (
          <button className="btn primary" disabled={busy === 'all'} onClick={claimAll}>
            <Coins size={16} /> 一键领取 {summary.gold_pending} 金币
          </button>
        )}
      </div>

      <div className="page" style={{ maxWidth: 960 }}>
        <div className="ach-hero">
          <div className="ach-hero-ring" style={{ '--p': pct }}>
            <div className="ach-hero-num"><b><CountUp value={summary?.unlocked || 0} format={false} /></b><span>/ {summary?.total || 0}</span></div>
          </div>
          <div className="ach-hero-tx">
            <b>已解锁 {summary?.unlocked || 0} 项成就</b>
            <p>持续探索对话、创作、社交、议会与财富各板块，点亮全部 {summary?.total || 0} 项成就。{summary?.claimable > 0 && <span className="ach-pending">　有 {summary.claimable} 项奖励待领取！</span>}</p>
            <div className="ach-hero-bar"><span style={{ width: pct + '%' }} /></div>
          </div>
        </div>

        {loading ? <div className="empty">载入中…</div> : CATS.map(cat => (byCat[cat]?.length ? (
          <section key={cat} className="ach-cat">
            <div className="section-title"><h2>{cat}</h2><span className="muted" style={{ fontSize: 13 }}>{byCat[cat].filter(a => a.unlocked).length}/{byCat[cat].length}</span></div>
            <div className="ach-grid">
              {byCat[cat].map(a => {
                const Ic = ICONS[a.icon] || Award;
                const p = Math.round((a.value / a.goal) * 100);
                return (
                  <div key={a.id} className={'ach-card' + (a.unlocked ? ' unlocked' : '') + (a.claimed ? ' claimed' : '')}>
                    <span className="ach-ic"><Ic size={22} />{a.unlocked && <span className="ach-ic-check"><Check size={11} /></span>}</span>
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
