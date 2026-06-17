import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { pid } from '../assets.jsx';
import Reviews from '../components/Reviews.jsx';
import ReportButton from '../components/ReportButton.jsx';
import { Coins, Heart, Play, Lock, Trash2, Eye } from 'lucide-react';

export default function ScriptDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [script, setScript] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api('/scripts/' + id).then(d => setScript(d.script)).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); api('/engage/view', { method: 'POST', body: { type: 'script', id: +id } }).catch(() => {}); /* eslint-disable-next-line */ }, [id]);

  if (!script) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;

  const isAuthor = user && user.id === script.author_id;
  const paid = script.price_gold > 0;
  const locked = paid && !script.unlocked;
  const tags = (script.tags || '').split(',').map(t => t.trim()).filter(Boolean);

  const buy = async () => {
    setBusy(true);
    try {
      await api('/scripts/' + id + '/buy', { method: 'POST' });
      toast('购买成功，已解锁');
      await refreshUser();
      await load();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  const refund = async () => {
    if (!confirm('确认申请退款？退款后将无法继续阅读本剧本。')) return;
    setBusy(true);
    try {
      const d = await api('/scripts/' + id + '/refund', { method: 'POST' });
      toast(d.message || '退款成功');
      await refreshUser();
      await load();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  const like = async () => {
    try {
      await api('/scripts/' + id + '/like', { method: 'POST' });
      await load();
    } catch (err) { toast(err.message, 'err'); }
  };

  const del = async () => {
    if (!confirm('确认删除该剧本？此操作不可撤销。')) return;
    try {
      await api('/scripts/' + id, { method: 'DELETE' });
      toast('已删除');
      nav('/scripts');
    } catch (err) { toast(err.message, 'err'); }
  };

  const canRefund = script.unlocked && paid && !isAuthor;

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}>← 返回</button>
        <div style={{ flex: 1 }}>
          <h1>{script.title}</h1>
          <div className="sub">{pid('script', script.id)} · 由 {script.author_name} 创作</div>
        </div>
        {!isAuthor && <ReportButton type="script" id={script.id} />}
        {isAuthor && <>
          <button className="btn" onClick={() => nav('/script/' + id + '/edit')}>编辑</button>
          <button className="btn danger" onClick={del}><Trash2 size={14} style={{ verticalAlign: 'middle' }} /> 删除</button>
        </>}
      </div>

      <div className="page" style={{ maxWidth: 820 }}>
        <div className="card">
          {script.cover && <div style={{ height: 280, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
            <img src={script.cover} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /></div>}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }} onClick={() => nav('/user/' + script.author_id)}>
              <Avatar src={script.author_avatar} name={script.author_name} size={36} />
              <div><b>{script.author_name}</b><div className="muted" style={{ fontSize: 12 }}>{script.created_at}</div></div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontSize: 13, color: 'var(--faint)' }}>
              <span><Play size={13} style={{ verticalAlign: 'middle' }} /> {script.plays || 0}</span>
              <span><Eye size={13} style={{ verticalAlign: 'middle' }} /> {script.views || 0}</span>
              <button className="btn sm ghost" onClick={like}><Heart size={14} style={{ verticalAlign: 'middle' }} /> {script.likes || 0}</button>
            </div>
          </div>

          {tags.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {tags.map(t => <span key={t} className="tag">{t}</span>)}
            </div>
          )}

          <p style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{script.summary || '暂无简介'}</p>

          {locked ? (
            <div className="card" style={{ background: 'var(--bg-2)', marginTop: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}><Lock size={30} /></div>
              <h3 style={{ margin: '0 0 6px' }}>本剧本需 <span className="price-tag"><Coins size={16} /> {script.price_gold}</span> 金币解锁</h3>
              <p className="muted" style={{ fontSize: 13 }}>支持购买后 30 分钟内不满意退款</p>
              <button className="btn primary" style={{ marginTop: 6 }} onClick={buy} disabled={busy}>
                {busy ? '处理中…' : '购买并解锁'}
              </button>
            </div>
          ) : (
            <div className="card" style={{ background: 'var(--bg-2)', marginTop: 18 }}>
              <div className="section-title"><h2>剧情设定</h2></div>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, marginBottom: 0 }}>{script.content || '暂无正文'}</p>
            </div>
          )}

          {canRefund && (
            <div style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={refund} disabled={busy}>申请退款(30分钟内)</button>
            </div>
          )}
        </div>

        <Reviews type="script" id={script.id} />
      </div>
    </>
  );
}
