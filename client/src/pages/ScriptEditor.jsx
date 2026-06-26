import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Uploader } from '../ui.jsx';
import { useDraftAutosave, loadDraft, delDraft, listDrafts } from '../drafts.js';
import { RotateCcw, Trash } from 'lucide-react';

const BLANK = {
  title: '', summary: '', cover: '', content: '',
  category: '', tags: '', price_gold: 0, nsfw: false
};

export default function ScriptEditor() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const [s, setS] = useState(BLANK);
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draftHint, setDraftHint] = useState(null);
  const draftKey = id || 'new';
  const draft = useDraftAutosave('script', draftKey, s, s.title, loaded);

  useEffect(() => {
    api('/meta/categories').then(d => setCats(d.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (editing) {
      api('/scripts/' + id)
        .then(d => { setS({ ...BLANK, ...d.script, nsfw: !!d.script.nsfw }); setLoaded(true); const dl = listDrafts('script').find(x => x.key === id); if (dl) setDraftHint(dl); })
        .catch(e => toast(e.message, 'err'));
    } else {
      setLoaded(true);
      const dl = listDrafts('script').find(x => x.key === 'new'); if (dl) setDraftHint(dl);
    }
    // eslint-disable-next-line
  }, [id]);

  const restoreDraft = () => { const d = loadDraft('script', draftKey); if (d) { setS({ ...BLANK, ...d }); toast('已恢复草稿，记得保存'); } setDraftHint(null); };
  const discardDraft = () => { delDraft('script', draftKey); setDraftHint(null); toast('草稿已丢弃'); };

  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!s.title.trim()) { toast('请填写标题', 'err'); return; }
    setBusy(true);
    const body = {
      title: s.title,
      summary: s.summary,
      cover: s.cover,
      content: s.content,
      category: s.category,
      tags: s.tags,
      price_gold: Number(s.price_gold) || 0,
      nsfw: !!s.nsfw
    };
    try {
      if (editing) await api('/scripts/' + id, { method: 'PUT', body });
      else await api('/scripts', { method: 'POST', body });
      draft.discard();
      toast('已保存');
      nav('/scripts');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}>← 返回</button>
        <div style={{ flex: 1 }}>
          <h1>{editing ? '编辑剧本' : '创建剧本'}</h1>
          <div className="sub">{s.title || '撰写你的世界观与剧情，分享或出售给其他玩家'}</div>
        </div>
        {loaded && <span className="draft-badge" title="内容会自动暂存到本机，断网不丢失"><RotateCcw size={12} /> 已自动暂存</span>}
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </div>

      {draftHint && (
        <div className="draft-restore">
          <span>检测到未保存的草稿「{draftHint.name}」（{Math.round((Date.now() - draftHint.savedAt) / 60000)} 分钟前）</span>
          <button className="btn sm primary" onClick={restoreDraft}><RotateCcw size={13} /> 恢复</button>
          <button className="btn sm ghost" onClick={discardDraft}><Trash size={13} /> 丢弃</button>
        </div>
      )}

      <div className="page" style={{ maxWidth: 820 }}>
        <div className="field"><label>标题 *</label>
          <input className="input" value={s.title} onChange={e => set('title', e.target.value)} placeholder="例如：浮空城的最后守夜人" /></div>

        <div className="field"><label>简介</label>
          <textarea className="textarea" value={s.summary} onChange={e => set('summary', e.target.value)}
            placeholder="一段吸引人的剧本简介，展示在市集卡片上…" /></div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="field"><label>分类</label>
            <select className="select" value={s.category} onChange={e => set('category', e.target.value)}>
              <option value="">未分类</option>
              {cats.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select></div>
          <div className="field"><label>价格（金币）</label>
            <input className="input" type="number" min="0" value={s.price_gold}
              onChange={e => set('price_gold', e.target.value)} placeholder="0" />
            <div className="hint">填 0 为免费；付费剧本买家可在30分钟内退款</div></div>
        </div>

        <div className="field"><label>标签 <span className="muted">(逗号分隔)</span></label>
          <input className="input" value={s.tags} onChange={e => set('tags', e.target.value)} placeholder="奇幻, 冒险, 悬疑" /></div>

        <div className="field"><label>封面</label>
          <Uploader value={s.cover} onChange={(url) => set('cover', url)} accept="image/*" /></div>

        <div className="field"><label>正文 / 剧情设定</label>
          <textarea className="textarea" style={{ minHeight: 260 }} value={s.content} onChange={e => set('content', e.target.value)}
            placeholder="详细的世界观、人物背景、剧情走向与开场设定…" /></div>

        <div className="field">
          <label className="switch">
            <input type="checkbox" checked={s.nsfw} onChange={e => set('nsfw', e.target.checked)} />
            <span className="track" /><span style={{ fontSize: 13 }}>标记为 NSFW（成人内容）</span>
          </label>
        </div>
      </div>
    </>
  );
}
