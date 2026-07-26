import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNav } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { pid } from '../assets.jsx';
import { isAppMode } from '../appmode.js';
import Reviews from '../components/Reviews.jsx';
import ReportButton from '../components/ReportButton.jsx';
import CallScreen from '../components/CallScreen.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { useAppOverlay } from '../overlay.jsx';
import { CoverArt, EmptyArt, QuietAquaCharacterArt, isLegacyMonogramCover, resolveCharacterMedia } from '../art.jsx';
import ShareCardSheet from '../components/ShareCardSheet.jsx';
import {
  MessageCircle, Heart, Pencil, BookOpen, ArrowLeft, Sparkles, Globe, Eye,
  ChevronRight, ChevronDown, Drama, BadgeCheck, Download, X, MoreHorizontal,
  Share2, Plus, Check, Quote, MessagesSquare, Puzzle, AudioLines, Phone, Flame,
  Image as ImageIcon
} from 'lucide-react';
import { shareUrl } from '../util.js';

function recordRecent(c) {
  try {
    const prev = JSON.parse(localStorage.getItem('recent_chars') || '[]').filter(x => x.id !== c.id);
    const item = { id: c.id, name: c.name, avatar: c.avatar, tagline: c.tagline, owner_name: c.owner_name, category: c.category, uses: c.uses, featured: c.featured };
    localStorage.setItem('recent_chars', JSON.stringify([item, ...prev].slice(0, 12)));
  } catch { /* */ }
}

export default function CharacterView() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNav();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [related, setRelated] = useState([]);
  const [faved, setFaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wbOpen, setWbOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setWbOpen(false);
    setC(null);
    setRelated([]);
    setLoadError('');
    // 详情接口已带 faved 字段，无需再全量拉一遍公开列表来找收藏态。
    api('/characters/' + id, { signal: controller.signal })
      .then(d => { setC(d.character); setRelated(d.related || []); setFaved(!!d.character.faved); recordRecent(d.character); })
      .catch(e => {
        if (e?.name === 'AbortError') return;
        setLoadError(e?.message || '角色暂时无法打开');
        toast(e?.message || '角色暂时无法打开', 'err');
      });
    return () => controller.abort();
  }, [id, loadAttempt]);

  // A manual retry reloads the resource but must not manufacture another
  // engagement event for the same mounted character page.
  useEffect(() => {
    api('/engage/view', { method: 'POST', body: { type: 'character', id: +id } }).catch(() => {});
  }, [id]);

  const startChat = async () => {
    setBusy(true);
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const toggleFav = async () => {
    try { const d = await api(`/characters/${c.id}/favorite`, { method: 'POST' }); setFaved(d.faved); toast(d.faved ? '已收藏' : '已取消收藏'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const exportCard = async () => {
    try {
      const card = await api('/characters/' + c.id + '/export');
      const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `character-${c.id}-${c.name}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('角色卡已导出');
    } catch (e) { toast(e.message, 'err'); }
  };
  const share = async () => {
    const url = shareUrl('/character/' + c.id);
    try { if (navigator.share) { await navigator.share({ title: c.name, url }); return; } }
    catch (error) { if (error?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('链接已复制'); } catch { toast('分享：' + c.name); }
  };

  // Resolve loading failures before splitting into the App/Web presentations.
  // Keeping retry state here avoids a child view reaching into parent scope,
  // and gives both clients the same explicit recovery path.
  if (!c && loadError) return (
    <div className={isAppMode() ? 'cvx immersive' : 'page'}>
      <div className="empty" role="alert" style={{ minHeight: '70dvh', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, padding: 28 }}>
        <EmptyArt kind="library" size={128} />
        <b>暂时无法加载角色</b>
        <span className="muted" style={{ maxWidth: 340, overflowWrap: 'anywhere' }}>{loadError}</span>
        <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
          <AppButton className="btn" onClick={() => nav(-1)}><ArrowLeft size={16} /> 返回</AppButton>
          <AppButton className="btn" onClick={() => nav('/library')}><BookOpen size={16} /> 角色库</AppButton>
          <AppButton className="btn primary" variant="primary" onClick={() => setLoadAttempt(n => n + 1)}>重试</AppButton>
        </div>
      </div>
    </div>
  );

  const shared = { c, user, nav, toast, faved, busy, wbOpen, setWbOpen, related, startChat, toggleFav, exportCard, share, id };
  // App 壳走全屏沉浸布局；Web / 移动网页保留编辑视角的卡片布局。
  if (isAppMode()) return <AppView key={c?.id || id} {...shared} />;
  return <WebView {...shared} />;
}

/* ============================================================
   App 沉浸布局 —— 全幅立绘 + 居中名字 + 作者关注 + 磁贴 + 档案行
   ============================================================ */
function AppView({ c, user, nav, toast, faved, busy, wbOpen, setWbOpen, related, startChat, toggleFav, exportCard, share }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [greetOpen, setGreetOpen] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  // S7-G10 与 TA 的足迹：从自己会话推导羁绊摘要（好感度最高的一段 + 相遇日）
  const [bond, setBond] = useState(null);
  useEffect(() => {
    if (!c?.id) { setBond(null); return; }
    api('/chat/conversations').then(d => {
      const mine = (d.conversations || []).filter(x => x.character_id === c.id);
      if (!mine.length) { setBond(null); return; }
      const first = mine.reduce((a, b) => (String(a.created_at || '') <= String(b.created_at || '') ? a : b));
      const best = mine.reduce((a, b) => ((b.affinity || 0) > (a.affinity || 0) ? b : a));
      setBond({
        affinity: best.affinity || 0,
        since: String(first.created_at || '').slice(0, 10),
        count: mine.length,
        convId: best.id,
      });
    }).catch(() => setBond(null));
  }, [c?.id]);
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);
  useAppOverlay(menuOpen, () => setMenuOpen(false), { rootRef: menuRef, returnFocusRef: menuTriggerRef });

  // 关注态：/social/follow-state 为主（静态离线版没有该端点则静默保持默认）。
  useEffect(() => {
    if (!c || !user || c.owner_id === user.id) return;
    api('/social/follow-state/' + c.owner_id)
      .then(d => { setFollowing(!!d.following); })
      .catch(() => {
        api('/users/' + c.owner_id).then(d => { setFollowing(!!d.following); }).catch(() => {});
      });
  }, [c?.owner_id, user?.id]);

  if (!c) return <div className="cvx immersive qa-character-view"><div className="cvx-loading">载入中…</div></div>;

  const isOwner = user && c.owner_id === user.id;
  const media = resolveCharacterMedia(c);
  const isVideo = media.kind === 'video';
  const ambientBackdrop = media.ambient;
  const heroSrc = media.src;
  const introText = c.intro || c.tagline || '';
  const tags = (c.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const world = Array.isArray(c.world) ? c.world : [];

  const follow = async () => {
    try { const d = await api('/social/follow/' + c.owner_id, { method: 'POST' }); setFollowing(!!d.following); toast(d.following ? '已关注作者' : '已取消关注'); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="cvx immersive qa-character-view">
      <div className="cvx-scroll">
        {/* —— 全幅立绘 hero —— */}
        <div className="cvx-hero">
          {ambientBackdrop && (
            <img className="cvx-hero-backdrop" src={assetUrl(ambientBackdrop)} alt="" aria-hidden="true" decoding="async" />
          )}
          {heroSrc
            ? (isVideo && c.background
              ? <video className="cvx-hero-media" src={assetUrl(c.background)} muted loop autoPlay playsInline style={{ viewTransitionName: 'qa-character-art' }} />
              : !isLegacyMonogramCover(heroSrc)
                ? <img className="cvx-hero-media" src={assetUrl(heroSrc)} alt="" decoding="async" style={{ viewTransitionName: 'qa-character-art' }} />
                : <QuietAquaCharacterArt className="cvx-hero-media qa-oracle-character" style={{ viewTransitionName: 'qa-character-art' }} />)
            : <QuietAquaCharacterArt className="cvx-hero-media qa-oracle-character" style={{ viewTransitionName: 'qa-character-art' }} />}
          <div className="cvx-hero-scrim" />
          <h1 className="cvx-name">{c.name}</h1>
        </div>

        {/* —— 悬浮顶栏 —— */}
        <div className="cvx-top">
          <AppIconButton className="cvx-orb" onClick={() => nav(-1)} label="返回"><ArrowLeft size={20} /></AppIconButton>
          <div className="cvx-top-r">
            <AppIconButton className="cvx-orb" onClick={share} label="分享"><Share2 size={17} /></AppIconButton>
            <AppIconButton ref={menuTriggerRef} className={'cvx-orb' + (menuOpen ? ' on' : '')} selected={menuOpen} pressed={menuOpen}
              onClick={() => setMenuOpen(o => !o)} label="更多" aria-expanded={menuOpen} aria-controls="cvx-action-menu">
              <MoreHorizontal size={19} />
            </AppIconButton>
          </div>
          {menuOpen && (
            <>
              <div className="cvx-menu-mask" onClick={() => setMenuOpen(false)} />
              <div ref={menuRef} className="cvx-menu" id="cvx-action-menu" role="menu" tabIndex={-1}>
                {isOwner && <AppButton variant="tertiary" onClick={() => nav('/character/' + c.id + '/edit')}><Pencil size={15} /> 编辑角色</AppButton>}
                <AppButton variant="tertiary" onClick={() => { exportCard(); setMenuOpen(false); }}><Download size={15} /> 导出角色卡</AppButton>
                <AppButton variant="tertiary" onClick={() => { setShareCardOpen(true); setMenuOpen(false); }}><ImageIcon size={15} /> 生成分享卡</AppButton>
                {!isOwner && <div className="cvx-menu-report"><ReportButton type="character" id={c.id} /></div>}
                <span className="cvx-menu-pid">{pid('character', c.id)}</span>
              </div>
            </>
          )}
        </div>

        {shareCardOpen && (
          <ShareCardSheet
            kind="character"
            payload={{ name: c.name, tagline: c.tagline || c.intro, category: c.category,
              avatar: c.avatar ? assetUrl(c.avatar) : '', cover: resolveCharacterMedia(c).src ? assetUrl(resolveCharacterMedia(c).src) : '',
              path: '/character/' + c.id }}
            onClose={() => setShareCardOpen(false)}
          />
        )}

        {/* —— 作者行 + 关注 —— */}
        <div className="cvx-body">
          <div className="cvx-author">
            <button className="cvx-author-id" onClick={() => nav('/user/' + c.owner_id)}>
              <Avatar src={c.owner_avatar} name={c.owner_name} size={40} />
              <span className="cvx-author-nm">
                {c.owner_name || '匿名作者'}
                {c.owner_verified && <BadgeCheck size={14} className="cvx-vf" />}
                <CreatorV tier={c.owner_tier} size={13} />
              </span>
            </button>
            {!isOwner && (
              <AppButton className={'cvx-follow' + (following ? ' on' : '')} variant="secondary" selected={following} pressed={following} onClick={follow}>
                {following ? <><Check size={14} /> 已关注</> : <><Plus size={14} /> 关注</>}
              </AppButton>
            )}
            {isOwner && (
              <AppButton className="cvx-follow" variant="secondary" onClick={() => nav('/character/' + c.id + '/edit')}><Pencil size={13} /> 编辑</AppButton>
            )}
          </div>

          {/* —— 简介（两段式：默认收拢，点击展开全部） —— */}
          {introText && (
            <button type="button" className={'cvx-intro' + (introOpen ? ' open' : '')}
              aria-expanded={introOpen} aria-controls="cvx-intro-copy"
              style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit' }}
              onClick={() => setIntroOpen(o => !o)}>
              <span id="cvx-intro-copy" style={{
                display: introOpen ? 'block' : '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: introOpen ? 'unset' : 3,
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.75,
              }}>{introText}</span>
              <span className="cvx-intro-more"><ChevronDown size={16} /></span>
            </button>
          )}

          {/* —— 数据 + 标签 —— */}
          <div className="cvx-stats">
            <span><MessageCircle size={12} /> {c.uses || 0} 对话</span>
            <span><Eye size={12} /> {c.views || 0} 浏览</span>
            <span><Heart size={12} /> {c.fav_count || 0} 收藏</span>
            {c.is_public ? <span><Globe size={12} /> 公开</span> : null}
          </div>
          {tags.length > 0 && (
            <div className="cvx-tags">{tags.map(t => <span key={t}>{t}</span>)}</div>
          )}

          {/* —— S7-G10 与 TA 的足迹：有过对话才出现，一眼看到这段关系 —— */}
          {bond && (
            <section className="qa-bond" aria-label={`与${c.name}的相伴足迹`}>
              <div className="qa-bond-head"><Flame size={14} aria-hidden="true" /> 与 TA 的足迹</div>
              <div className="qa-bond-row">
                <span>好感度 <b>{bond.affinity}</b></span>
                {bond.since && <span>相遇于 <b>{bond.since}</b></span>}
                <span>共 <b>{bond.count}</b> 段对话</span>
              </div>
              <AppButton className="qa-bond-cta" variant="secondary" size="sm" onClick={() => nav('/chats/' + bond.convId)}>
                继续这段故事 <ChevronRight size={14} />
              </AppButton>
            </section>
          )}

          {/* —— 能力磁贴：对话模式 / 语音音色 / 世界书 —— */}
          <div className="cvx-tiles">
            <button className="cvx-tile" onClick={startChat}>
              <Sparkles size={19} />
              <b>对话模式</b>
              <span>沉浸扮演</span>
            </button>
            <button className="cvx-tile" onClick={() => setVoiceOpen(o => !o)} aria-expanded={voiceOpen} aria-controls="cvx-voice-note">
              <AudioLines size={19} />
              <b>语音音色</b>
              <span>{c.voice_name ? c.voice_name : '浏览器朗读'}</span>
            </button>
            <button className={'cvx-tile' + (world.length ? '' : ' dim')} onClick={() => setWbOpen(o => !o)}
              disabled={!world.length} aria-expanded={world.length ? wbOpen : undefined} aria-controls={world.length ? 'cvx-world-note' : undefined}>
              <Puzzle size={19} />
              <b>Ta 的记忆</b>
              <span>{world.length ? `${world.length} 条设定` : '暂无设定'}</span>
            </button>
          </div>
          {voiceOpen && (
            <div className="cvx-note" id="cvx-voice-note">
              语速 ×{c.voice_speed || 1} · 音调 ×{c.voice_pitch || 1}。对话中点消息旁的「朗读」即可听到 Ta 的声音。
            </div>
          )}
          {wbOpen && world.length > 0 && (
            <div className="cvx-wb" id="cvx-world-note">
              {world.map((w, i) => (
                <div className="wb-item" key={i}>
                  <div className="wb-keys">{(w.keys || '常驻').split(',').map(k => k.trim()).filter(Boolean).map((k, j) => <span key={j}>{k}</span>)}</div>
                  <p>{w.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* —— 档案行：Ta 的心声（开场白）· 大家怎么说 · 参演故事 —— */}
          {c.greeting && (
            <div className="cvx-row-wrap">
              <AppButton className="cvx-row" variant="tertiary" onClick={() => setGreetOpen(o => !o)}
                pressed={greetOpen} aria-expanded={greetOpen} aria-controls="cvx-greeting">
                <Quote size={16} className="cvx-row-ic" />
                <span>Ta 的心声</span>
                <ChevronRight size={17} className={'cvx-row-chev' + (greetOpen ? ' open' : '')} />
              </AppButton>
              {greetOpen && <div className="cvx-greet" id="cvx-greeting">{c.greeting}</div>}
            </div>
          )}
          <div className="cvx-row-wrap">
            <AppButton className="cvx-row" variant="tertiary" onClick={() => setReviewsOpen(o => !o)}
              pressed={reviewsOpen} aria-expanded={reviewsOpen} aria-controls="cvx-reviews">
              <MessagesSquare size={16} className="cvx-row-ic" />
              <span>大家怎么说</span>
              <ChevronRight size={17} className={'cvx-row-chev' + (reviewsOpen ? ' open' : '')} />
            </AppButton>
            {reviewsOpen && <div className="cvx-reviews" id="cvx-reviews"><Reviews type="character" id={c.id} /></div>}
          </div>
          {related.length > 0 && (
            <div className="cvx-row-wrap">
              <div className="cvx-row static">
                <Drama size={16} className="cvx-row-ic" />
                <span>参演故事 · 同世界角色</span>
                <em className="cvx-row-n">全部 {related.length}</em>
              </div>
              <div className="cvx-rail">
                {related.map(rc => (
                  <button key={rc.id} className="cvx-rel" onClick={() => nav('/character/' + rc.id)}>
                    <div className="cvx-rel-cv">{rc.avatar && !isLegacyMonogramCover(rc.avatar) ? <img src={assetUrl(rc.avatar)} alt="" loading="lazy" decoding="async" /> : <QuietAquaCharacterArt className="cvx-rel-art" alt="" loading="lazy" />}</div>
                    <b>{rc.name}</b>
                    <span>{rc.tagline || '——'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="cvx-bottom-space" />
        </div>
      </div>

      {/* —— 吸底行动条 —— */}
      <div className="cvx-cta">
        <AppIconButton className={'cvx-fav' + (faved ? ' on' : '')} variant="secondary" selected={faved} pressed={faved}
          onClick={toggleFav} label={faved ? '取消收藏' : '收藏'}>
          <Heart size={21} fill={faved ? 'currentColor' : 'none'} />
        </AppIconButton>
        <AppButton className="cvx-go" variant="primary" size="lg" loading={busy} onClick={startChat}>
          <MessageCircle size={17} /> {busy ? '进入中…' : '开始对话'}
        </AppButton>
      </div>
    </div>
  );
}

/* ============================================================
   Web / 移动网页布局（原样保留）
   ============================================================ */
function WebView({ c, user, nav, faved, busy, wbOpen, setWbOpen, related, startChat, toggleFav, exportCard }) {
  // 语音通话（Web 专属入口）：WebView 只在 !isAppMode() 下被渲染，App 端
  // 已有自己的通话入口（沉浸流电话键），此处零波及。CallScreen 双端可用。
  const [calling, setCalling] = useState(false);
  if (!c) return (
    <><div className="topbar"><button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button><div style={{ flex: 1 }}><h1>角色</h1></div></div>
      <div className="page"><div className="empty">载入中…</div></div></>
  );

  const isOwner = user && c.owner_id === user.id;
  const isVideo = c.background_type === 'video';

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1 }}><h1>{c.name}</h1><div className="sub">角色卡 · {pid('character', c.id)}</div></div>
        {!isOwner && <ReportButton type="character" id={c.id} />}
        <button className="btn ghost sm" onClick={exportCard} title="导出角色卡 JSON"><Download size={15} /></button>
        {isOwner && <button className="btn" onClick={() => nav('/character/' + c.id + '/edit')}><Pencil size={15} /> 编辑</button>}
      </div>
      <div className="page" style={{ maxWidth: 860 }}>
        <div className="char-hero">
          <div className="char-hero-bg">
            {c.background ? (isVideo
              ? <video src={assetUrl(c.background)} muted loop autoPlay playsInline />
              : <img src={assetUrl(c.background)} alt="" />) : null}
          </div>
          <div className="char-hero-fg">
            <Avatar src={c.avatar} name={c.name} size={92} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: '2px 0 6px' }}>{c.name}</h2>
              <div className="muted">{c.tagline || '这个角色还没有一句话简介'}</div>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {(c.tags || '').split(',').filter(Boolean).map(t => <span key={t} className="tag">{t.trim()}</span>)}
                <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><MessageCircle size={12} /> {c.uses} 次对话</span>
                <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Eye size={12} /> {c.views || 0} 浏览</span>
                <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Heart size={12} /> {c.fav_count || 0} 收藏</span>
                {c.is_public ? <span className="muted" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> 公开</span> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="row" style={{ margin: '20px 0' }}>
          <button className="btn primary block" onClick={startChat} disabled={busy}><MessageCircle size={16} /> {busy ? '进入中…' : '开始对话'}</button>
          <button className="btn block lgw-cv-call" onClick={() => setCalling(true)} aria-label="语音通话" title={`给 ${c.name} 打电话`}><Phone size={15} /> 语音通话</button>
          <button className={'btn block' + (faved ? ' danger' : '')} onClick={toggleFav}><Heart size={15} fill={faved ? 'currentColor' : 'none'} /> {faved ? '已收藏' : '收藏'}</button>
        </div>

        {c.intro && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>角色简介</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0 }}>{c.intro}</p>
          </div>
        )}
        {c.greeting && (
          <div className="card" style={{ marginBottom: 16, background: 'var(--bg-2)' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--muted)' }}><Sparkles size={14} style={{ verticalAlign: -2 }} /> 开场白</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0 }}>{c.greeting}</p>
          </div>
        )}
        {Array.isArray(c.world) && c.world.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ cursor: 'pointer' }} onClick={() => setWbOpen(o => !o)}>
              <h2 style={{ fontSize: 15 }}><BookOpen size={14} style={{ verticalAlign: -2, marginRight: 5 }} />世界书 · {c.world.length} 条设定</h2>
              <button className="btn ghost sm">{wbOpen ? '收起' : '展开预览'}</button>
            </div>
            {!wbOpen
              ? <div className="muted" style={{ fontSize: 13 }}>对话时按关键词自动注入设定。点击展开预览全部条目。</div>
              : <div style={{ marginTop: 4 }}>{c.world.map((w, i) => (
                  <div className="wb-item" key={i}>
                    <div className="wb-keys">{(w.keys || '常驻').split(',').map(k => k.trim()).filter(Boolean).map((k, j) => <span key={j}>{k}</span>)}</div>
                    <p>{w.content}</p>
                  </div>
                ))}</div>}
          </div>
        )}

        {/* 作者 */}
        <div className="card author-card" style={{ marginBottom: 16 }} onClick={() => nav('/user/' + c.owner_id)}>
          <Avatar src={c.owner_avatar} name={c.owner_name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{c.owner_name || '匿名作者'}
              {c.owner_verified && <BadgeCheck size={14} style={{ color: 'var(--diamond)' }} />}
              <CreatorV tier={c.owner_tier} size={14} /></b>
            <span className="muted" style={{ fontSize: 12.5 }}>作者 · 另有 {c.author_char_count || 0} 个公开角色</span>
          </div>
          <ChevronRight size={18} className="muted" />
        </div>

        {related.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}><Sparkles size={15} style={{ verticalAlign: -2, marginRight: 5 }} />相关角色推荐</h3>
            <div className="grid">
              {related.map(rc => (
                <div key={rc.id} className="char-card" onClick={() => nav('/character/' + rc.id)}>
                  <div className="cover">{rc.avatar ? <img src={assetUrl(rc.avatar)} alt="" loading="lazy" /> : <div className="ph cover-art-box"><CoverArt name={rc.name} /></div>}</div>
                  <div className="meta"><h3>{rc.name}</h3><p>{rc.tagline || '——'}</p>
                    <div className="foot"><span className="muted" style={{ fontSize: 12 }}><MessageCircle size={11} /> {rc.uses}</span></div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Reviews type="character" id={c.id} />
      </div>

      {/* 通话 —— 给角色打电话（沉浸式全屏，Portal 自隔离，与 DiscoverFeed Web 分支同款拉起方式） */}
      {calling && <CallScreen character={c} onClose={() => setCalling(false)} />}
    </>
  );
}
