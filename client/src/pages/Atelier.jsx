import React, { useEffect, useRef, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, Modal, CountUp } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { AppEmptyArt } from '../art.jsx';
import AppErrorState from '../components/AppErrorState.jsx';
import {
  PenTool, Plus, Sparkles, BookText, Library, Layers, Feather,
  Trash2, Pin, Wand2, Loader2, ArrowLeft, ArrowRight, ScrollText, BookOpen, Globe, User, X,
} from 'lucide-react';

// 纯小说创作板块首页 · 「创作工坊」。列出我的小说，支持一句话灵感开局。
export default function Atelier() {
  const nav = useNavigate();
  const toast = useToast();
  const appMode = isAppMode();
  const [novels, setNovels] = useState(null);
  const [novelsError, setNovelsError] = useState('');
  const [creating, setCreating] = useState(false);
  const createLockRef = useRef(false);
  const [tab, setTab] = useState('mine');
  const [showcase, setShowcase] = useState(null);
  const [showcaseError, setShowcaseError] = useState('');

  const load = async () => {
    setNovels(null);
    setNovelsError('');
    try {
      const next = await api('/novels');
      setNovels(next.novels || []);
    } catch (error) {
      setNovelsError(error?.message || '书架加载失败，请稍后重试');
    }
  };
  const loadShowcase = async () => {
    setShowcase(null);
    setShowcaseError('');
    try {
      const next = await api('/novels/showcase');
      setShowcase(next.novels || []);
    } catch (error) {
      setShowcaseError(error?.message || '精选书架加载失败，请稍后重试');
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (tab === 'showcase' && showcase === null && !showcaseError) void loadShowcase();
    /* eslint-disable-next-line */
  }, [tab]);

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

  if (appMode) {
    const activeItems = tab === 'showcase' ? showcase : novels;
    const activeError = tab === 'showcase' ? showcaseError : novelsError;
    const retryActive = tab === 'showcase' ? loadShowcase : load;
    const loading = activeItems === null;
    const empty = Array.isArray(activeItems) && activeItems.length === 0;

    return (
      <main className="qa-atelier">
        <header className="qa-atelier-head">
          <AppIconButton label="返回" onClick={() => nav(-1)}><ArrowLeft size={21} /></AppIconButton>
          <div className="qa-atelier-head-title">
            <h1>小说工坊</h1>
            <span>AI 共写书架</span>
          </div>
          <AppIconButton label="开新书" variant="filled" onClick={() => setCreating(true)}><Plus size={20} /></AppIconButton>
        </header>

        <div className="qa-atelier-body">
          <section className="qa-atelier-intro" aria-labelledby="qa-atelier-intro-title">
            <span className="qa-atelier-intro-icon" aria-hidden="true"><Feather size={22} /></span>
            <div>
              <span className="qa-atelier-kicker"><Sparkles size={12} /> AI 创作</span>
              <h2 id="qa-atelier-intro-title">从一个念头，写成一本书</h2>
              <p>你定方向，AI 续写正文；世界设定会随剧情持续生长。</p>
            </div>
          </section>

          <div className="qa-atelier-tabs" role="tablist" aria-label="小说书架">
            <AppButton
              className="qa-atelier-tab"
              variant="tertiary"
              selected={tab === 'mine'}
              role="tab"
              aria-selected={tab === 'mine'}
              onClick={() => setTab('mine')}
            ><Library size={16} /> 我的书架</AppButton>
            <AppButton
              className="qa-atelier-tab"
              variant="tertiary"
              selected={tab === 'showcase'}
              role="tab"
              aria-selected={tab === 'showcase'}
              onClick={() => setTab('showcase')}
            ><Globe size={16} /> 书架精选</AppButton>
          </div>

          {activeError ? (
            <AtelierLoadError appMode message={activeError} onRetry={() => void retryActive()} />
          ) : loading ? (
            <AppAtelierLoading />
          ) : empty ? (
            <AppAtelierEmpty
              showcase={tab === 'showcase'}
              onCreate={() => setCreating(true)}
            />
          ) : (
            <AppAtelierShelf
              novels={activeItems}
              showcase={tab === 'showcase'}
              onOpen={(n) => nav(tab === 'showcase' ? `/atelier/read/${n.id}` : `/atelier/${n.id}`)}
              onPin={togglePin}
              onRemove={remove}
            />
          )}
        </div>

        {creating && (
          <CreateModal
            appMode
            creationLock={createLockRef}
            onClose={() => { if (!createLockRef.current) setCreating(false); }}
            onCreated={(id) => nav(`/atelier/${id}`)}
          />
        )}
      </main>
    );
  }

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
        showcaseError ? <AtelierLoadError message={showcaseError} onRetry={() => void loadShowcase()} /> :
        showcase === null ? (
          <div className="lgw-skel-list" style={{ paddingTop: 20 }} aria-hidden="true">
            {[0, 1, 2].map(i => <div key={i} className="skel lgw-skel-lg" />)}
          </div>
        ) :
        showcase.length === 0 ? (
          <div className="atl-empty lgw-empty">
            <div className="atl-empty-ic"><BookOpen size={40} /></div>
            <h2>书架还很空</h2>
            <p>把你的作品发布出来，让它成为第一本被人翻开的书。</p>
            <div className="lgw-empty-cta"><button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> 开新书</button></div>
          </div>
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
      ) : novelsError ? (
        <AtelierLoadError message={novelsError} onRetry={() => void load()} />
      ) : novels === null ? (
        <div className="lgw-skel-list" style={{ paddingTop: 20 }} aria-hidden="true">
          {[0, 1, 2].map(i => <div key={i} className="skel lgw-skel-lg" />)}
        </div>
      ) : novels.length === 0 ? (
        <div className="atl-empty lgw-empty">
          <div className="atl-empty-ic"><BookText size={40} /></div>
          <h2>还没有作品</h2>
          <p>从一个念头开始 —— 一句创意、一个开场，剩下的交给与你共写的 AI。</p>
          <div className="lgw-empty-cta"><button className="btn primary" onClick={() => setCreating(true)}><Wand2 size={16} /> 灵感开局</button></div>
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

      {creating && (
        <CreateModal
          creationLock={createLockRef}
          onClose={() => { if (!createLockRef.current) setCreating(false); }}
          onCreated={(id) => nav(`/atelier/${id}`)}
        />
      )}
    </div>
  );
}

function AtelierLoadError({ message, onRetry, appMode = false }) {
  // App 壳：统一错误态（含重试）；Web 分支保持原状，零视觉差。
  if (appMode) return <AppErrorState kind="atelier" title="书架暂时无法加载" message={message} onRetry={onRetry} retryLabel="重新加载" />;
  return (
    <section className={appMode ? 'qa-atelier-empty' : 'atl-empty'} role="alert" aria-live="assertive">
      <div className={appMode ? 'qa-atelier-empty-icon' : 'atl-empty-ic'} aria-hidden="true"><BookOpen size={34} /></div>
      <h2>书架暂时无法加载</h2>
      <p>{message}</p>
      <AppButton className={appMode ? 'qa-atelier-empty-create' : 'btn primary'} variant="primary" onClick={onRetry}>
        重新加载
      </AppButton>
    </section>
  );
}

function AppAtelierLoading() {
  return (
    <section className="qa-atelier-loading" role="status" aria-label="正在载入小说书架">
      {[0, 1, 2].map(i => (
        <div className="qa-atelier-skeleton" key={i} aria-hidden="true">
          <span className="skel qa-atelier-skeleton-cover" />
          <span className="qa-atelier-skeleton-copy">
            <i className="skel qa-atelier-skeleton-title" />
            <i className="skel qa-atelier-skeleton-summary" />
            <i className="skel qa-atelier-skeleton-action" />
          </span>
        </div>
      ))}
    </section>
  );
}

function AppAtelierEmpty({ showcase, onCreate }) {
  return (
    <section className="qa-atelier-empty" aria-labelledby="qa-atelier-empty-title">
      <AppEmptyArt kind="atelier" size={104} />
      <h2 id="qa-atelier-empty-title">{showcase ? '精选书架还很空' : '还没有作品'}</h2>
      <p>{showcase ? '把你的作品发布出来，让它成为第一本被人翻开的书。' : '从一句创意或一个开场开始，与你的 AI 搭档共同写下第一章。'}</p>
      {!showcase && (
        <AppButton className="qa-atelier-empty-create" variant="primary" size="lg" onClick={onCreate}>
          <Wand2 size={17} /> 灵感开局
        </AppButton>
      )}
    </section>
  );
}

function AppAtelierShelf({ novels, showcase, onOpen, onPin, onRemove }) {
  return (
    <section className="qa-atelier-shelf" aria-label={showcase ? '精选小说' : '我的小说'}>
      {novels.map(n => (
        <article className="qa-atelier-card" key={n.id}>
          <div className="qa-atelier-cover">
            {n.cover
              ? <img src={assetUrl(n.cover)} alt={`${n.title}封面`} loading="lazy" decoding="async" />
              : <span className="qa-atelier-cover-placeholder" aria-hidden="true"><ScrollText size={27} /></span>}
            {n.genre && <span className="qa-atelier-genre">{n.genre}</span>}
          </div>

          <div className="qa-atelier-card-copy">
            <div className="qa-atelier-card-head">
              <div className="qa-atelier-card-title">
                <h2>{n.title}</h2>
                {showcase && n.mine && <span>我的</span>}
              </div>
              {!showcase && (
                <div className="qa-atelier-card-tools">
                  <AppIconButton
                    className="qa-atelier-pin"
                    label={n.pinned ? `取消置顶《${n.title}》` : `置顶《${n.title}》`}
                    selected={n.pinned}
                    pressed={n.pinned}
                    onClick={(event) => onPin(n, event)}
                  ><Pin size={17} /></AppIconButton>
                  <AppIconButton
                    className="qa-atelier-delete"
                    label={`删除《${n.title}》`}
                    tone="danger"
                    onClick={(event) => onRemove(n, event)}
                  ><Trash2 size={17} /></AppIconButton>
                </div>
              )}
            </div>

            <p>{n.logline || n.synopsis || '尚未写下故事内核。'}</p>

            <div className="qa-atelier-meta" aria-label="作品信息">
              {showcase ? (
                <>
                  <span><User size={13} /> {n.author_name}</span>
                  <span><PenTool size={13} /> <CountUp value={n.words} /> 字</span>
                </>
              ) : (
                <>
                  <span><Library size={13} /> {n.run_count} 条剧情线</span>
                  <span><Layers size={13} /> {n.codex_count} 项设定</span>
                  <span><PenTool size={13} /> <CountUp value={n.words} /> 字</span>
                </>
              )}
            </div>

            <AppButton className="qa-atelier-open" variant="primary" onClick={() => onOpen(n)}>
              {showcase ? <BookOpen size={16} /> : <Feather size={16} />}
              {showcase ? '打开阅读' : '继续创作'}
              <ArrowRight size={15} />
            </AppButton>
          </div>
        </article>
      ))}
    </section>
  );
}

const GENRES = ['奇幻', '科幻', '武侠', '仙侠', '都市', '言情', '悬疑', '恐怖', '历史', '游戏', '校园', '末世', '轻小说', '同人'];

function CreateModal({ onClose, onCreated, appMode = false, creationLock }) {
  const toast = useToast();
  const localCreationLock = useRef(false);
  const createLock = creationLock || localCreationLock;
  const [seed, setSeed] = useState('');
  const [form, setForm] = useState({ title: '', logline: '', genre: '', synopsis: '', tags: '' });
  const [brainstorming, setBrainstorming] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const close = () => { if (!createLock.current) onClose(); };

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
    if (createLock.current) return;
    if (!form.title.trim()) { toast('请填写作品名', 'info'); return; }
    createLock.current = true;
    setSaving(true);
    try {
      const d = await api('/novels', { method: 'POST', body: form });
      toast('已创建，开始创作吧', 'ok');
      // Keep the synchronous lock held after success until navigation unmounts
      // this modal. Even a delayed route transition cannot submit the same
      // draft a second time.
      onCreated(d.novel.id);
    } catch (e) {
      toast(e.message, 'err');
      createLock.current = false;
      setSaving(false);
    }
  };

  if (appMode) {
    return (
      <Modal onClose={close} className="qa-atelier-create-modal" backdropClassName="qa-atelier-create-backdrop">
        <header className="qa-atelier-create-head">
          <div>
            <span><Sparkles size={13} /> AI 共写</span>
            <h2>开一本新书</h2>
          </div>
          <AppIconButton label="关闭新书表单" disabled={saving} onClick={close}><X size={19} /></AppIconButton>
        </header>

        <div className="qa-atelier-seed">
          <label htmlFor="qa-atelier-seed"><Wand2 size={15} /> 灵感开局 <span>可选</span></label>
          <input
            id="qa-atelier-seed"
            className="input"
            placeholder="一句话写下你的创意…"
            value={seed}
            onChange={e => setSeed(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') brainstorm(); }}
          />
          <AppButton variant="secondary" loading={brainstorming} disabled={brainstorming} onClick={brainstorm}>
            <Sparkles size={15} /> 生成作品信息
          </AppButton>
        </div>

        <div className="qa-atelier-create-fields">
          <div className="field">
            <label htmlFor="qa-atelier-title">作品名</label>
            <input id="qa-atelier-title" className="input" value={form.title} onChange={e => set('title', e.target.value)} maxLength={80} placeholder="给故事起个名字" />
          </div>
          <div className="field">
            <label htmlFor="qa-atelier-logline">一句话内核</label>
            <input id="qa-atelier-logline" className="input" value={form.logline} onChange={e => set('logline', e.target.value)} maxLength={200} placeholder="一句话说清这是个什么样的故事" />
          </div>
          <div className="qa-atelier-form-grid">
            <div className="field">
              <label htmlFor="qa-atelier-genre">类型</label>
              <input id="qa-atelier-genre" className="input" value={form.genre} onChange={e => set('genre', e.target.value)} maxLength={40} placeholder="奇幻 / 科幻 …" list="qa-atl-genres" />
              <datalist id="qa-atl-genres">{GENRES.map(g => <option key={g} value={g} />)}</datalist>
            </div>
            <div className="field">
              <label htmlFor="qa-atelier-tags">标签</label>
              <input id="qa-atelier-tags" className="input" value={form.tags} onChange={e => set('tags', e.target.value)} maxLength={200} placeholder="逗号分隔" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="qa-atelier-synopsis">开篇梗概 / 起点</label>
            <textarea id="qa-atelier-synopsis" className="textarea" rows={4} value={form.synopsis} onChange={e => set('synopsis', e.target.value)} maxLength={4000} placeholder="故事从哪里开始？AI 会从这里接手。" />
          </div>
        </div>

        <div className="qa-atelier-create-actions">
          <AppButton variant="secondary" disabled={saving} onClick={close}>取消</AppButton>
          <AppButton variant="primary" size="lg" loading={saving} disabled={saving} onClick={create}>
            <Plus size={16} /> 创建并开始
          </AppButton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={close}>
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
        <button className="btn ghost" onClick={close} disabled={saving} style={{ flex: 1 }}>取消</button>
        <button className="btn primary" onClick={create} disabled={saving} style={{ flex: 2 }}>
          {saving ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} 创建并开始
        </button>
      </div>
    </Modal>
  );
}
