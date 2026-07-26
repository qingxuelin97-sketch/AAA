import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, Uploader, Modal } from '../ui.jsx';
import { EmptyArt } from '../art.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { Users, Plus, ArrowLeft, ChevronRight } from 'lucide-react';

export default function Groups() {
  const app = isAppMode();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [seg, setSeg] = useState('all'); // S7-G10 App 加入状态分段（Web 零变化）
  const nav = useNavigate();
  const toast = useToast();

  const load = () => {
    setLoading(true);
    setLoadError('');
    return api('/groups')
      .then(d => setGroups(d.groups))
      .catch(e => { setLoadError(e.message || '群聊列表载入失败，请稍后重试'); toast(e.message, 'err'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const open = async (g) => {
    try { if (!g.joined) await api('/groups/' + g.id + '/join', { method: 'POST' }); nav('/group/' + g.id); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      {app ? (
        <header className="qa-groups-topbar">
          <AppIconButton className="qa-groups-back" label="返回消息" onClick={() => nav('/messages')}><ArrowLeft size={20} /></AppIconButton>
          <h1>群聊</h1>
          <AppIconButton className="qa-groups-create-icon" label="创建群聊" variant="filled" onClick={() => setCreating(true)}><Plus size={20} /></AppIconButton>
        </header>
      ) : (
        <div className="topbar">
          <div style={{ flex: 1 }}><h1>群聊</h1><div className="sub">和同好们一起讨论角色、剧本与脑洞</div></div>
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> 创建群聊</button>
        </div>
      )}
      <div className={app ? 'page qa-groups-page' : 'page'}>
        {loading ? (
          app ? (
            <div className="qa-groups-loading" role="status" aria-label="正在加载群聊">
              {[0, 1, 2].map(i => (
                <div className="qa-groups-skeleton" key={i} aria-hidden="true">
                  <span className="skel qa-groups-skeleton-avatar" />
                  <span><i className="skel qa-groups-skeleton-name" /><i className="skel qa-groups-skeleton-description" /><i className="skel qa-groups-skeleton-meta" /></span>
                </div>
              ))}
            </div>
          ) : (
            <div className="lgw-skel-list" aria-hidden="true">
              {[0, 1, 2].map(i => <div key={i} className="skel" style={{ height: 84 }} />)}
            </div>
          )
        ) : !app && loadError && groups.length === 0 ? (
          <div className="empty lgw-error" role="alert">
            <span className="lgw-error-ic"><Users size={22} /></span>
            <h2 className="lgw-error-title">群聊暂时无法载入</h2>
            <p className="lgw-error-msg">{loadError}</p>
            <button className="btn primary lgw-error-retry" onClick={() => load()}>重新载入</button>
          </div>
        ) : groups.length === 0 ? (
          app ? (
            <section className="qa-groups-empty" aria-labelledby="qa-groups-empty-title">
              <EmptyArt kind="friends" />
              <h2 id="qa-groups-empty-title">还没有群聊</h2>
              <p>创建一个群聊，和同好讨论角色、剧本与脑洞。</p>
              <AppButton className="qa-groups-empty-create" variant="primary" size="lg" onClick={() => setCreating(true)}><Plus size={17} /> 创建第一个群聊</AppButton>
            </section>
          ) : (
            <div className="empty lgw-empty">
              <EmptyArt kind="friends" />
              <h2 className="lgw-empty-title">还没有群聊</h2>
              <p className="lgw-empty-sub">创建一个群聊，和同好一起讨论角色、剧本与脑洞。</p>
              <div className="lgw-empty-cta">
                <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> 创建第一个群聊</button>
              </div>
            </div>
          )
        ) : (
          app ? (
            <>
            {/* S7-G10 分段：我加入的群优先可见（两侧都有才展示分段） */}
            {groups.some(g => g.joined) && groups.some(g => !g.joined) && (
              <div className="qa-groups-seg" role="group" aria-label="按加入状态筛选群聊">
                {[['all', '全部'], ['joined', '我加入的'], ['open', '可加入']].map(([key, label]) => (
                  <AppButton key={key} size="sm" variant="tertiary" selected={seg === key} pressed={seg === key} onClick={() => setSeg(key)}>
                    {label}
                  </AppButton>
                ))}
              </div>
            )}
            <section className="qa-groups-list" aria-label="群聊列表">
              {groups.filter(g => seg === 'all' ? true : seg === 'joined' ? g.joined : !g.joined).map(g => (
                <AppButton key={g.id} className="qa-groups-row" variant="tertiary" onClick={() => open(g)}>
                  {g.avatar ? <img className="ava" src={assetUrl(g.avatar)} alt="" /> : <span className="ava qa-groups-avatar-fallback" aria-hidden="true"><Users size={22} /></span>}
                  <span className="qa-groups-copy">
                    <b>{g.name}</b>
                    <small>{g.description || '暂无群简介'}</small>
                    <span><Users size={11} aria-hidden="true" /> {g.member_count} 人 · 群主 {g.owner_name}</span>
                  </span>
                  <span className={'qa-groups-status' + (g.joined ? ' joined' : '')}>{g.joined ? '已加入' : '加入'}</span>
                  <ChevronRight className="qa-groups-chevron" size={17} aria-hidden="true" />
                </AppButton>
              ))}
            </section>
            </>
          ) : groups.map(g => (
              <div key={g.id} className="room-row" onClick={() => open(g)}>
                {g.avatar ? <img className="ava" src={assetUrl(g.avatar)} alt="" /> : <div className="ava" style={{ display: 'grid', placeItems: 'center', background: 'var(--panel-2)' }}><Users size={22} /></div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 15 }}>{g.name}</b>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.description || '暂无群简介'}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}><Users size={11} style={{ verticalAlign: -1 }} /> {g.member_count} 人 · 群主 {g.owner_name}</div>
                </div>
                {g.joined ? <span className="tag">已加入</span> : <button className="btn sm">加入</button>}
              </div>
            ))
        )}
      </div>
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={(id) => nav('/group/' + id)} />}
    </>
  );
}

function CreateModal({ onClose, onDone }) {
  const app = isAppMode();
  const [form, setForm] = useState({ name: '', description: '', avatar: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const create = async () => {
    if (!form.name.trim()) return toast('请填写群名称', 'err');
    setBusy(true);
    try { const d = await api('/groups', { method: 'POST', body: form }); onDone(d.group.id); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} className={app ? 'qa-groups-create-modal' : ''}>
      <h2 style={{ marginTop: 0 }}>创建群聊</h2>
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 12 }}>
        <Uploader variant="avatar" value={form.avatar} onChange={url => setForm({ ...form, avatar: url })} accept="image/*" />
      </div>
      <div className="field"><label htmlFor={app ? 'qa-group-name' : undefined}>群名称</label><input id={app ? 'qa-group-name' : undefined} className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：幻域创作者联盟" /></div>
      <div className="field"><label htmlFor={app ? 'qa-group-description' : undefined}>群简介</label><textarea id={app ? 'qa-group-description' : undefined} className="textarea" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="介绍一下这个群…" /></div>
      <div className={app ? 'row qa-groups-create-actions' : 'row'}><AppButton className="btn block" variant="secondary" onClick={onClose}>取消</AppButton><AppButton className="btn primary block" variant="primary" loading={busy} onClick={create} disabled={busy}>{busy ? '创建中…' : '创建'}</AppButton></div>
    </Modal>
  );
}
