import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';

export default function PostDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [post, setPost] = useState(null);
  const [push, setPush] = useState(null);
  let payload = {};

  useEffect(() => { api('/community/posts/' + id).then(d => setPost(d.post)).catch(e => toast(e.message, 'err')); }, [id]);
  if (!post) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  try { payload = JSON.parse(post.payload || '{}'); } catch { /* */ }

  const importCard = async () => {
    try { const d = await api('/community/posts/' + id + '/import', { method: 'POST' });
      toast('已导入到你的角色库'); nav('/character/' + d.character_id + '/edit'); }
    catch (err) { toast(err.message, 'err'); }
  };
  const startChat = async () => {
    try {
      const d = await api('/community/posts/' + id + '/import', { method: 'POST' });
      const conv = await api('/chat/conversations', { method: 'POST', body: { character_id: d.character_id } });
      nav('/chats/' + conv.conversation.id);
    } catch (err) { toast(err.message, 'err'); }
  };
  const doPush = async () => {
    try { await api('/community/push', { method: 'POST', body: { post_id: post.id, to_username: push.to, note: push.note } });
      setPush(null); toast('已推送给该玩家 📨'); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}>← 返回</button>
        <div style={{ flex: 1 }}><h1>{post.title}</h1>
          <div className="sub">{post.type === 'script' ? '剧本' : '角色卡'} · 由 {post.author_name} 发布</div></div>
        <button className="btn" onClick={() => setPush({ to: '', note: '' })}>📨 推送给玩家</button>
      </div>
      <div className="page" style={{ maxWidth: 820 }}>
        <div className="card">
          {post.cover && <div style={{ height: 280, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
            <img src={post.cover} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /></div>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
            <Avatar src={post.author_avatar} name={post.author_name} size={36} />
            <div><b>{post.author_name}</b><div className="muted" style={{ fontSize: 12 }}>{post.created_at}</div></div>
            <div style={{ marginLeft: 'auto' }}>
              {(post.tags || '').split(',').filter(Boolean).map(t => <span key={t} className="tag">{t.trim()}</span>)}
            </div>
          </div>
          <p style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{post.body || '暂无简介'}</p>

          {post.type === 'card' && payload.persona && (
            <div className="card" style={{ background: 'var(--bg-2)', marginTop: 16 }}>
              <b style={{ fontSize: 13, color: 'var(--muted)' }}>角色设定预览</b>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, marginBottom: 0 }}>{(payload.intro || payload.persona).slice(0, 400)}…</p>
              {Array.isArray(payload.world) && payload.world.length > 0 &&
                <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>📖 含 {payload.world.length} 条世界书设定</div>}
            </div>
          )}

          <div className="row" style={{ marginTop: 20 }}>
            {post.type === 'card' ? <>
              <button className="btn primary block" onClick={startChat}>💬 立即对话</button>
              <button className="btn block" onClick={importCard}>⬇ 导入到我的角色库</button>
            </> : <button className="btn primary block" onClick={() => toast('剧本已记录，开始你的故事吧')}>📜 使用此剧本</button>}
          </div>
        </div>
      </div>

      {push && (
        <Modal onClose={() => setPush(null)}>
          <h2 style={{ marginTop: 0 }}>推送给其他玩家</h2>
          <div className="field"><label>目标玩家用户名 / 昵称</label>
            <input className="input" value={push.to} onChange={e => setPush({ ...push, to: e.target.value })} placeholder="对方的用户名" /></div>
          <div className="field"><label>附言 <span className="muted">(可选)</span></label>
            <input className="input" value={push.note} onChange={e => setPush({ ...push, note: e.target.value })} placeholder="推荐你试试这个～" /></div>
          <div className="row"><button className="btn block" onClick={() => setPush(null)}>取消</button>
            <button className="btn primary block" onClick={doPush}>推送</button></div>
        </Modal>
      )}
    </>
  );
}
