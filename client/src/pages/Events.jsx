import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useToast, CoinIcon, DiamondIcon } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { AppEmptyArt } from '../art.jsx';
import AppErrorState from '../components/AppErrorState.jsx';
import { PartyPopper, Gift, Check, ArrowRight, Copy, Users, ListChecks, ArrowLeft } from 'lucide-react';

// Event accents are semantic and stable. They are deliberately independent
// from the user's global accent so the activity feed does not become one teal
// wall while still avoiding arbitrary server-provided colours in the App UI.
const eventTone = (event, index) => {
  const tag = String(event?.tag || '').toLowerCase();
  if (event?.kind === 'claim') return 'gold';
  if (tag.includes('联机') || tag.includes('群')) return 'indigo';
  if (tag.includes('反馈') || tag.includes('公告')) return 'coral';
  return ['blue', 'rose', 'graphite'][index % 3];
};

export default function Events() {
  const app = isAppMode();
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [busy, setBusy] = useState('');
  const nav = useNavigate();
  const toast = useToast();
  const { refreshUser } = useAuth();

  const load = () => api('/engage/events').then(d => setEvents(d.events)).catch(e => { toast(e.message, 'err'); setErr(true); });
  const loadTasks = () => api('/engage/tasks').then(d => setTasks(d.tasks)).catch(() => {});
  useEffect(() => { load(); loadTasks(); /* eslint-disable-next-line */ }, []);

  const claimTask = (t) => async () => {
    setBusy('t-' + t.id);
    try { const d = await api(`/engage/tasks/${t.id}/claim`, { method: 'POST' }); toast(`领取成功！+${d.reward} 金币`); await refreshUser(); await loadTasks(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };

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
  const TasksRoot = app ? 'section' : 'div';

  return (
    <>
      <div className={app ? 'topbar qa-events-header' : 'topbar'}>
        {app && <AppIconButton className="qa-events-back" label="返回上一页" onClick={() => nav(-1)}><ArrowLeft size={20} /></AppIconButton>}
        <div style={{ flex: 1 }}><h1>活动中心</h1><div className="sub">领奖励 · 玩联机 · 提反馈，幻域因你更精彩</div></div>
      </div>
      <div className={app ? 'page qa-events-page' : 'page'}>
        {app && !tasks && <div className="qa-events-task-loading" role="status" aria-label="正在载入每日任务"><i className="skel" /><i className="skel" /></div>}
        {tasks && (
          <TasksRoot className={app ? 'card daily-tasks qa-events-tasks' : 'card daily-tasks'}>
            <div className="section-title"><h2><ListChecks size={17} style={{ verticalAlign: -3, marginRight: 6 }} />每日任务</h2>
              <span className="muted" style={{ fontSize: 12.5 }}>每日 0 点刷新</span></div>
            {tasks.map(t => (
              <div key={t.id} className={'task-row' + (app ? ' qa-events-task' : '') + (t.claimed ? ' claimed' : '')}>
                <div className="tk-tx">
                  <b>{t.name}</b>
                  <div className="tk-bar"><span style={{ width: Math.round(t.progress / t.target * 100) + '%' }} /></div>
                </div>
                <span className="tk-reward"><CoinIcon size={13} /> {t.reward}</span>
                <AppButton className="btn sm primary" variant="primary" loading={app && busy === 't-' + t.id} disabled={!t.done || t.claimed || busy === 't-' + t.id} onClick={claimTask(t)}>
                  {t.claimed ? '已领取' : t.done ? '领取' : `${t.progress}/${t.target}`}
                </AppButton>
              </div>
            ))}
          </TasksRoot>
        )}
        {!events ? (app ? (err ? <AppErrorState kind="events" onRetry={() => { setErr(false); load(); }} /> : <div className="qa-events-loading" role="status" aria-label="正在载入活动"><i className="skel" /><i className="skel" /><i className="skel" /></div>) : <div className="empty">载入中…</div>) : events.length === 0 && app ? (
          <div className="empty qa-events-empty"><AppEmptyArt kind="events" size={104} />当前暂无活动</div>
        ) : (
          <>
            {app && events.length > 0 && (
              <div className="qa-events-section-head">
                <h2>正在进行</h2>
                <span>{events.length} 项活动</span>
              </div>
            )}
            <div className={app ? 'event-grid qa-events-list' : 'event-grid'}>
              {events.map((ev, index) => {
                const EventRoot = app ? 'article' : 'div';
                return (
                <EventRoot key={ev.id} className={app ? 'event-card qa-events-card' : 'event-card'} data-tone={app ? eventTone(ev, index) : undefined} style={app ? undefined : { '--ev': ev.accent }}>
                <div className="ev-top">
                  <span className="ev-tag">{ev.tag}</span>
                  {ev.kind === 'claim' && ev.claimed && <span className="ev-done"><Check size={13} /> 已领取</span>}
                </div>
                <div className="ev-ic"><PartyPopper size={20} /></div>
                <h3>{ev.title}</h3>
                <p>{ev.desc}</p>

                {ev.reward && (ev.reward.gold > 0 || ev.reward.diamond > 0) && (
                  <div className="ev-reward">
                    {ev.reward.gold > 0 && <span><CoinIcon size={14} /> {ev.reward.gold} 金币</span>}
                    {ev.reward.diamond > 0 && <span><DiamondIcon size={14} /> {ev.reward.diamond} 钻石</span>}
                  </div>
                )}

                <div className="ev-actions">
                  {ev.kind === 'claim' && (
                    <AppButton className="btn primary block" variant="primary" loading={app && busy === ev.id} disabled={ev.claimed || busy === ev.id} onClick={claim(ev)}>
                      {ev.claimed ? <><Check size={15} /> 已领取</> : <><Gift size={15} /> 立即领取</>}
                    </AppButton>
                  )}
                  {ev.link && (
                    <AppButton className={'btn block' + (ev.kind === 'claim' ? '' : ' primary')} variant={ev.kind === 'claim' ? 'secondary' : 'primary'} onClick={() => nav(ev.link)}>
                      {ev.tag === '联机' ? <Users size={15} /> : <ArrowRight size={15} />} {ev.linkText || '前往'}
                    </AppButton>
                  )}
                  {ev.qq && (
                    <AppButton className="btn block" onClick={copyQQ(ev.qq)}><Copy size={15} /> 复制官方 QQ {ev.qq}</AppButton>
                  )}
                </div>
                </EventRoot>
              );})}
            </div>
          </>
        )}
      </div>
    </>
  );
}
