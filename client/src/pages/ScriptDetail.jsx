import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Avatar, CoinIcon } from '../ui.jsx';
import { pid } from '../assets.jsx';
import Reviews from '../components/Reviews.jsx';
import ReportButton from '../components/ReportButton.jsx';
import PushSheet from '../components/PushSheet.jsx';
import { isAppMode } from '../appmode.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { Heart, Play, Lock, Trash2, Eye, ArrowLeft, Pencil, Sparkles, ShieldCheck, Clock3, BookOpen, ChevronRight, Send } from 'lucide-react';

export default function ScriptDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const appMode = isAppMode();
  const [script, setScript] = useState(null);
  const [busy, setBusy] = useState(false);
  const [liked, setLiked] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [pushOpen, setPushOpen] = useState(false); // 推送给玩家（收件箱定向分享）

  const load = () => {
    setLoadError(null);
    return api('/scripts/' + id).then(d => {
      setScript(d.script);
      if (typeof d.script?.liked === 'boolean') setLiked(d.script.liked);
    }).catch(e => { setLoadError(e); toast(e.message, 'err'); });
  };
  useEffect(() => { load(); api('/engage/view', { method: 'POST', body: { type: 'script', id: +id } }).catch(() => {}); /* eslint-disable-next-line */ }, [id]);

  if (!script) {
    if (appMode) return (
      <main className="qa-script-detail-v4 qa-script-detail-v4--loading" data-testid="app-script-detail-loading">
        <AppIconButton className="qa-script-detail-v4__back" label="返回剧本市集" onClick={() => nav(-1)}><ArrowLeft size={20} /></AppIconButton>
        <section className="qa-script-detail-v4__load-state" role={loadError ? 'alert' : 'status'} aria-live="polite">
          <span className="qa-script-detail-v4__load-icon" aria-hidden="true">{loadError ? <BookOpen size={25} /> : <span className="qa-script-detail-v4__load-spinner" />}</span>
          <h1>{loadError ? '剧本暂时打不开' : '正在载入剧本'}</h1>
          <p>{loadError ? '请检查网络后重试，已购买的剧本不会受到影响。' : '正在整理封面、作者与互动设定…'}</p>
          {loadError && <AppButton variant="primary" onClick={load}>重试</AppButton>}
        </section>
      </main>
    );
    return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;
  }

  const isAuthor = user && user.id === script.author_id;
  const paid = script.price_gold > 0;
  const locked = paid && !script.unlocked;
  const tags = (script.tags || '').split(',').map(t => t.trim()).filter(Boolean);

  const buy = async () => {
    setBusy(true);
    try {
      await api('/scripts/' + id + '/buy', { method: 'POST' });
      toast('购买成功，已解锁');
      await refreshUser();
      await load();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  const play = async () => {
    setBusy(true);
    try {
      const d = await api('/scripts/' + id + '/play', { method: 'POST' });
      nav('/chats/' + d.conversation.id);
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  const refund = async () => {
    if (!confirm('确认申请退款？退款后将无法继续阅读本剧本。')) return;
    setBusy(true);
    try {
      const d = await api('/scripts/' + id + '/refund', { method: 'POST' });
      toast(d.message || '退款成功');
      await refreshUser();
      await load();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  const like = async () => {
    try {
      const d = await api('/scripts/' + id + '/like', { method: 'POST' });
      if (typeof d?.liked === 'boolean') setLiked(d.liked);
      else setLiked(value => !value);
      await load();
    } catch (err) { toast(err.message, 'err'); }
  };

  const del = async () => {
    if (!confirm('确认删除该剧本？此操作不可撤销。')) return;
    try {
      await api('/scripts/' + id, { method: 'DELETE' });
      toast('已删除');
      nav('/scripts');
    } catch (err) { toast(err.message, 'err'); }
  };

  const canRefund = script.unlocked && paid && !isAuthor;

  if (appMode) {
    return (
      <main className="qa-script-detail-v4" data-testid="app-script-detail">
        <header className="qa-script-detail-v4__topbar">
          <AppIconButton className="qa-script-detail-v4__back" label="返回剧本市集" onClick={() => nav(-1)}>
            <ArrowLeft size={20} />
          </AppIconButton>
          <div className="qa-script-detail-v4__topcopy">
            <span>剧本详情</span>
            <strong>{script.title}</strong>
          </div>
          <AppIconButton className="qa-script-detail-v4__top-edit" label="推送给玩家" onClick={() => setPushOpen(true)}>
            <Send size={18} />
          </AppIconButton>
          {!isAuthor
            ? <span className="qa-script-detail-v4__top-action"><ReportButton type="script" id={script.id} label="" size={18} /></span>
            : <AppIconButton className="qa-script-detail-v4__top-edit" label="编辑剧本" onClick={() => nav('/script/' + id + '/edit')}>
              <Pencil size={18} />
            </AppIconButton>}
        </header>
        {pushOpen && <PushSheet title={script.title} payload={{ script_id: script.id }} onClose={() => setPushOpen(false)} />}

        <div className="qa-script-detail-v4__scroll">
          <section className="qa-script-detail-v4__hero" aria-labelledby="qa-script-detail-title">
            <div className="qa-script-detail-v4__hero-backdrop" aria-hidden="true">
              {script.cover ? <img src={assetUrl(script.cover)} alt="" /> : <span className="qa-script-detail-v4__hero-lines" />}
            </div>
            <div className="qa-script-detail-v4__hero-media">
              {script.cover
                ? <img src={assetUrl(script.cover)} alt="" />
                : <div className="qa-script-detail-v4__cover-placeholder" aria-hidden="true"><BookOpen size={44} /><span>剧本</span></div>}
              <span className={'qa-script-detail-v4__access ' + (locked ? 'is-locked' : 'is-open')}>
                {locked ? <><Lock size={13} /> 需解锁</> : <><ShieldCheck size={13} /> 已开放</>}
              </span>
            </div>
            <div className="qa-script-detail-v4__hero-copy">
              <span className="qa-script-detail-v4__eyebrow">{script.category || '沉浸式剧本'} · {pid('script', script.id)}</span>
              <h1 id="qa-script-detail-title">{script.title}</h1>
              <p>{script.summary || '暂无简介'}</p>
            </div>
          </section>

          <section className="qa-script-detail-v4__body" aria-label="剧本信息">
            <div className="qa-script-detail-v4__author-row">
              <button className="qa-script-detail-v4__author" type="button" onClick={() => nav('/user/' + script.author_id)}>
                <Avatar src={script.author_avatar} name={script.author_name} size={44} eager />
                <span><b>{script.author_name}</b><small>创作者 · {script.created_at}</small></span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              <AppIconButton className="qa-script-detail-v4__like" label={liked ? '取消喜欢' : '喜欢'} pressed={liked} onClick={like}>
                <Heart size={19} fill={liked ? 'currentColor' : 'none'} />
              </AppIconButton>
            </div>

            <div className="qa-script-detail-v4__stats" aria-label="剧本数据">
              <span><Play size={14} aria-hidden="true" /><b>{script.plays || 0}</b><small>演绎</small></span>
              <span><Eye size={14} aria-hidden="true" /><b>{script.views || 0}</b><small>浏览</small></span>
              <span className="is-like"><Heart size={14} aria-hidden="true" /><b>{script.likes || 0}</b><small>喜欢</small></span>
              <span className="is-clock"><Clock3 size={14} aria-hidden="true" /><b>30 分钟</b><small>退款期</small></span>
            </div>

            {tags.length > 0 && <div className="qa-script-detail-v4__tags" aria-label="剧本标签">{tags.map(t => <span key={t}>{t}</span>)}</div>}

            {locked ? (
              <section className="qa-script-detail-v4__unlock" aria-labelledby="qa-script-unlock-title">
                <div className="qa-script-detail-v4__unlock-icon" aria-hidden="true"><Lock size={21} /></div>
                <div className="qa-script-detail-v4__unlock-copy">
                  <span className="qa-script-detail-v4__section-kicker">完整剧本</span>
                  <h2 id="qa-script-unlock-title">解锁后开始你的专属演绎</h2>
                  <p>购买后 30 分钟内不满意可申请退款，余额会在确认后更新。</p>
                </div>
                <div className="qa-script-detail-v4__price"><CoinIcon size={17} /> {script.price_gold}<small>金币</small></div>
                <AppButton className="qa-script-detail-v4__unlock-button" variant="primary" size="lg" loading={busy} onClick={buy}>
                  {busy ? '处理中…' : '购买并解锁'}
                </AppButton>
              </section>
            ) : (
              <section className="qa-script-detail-v4__content" aria-labelledby="qa-script-content-title">
                <div className="qa-script-detail-v4__content-head">
                  <div><span className="qa-script-detail-v4__section-kicker">故事设定</span><h2 id="qa-script-content-title">剧情与世界观</h2></div>
                  <span className="qa-script-detail-v4__open-mark"><ShieldCheck size={14} /> 可互动</span>
                </div>
                <p className="qa-script-detail-v4__content-text">{script.content || '暂无正文'}</p>
                <AppButton className="qa-script-detail-v4__play-button" variant="primary" size="lg" loading={busy} onClick={play}>
                  <Play size={17} fill="currentColor" /> {busy ? '准备中…' : '进入剧本，开始互动'}
                </AppButton>
              </section>
            )}

            {canRefund && <div className="qa-script-detail-v4__refund"><AppButton variant="tertiary" tone="danger" loading={busy} onClick={refund}><Clock3 size={15} /> 申请退款（30 分钟内）</AppButton></div>}

            <section className="qa-script-detail-v4__reviews" aria-label="剧本评价">
              <Reviews type="script" id={script.id} />
            </section>
          </section>
        </div>

        {isAuthor && <div className="qa-script-detail-v4__ownerbar" role="toolbar" aria-label="剧本管理操作">
          <span><Sparkles size={15} /> 这是你的剧本</span>
          <div><AppButton variant="secondary" onClick={() => nav('/script/' + id + '/edit')}><Pencil size={15} /> 编辑</AppButton><AppIconButton label="删除剧本" tone="danger" onClick={del}><Trash2 size={18} /></AppIconButton></div>
        </div>}
      </main>
    );
  }

  return (
    <>
      {pushOpen && <PushSheet title={script.title} payload={{ script_id: script.id }} onClose={() => setPushOpen(false)} />}
      <div className="topbar">
        <button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /> 返回</button>
        <div style={{ flex: 1 }}>
          <h1>{script.title}</h1>
          <div className="sub">{pid('script', script.id)} · 由 {script.author_name} 创作</div>
        </div>
        <button className="btn ghost sm" onClick={() => setPushOpen(true)} title="推送给玩家"><Send size={15} /></button>
        {!isAuthor && <ReportButton type="script" id={script.id} />}
        {isAuthor && <>
          <button className="btn" onClick={() => nav('/script/' + id + '/edit')}>编辑</button>
          <button className="btn danger" onClick={del}><Trash2 size={14} style={{ verticalAlign: 'middle' }} /> 删除</button>
        </>}
      </div>

      <div className="page" style={{ maxWidth: 820 }}>
        <div className="card">
          {script.cover && <div style={{ height: 280, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
            <img src={assetUrl(script.cover)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /></div>}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }} onClick={() => nav('/user/' + script.author_id)}>
              <Avatar src={script.author_avatar} name={script.author_name} size={36} />
              <div><b>{script.author_name}</b><div className="muted" style={{ fontSize: 12 }}>{script.created_at}</div></div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontSize: 13, color: 'var(--faint)' }}>
              <span><Play size={13} style={{ verticalAlign: 'middle' }} /> {script.plays || 0}</span>
              <span><Eye size={13} style={{ verticalAlign: 'middle' }} /> {script.views || 0}</span>
              <button className="btn sm ghost" onClick={like}><Heart size={14} style={{ verticalAlign: 'middle' }} /> {script.likes || 0}</button>
            </div>
          </div>

          {tags.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {tags.map(t => <span key={t} className="tag">{t}</span>)}
            </div>
          )}

          <p style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{script.summary || '暂无简介'}</p>

          {locked ? (
            <div className="card" style={{ background: 'var(--bg-2)', marginTop: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}><Lock size={30} /></div>
              <h3 style={{ margin: '0 0 6px' }}>本剧本需 <span className="price-tag"><CoinIcon size={16} /> {script.price_gold}</span> 金币解锁</h3>
              <p className="muted" style={{ fontSize: 13 }}>支持购买后 30 分钟内不满意退款</p>
              <button className="btn primary" style={{ marginTop: 6 }} onClick={buy} disabled={busy}>
                {busy ? '处理中…' : '购买并解锁'}
              </button>
            </div>
          ) : (
            <div className="card" style={{ background: 'var(--bg-2)', marginTop: 18 }}>
              <div className="section-title"><h2>剧情设定</h2>
                <button className="btn primary sm" onClick={play} disabled={busy}><Play size={14} /> {busy ? '准备中…' : '开始扮演'}</button>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, marginBottom: 14 }}>{script.content || '暂无正文'}</p>
              <button className="btn primary block" onClick={play} disabled={busy}><Play size={15} /> {busy ? '准备中…' : '进入剧本 · 开始互动扮演'}</button>
            </div>
          )}

          {canRefund && (
            <div style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={refund} disabled={busy}>申请退款(30分钟内)</button>
            </div>
          )}
        </div>

        <Reviews type="script" id={script.id} />
      </div>
    </>
  );
}
