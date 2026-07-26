import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api } from '../api.jsx';
import { useToast, Uploader, CoinIcon } from '../ui.jsx';
import { useDraftAutosave, loadDraft, delDraft, listDrafts } from '../drafts.js';
import { useUnsavedValue } from '../appNavigation.jsx';
import { isAppMode } from '../appmode.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { RotateCcw, Trash, ArrowLeft, Save, FileText, Image as ImageIcon, BookOpen, ShieldAlert, Check, Sparkles } from 'lucide-react';

const BLANK = {
  title: '', summary: '', cover: '', content: '',
  category: '', tags: '', price_gold: 0, nsfw: false
};

export default function ScriptEditor() {
  const { id } = useParams();
  const editing = !!id;
  const appMode = isAppMode();
  const nav = useNavigate();
  const toast = useToast();
  const [s, setS] = useState(BLANK);
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draftHint, setDraftHint] = useState(null);
  const [appSection, setAppSection] = useState('basics');
  const draftKey = id || 'new';
  const draft = useDraftAutosave('script', draftKey, s, s.title, loaded);
  const markScriptClean = useUnsavedValue(s, loaded, '剧本还有尚未保存的修改，确定离开吗？');

  useEffect(() => {
    api('/meta/categories').then(d => setCats(d.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (editing) {
      api('/scripts/' + id)
        .then(d => {
          const next = { ...BLANK, ...d.script, nsfw: !!d.script.nsfw };
          markScriptClean(next);
          setS(next);
          setLoaded(true);
          const dl = listDrafts('script').find(x => x.key === id); if (dl) setDraftHint(dl);
        })
        .catch(e => toast(e.message, 'err'));
    } else {
      markScriptClean(BLANK);
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
      markScriptClean(s);
      draft.discard();
      toast('已保存');
      nav('/scripts');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  const openAppSection = (section) => {
    setAppSection(section);
    document.getElementById(`qa-script-editor-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (appMode) {
    return (
      <main className="qa-script-editor-v4" data-testid="app-script-editor">
        <header className="qa-script-editor-v4__topbar">
          <AppIconButton className="qa-script-editor-v4__back" label="返回上一页" onClick={() => nav(-1)}><ArrowLeft size={20} /></AppIconButton>
          <div className="qa-script-editor-v4__topcopy">
            <strong>{editing ? '编辑剧本' : '创建剧本'}</strong>
            <span>{s.title || '未命名草稿'}</span>
          </div>
          <span className="qa-script-editor-v4__draft-state" data-ready={loaded || undefined}>{loaded ? '草稿已保护' : '载入中'}</span>
        </header>

        <nav className="qa-script-editor-v4__tabs" aria-label="剧本编辑区">
          {[
            ['basics', '信息'],
            ['market', '封面与发布'],
            ['story', '正文'],
          ].map(([key, label]) => (
            <AppButton key={key} className="qa-script-editor-v4__tab" variant="tertiary" data-section={key} selected={appSection === key} onClick={() => openAppSection(key)}>{label}</AppButton>
          ))}
        </nav>

        {draftHint && (
          <aside className="qa-script-editor-v4__restore" aria-label="未保存草稿">
            <span className="qa-script-editor-v4__restore-icon" aria-hidden="true"><RotateCcw size={18} /></span>
            <span className="qa-script-editor-v4__restore-copy"><b>发现本机草稿</b><small>「{draftHint.name}」· {Math.max(0, Math.round((Date.now() - draftHint.savedAt) / 60000))} 分钟前</small></span>
            <div><AppButton variant="primary" size="sm" onClick={restoreDraft}>恢复</AppButton><AppIconButton label="丢弃本机草稿" tone="danger" onClick={discardDraft}><Trash size={17} /></AppIconButton></div>
          </aside>
        )}

        <div className="qa-script-editor-v4__page">
          <section className="qa-script-editor-v4__intro" aria-labelledby="qa-script-editor-heading">
            <span className="qa-script-editor-v4__intro-icon" aria-hidden="true"><Sparkles size={21} /></span>
            <div><span>沉浸式故事工作台</span><h1 id="qa-script-editor-heading">把世界观整理成可演绎的剧本</h1><p>先让读者看懂故事，再决定封面、售价与互动开场。</p></div>
          </section>

          <section id="qa-script-editor-basics" className="qa-script-editor-v4__section" aria-labelledby="qa-script-editor-basics-title">
            <header className="qa-script-editor-v4__section-head">
              <span className="qa-script-editor-v4__section-icon is-indigo" aria-hidden="true"><FileText size={19} /></span>
              <div><span>第一步</span><h2 id="qa-script-editor-basics-title">剧本信息</h2><p>这些内容会出现在市集与分享卡片上。</p></div>
            </header>

            <div className="qa-script-editor-v4__form-card">
              <div className="field qa-script-editor-v4__field">
                <label htmlFor="qa-script-title">标题 <b>必填</b><small>{s.title.length}/80</small></label>
                <input id="qa-script-title" className="input" value={s.title} maxLength={80} onChange={e => set('title', e.target.value)} placeholder="例如：浮空城的最后守夜人" />
              </div>
              <div className="field qa-script-editor-v4__field">
                <label htmlFor="qa-script-summary">一句话简介 <small>{s.summary.length}/500</small></label>
                <textarea id="qa-script-summary" className="textarea" value={s.summary} maxLength={500} onChange={e => set('summary', e.target.value)} placeholder="讲清主角、困境与最吸引人的悬念…" />
              </div>
              <div className="qa-script-editor-v4__field-grid">
                <div className="field qa-script-editor-v4__field"><label htmlFor="qa-script-category">分类</label>
                  <select id="qa-script-category" className="select" value={s.category} onChange={e => set('category', e.target.value)}>
                    <option value="">未分类</option>{cats.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field qa-script-editor-v4__field"><label htmlFor="qa-script-tags">标签 <small>逗号分隔</small></label>
                  <input id="qa-script-tags" className="input" value={s.tags} onChange={e => set('tags', e.target.value)} placeholder="奇幻, 冒险, 悬疑" />
                </div>
              </div>
            </div>
          </section>

          <section id="qa-script-editor-market" className="qa-script-editor-v4__section" aria-labelledby="qa-script-editor-market-title">
            <header className="qa-script-editor-v4__section-head">
              <span className="qa-script-editor-v4__section-icon is-coral" aria-hidden="true"><ImageIcon size={19} /></span>
              <div><span>第二步</span><h2 id="qa-script-editor-market-title">封面与发布</h2><p>用清晰封面建立识别，再设置访问方式。</p></div>
            </header>

            <div className="qa-script-editor-v4__form-card qa-script-editor-v4__market-card">
              <div className="field qa-script-editor-v4__field qa-script-editor-v4__cover-field"><label>封面图</label><Uploader value={s.cover} onChange={(url) => set('cover', url)} accept="image/*" label="选择一张横向封面" /></div>
              <div className="field qa-script-editor-v4__field qa-script-editor-v4__price-field">
                <label htmlFor="qa-script-price">解锁价格</label>
                <div className="qa-script-editor-v4__price-input"><CoinIcon size={20} /><input id="qa-script-price" className="input" type="number" min="0" step="1" inputMode="numeric" value={s.price_gold} onChange={e => set('price_gold', e.target.value)} placeholder="0" /><span>金币</span></div>
                <p><Check size={14} /> 填 0 即免费；付费剧本支持购买后 30 分钟内退款。</p>
              </div>
              <label className="switch qa-script-editor-v4__safety">
                <input type="checkbox" checked={s.nsfw} onChange={e => set('nsfw', e.target.checked)} />
                <span className="track" /><span><b><ShieldAlert size={15} /> 成人内容标记</b><small>仅在确实包含成人内容时开启，帮助读者提前判断。</small></span>
              </label>
            </div>
          </section>

          <section id="qa-script-editor-story" className="qa-script-editor-v4__section" aria-labelledby="qa-script-editor-story-title">
            <header className="qa-script-editor-v4__section-head">
              <span className="qa-script-editor-v4__section-icon is-gold" aria-hidden="true"><BookOpen size={19} /></span>
              <div><span>第三步</span><h2 id="qa-script-editor-story-title">剧情与互动开场</h2><p>写下世界规则、角色处境、冲突和第一幕。</p></div>
            </header>

            <div className="qa-script-editor-v4__form-card">
              <div className="field qa-script-editor-v4__field qa-script-editor-v4__story-field">
                <label htmlFor="qa-script-content">正文 / 剧情设定 <small>{s.content.length} 字</small></label>
                <textarea id="qa-script-content" className="textarea" value={s.content} onChange={e => set('content', e.target.value)} placeholder="建议依次写：世界观、人物背景、当前冲突、开场场景与可互动方向…" />
              </div>
              <p className="qa-script-editor-v4__story-note"><BookOpen size={15} /> 第一屏先交代玩家身处哪里、面对谁，以及现在必须做什么。</p>
            </div>
          </section>
        </div>

        {typeof document !== 'undefined' && createPortal(
          <div className="qa-script-editor-v4__savebar" role="toolbar" aria-label="剧本保存操作">
            <span className="qa-script-editor-v4__save-state"><RotateCcw size={15} /><span>{loaded ? '内容自动暂存到本机' : '正在载入剧本'}</span></span>
            <AppButton className="qa-script-editor-v4__save" variant="primary" size="lg" loading={busy} disabled={!loaded} onClick={save}><Save size={17} /> {busy ? '保存中…' : '保存剧本'}</AppButton>
          </div>, document.body)}
      </main>
    );
  }

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
