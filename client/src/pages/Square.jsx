// 广场 —— app 壳「首页」的浏览页（按设计系统）。
// 顶部：广场品牌 + 推荐/关注/榜单 分段 + 搜索 + 签到；
// 今日精选：横向故事横幅；热门推荐：2 列角色卡网格（封面/名字/标签/🔥热度）。
// 数据全部走既有端点，无新协议。
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { CoverArt } from '../art.jsx';
import { cnToday, fmtNum } from '../util.js';
import {
  Search, Flame, ChevronRight, Sparkles, CalendarCheck, Check, Bell, BookHeart
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };
// 热度：过万转「1.2w」。
const fmtW = (n) => { n = n || 0; return n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + 'w' : String(n); };

const TABS = [{ id: 'rec', label: '推荐' }, { id: 'follow', label: '关注' }, { id: 'rank', label: '榜单' }];

export default function Square() {
  const nav = useNavigate();
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('rec');
  const [rec, setRec] = useState(null);
  const [rank, setRank] = useState(null);
  const [follow, setFollow] = useState(null);
  const [feat, setFeat] = useState([]);
  const [unread, setUnread] = useState(0);
  const [checked, setChecked] = useState(() => !!user?.last_checkin && user.last_checkin === cnToday());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/characters/public?sort=hot&limit=30').then(d => {
      const cs = d.characters || [];
      setRank(cs);
      setRec(r => r || cs);
      setFeat((cs.filter(c => c.featured).concat(cs)).filter((c, i, a) => a.findIndex(x => x.id === c.id) === i).slice(0, 5));
    }).catch(() => { setRank([]); setRec(r => r || []); });
    api('/characters/recommended').then(d => { const cs = d.characters || []; if (cs.length) setRec(cs); }).catch(() => {});
    api('/characters/favorites/list').then(d => setFollow(d.characters || [])).catch(() => setFollow([]));
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
  }, []);
  useRealtimeEvent('notification', () => setUnread(u => u + 1));
  useRealtimeEvent('character_new', (data) => {
    const c = data?.character; if (!c) return;
    setRank(prev => prev ? (prev.some(x => x.id === c.id) ? prev : [{ ...c, uses: 0 }, ...prev]) : prev);
  });

  const checkin = useCallback(async () => {
    if (busy || checked) return;
    setBusy(true);
    try { const d = await api('/economy/checkin', { method: 'POST' }); setChecked(true); toast(`签到成功 · +${d.reward} 金币 · 连续 ${d.streak} 天`); refreshUser?.(); }
    catch (e) { setChecked(true); toast(e?.message || '今天已签到'); }
    finally { setBusy(false); }
  }, [busy, checked, toast, refreshUser]);

  const list = tab === 'rec' ? rec : tab === 'rank' ? rank : follow;

  return (
    <div className="sq">
      {/* 顶部：品牌 + 分段 + 搜索/通知/签到 */}
      <div className="sq-top">
        <div className="sq-tabbar">
          {TABS.map(t => (
            <button key={t.id} className={'sq-tab' + (t.id === tab ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="sq-top-acts">
          <button className={'sq-checkin' + (checked ? ' done' : '')} onClick={checkin} disabled={busy}>
            {checked ? <><Check size={13} /> 已签</> : <><CalendarCheck size={13} /> 签到</>}
          </button>
          <button className="sq-ic" onClick={openCmdk} aria-label="搜索"><Search size={20} /></button>
          <button className="sq-ic" onClick={() => nav('/notifications')} aria-label="通知">
            <Bell size={20} />{unread > 0 && <i className="sq-dot" />}
          </button>
        </div>
      </div>

      <div className="sq-scroll">
        {/* 今日精选 —— 横向故事横幅 */}
        {feat.length > 0 && (
          <>
            <div className="sq-sec-h"><h2><Sparkles size={16} /> 今日精选</h2>
              <button className="sq-more" onClick={() => nav('/')}>沉浸模式 <ChevronRight size={14} /></button></div>
            <div className="sq-feat-rail">
              {feat.map(c => (
                <button key={c.id} className="sq-feat" onClick={() => nav('/character/' + c.id)}>
                  {c.avatar ? <img src={c.avatar} alt="" loading="lazy" decoding="async" /> : <div className="sq-feat-ph cover-art-box"><CoverArt name={c.name} /></div>}
                  <span className="sq-feat-scrim" />
                  <span className="sq-feat-badge"><BookHeart size={11} /> 精选</span>
                  <div className="sq-feat-tx"><b>{c.name}</b><span>{c.tagline || c.intro || '一段等待开启的故事'}</span></div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* 热门推荐 —— 2 列角色卡网格 */}
        <div className="sq-sec-h"><h2><Flame size={16} /> 热门推荐</h2>
          <button className="sq-more" onClick={() => nav('/leaderboard')}>排行榜 <ChevronRight size={14} /></button></div>
        {list === null ? (
          <div className="sq-grid">{[0, 1, 2, 3].map(i => <div key={i} className="sq-card-skel" />)}</div>
        ) : list.length === 0 ? (
          <div className="sq-empty">{tab === 'follow' ? '还没有收藏的角色 —— 去收藏喜欢的角色吧' : '暂无内容'}</div>
        ) : (
          <div className="sq-grid">
            {list.map(c => (
              <button key={c.id} className="sq-card" onClick={() => nav('/character/' + c.id)}>
                <div className="sq-card-cv">
                  {c.avatar ? <img src={c.avatar} alt="" loading="lazy" decoding="async" /> : <div className="cover-art-box"><CoverArt name={c.name} /></div>}
                  <span className="sq-card-scrim" />
                  <span className="sq-card-heat"><Flame size={11} /> {fmtW(c.uses)}</span>
                  <div className="sq-card-foot">
                    <b>{c.name}</b>
                    <span className="sq-card-author"><Avatar src={c.owner_avatar} name={c.owner_name} size={15} /> {c.owner_name}<CreatorV tier={c.owner_tier} size={10} /></span>
                  </div>
                </div>
                <div className="sq-card-tags">
                  {(c.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 3).map(t => <span key={t}>{t}</span>)}
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="sq-bottom-space" />
      </div>
    </div>
  );
}
