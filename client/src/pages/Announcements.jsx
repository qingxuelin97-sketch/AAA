import React, { useEffect, useState } from 'react';
import { api } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import { fmtDateTime } from '../time.js';
import { Megaphone, Plus, Trash2, Pin, ShieldCheck } from 'lucide-react';

export default function Announcements() {
  const [list, setList] = useState([]);
  const [isGm, setIsGm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => api('/announcements').then(d => { setList(d.announcements); setIsGm(d.is_gm); }).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const publish = async () => {
    if (!form.title.trim()) return toast('请填写标题', 'err');
    setBusy(true);
    try { await api('/announcements', { method: 'POST', body: form }); toast('公告已发布'); setForm(null); load(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const del = async (a) => {
    if (!confirm('删除该公告？')) return;
    try { await api('/announcements/' + a.id, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1>公告中心</h1><div className="sub">幻域官方动态与版本说明</div></div>
        {isGm && <button className="btn primary" onClick={() => setForm({ title: '', body: '', pinned: false })}><Plus size={16} /> 发布公告</button>}
      </div>
      <div className="page" style={{ maxWidth: 820 }}>
        {isGm && (
          <div className="ann-banner" style={{ background: 'linear-gradient(120deg,#f3ece2,#ece4d7)', cursor: 'default' }}>
            <span className="ann-ic" style={{ background: '#2a2722' }}><ShieldCheck size={18} /></span>
            <div className="ann-tx"><b>你是 GM 管理员</b><p>可发布 / 置顶 / 删除全站公告</p></div>
          </div>
        )}
        {loading ? <div className="empty">载入中…</div> :
          list.length === 0 ? <div className="empty"><div className="big"><Megaphone size={44} /></div>暂无公告</div> : (
            list.map(a => (
              <div key={a.id} className={'ann-item' + (a.pinned ? ' pinned' : '')}>
                <h3>{a.pinned ? <span className="pin"><Pin size={11} style={{ verticalAlign: -1 }} /> 置顶</span> : null}{a.title}</h3>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0, color: 'var(--text)' }}>{a.body}</p>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>{a.author_name || '官方'} · {fmtDateTime(a.created_at)}</span>
                  {isGm && <button className="btn sm danger" style={{ marginLeft: 'auto' }} onClick={() => del(a)}><Trash2 size={13} /> 删除</button>}
                </div>
              </div>
            ))
          )}
      </div>

      {form && (
        <Modal onClose={() => setForm(null)}>
          <h2 style={{ marginTop: 0 }}>发布公告</h2>
          <div className="field"><label>标题</label><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="公告标题" /></div>
          <div className="field"><label>正文</label><textarea className="textarea" style={{ minHeight: 120 }} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="公告内容…" /></div>
          <label className="switch" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} />
            <span className="track" /><span style={{ fontSize: 13.5 }}>置顶此公告</span>
          </label>
          <div className="row"><button className="btn block" onClick={() => setForm(null)}>取消</button>
            <button className="btn primary block" onClick={publish} disabled={busy}>{busy ? '发布中…' : '发布'}</button></div>
        </Modal>
      )}
    </>
  );
}
