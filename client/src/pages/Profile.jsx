import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Uploader, Modal } from '../ui.jsx';

export default function Profile() {
  const { id } = useParams();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const targetId = id || user?.id;
  const isMe = String(targetId) === String(user?.id);
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const [pwd, setPwd] = useState(null);

  const load = () => api('/users/' + targetId).then(setData).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [targetId]);
  if (!data) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;

  const saveProfile = async () => {
    try { const d = await api('/auth/me', { method: 'PUT', body: edit }); setUser(d.user); setEdit(null); load(); toast('资料已更新'); }
    catch (err) { toast(err.message, 'err'); }
  };
  const savePwd = async () => {
    try { await api('/auth/password', { method: 'PUT', body: pwd }); setPwd(null); toast('密码已修改'); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>{isMe ? '个人中心' : '玩家主页'}</h1><div className="sub">@{data.user.username}</div></div>
        {isMe && <>
          <button className="btn" onClick={() => setPwd({ old_password: '', new_password: '' })}>修改密码</button>
          <button className="btn primary" onClick={() => setEdit({ display_name: data.user.display_name, bio: data.user.bio, avatar: data.user.avatar })}>编辑资料</button>
        </>}
      </div>
      <div className="page">
        <div className="card">
          <div className="profile-head">
            <Avatar src={data.user.avatar} name={data.user.display_name} size={84} />
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: '0 0 4px' }}>{data.user.display_name}</h2>
              <div className="muted" style={{ fontSize: 14 }}>{data.user.bio || '这位玩家还没有写简介'}</div>
              <div className="stat-row">
                <div className="s"><b>{data.stats.characters}</b><span>角色</span></div>
                <div className="s"><b>{data.stats.posts}</b><span>作品</span></div>
                <div className="s"><b>{data.stats.likes}</b><span>获赞</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 28 }}><h2>🎭 公开角色</h2></div>
        {data.characters.length === 0 ? <div className="empty" style={{ padding: 40 }}>暂无公开角色</div> : (
          <div className="grid">
            {data.characters.map(c => (
              <div key={c.id} className="char-card">
                <div className="cover">{c.avatar ? <img src={c.avatar} alt="" /> : <div className="ph">🎭</div>}</div>
                <div className="meta"><h3>{c.name}</h3><p>{c.tagline || c.intro}</p></div>
              </div>
            ))}
          </div>
        )}

        <div className="section-title" style={{ marginTop: 28 }}><h2>📜 发布的作品</h2></div>
        {data.posts.length === 0 ? <div className="empty" style={{ padding: 40 }}>暂无作品</div> : (
          <div className="grid">
            {data.posts.map(p => (
              <div key={p.id} className="char-card" onClick={() => nav('/post/' + p.id)}>
                <div className="cover">{p.cover ? <img src={p.cover} alt="" /> : <div className="ph">{p.type === 'script' ? '📜' : '🎭'}</div>}
                  <div className="pill-pub">{p.type === 'script' ? '剧本' : '角色卡'}</div></div>
                <div className="meta"><h3>{p.title}</h3><p>{p.body}</p></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {edit && (
        <Modal onClose={() => setEdit(null)}>
          <h2 style={{ marginTop: 0 }}>编辑资料</h2>
          <div style={{ display: 'grid', placeItems: 'center', marginBottom: 14 }}>
            <Uploader variant="avatar" value={edit.avatar} onChange={url => setEdit({ ...edit, avatar: url })} accept="image/*" />
          </div>
          <div className="field"><label>昵称</label><input className="input" value={edit.display_name} onChange={e => setEdit({ ...edit, display_name: e.target.value })} /></div>
          <div className="field"><label>简介</label><textarea className="textarea" value={edit.bio} onChange={e => setEdit({ ...edit, bio: e.target.value })} /></div>
          <div className="row"><button className="btn block" onClick={() => setEdit(null)}>取消</button><button className="btn primary block" onClick={saveProfile}>保存</button></div>
        </Modal>
      )}
      {pwd && (
        <Modal onClose={() => setPwd(null)}>
          <h2 style={{ marginTop: 0 }}>修改密码</h2>
          <div className="field"><label>原密码</label><input className="input" type="password" value={pwd.old_password} onChange={e => setPwd({ ...pwd, old_password: e.target.value })} /></div>
          <div className="field"><label>新密码</label><input className="input" type="password" value={pwd.new_password} onChange={e => setPwd({ ...pwd, new_password: e.target.value })} /></div>
          <div className="row"><button className="btn block" onClick={() => setPwd(null)}>取消</button><button className="btn primary block" onClick={savePwd}>确认</button></div>
        </Modal>
      )}
    </>
  );
}
