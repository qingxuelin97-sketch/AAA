import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uploadFile } from '../api.jsx';
import { parseCharacterCard } from '../charcard.js';
import { useToast, GridSkeleton } from '../ui.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { Globe, MessageCircle, Plus, X, Upload } from 'lucide-react';

export default function Library() {
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef();

  // 导入角色卡：支持幻域 JSON / 酒馆 JSON / 酒馆 PNG（内嵌卡）。
  const importCard = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('文件过大（上限 8MB）', 'err'); return; }
    setImporting(true);
    try {
      const { character, world, notices, imageBlob } = await parseCharacterCard(file);
      // PNG 卡：图片本身即立绘，上传为托管头像（服务端 avatar 存 URL，不能塞 data-URL）。
      if (imageBlob && !character.avatar) {
        try { const up = await uploadFile(imageBlob); if (up?.url) character.avatar = up.url; }
        catch { /* 头像上传失败不阻断导入，仍建角色 */ }
      }
      // 世界书条目随角色一并落入内嵌世界书（编辑页「世界书(N)」可见、计数正确）。
      const d = await api('/characters/import', { method: 'POST', body: { character, world: world || [] } });
      toast(`导入成功，已创建角色（世界书 ${world?.length || 0} 条）`);
      (notices || []).forEach((n, i) => setTimeout(() => toast(n), 400 * (i + 1)));
      nav('/character/' + d.character.id + '/edit');
    } catch (err) {
      toast(err.message || '导入失败：不支持的文件格式', 'err');
    } finally { setImporting(false); }
  };

  const load = () => api('/characters/mine').then(d => setChars(d.characters)).catch(e => toast(e.message, 'err')).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const startChat = async (e, c) => {
    e.stopPropagation();
    try {
      const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } });
      nav('/chats/' + d.conversation.id);
    } catch (err) { toast(err.message, 'err'); }
  };
  const publish = async (e, c) => {
    e.stopPropagation();
    try { await api('/community/publish-character/' + c.id, { method: 'POST' }); toast('已发布到广场'); load(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const del = async (e, c) => {
    e.stopPropagation();
    if (!confirm(`删除角色「${c.name}」？`)) return;
    try { await api('/characters/' + c.id, { method: 'DELETE' }); toast('已删除'); load(); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1>我的角色</h1>
          <div className="sub">创建并管理你的角色，配置立绘、动态背景与世界书</div>
        </div>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing} title="导入角色卡（支持幻域 JSON、酒馆 JSON / PNG 角色卡）"><Upload size={15} style={{ verticalAlign: -3 }} /> {importing ? '导入中…' : '导入'}</button>
        <button className="btn primary" onClick={() => nav('/character/new')}><Plus size={16} style={{ verticalAlign: -3 }} /> 新建角色</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json,image/png,.png" style={{ display: 'none' }} onChange={importCard} />
      <div className="page">
        {loading ? <GridSkeleton n={6} /> :
          chars.length === 0 ? (
            <div className="empty">
              <EmptyArt kind="library" />还没有角色
              <div style={{ marginTop: 16 }}><button className="btn primary" onClick={() => nav('/character/new')}>创建第一个角色</button></div>
            </div>
          ) : (
            <div className="grid">
              {chars.map(c => (
                <div key={c.id} className="char-card" onClick={() => nav('/character/' + c.id + '/edit')}>
                  <div className="cover">
                    {c.avatar ? <img src={c.avatar} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={c.name} /></div>}
                    {c.is_public ? <div className="pill-pub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> 已公开</div> : null}
                  </div>
                  <div className="meta">
                    <h3>{c.name}</h3>
                    <p>{c.tagline || c.intro || '暂无简介'}</p>
                    <div className="foot">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MessageCircle size={13} /> {c.uses}</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button className="btn sm primary" onClick={e => startChat(e, c)}>对话</button>
                        {!c.is_public && <button className="btn sm" onClick={e => publish(e, c)}>发布</button>}
                        <button className="btn sm danger" onClick={e => del(e, c)}><X size={14} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </>
  );
}
