import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, CountUp, IdentityBadges, CoinIcon, DiamondIcon } from '../ui.jsx';
import { Settings, ScrollText, UserPlus, UserCheck, LogOut, Wallet, Drama, Heart, BadgeCheck, Crown, X, Pencil, Share2, Check, MessageSquare } from 'lucide-react';
import { pid } from '../assets.jsx';
import { shareUrl } from '../util.js';
import { CoverArt } from '../art.jsx';
import ReportButton from '../components/ReportButton.jsx';

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
  const [listModal, setListModal] = useState(null); // { kind, title, users }
  const [fr, setFr] = useState({ state: 'none', can_dm: false });

  const load = () => api('/users/' + targetId).then(d => { setData(d); setFollowing(d.following); }).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [targetId]);
  useEffect(() => { if (!isMe && targetId) api('/friends/state/' + targetId).then(setFr).catch(() => {}); /* eslint-disable-next-line */ }, [targetId, isMe]);
  const friendAction = async () => {
    try {
      if (fr.state === 'pending_in') { /* accept: find the request — simplest: send request back which auto-accepts */ await api('/friends/request/' + targetId, { method: 'POST' }); toast('已添加为好友'); }
      else if (fr.state === 'friends') { if (!confirm('解除好友关系？')) return; await api('/friends/' + targetId, { method: 'DELETE' }); toast('已解除好友'); }
      else { const d = await api('/friends/request/' + targetId, { method: 'POST' }); toast(d.state === 'friends' ? '已成为好友' : '好友申请已发送'); }
      api('/friends/state/' + targetId).then(setFr).catch(() => {});
    } catch (e) { toast(e.message, 'err'); }
  };
  if (!data) return <><div className="topbar"><div style={{ flex: 1 }}><h1>个人中心</h1></div></div><div className="page"><div className="empty">载入中…</div></div></>;
  const u = data.user;

  const shareProfile = async () => {
    const url = shareUrl('/user/' + u.id);
    try { await navigator.clipboard.writeText(url); toast('主页链接已复制'); }
    catch { toast('复制失败：' + url, 'err'); }
  };
  const toggleFollow = async () => {
    try { const d = await api('/social/follow/' + targetId, { method: 'POST' }); setFollowing(d.following); load(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const openList = async (kind) => {
    try { const d = await api(`/users/${targetId}/${kind}`); setListModal({ kind, title: kind === 'followers' ? '粉丝' : '关注', users: d.users }); }
    catch (e) { toast(e.message, 'err'); }
  };
  const followInList = async (uid) => {
    try { const d = await api('/social/follow/' + uid, { method: 'POST' });
      setListModal(lm => lm ? { ...lm, users: lm.users.map(x => x.id === uid ? { ...x, following: d.following } : x) } : lm); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>{isMe ? '个人中心' : u.display_name}</h1><div className="sub">@{u.username} · {pid('user', u.id)}</div></div>
        <button className="btn ghost" onClick={shareProfile} title="复制主页链接"><Share2 size={15} /></button>
        {isMe ? (
          <>
            <button className="btn" onClick={() => nav('/settings')}><Settings size={15} /> 设置</button>
            <button className="btn ghost" onClick={logout}><LogOut size={15} /></button>
          </>
        ) : (
          <>
            <button className={'btn ' + (fr.state === 'friends' ? '' : 'primary')} onClick={friendAction}>
              {fr.state === 'friends' ? <><Check size={15} /> 已是好友</>
                : fr.state === 'pending_out' ? <><UserPlus size={15} /> 待通过</>
                  : fr.state === 'pending_in' ? <><UserPlus size={15} /> 接受申请</>
                    : <><UserPlus size={15} /> 加好友</>}
            </button>
            {(fr.state === 'friends' || fr.can_dm) && <button className="btn" onClick={() => nav('/friends?dm=' + u.id)}><MessageSquare size={15} /> 私信</button>}
            <button className={'btn ' + (following ? 'ghost' : '')} onClick={toggleFollow}>
              {following ? <><UserCheck size={15} /> 已关注</> : <><UserPlus size={15} /> 关注</>}
            </button>
            <ReportButton type="user" id={u.id} label="举报用户" />
          </>
        )}
      </div>

      <div className="page">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ height: 150, background: u.banner ? `url(${u.banner}) center/cover` : 'linear-gradient(135deg, #e7d8c0, #d8c3a4)' }} />
          <div style={{ padding: '0 24px 22px', marginTop: -42 }}>
            <div className="profile-head" style={{ alignItems: 'flex-end' }}>
              <div style={{ border: '4px solid var(--panel)', borderRadius: '50%' }}><Avatar src={u.avatar} name={u.display_name} size={84} /></div>
              <div style={{ flex: 1, paddingBottom: 6, minWidth: 0 }}>
                <h2 className="pf-name">{u.display_name}</h2>
                <IdentityBadges u={u} />
                <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>{u.bio || '这位玩家还没有写简介'}</div>
              </div>
            </div>
            <div className="stat-row">
              <div className="s" onClick={() => setTab('characters')} style={{ cursor: 'pointer' }}><b><CountUp value={data.stats.characters} /></b><span>角色</span></div>
              <div className="s" onClick={() => setTab('scripts')} style={{ cursor: 'pointer' }}><b><CountUp value={data.stats.scripts} /></b><span>剧本</span></div>
              <div className="s" onClick={() => openList('followers')} style={{ cursor: 'pointer' }}><b><CountUp value={data.stats.followers} /></b><span>粉丝</span></div>
              <div className="s" onClick={() => openList('following')} style={{ cursor: 'pointer' }}><b><CountUp value={data.stats.following} /></b><span>关注</span></div>
              {data.stats.achievements != null && <div className="s" onClick={() => isMe && nav('/achievements')} style={{ cursor: isMe ? 'pointer' : 'default' }}><b><CountUp value={data.stats.achievements} /></b><span>成就</span></div>}
            </div>
            {isMe && (
              <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="coin gold"><CoinIcon size={14} /> {user.gold} 金币</span>
                <span className="coin diamond"><DiamondIcon size={14} /> {user.diamond} 钻石</span>
                <button className="btn sm" onClick={() => nav('/wallet')}><Wallet size={14} /> 钱包 / 充值</button>
                <button className="btn sm" onClick={() => nav('/settings')}><Pencil size={14} /> 编辑资料</button>
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
              <div key={c.id} className="char-card" onClick={() => nav('/character/' + c.id)}>
                <div className="cover">{c.avatar ? <img src={c.avatar} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}</div>
                <div className="meta"><h3>{c.name}</h3><p>{c.tagline || c.intro}</p></div>
              </div>
            ))}
          </div>
        ))}
        {tab === 'scripts' && (data.scripts.length === 0 ? <div className="empty" style={{ padding: 40 }}>暂无剧本</div> : (
          <div className="grid">
            {data.scripts.map(s => (
              <div key={s.id} className="char-card" onClick={() => nav('/script/' + s.id)}>
                <div className="cover">{s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <div className="ph"><ScrollText size={32} /></div>}
                  <div className="pill-pub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.price_gold > 0 ? <><CoinIcon size={12} /> {s.price_gold}</> : '免费'}</div></div>
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

      {listModal && (
        <div className="modal-backdrop" onClick={() => setListModal(null)}>
          <div className="card modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="section-title"><h2>{listModal.title} · {listModal.users.length}</h2>
              <button className="btn ghost sm" onClick={() => setListModal(null)}><X size={16} /></button></div>
            {listModal.users.length === 0 ? <div className="empty" style={{ padding: 30 }}>还没有{listModal.title}</div> : (
              <div className="user-list">
                {listModal.users.map(uu => (
                  <div key={uu.id} className="ul-row">
                    <div className="ul-info" onClick={() => { setListModal(null); nav('/user/' + uu.id); }}>
                      <Avatar src={uu.avatar} name={uu.display_name} size={40} />
                      <div style={{ minWidth: 0 }}>
                        <b style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{uu.display_name}
                          {uu.verified && <BadgeCheck size={13} style={{ color: 'var(--diamond)' }} />}
                          {uu.svip ? <span className="svip-badge">SVIP</span> : uu.vip ? <span className="vip-badge"><Crown size={10} /> VIP</span> : null}</b>
                        <span className="muted" style={{ fontSize: 12.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uu.bio || '@' + uu.username}</span>
                      </div>
                    </div>
                    {uu.id !== user?.id && (
                      <button className={'btn sm' + (uu.following ? '' : ' primary')} onClick={() => followInList(uu.id)}>
                        {uu.following ? '已关注' : '关注'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
