import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.jsx';
import { useToast, Uploader, AvatarPicker } from '../ui.jsx';
import { CATEGORIES } from '../assets.jsx';
import { BG_PRESETS, ONLINE_BG } from '../faces.js';
import { Plus } from 'lucide-react';

// Local fallback shown if a third-party online image fails to hotlink.
const IMG_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#efd9e6"/><stop offset="100%" stop-color="#c9b8ff"/></linearGradient></defs><rect width="160" height="100" fill="url(#g)"/><text x="80" y="56" font-size="12" fill="#fff" text-anchor="middle" font-family="sans-serif">加载失败</text></svg>');
const onImgErr = (e) => { if (e.currentTarget.src !== IMG_FALLBACK) { e.currentTarget.src = IMG_FALLBACK; e.currentTarget.closest('.bg-preset')?.classList.add('img-failed'); } };

// Resolve a (possibly random) online image endpoint into ONE fixed image and
// store it as a stable data URL, so the chat background never changes again.
// Adds a cache-buster so we capture a fresh pick, then freezes that exact frame.
async function lockImage(url) {
  const bust = url + (url.includes('?') ? '&' : '?') + 'lock=' + Date.now();
  const res = await fetch(bust, { mode: 'cors', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') throw new Error('非图片响应');
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('读取失败'));
    fr.readAsDataURL(blob);
  });
}

const BLANK = {
  name: '', avatar: '', background: '', background_type: 'image',
  tagline: '', intro: '', greeting: '', persona: '', voice_name: '', category: '', tags: '',
  is_public: false, nsfw: false, world: []
};

export default function CharacterEditor() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('basic');
  const [c, setC] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [locking, setLocking] = useState('');

  // Pick an online image but freeze it to one fixed frame (no more random swaps).
  const pickOnline = async (b) => {
    setLocking(b.name);
    try {
      const dataUrl = await lockImage(b.url);
      setC(prev => ({ ...prev, background: dataUrl, background_type: 'image' }));
      toast('已锁定为固定背景');
    } catch (err) {
      setC(prev => ({ ...prev, background: b.url, background_type: 'image' }));
      toast('该图源不支持锁定，已存随机链接（每次可能变化）', 'err');
    } finally { setLocking(''); }
  };

  useEffect(() => {
    if (editing) {
      api('/characters/' + id).then(d => setC({ ...BLANK, ...d.character, is_public: !!d.character.is_public, world: d.character.world || [] }))
        .catch(e => toast(e.message, 'err'));
    }
  }, [id]);

  const set = (k, v) => setC(prev => ({ ...prev, [k]: v }));

  const addWorld = () => set('world', [...c.world, { keys: '', content: '', enabled: true }]);
  const updWorld = (i, k, v) => set('world', c.world.map((w, j) => j === i ? { ...w, [k]: v } : w));
  const delWorld = (i) => set('world', c.world.filter((_, j) => j !== i));

  const save = async () => {
    if (!c.name.trim()) { toast('请填写角色名', 'err'); setTab('basic'); return; }
    setBusy(true);
    try {
      if (editing) await api('/characters/' + id, { method: 'PUT', body: c });
      else await api('/characters', { method: 'POST', body: c });
      toast('已保存');
      nav('/library');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}>← 返回</button>
        <div style={{ flex: 1 }}>
          <h1>{editing ? '编辑角色' : '新建角色'}</h1>
          <div className="sub">{c.name || '为你的角色注入灵魂'}</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={c.is_public} onChange={e => set('is_public', e.target.checked)} />
          <span className="track" /><span style={{ fontSize: 13 }}>公开到广场</span>
        </label>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存角色'}</button>
      </div>

      <div className="page">
        <div className="tabs-bar">
          <button className={tab === 'basic' ? 'active' : ''} onClick={() => setTab('basic')}>基础信息</button>
          <button className={tab === 'persona' ? 'active' : ''} onClick={() => setTab('persona')}>人设 / 简介</button>
          <button className={tab === 'world' ? 'active' : ''} onClick={() => setTab('world')}>世界书 ({c.world.length})</button>
          <button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>立绘 / 背景</button>
        </div>

        {tab === 'basic' && (
          <div className="editor-grid">
            <div>
              <div className="field"><label>角色名 *</label>
                <input className="input" value={c.name} onChange={e => set('name', e.target.value)} placeholder="例如：星界旅人 · 莉雅" /></div>
              <div className="field"><label>一句话简介</label>
                <input className="input" value={c.tagline} onChange={e => set('tagline', e.target.value)} placeholder="广场卡片上展示的短介绍" /></div>
              <div className="row">
                <div className="field"><label>分类</label>
                  <select className="select" value={c.category} onChange={e => set('category', e.target.value)}>
                    <option value="">— 选择分类 —</option>
                    {CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select></div>
                <div className="field"><label>标签 <span className="muted">(逗号分隔)</span></label>
                  <input className="input" value={c.tags} onChange={e => set('tags', e.target.value)} placeholder="奇幻, 治愈" /></div>
              </div>
              <div className="field"><label>开场白</label>
                <textarea className="textarea" value={c.greeting} onChange={e => set('greeting', e.target.value)}
                  placeholder="对话开始时角色说的第一句话…" /></div>
            </div>
            <div className="card">
              <div className="field" style={{ textAlign: 'center' }}>
                <label>角色头像 <span className="muted">(预设脸模或上传)</span></label>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  <AvatarPicker value={c.avatar} onChange={(url) => set('avatar', url)} size={104} />
                </div>
                <div className="hint" style={{ textAlign: 'center' }}>可挑选真人风格预设脸模（区分男女），或上传自定义静态图片</div>
              </div>
              <div className="field"><label>语音音色名 <span className="muted">(可选)</span></label>
                <input className="input" value={c.voice_name} onChange={e => set('voice_name', e.target.value)} placeholder="如 alloy / nova，留空用默认" />
                <div className="hint">对话时朗读该角色台词所用的语音音色（需在设置中配置语音 API）。</div>
              </div>
            </div>
          </div>
        )}

        {tab === 'persona' && (
          <div>
            <div className="field"><label>角色简介 <span className="muted">(展示给玩家阅读)</span></label>
              <textarea className="textarea" style={{ minHeight: 120 }} value={c.intro} onChange={e => set('intro', e.target.value)}
                placeholder="角色的背景故事、外貌、性格…" /></div>
            <div className="field"><label>人设定义 / System Prompt <span className="muted">(发送给模型)</span></label>
              <textarea className="textarea" style={{ minHeight: 220 }} value={c.persona} onChange={e => set('persona', e.target.value)}
                placeholder={'详细描述角色的身份、说话风格、行为准则等。\n例如：你是莉雅，一位来自星界的旅人，说话温柔而带着诗意，喜欢用星辰作比喻…'} />
              <div className="hint">这段内容会作为系统提示词随每次对话发送给语言模型，是角色扮演的核心。</div>
            </div>
          </div>
        )}

        {tab === 'world' && (
          <div>
            <div className="section-title">
              <h2>世界书</h2>
              <button className="btn sm" onClick={addWorld}><Plus size={14} /> 添加条目</button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
              当最近的对话中出现「触发关键词」时，对应设定会自动注入提示词，帮助模型记住世界观细节。留空关键词则为常驻设定。
            </p>
            {c.world.length === 0 && <div className="empty" style={{ padding: 40 }}>暂无条目，点击右上角添加</div>}
            {c.world.map((w, i) => (
              <div key={i} className="world-entry">
                <div className="top">
                  <input className="input" style={{ flex: 1 }} placeholder="触发关键词，逗号分隔（留空=常驻）"
                    value={w.keys} onChange={e => updWorld(i, 'keys', e.target.value)} />
                  <label className="switch">
                    <input type="checkbox" checked={w.enabled !== false} onChange={e => updWorld(i, 'enabled', e.target.checked)} />
                    <span className="track" />
                  </label>
                  <button className="btn sm danger" onClick={() => delWorld(i)}>删除</button>
                </div>
                <textarea className="textarea" placeholder="设定内容，例如：「圣城阿斯特拉位于浮空岛之上，由七位贤者守护…」"
                  value={w.content} onChange={e => updWorld(i, 'content', e.target.value)} />
              </div>
            ))}
          </div>
        )}

        {tab === 'media' && (
          <div className="editor-grid">
            <div className="field">
              <label>聊天背景（支持动态 GIF / 视频）</label>
              <Uploader value={c.background} type={c.background_type} dynamic
                onChange={(url, type) => setC(prev => ({ ...prev, background: url, background_type: type }))} />
              <div className="hint">将作为与该角色对话时的沉浸式背景。支持 jpg/png/webp/gif 或 mp4/webm 短视频实现动态背景。</div>
              <label style={{ marginTop: 14 }}>二次元 / 风景背景预设</label>
              <div className="bg-preset-grid">
                {BG_PRESETS.map(b => (
                  <button key={b.name} type="button" className={'bg-preset' + (c.background === b.url ? ' on' : '')}
                    onClick={() => setC(prev => ({ ...prev, background: b.url, background_type: 'image' }))} title={b.name}>
                    <img src={b.url} alt={b.name} />
                    <span>{b.name}</span>
                  </button>
                ))}
              </div>
              <label style={{ marginTop: 14 }}>在线二次元图库 <span className="muted">(点击即抓取并永久锁定一张)</span></label>
              <div className="bg-preset-grid">
                {ONLINE_BG.map(b => (
                  <button key={b.name} type="button" className={'bg-preset' + (locking === b.name ? ' loading' : '')}
                    disabled={!!locking} onClick={() => pickOnline(b)} title={b.name}>
                    <img src={b.url} alt={b.name} loading="lazy" referrerPolicy="no-referrer" onError={onImgErr} />
                    <span>{locking === b.name ? '锁定中…' : b.name}</span>
                  </button>
                ))}
              </div>
              <div className="hint">在线图库来自开源社区随机图接口。点击后会立即抓取其中一张并保存为固定背景，之后进入对话不会再变化。若该图源不支持跨域抓取，将退回为随机链接（每次进入可能不同）；需要稳定背景建议直接在上方上传图片 / GIF / MP4。</div>
              {c.background && <button className="btn sm ghost" style={{ marginTop: 10 }}
                onClick={() => setC(prev => ({ ...prev, background: '', background_type: 'image' }))}>清除背景</button>}
            </div>
            <div className="card">
              <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>预览</label>
              <div style={{ height: 220, borderRadius: 12, overflow: 'hidden', marginTop: 8, position: 'relative', background: 'var(--bg-2)' }}>
                {c.background ? (c.background_type === 'video'
                  ? <video src={c.background} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <img src={c.background} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                ) : <div className="empty" style={{ padding: 70 }}>未设置背景</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
