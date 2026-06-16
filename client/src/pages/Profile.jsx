import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Crown, Coins, Gem, Settings, ScrollText, UserPlus, UserCheck, LogOut, Wallet, Drama, Heart } from 'lucide-react';

export default function Profile() {
  const { id } = useParams();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const targetId = id || user?.id;
  const isMe = String(targetId) === String(user?.id);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('characters');
  const [following, setFollowing] = useState(false);

  const load = () => api('/users/' + targetId).then(d => { setData(d); setFollowing(d.following); }).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [targetId]);
  if (!data) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  const u = data.user;

  const toggleFollow = async () => {
    try { const d = await api('/social/follow/' + targetId, { method: 'POST' }); setFollowing(d.following); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>{isMe ? '个人中心' : u.display_name}</h1><div className="sub">@{u.username}</div></div>
        {isMe ? (
          <>
            <button className="btn" onClick={() => nav('/settings')}><Settings size={15} /> 设置</button>
            <button className="btn ghost" onClick={logout}><LogOut size={15} /></button>
          </>
        ) : (
          <button className={'btn ' + (following ? '' : 'primary')} onClick={toggleFollow}>
            {following ? <><UserCheck size={15} /> 已关注</> : <><UserPlus size={15} /> 关注</>}
          </button>
        )}
      </div>

      <div className="page">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ height: 150, background: u.banner ? `url(${u.banner}) center/cover` : 'linear-gradient(135deg, #e7d8c0, #d8c3a4)' }} />
          <div style={{ padding: '0 24px 22px', marginTop: -42 }}>
            <div className="profile-head" style={{ alignItems: 'flex-end' }}>
              <div style={{ border: '4px solid var(--panel)', borderRadius: '50%' }}><Avatar src={u.avatar} name={u.display_name} size={84} /></div>
              <div style={{ flex: 1, paddingBottom: 6 }}>
                <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {u.display_name} {u.vip && <span className="vip-badge"><Crown size={12} /> VIP</span>}
                </h2>
                <div className="muted" style={{ fontSize: 14 }}>{u.bio || '这位玩家还没有写简介'}</div>
              </div>
            </div>
            <div className="stat-row">
              <div className="s"><b>{data.stats.characters}</b><span>角色</span></div>
              <div className="s"><b>{data.stats.scripts}</b><span>剧本</span></div>
              <div className="s"><b>{data.stats.followers}</b><span>粉丝</span></div>
              <div className="s"><b>{data.stats.following}</b><span>关注</span></div>
            </div>
            {isMe && (
              <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                <span className="coin gold"><Coins size={14} /> {user.gold} 金币</span>
                <span className="coin diamond"><Gem size={14} /> {user.diamond} 钻石</span>
                <button className="btn sm" onClick={() => nav('/wallet')}><Wallet size={14} /> 钱包 / 充值</button>
              </div>
            )}
          </div>
        </div>

        <div className="tabs-bar" style={{ marginTop: 24 }}>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>角色 ({data.characters.length})</button>
          <button className={tab === 'scripts' ? 'active' : ''} onClick={() => setTab('scripts')}>剧本 ({data.scripts.length})</button>
          <button className={tab === 'moments' ? 'active' : ''} onClick={() => setTab('moments')}>动态 ({data.moments.length})</button>
        </div>

        {tab === 'characters' && (data.characters.length === 0 ? <div className="empty" style={{ padding: 40 }}>暂无公开角色</div> : (
          <div className="grid">
            {data.characters.map(c => (
              <div key={c.id} className="char-card" onClick={() => nav('/character/' + c.id + '/edit')}>
                <div className="cover">{c.avatar ? <img src={c.avatar} alt="" /> : <div className="ph"><Drama size={46} /></div>}</div>
                <div className="meta"><h3>{c.name}</h3><p>{c.tagline || c.intro}</p></div>
              </div>
            ))}
          </div>
        ))}
        {tab === 'scripts' && (data.scripts.length === 0 ? <div className="empty" style={{ padding: 40 }}>暂无剧本</div> : (
          <div className="grid">
            {data.scripts.map(s => (
              <div key={s.id} className="char-card" onClick={() => nav('/script/' + s.id)}>
                <div className="cover">{s.cover ? <img src={s.cover} alt="" /> : <div className="ph"><ScrollText size={32} /></div>}
                  <div className="pill-pub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.price_gold > 0 ? <><Coins size={12} /> {s.price_gold}</> : '免费'}</div></div>
                <div className="meta"><h3>{s.title}</h3><p>{s.summary}</p></div>
              </div>
            ))}
          </div>
        ))}
        {tab === 'moments' && (data.moments.length === 0 ? <div className="empty" style={{ padding: 40 }}>暂无动态</div> : (
          data.moments.map(m => (
            <div key={m.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{m.text}</div>
              {m.image && <img src={m.image} style={{ marginTop: 10, borderRadius: 12, maxHeight: 240, maxWidth: '100%' }} alt="" />}
              <div className="muted" style={{ fontSize: 12, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}><Heart size={12} fill="currentColor" /> {m.likes} · {m.created_at}</div>
            </div>
          ))
        ))}
      </div>
    </>
  );
}
