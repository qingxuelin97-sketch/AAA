import React, { useEffect, useState } from 'react';
import { api } from '../api.jsx';
import { useNav as useNavigate } from '../nav.js';
import { useToast, Modal } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { EmptyArt } from '../art.jsx';
import { Megaphone, Plus, Trash2, Pin, ShieldCheck, ArrowLeft, X, RefreshCw } from 'lucide-react';

export default function Announcements() {
  const app = isAppMode();
  const [list, setList] = useState([]);
  const [isGm, setIsGm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => {
    if (!app) setLoadError('');
    return api('/announcements').then(d => { setList(d.announcements); setIsGm(d.is_gm); })
      .catch(e => { if (!app) setLoadError(e.message || '公告载入失败，请稍后重试'); toast(e.message, 'err'); })
      .finally(() => setLoading(false));
  };
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
      <div className={app ? 'topbar qa-announcements-header' : 'topbar'}>
        {app && <AppIconButton className="qa-announcements-back" label="返回上一页" onClick={() => nav(-1)}><ArrowLeft size={20} /></AppIconButton>}
        <div style={{ flex: 1 }}><h1>公告中心</h1><div className="sub">幻域官方动态与版本说明</div></div>
        {isGm && <AppButton className="btn primary" variant="primary" onClick={() => setForm({ title: '', body: '', pinned: false })}><Plus size={16} /> 发布公告</AppButton>}
      </div>
      <div className={app ? 'page qa-announcements-page' : 'page'} style={{ maxWidth: 820 }}>
        {isGm && (
          <div className={app ? 'ann-banner qa-announcements-admin' : 'ann-banner'} style={{ background: 'linear-gradient(120deg,#f3ece2,#ece4d7)', cursor: 'default' }}>
            <span className="ann-ic" style={{ background: '#2a2722' }}><ShieldCheck size={18} /></span>
            <div className="ann-tx"><b>你是 GM 管理员</b><p>可发布 / 置顶 / 删除全站公告</p></div>
          </div>
        )}
        {loading ? (app ? <div className="qa-announcements-loading" role="status" aria-label="正在载入公告"><i className="skel" /><i className="skel" /><i className="skel" /></div> : (
          <div className="lgw-skel-list" aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className="skel lgw-skel-lg" />)}</div>
        )) : !app && loadError && list.length === 0 ? (
          <div className="empty lgw-error" role="alert">
            <span className="lgw-error-ic"><Megaphone size={22} /></span>
            <h2 className="lgw-error-title">公告暂时无法载入</h2>
            <p className="lgw-error-msg">{loadError}</p>
            <button className="btn primary lgw-error-retry" onClick={() => void load()}><RefreshCw size={15} /> 重新载入</button>
          </div>
        ) :
          list.length === 0 ? (app
            ? <div className="empty qa-announcements-empty"><div className="big"><Megaphone size={44} /></div>暂无公告</div>
            : (
              <div className="empty lgw-empty">
                <EmptyArt kind="notifications" />
                <h2 className="lgw-empty-title">暂无公告</h2>
                <p className="lgw-empty-sub">官方动态与版本说明发布后，会第一时间出现在这里。</p>
                <div className="lgw-empty-cta"><button className="btn primary" onClick={() => nav('/')}>回发现广场逛逛</button></div>
              </div>
            )
          ) : (
            list.map(a => {
              const ItemRoot = app ? 'article' : 'div';
              return (
              <ItemRoot key={a.id} className={'ann-item' + (app ? ' qa-announcements-item' : '') + (a.pinned ? ' pinned' : '')}>
                <h3>{a.pinned ? <span className="pin"><Pin size={11} style={{ verticalAlign: -1 }} /> 置顶</span> : null}{a.title}</h3>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0, color: 'var(--text)' }}>{a.body}</p>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>{a.author_name || '官方'} · {String(a.created_at || '').slice(0, 16)}</span>
                  {isGm && <AppButton className="btn sm danger" tone="danger" style={{ marginLeft: 'auto' }} onClick={() => del(a)}><Trash2 size={13} /> 删除</AppButton>}
                </div>
              </ItemRoot>
            );})
          )}
      </div>

      {form && (
        <Modal onClose={() => setForm(null)} className={app ? 'qa-announcements-modal' : ''} backdropClassName={app ? 'qa-announcements-modal-backdrop' : ''}>
          {app ? <div className="qa-announcements-modal-head"><h2>发布公告</h2><AppIconButton label="关闭发布公告" onClick={() => setForm(null)}><X size={19} /></AppIconButton></div> : <h2 style={{ marginTop: 0 }}>发布公告</h2>}
          <div className="field"><label>标题</label><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="公告标题" /></div>
          <div className="field"><label>正文</label><textarea className="textarea" style={{ minHeight: 120 }} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="公告内容…" /></div>
          <label className="switch" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} />
            <span className="track" /><span style={{ fontSize: 13.5 }}>置顶此公告</span>
          </label>
          <div className={app ? 'row qa-announcements-modal-actions' : 'row'}><AppButton className="btn block" onClick={() => setForm(null)}>取消</AppButton>
            <AppButton className="btn primary block" variant="primary" loading={app && busy} onClick={publish} disabled={busy}>{busy ? '发布中…' : '发布'}</AppButton></div>
        </Modal>
      )}
    </>
  );
}
