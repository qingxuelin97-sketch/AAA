import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, uploadFile, getToken } from '../api.jsx';
import { useToast, Uploader, AvatarPicker } from '../ui.jsx';
import { CATEGORIES } from '../assets.jsx';
import { BG_PRESETS, ONLINE_BG, randomBg, randomAnimeAvatar } from '../faces.js';
import { speakBrowser } from '../voice.js';
import { useDraftAutosave, loadDraft, delDraft, listDrafts } from '../drafts.js';
import { Plus, Dices, Music, X, Volume2, RotateCcw, Trash, Link2, Unlink, BookUp } from 'lucide-react';

const BGM_MAX_SEC = 60;

// Cross-provider voice presets for the character voice picker. The actual
// provider is whatever the user/platform configured in Settings; these are the
// common voice ids so creators can pick rather than memorize.
const VOICE_PRESETS = [
  ['百度智能云（发音人 per）', [['0', '度小美·甜美女声'], ['1', '度小宇·成熟男声'], ['3', '度逍遥·情感男声'], ['4', '度丫丫·童声'], ['5118', '度小鹿·清甜女声'], ['106', '度博文·磁性男声'], ['110', '度小童·活泼萌娃'], ['111', '度小萌·软萌女声'], ['103', '度米朵·治愈女声'], ['5', '度小娇·温柔女声']]],
  ['火山引擎 · 豆包（voice_type）', [['BV001_streaming', '通用女声'], ['BV002_streaming', '通用男声'], ['BV700_streaming', '灿灿·多情感'], ['BV705_streaming', '炎明熙·多情感'], ['BV701_streaming', '擎苍·浑厚男声'], ['BV064_streaming', '奶气萌娃'], ['BV051_streaming', '活力女声'], ['BV056_streaming', '阳光男声'], ['BV034_streaming', '知性姐姐'], ['BV007_streaming', '亲切女声']]],
  ['腾讯云（VoiceType）', [['101001', '智瑜·情感女声'], ['101002', '智聆·通用女声'], ['101003', '智美·客服女声'], ['101004', '智云·通用男声'], ['101005', '智莉·通用女声'], ['101008', '智琪·客服女声'], ['101010', '智华·通用男声'], ['101016', '智甜·女童声'], ['101019', '智彤·粤语女声'], ['101040', '智川·四川男声']]],
  ['阿里云 Qwen-TTS', [['Cherry', '樱桃·温柔女声'], ['Serena', '塞琳娜·知性女声'], ['Ethan', '伊森·阳光男声'], ['Chelsie', '切尔西·清甜少女'], ['Dylan', '迪伦·北京话'], ['Jada', '婕达·上海话'], ['Sunny', '桑尼·四川话']]],
  ['OpenAI 兼容', [['alloy', '中性'], ['echo', '沉稳男声'], ['fable', '英伦叙述'], ['onyx', '低沉男声'], ['nova', '活泼女声'], ['shimmer', '柔和女声'], ['coral', '温暖女声'], ['sage', '沉静']]],
  ['Azure 中文', [['zh-CN-XiaoxiaoNeural', '晓晓·女声'], ['zh-CN-XiaoyiNeural', '晓伊·女声'], ['zh-CN-YunxiNeural', '云希·男声'], ['zh-CN-YunjianNeural', '云健·男声'], ['zh-CN-YunxiaNeural', '云夏·少年']]],
  ['MiniMax 海螺（voice_id）', [['male-qn-qingse', '青涩男声'], ['male-qn-jingying', '精英男声'], ['male-qn-badao', '霸道男声'], ['female-shaonv', '少女音'], ['female-yujie', '御姐音'], ['female-chengshu', '成熟女声'], ['female-tianmei', '甜美女声'], ['audiobook_male_1', '有声书男声'], ['audiobook_female_1', '有声书女声'], ['presenter_female', '女主播']]],
];
const VOICE_SAMPLE = '你好呀，很高兴见到你。这是我的声音试听。';

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
  name: '', avatar: '', background: '', background_type: 'image', bgm: '',
  tagline: '', intro: '', greeting: '', persona: '', voice_name: '', voice_speed: 1, voice_pitch: 1, category: '', tags: '',
  is_public: false, nsfw: false, world: []
};

// Probe an audio File's duration (seconds) without uploading it.
function audioDuration(file) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => { URL.revokeObjectURL(el.src); resolve(el.duration); };
    el.onerror = () => { URL.revokeObjectURL(el.src); reject(new Error('无法读取音频')); };
    el.src = URL.createObjectURL(file);
  });
}

export default function CharacterEditor() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('basic');
  const [c, setC] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [locking, setLocking] = useState('');
  const [bgmBusy, setBgmBusy] = useState(false);
  const [voiceCfg, setVoiceCfg] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [loaded, setLoaded] = useState(false); // 服务器数据加载完成前不自动存草稿，避免覆盖
  const [draftHint, setDraftHint] = useState(null); // { savedAt } 检测到本地草稿时提示恢复
  const [myWbs, setMyWbs] = useState([]); // 我的世界书列表，供关联选择
  const [showAttach, setShowAttach] = useState(false);
  const [wbBusy, setWbBusy] = useState(false);
  const draftKey = id || 'new';
  const draft = useDraftAutosave('character', draftKey, c, c.name, loaded);

  // 加载我的世界书列表（供关联选择器使用）
  useEffect(() => { api('/worldbooks/mine').then(d => setMyWbs(d.worldbooks || [])).catch(() => {}); }, []);

  // Know the user's own voice protocol so the editor preview can use the right
  // path (browser TTS vs. server synthesis).
  useEffect(() => { api('/settings').then(d => setVoiceCfg({ proto: d.settings.voice_protocol, name: d.settings.voice_name })).catch(() => {}); }, []);

  // 试听 — speak a sample line using this character's chosen voice + speed.
  const previewVoice = async () => {
    if (previewing) return;
    if (voiceCfg?.proto === 'browser') { speakBrowser(VOICE_SAMPLE, c.voice_name || voiceCfg.name, c.voice_speed, c.voice_pitch); return; }
    setPreviewing(true);
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text: VOICE_SAMPLE, voice: c.voice_name || undefined, speed: c.voice_speed || undefined, pitch: c.voice_pitch || undefined })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '语音合成失败'); }
      const charged = res.headers.get('X-Gold-Fee');
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      audio.onended = () => setPreviewing(false);
      audio.onerror = () => setPreviewing(false);
      await audio.play();
      if (charged) toast(`平台语音试听 · 消耗 ${charged} 金币`);
    } catch (err) { toast(err.message, 'err'); setPreviewing(false); }
  };

  // Upload a character BGM — rejected client-side if longer than 60s so we never
  // ship an oversized loop. Stored as c.bgm (a /uploads URL, or data URL in the
  // static build).
  const pickBgm = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBgmBusy(true);
    try {
      let dur = 0;
      try { dur = await audioDuration(file); } catch { /* some formats hide metadata — allow, server still size-caps */ }
      if (dur && dur > BGM_MAX_SEC + 0.5) { toast(`背景音乐不能超过 ${BGM_MAX_SEC} 秒（当前 ${Math.round(dur)} 秒）`, 'err'); return; }
      const d = await uploadFile(file);
      set('bgm', d.url);
      toast('背景音乐已上传 🎵');
    } catch (err) { toast(err.message || '上传失败', 'err'); } finally { setBgmBusy(false); }
  };

  // Pick an online image but freeze it to one fixed frame (no more random swaps).
  const pickOnline = async (b) => {
    setLocking(b.name);
    try {
      const dataUrl = await lockImage(b.url);
      setC(prev => ({ ...prev, background: dataUrl, background_type: 'image' }));
      toast('已锁定为固定背景');
    } catch (err) {
      // Never store a live random endpoint — that's what caused cards to keep
      // re-randomising after creation. Leave the current background untouched.
      toast('该图源无法锁定（跨域限制）。请改用下方「随机生成」或预设/上传，确保固定一张', 'err');
    } finally { setLocking(''); }
  };

  // Draw a random scenery background, frozen as a fixed image (never re-randomises).
  const rollBg = () => { setC(prev => ({ ...prev, background: randomBg(), background_type: 'image' })); toast('已抽到一张并锁定 🎲'); };
  const rollAvatar = () => { set('avatar', randomAnimeAvatar()); toast('已抽到一个头像 🎲'); };

  useEffect(() => {
    if (editing) {
      api('/characters/' + id).then(d => { setC({ ...BLANK, ...d.character, is_public: !!d.character.is_public, world: d.character.world || [] }); setLoaded(true); const dl = listDrafts('character').find(x => x.key === id); if (dl) setDraftHint(dl); })
        .catch(e => toast(e.message, 'err'));
    } else {
      setLoaded(true);
      const dl = listDrafts('character').find(x => x.key === 'new'); if (dl) setDraftHint(dl);
    }
  }, [id]);

  const restoreDraft = () => { const d = loadDraft('character', draftKey); if (d) { setC({ ...BLANK, ...d }); toast('已恢复草稿，记得保存'); } setDraftHint(null); };
  const discardDraft = () => { delDraft('character', draftKey); setDraftHint(null); toast('草稿已丢弃'); };

  const set = (k, v) => setC(prev => ({ ...prev, [k]: v }));

  const addWorld = () => set('world', [...c.world, { keys: '', content: '', enabled: true }]);
  const updWorld = (i, k, v) => set('world', c.world.map((w, j) => j === i ? { ...w, [k]: v } : w));
  const delWorld = (i) => set('world', c.world.filter((_, j) => j !== i));

  // ── 独立世界书关联（跨角色复用）── 仅已保存角色可关联
  const linked = c.linked_worldbooks || [];
  const attachWb = async (wbId) => {
    setWbBusy(true);
    try {
      await api('/worldbooks/' + wbId + '/attach/' + id, { method: 'POST' });
      const w = myWbs.find(x => x.id === wbId);
      set('linked_worldbooks', [...linked, { id: w.id, name: w.name, is_public: w.is_public, owner_id: w.owner_id, entry_count: w.entry_count }]);
      toast('已关联世界书');
    } catch (e) { toast(e.message, 'err'); } finally { setWbBusy(false); }
  };
  const detachWb = async (wbId) => {
    setWbBusy(true);
    try {
      await api('/worldbooks/' + wbId + '/attach/' + id, { method: 'DELETE' });
      set('linked_worldbooks', linked.filter(x => x.id !== wbId));
      toast('已解除关联');
    } catch (e) { toast(e.message, 'err'); } finally { setWbBusy(false); }
  };
  const saveAsWb = async () => {
    if (!c.world.length) { toast('当前没有内嵌世界书条目', 'err'); return; }
    const name = prompt('为新世界书命名：', c.name + ' 的世界书');
    if (!name) return;
    setWbBusy(true);
    try {
      const d = await api('/worldbooks/from-character/' + id, { method: 'POST', body: { name } });
      setMyWbs(prev => [...prev, d.worldbook]);
      toast('已另存为独立世界书，可在「世界书」页管理');
    } catch (e) { toast(e.message, 'err'); } finally { setWbBusy(false); }
  };

  const save = async () => {
    if (!c.name.trim()) { toast('请填写角色名', 'err'); setTab('basic'); return; }
    setBusy(true);
    try {
      if (editing) await api('/characters/' + id, { method: 'PUT', body: c });
      else await api('/characters', { method: 'POST', body: c });
      draft.discard(); // 保存成功后清理本地草稿
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
        {loaded && <span className="draft-badge" title="内容会自动暂存到本机，断网不丢失"><RotateCcw size={12} /> 已自动暂存</span>}
        <label className="switch">
          <input type="checkbox" checked={c.is_public} onChange={e => set('is_public', e.target.checked)} />
          <span className="track" /><span style={{ fontSize: 13 }}>公开到广场</span>
        </label>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存角色'}</button>
      </div>

      {draftHint && (
        <div className="draft-restore">
          <span>检测到未保存的草稿「{draftHint.name}」（{Math.round((Date.now() - draftHint.savedAt) / 60000)} 分钟前）</span>
          <button className="btn sm primary" onClick={restoreDraft}><RotateCcw size={13} /> 恢复</button>
          <button className="btn sm ghost" onClick={discardDraft}><Trash size={13} /> 丢弃</button>
        </div>
      )}

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
                <button type="button" className="btn sm ghost" style={{ margin: '8px auto 0' }} onClick={rollAvatar}><Dices size={14} /> 随机二次元头像</button>
                <div className="hint" style={{ textAlign: 'center' }}>可挑选真人风格预设脸模（区分男女）、随机二次元头像，或上传自定义静态图片</div>
              </div>
              <div className="field"><label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Volume2 size={15} /> 音色调优 <span className="muted">(可选)</span></label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} value={c.voice_name} onChange={e => set('voice_name', e.target.value)} placeholder="如 Cherry / alloy，留空用默认音色" list="voice-presets" />
                  <button type="button" className="btn sm" onClick={previewVoice} disabled={previewing} title="试听该音色">
                    <Volume2 size={14} className={previewing ? 'spin' : ''} /> {previewing ? '播放中' : '试听'}
                  </button>
                </div>
                <datalist id="voice-presets">
                  {VOICE_PRESETS.map(([g, vs]) => vs.map(([v, lb]) => <option key={g + v} value={v}>{g} · {lb}</option>))}
                </datalist>
                <div className="voice-chips">
                  {VOICE_PRESETS.map(([g, vs]) => (
                    <div key={g} className="voice-chip-group">
                      <span className="vcg-label">{g}</span>
                      {vs.map(([v, lb]) => (
                        <button key={v} type="button" title={v} className={'voice-chip' + (c.voice_name === v ? ' on' : '')} onClick={() => set('voice_name', v)}>{lb}</button>
                      ))}
                    </div>
                  ))}
                </div>
                <label style={{ marginTop: 12, display: 'block' }}>语速：<b>{Number(c.voice_speed || 1).toFixed(2)}×</b></label>
                <input type="range" min="0.5" max="2" step="0.05" value={c.voice_speed || 1}
                  onChange={e => set('voice_speed', parseFloat(e.target.value))} style={{ width: '100%' }} />
                <div className="vc-ticks"><span>慢 0.5×</span><span>正常 1×</span><span>快 2×</span></div>
                <label style={{ marginTop: 10, display: 'block' }}>音调：<b>{Number(c.voice_pitch || 1).toFixed(2)}×</b></label>
                <input type="range" min="0.5" max="1.5" step="0.05" value={c.voice_pitch || 1}
                  onChange={e => set('voice_pitch', parseFloat(e.target.value))} style={{ width: '100%' }} />
                <div className="vc-ticks"><span>低沉 0.5×</span><span>自然 1×</span><span>尖亮 1.5×</span></div>
                <div className="hint">朗读该角色台词所用的音色、语速与音调（需在「设置 → 语音模型」配置语音 API，或由平台提供）。语速对多数服务商生效；音调对浏览器语音 / Azure / Google / MiniMax / 百度 / 火山生效。音色 ID 跟随你所配置的服务商：百度填发音人编号（per，如 0 / 1 / 5118），火山填 voice_type（如 BV001_streaming），腾讯填 VoiceType 编号（如 101001），其余厂商填对应音色名。试听走你当前的语音通道，平台语音按句计费。</div>
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

            {editing && (
              <div className="card" style={{ marginTop: 22, background: 'var(--bg-2)' }}>
                <div className="section-title">
                  <h2 style={{ fontSize: 15 }}><Link2 size={14} style={{ verticalAlign: -2, marginRight: 5 }} />关联独立世界书 ({linked.length})</h2>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn sm" onClick={saveAsWb} disabled={wbBusy} title="把上方内嵌条目另存为独立世界书"><BookUp size={13} /> 另存为</button>
                    <button className="btn sm" onClick={() => setShowAttach(s => !s)} disabled={wbBusy}><Plus size={13} /> 关联</button>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>
                  关联后，该世界书的条目会与本角色内嵌条目一起在对话中触发。可在「世界书」页独立编辑，多个角色共享同一本。
                </p>
                {linked.length === 0 && <div className="muted" style={{ fontSize: 13, padding: '6px 0' }}>尚未关联任何独立世界书</div>}
                {linked.map(w => (
                  <div key={w.id} className="room-row" style={{ padding: '8px 10px', background: 'var(--panel)', marginBottom: 6, borderRadius: 10 }}>
                    <BookUp size={15} className="muted" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 13.5 }}>{w.name}</b>
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{w.entry_count || 0} 条</span>
                      {w.is_public ? <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>· 公开</span> : null}
                    </div>
                    <button className="btn sm ghost danger" onClick={() => detachWb(w.id)} disabled={wbBusy} title="解除关联"><Unlink size={13} /></button>
                  </div>
                ))}
                {showAttach && (
                  <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>从我的世界书中选择：</div>
                    {myWbs.filter(w => !linked.some(l => l.id === w.id)).length === 0
                      ? <div className="muted" style={{ fontSize: 13 }}>没有可关联的世界书（全部已关联或尚未创建）</div>
                      : myWbs.filter(w => !linked.some(l => l.id === w.id)).map(w => (
                        <div key={w.id} className="room-row" style={{ padding: '7px 10px', background: 'var(--panel)', marginBottom: 5, borderRadius: 10, cursor: 'pointer' }} onClick={() => attachWb(w.id)}>
                          <Plus size={14} style={{ color: 'var(--accent)' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <b style={{ fontSize: 13 }}>{w.name}</b>
                            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{w.entry_count || 0} 条</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'media' && (
          <div className="editor-grid">
            <div className="field">
              <label>聊天背景（支持动态 GIF / 视频）</label>
              <Uploader value={c.background} type={c.background_type} dynamic
                onChange={(url, type) => setC(prev => ({ ...prev, background: url, background_type: type }))} />
              <div className="hint">将作为与该角色对话时的沉浸式背景。支持 jpg/png/webp/gif 或 mp4/webm 短视频实现动态背景。</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                <label style={{ margin: 0 }}>二次元 / 风景背景预设</label>
                <button type="button" className="btn sm primary" onClick={rollBg}><Dices size={14} /> 随机生成一张（锁定）</button>
              </div>
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

              <label style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 6 }}><Music size={15} /> 角色背景音乐 (BGM)</label>
              <input id="bgm-file" type="file" accept="audio/*" hidden onChange={pickBgm} />
              {c.bgm ? (
                <div className="bgm-row">
                  <audio src={c.bgm} controls loop preload="metadata" style={{ width: '100%' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn sm ghost" onClick={() => document.getElementById('bgm-file').click()} disabled={bgmBusy}>{bgmBusy ? '上传中…' : '更换'}</button>
                    <button type="button" className="btn sm danger" onClick={() => set('bgm', '')}><X size={14} /> 移除</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => document.getElementById('bgm-file').click()} disabled={bgmBusy}>
                  <Music size={14} /> {bgmBusy ? '上传中…' : '上传背景音乐'}
                </button>
              )}
              <div className="hint">进入与该角色的对话时自动循环播放（用户可在对话内随时静音）。仅支持音频文件，时长不超过 {BGM_MAX_SEC} 秒。</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
