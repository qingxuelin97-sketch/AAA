import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, Modal, CountUp } from '../ui.jsx';
import {
  PenTool, Plus, Sparkles, BookText, Library, Layers, Feather,
  Trash2, Pin, Wand2, Loader2, ArrowRight, ScrollText, BookOpen, Globe, User,
} from 'lucide-react';

// 纯小说创作板块首页 · 「创作工坊」。列出我的小说，支持一句话灵感开局。
export default function Atelier() {
  const nav = useNavigate();
  const toast = useToast();
  const [novels, setNovels] = useState(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState('mine');
  const [showcase, setShowcase] = useState(null);

  const load = () => api('/novels').then(d => setNovels(d.novels)).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === 'showcase' && showcase === null) api('/novels/showcase').then(d => setShowcase(d.novels)).catch(e => toast(e.message, 'err')); }, [tab]);

  const remove = async (n, e) => {
    e.stopPropagation();
    if (!confirm(`删除《${n.title}》？这条作品下的所有剧情线与正文都会一并删除，且不可恢复。`)) return;
    try { await api(`/novels/${n.id}`, { method: 'DELETE' }); toast('已删除', 'info'); load(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const togglePin = async (n, e) => {
    e.stopPropagation();
    try { await api(`/novels/${n.id}`, { method: 'PATCH', body: { pinned: !n.pinned } }); load(); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <div className="page atl-home">
      <div className="atl-hero">
        <div className="atl-hero-glyph"><Feather size={26} /></div>
        <div className="atl-hero-tx">
          <div className="atl-kicker"><Sparkles size={13} /> AI 创作 · 小说工坊</div>
          <h1>你来定方向，AI 替你落笔成文</h1>
          <p>抛开传统大纲。写一句你想要的剧情，AI 就续出富有文采的正文；世界设定分「局外母版」与「局内生效」，剧情会让局内设定自己生长。</p>
        </div>
        <button className="btn primary atl-hero-btn" onClick={() => setCreating(true)}><Plus size={17} /> 开新书</button>
      </div>

      <div className="seg atl-tabs">
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}><Library size={14} /> 我的书架</button>
        <button className={tab === 'showcase' ? 'active' : ''} onClick={() => setTab('showcase')}><Globe size={14} /> 书架精选</button>
      </div>

      {tab === 'showcase' ? (
        showcase === null ? <div className="empty" style={{ paddingTop: 60 }}>载入中…</div> :
        showcase.length === 0 ? (
          <div className="atl-empty"><div className="atl-empty-ic"><BookOpen size={40} /></div><h2>书架还很空</h2><p>把你的作品发布出来，让它成为第一本被人翻开的书。</p></div>
        ) : (
          <div className="atl-shelf">
            {showcase.map(n => (
              <div key={n.id} className="atl-card" onClick={() => nav(`/atelier/read/${n.id}`)}>
                <div className="atl-card-spine" />
                <div className="atl-card-cover">
                  {n.cover ? <img src={assetUrl(n.cover)} alt="" /> : <div className="atl-card-ph"><ScrollText size={26} /></div>}
                  {n.genre && <span className="atl-card-genre">{n.genre}</span>}
                </div>
                <div className="atl-card-body">
                  <div className="atl-card-titlerow"><b>{n.title}</b>{n.mine && <span className="atl-mine-tag">我的</span>}</div>
                  <p>{n.logline || '—'}</p>
                  <div className="atl-card-foot">
                    <span><User size={13} /> {n.author_name}</span>
                    <span><PenTool size={13} /> <CountUp value={n.words} /> 字</span>
                    <span className="atl-card-open">阅读 <ArrowRight size={13} /></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : novels === null ? (
        <div className="empty" style={{ paddingTop: 80 }}>载入中…</div>
      ) : novels.length === 0 ? (
        <div className="atl-empty">
          <div className="atl-empty-ic"><BookText size={40} /></div>
          <h2>还没有作品</h2>
          <p>从一个念头开始 —— 一句创意、一个开场，剩下的交给与你共写的 AI。</p>
          <button className="btn primary" onClick={() => setCreating(true)}><Wand2 size={16} /> 灵感开局</button>
        </div>
      ) : (
        <div className="atl-shelf">
          {novels.map(n => (
            <div key={n.id} className="atl-card" onClick={() => nav(`/atelier/${n.id}`)}>
              <div className="atl-card-spine" />
              <div className="atl-card-cover">
                {n.cover ? <img src={assetUrl(n.cover)} alt="" /> : <div className="atl-card-ph"><ScrollText size={26} /></div>}
                {n.genre && <span className="atl-card-genre">{n.genre}</span>}
              </div>
              <div className="atl-card-body">
                <div className="atl-card-titlerow">
                  <b>{n.title}</b>
                  <button className={'atl-pin' + (n.pinned ? ' on' : '')} title={n.pinned ? '取消置顶' : '置顶'} onClick={(e) => togglePin(n, e)}><Pin size={14} /></button>
                </div>
                <p>{n.logline || n.synopsis || '尚未写下故事内核。'}</p>
                <div className="atl-card-foot">
                  <span><Library size={13} /> {n.run_count} 线</span>
                  <span><Layers size={13} /> {n.codex_count} 设定</span>
                  <span><PenTool size={13} /> <CountUp value={n.words} /> 字</span>
                  <span className="atl-card-open">续写 <ArrowRight size={13} /></span>
                </div>
              </div>
              <button className="atl-card-del" title="删除作品" onClick={(e) => remove(n, e)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(id) => nav(`/atelier/${id}`)} />}
    </div>
  );
}

const GENRES = ['奇幻', '科幻', '武侠', '仙侠', '都市', '言情', '悬疑', '恐怖', '历史', '游戏', '校园', '末世', '轻小说', '同人'];

function CreateModal({ onClose, onCreated }) {
  const toast = useToast();
  const [seed, setSeed] = useState('');
  const [form, setForm] = useState({ title: '', logline: '', genre: '', synopsis: '', tags: '' });
  const [brainstorming, setBrainstorming] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const brainstorm = async () => {
    if (!seed.trim()) { toast('先写一句你的创意', 'info'); return; }
    setBrainstorming(true);
    try {
      const d = await api('/novels/brainstorm', { method: 'POST', body: { seed: seed.trim() } });
      setForm({ ...form, ...d.draft });
      toast('灵感已生成，可继续微调', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { setBrainstorming(false); }
  };

  const create = async () => {
    if (!form.title.trim()) { toast('请填写作品名', 'info'); return; }
    setSaving(true);
    try {
      const d = await api('/novels', { method: 'POST', body: form });
      toast('已创建，开始创作吧', 'ok');
      onCreated(d.novel.id);
    } catch (e) { toast(e.message, 'err'); setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>开一本新书</h2>
      <div className="atl-seed">
        <label className="atl-seed-label"><Wand2 size={14} /> 灵感开局（可选）</label>
        <div className="atl-seed-row">
          <input className="input" placeholder="一句话写下你的创意，如：废土上最后一座图书馆与守馆的少女…"
            value={seed} onChange={e => setSeed(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') brainstorm(); }} />
          <button className="btn" onClick={brainstorm} disabled={brainstorming}>
            {brainstorming ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} 生成
          </button>
        </div>
      </div>
      <div className="atl-rule"><span>作品信息</span></div>
      <label className="field-label">作品名</label>
      <input className="input" value={form.title} onChange={e => set('title', e.target.value)} maxLength={80} placeholder="给故事起个名字" />
      <label className="field-label">一句话内核</label>
      <input className="input" value={form.logline} onChange={e => set('logline', e.target.value)} maxLength={200} placeholder="一句话说清这是个什么样的故事" />
      <div className="atl-form-grid">
        <div>
          <label className="field-label">类型</label>
          <input className="input" value={form.genre} onChange={e => set('genre', e.target.value)} maxLength={40} placeholder="奇幻 / 科幻 …" list="atl-genres" />
          <datalist id="atl-genres">{GENRES.map(g => <option key={g} value={g} />)}</datalist>
        </div>
        <div>
          <label className="field-label">标签</label>
          <input className="input" value={form.tags} onChange={e => set('tags', e.target.value)} maxLength={200} placeholder="逗号分隔" />
        </div>
      </div>
      <label className="field-label">开篇梗概 / 起点</label>
      <textarea className="textarea" rows={4} value={form.synopsis} onChange={e => set('synopsis', e.target.value)} maxLength={4000} placeholder="故事从哪里开始？写下开场情境，AI 会从这里接手。" />
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose} style={{ flex: 1 }}>取消</button>
        <button className="btn primary" onClick={create} disabled={saving} style={{ flex: 2 }}>
          {saving ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} 创建并开始
        </button>
      </div>
    </Modal>
  );
}
