import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { PartyPopper, Coins, Gem, Gift, Check, ArrowRight, Copy, Users } from 'lucide-react';

export default function Events() {
  const [events, setEvents] = useState(null);
  const [busy, setBusy] = useState('');
  const nav = useNavigate();
  const toast = useToast();
  const { refreshUser } = useAuth();

  const load = () => api('/engage/events').then(d => setEvents(d.events)).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const claim = (ev) => async () => {
    setBusy(ev.id);
    try {
      await api(`/engage/events/${ev.id}/claim`, { method: 'POST' });
      const parts = [ev.reward?.gold && `+${ev.reward.gold} 金币`, ev.reward?.diamond && `+${ev.reward.diamond} 钻石`].filter(Boolean).join(' · ');
      toast('领取成功！' + parts);
      await refreshUser(); await load();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const copyQQ = (qq) => async () => {
    try { await navigator.clipboard.writeText(qq); toast('已复制官方技术 QQ：' + qq); }
    catch { toast('复制失败，QQ：' + qq, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>活动中心</h1><div className="sub">领奖励 · 玩联机 · 提反馈，幻域因你更精彩</div></div>
      </div>
      <div className="page">
        {!events ? <div className="empty">载入中…</div> : (
          <div className="event-grid">
            {events.map(ev => (
              <div key={ev.id} className="event-card" style={{ '--ev': ev.accent }}>
                <div className="ev-top">
                  <span className="ev-tag">{ev.tag}</span>
                  {ev.kind === 'claim' && ev.claimed && <span className="ev-done"><Check size={13} /> 已领取</span>}
                </div>
                <div className="ev-ic"><PartyPopper size={20} /></div>
                <h3>{ev.title}</h3>
                <p>{ev.desc}</p>

                {ev.reward && (ev.reward.gold > 0 || ev.reward.diamond > 0) && (
                  <div className="ev-reward">
                    {ev.reward.gold > 0 && <span><Coins size={14} /> {ev.reward.gold} 金币</span>}
                    {ev.reward.diamond > 0 && <span><Gem size={14} /> {ev.reward.diamond} 钻石</span>}
                  </div>
                )}

                <div className="ev-actions">
                  {ev.kind === 'claim' && (
                    <button className="btn primary block" disabled={ev.claimed || busy === ev.id} onClick={claim(ev)}>
                      {ev.claimed ? <><Check size={15} /> 已领取</> : <><Gift size={15} /> 立即领取</>}
                    </button>
                  )}
                  {ev.link && (
                    <button className={'btn block' + (ev.kind === 'claim' ? '' : ' primary')} onClick={() => nav(ev.link)}>
                      {ev.tag === '联机' ? <Users size={15} /> : <ArrowRight size={15} />} {ev.linkText || '前往'}
                    </button>
                  )}
                  {ev.qq && (
                    <button className="btn block" onClick={copyQQ(ev.qq)}><Copy size={15} /> 复制官方 QQ {ev.qq}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
