import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Uploader } from '../ui.jsx';
import { Heart, MessageCircle, Send, Trash2, Inbox, UserPlus, Check, Sparkles } from 'lucide-react';

function SuggestedPeople() {
  const nav = useNavigate();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [done, setDone] = useState({});
  useEffect(() => { api('/social/suggested').then(d => setUsers(d.users)).catch(() => {}); }, []);
  if (!users.length) return null;
  const follow = async (e, u) => {
    e.stopPropagation();
    try { await api('/social/follow/' + u.id, { method: 'POST' }); setDone(d => ({ ...d, [u.id]: true })); toast('已关注 ' + u.display_name); }
    catch (err) { toast(err.message, 'err'); }
  };
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16 }}><Sparkles size={15} style={{ verticalAlign: -2, color: 'var(--accent)' }} /> 你可能感兴趣的人</h2>
      </div>
      <div className="people-rail">
        {users.map(u => (
          <div key={u.id} className="person-chip" onClick={() => nav('/user/' + u.id)}>
            <Avatar src={u.avatar} name={u.display_name} size={52} />
            <b>{u.display_name}</b>
            <span className="muted">{u.followers} 粉丝 · {u.chars} 角色</span>
            <button className={'btn sm' + (done[u.id] ? '' : ' primary')} onClick={e => follow(e, u)} disabled={done[u.id]}>
              {done[u.id] ? <><Check size={13} /> 已关注</> : <><UserPlus size={13} /> 关注</>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Comments({ moment, onCount }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/social/moments/${moment.id}/comments`)
    .then(d => setComments(d.comments)).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const post = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await api(`/social/moments/${moment.id}/comments`, { method: 'POST', body: { text: t } });
      setText('');
      await load();
      onCount && onCount();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 10 }}>
      {comments.map(c => (
        <div key={c.id} className="comment">
          <span className="ava-link" onClick={() => nav('/user/' + c.user_id)} title="查看主页"><Avatar src={c.author_avatar} name={c.author_name} size={28} /></span>
          <div className="c-body">
            <b onClick={() => nav('/user/' + c.user_id)} style={{ cursor: 'pointer' }}>{c.author_name}</b>
            <span style={{ marginLeft: 6 }}>{c.text}</span>
          </div>
        </div>
      ))}
      <div className="field" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="input" placeholder="写下你的评论…" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } }} />
        <button className="btn sm" onClick={post} disabled={busy || !text.trim()}><Send size={15} /></button>
      </div>
    </div>
  );
}

export default function Community() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [scope, setScope] = useState('all');
  const [moments, setMoments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [posting, setPosting] = useState(false);
  const [openComments, setOpenComments] = useState(null);

  const load = () => {
    setLoading(true);
    api(`/social/moments?scope=${scope}`)
      .then(d => setMoments(d.moments)).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [scope]);

  const publish = async () => {
    if ((!text.trim() && !image) || posting) return;
    setPosting(true);
    try {
      await api('/social/moments', { method: 'POST', body: { text: text.trim(), image } });
      setText(''); setImage('');
      toast('已发布');
      load();
    } catch (e) { toast(e.message, 'err'); } finally { setPosting(false); }
  };

  const like = async (m) => {
    try {
      const d = await api(`/social/moments/${m.id}/like`, { method: 'POST' });
      setMoments(moments.map(x => x.id === m.id ? { ...x, liked: d.liked, likes: d.likes } : x));
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (m) => {
    if (!confirm('删除这条动态？')) return;
    try {
      await api(`/social/moments/${m.id}`, { method: 'DELETE' });
      setMoments(moments.filter(x => x.id !== m.id));
    } catch (e) { toast(e.message, 'err'); }
  };

  const bump = (m) => setMoments(ms => ms.map(x => x.id === m.id ? { ...x, comment_count: (x.comment_count || 0) + 1 } : x));

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>社区</h1>
          <div className="sub">分享你的此刻，看看大家都在想什么</div>
        </div>
      </div>

      <div className="page">
        <div className="seg" style={{ marginBottom: 16 }}>
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>推荐</button>
          <button className={scope === 'following' ? 'active' : ''} onClick={() => setScope('following')}>关注</button>
        </div>

        <SuggestedPeople />

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="field">
            <textarea className="textarea" placeholder="分享此刻的想法…" rows={3}
              value={text} onChange={e => setText(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ width: 96 }}>
              <Uploader value={image} onChange={url => setImage(url)} accept="image/*" label="配图" />
            </div>
            <div style={{ flex: 1 }} />
            <button className="btn primary" onClick={publish} disabled={posting || (!text.trim() && !image)}>
              {posting ? '发布中…' : '发布'}
            </button>
          </div>
        </div>

        {loading ? <div className="empty">载入中…</div> :
          moments.length === 0 ? (
            <div className="empty"><div className="big"><Inbox size={46} /></div>这里还没有动态，来发布第一条吧</div>
          ) : moments.map(m => (
            <div key={m.id} className="moment">
              <span className="ava-link" onClick={() => nav('/user/' + m.user_id)} title="查看主页"><Avatar src={m.author_avatar} name={m.author_name} size={42} /></span>
              <div className="body">
                <div className="head">
                  <b onClick={() => nav('/user/' + m.user_id)} style={{ cursor: 'pointer' }}>{m.author_name}</b>
                  <span className="t">{fmtDate(m.created_at)}</span>
                  {m.user_id === user?.id && (
                    <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => del(m)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {m.text && <div className="text" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
                {m.image && <img className="pic" src={m.image} alt="" />}
                <div className="acts">
                  <button className={m.liked ? 'on' : ''} onClick={() => like(m)}
                    style={m.liked ? { color: 'var(--accent)' } : undefined}>
                    <Heart size={16} fill={m.liked ? 'currentColor' : 'none'} /> {m.likes || 0}
                  </button>
                  <button onClick={() => setOpenComments(openComments === m.id ? null : m.id)}>
                    <MessageCircle size={16} /> {m.comment_count || 0}
                  </button>
                </div>
                {openComments === m.id && <Comments moment={m} onCount={() => bump(m)} />}
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
