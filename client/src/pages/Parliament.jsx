import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal, CountUp, CreatorV, CouncilorBadge } from '../ui.jsx';
import { startBgm, stopBgm, resume as resumeBgm, setMuted as setBgmMuted } from '../parliamentBgm.js';
import {
  Gavel, Scale, ThumbsUp, ThumbsDown, MinusCircle, Check, X, Plus,
  Users, Sparkles, BadgeCheck, Trash2, ChevronDown, ChevronUp, Lock, ScrollText, Feather,
  Music, VolumeX, MessageSquare, Search, Send
} from 'lucide-react';

const BGM_KEY = 'huanyu_pl_bgm';

/* ------------------------------------------------------------------ crest */
function Crest({ size = 96 }) {
  return (
    <div className="pl-emblem" style={{ width: size, height: size }}>
      <span className="pl-emblem-glow" />
      <svg className="pl-emblem-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="47" fill="none" stroke="url(#plgr)" strokeWidth="0.8" strokeDasharray="1.4 3.4" />
        <defs><linearGradient id="plgr" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#f4d488" /><stop offset="100%" stopColor="#9c6f1c" /></linearGradient></defs>
      </svg>
      <svg className="pl-crest" viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id="plg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fbe9b0" /><stop offset="48%" stopColor="#e2b54e" /><stop offset="100%" stopColor="#a9781f" /></linearGradient></defs>
        <g fill="none" stroke="url(#plg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="50" cy="50" r="40" strokeWidth="2.4" />
          <path d="M50 13 l2.9 6 6.6 .9 -4.8 4.6 1.1 6.6 -5.8 -3.1 -5.8 3.1 1.1-6.6 -4.8-4.6 6.6-.9z" fill="url(#plg)" stroke="none" />
          <path d="M50 32 v40 M36 78 h28" />
          <path d="M50 38 L29 47 M50 38 L71 47" />
          <path d="M21 47 a8.5 8.5 0 0 0 16 0 z" fill="url(#plg)" fillOpacity="0.2" />
          <path d="M63 47 a8.5 8.5 0 0 0 16 0 z" fill="url(#plg)" fillOpacity="0.2" />
          <path d="M30 74 C19 70 15 59 17 48 M70 74 C81 70 85 59 83 48" />
          <path d="M21 55 q-4 1 -5 5 M20 62 q-4 1 -5 5 M23 48 q-4 0 -6 4" />
          <path d="M79 55 q4 1 5 5 M80 62 q4 1 5 5 M77 48 q4 0 6 4" />
        </g>
      </svg>
    </div>
  );
}

/* ----------------------------------------------- grand-doors entrance */
function Entrance() {
  return (
    <div className="pl-enter" aria-hidden="true">
      <div className="pl-enter-veil" />
      <div className="pl-door l"><span className="pl-door-grain" /><span className="pl-door-stud" /></div>
      <div className="pl-door r"><span className="pl-door-grain" /><span className="pl-door-stud" /></div>
      <div className="pl-enter-seam" />
      <div className="pl-enter-burst" />
      <div className="pl-enter-crest"><Crest size={132} /></div>
      <div className="pl-enter-word">幻域议会</div>
    </div>
  );
}

/* --------------------------------------------------------- music control */
function ChamberMusic() {
  const [muted, setMuted] = useState(() => localStorage.getItem(BGM_KEY) === 'off');
  useEffect(() => {
    startBgm(); setBgmMuted(muted);
    const kick = () => resumeBgm();
    window.addEventListener('pointerdown', kick); window.addEventListener('keydown', kick);
    return () => { window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); stopBgm(); };
  }, []); // eslint-disable-line
  const toggle = () => { const n = !muted; setMuted(n); setBgmMuted(n); resumeBgm(); localStorage.setItem(BGM_KEY, n ? 'off' : 'on'); };
  return (
    <button className={'pl-music' + (muted ? ' muted' : '')} onClick={toggle} title={muted ? '奏礼乐' : '止礼乐'} aria-label="议会礼乐">
      {muted ? <VolumeX size={16} /> : <Music size={16} />}
      <span className="pl-eq" aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="pl-music-tx">{muted ? '礼乐已止' : '议会礼乐'}</span>
    </button>
  );
}

const STATUS = {
  pending: { label: '征集中', seal: '待\n采', cls: 'pending', desc: '已公开陈列，候主席团采纳付诸表决' },
  voting: { label: '审议表决', seal: '表\n决', cls: 'voting', desc: '议员表决中：赞成逾半数成一般决议，逾三分之二成特别决议' },
  passed_general: { label: '一般决议', seal: '通\n过', cls: 'g', desc: '赞成逾二分之一，已成一般决议' },
  passed_special: { label: '特别决议', seal: '特\n别', cls: 's', desc: '赞成逾三分之二，已成特别决议' },
  failed: { label: '未获通过', seal: '未\n通', cls: 'failed', desc: '赞成未达半数' },
  rejected: { label: '未予采纳', seal: '驳\n回', cls: 'rejected', desc: '主席团未予采纳' },
};

function SupportBar({ ratio, total, animate }) {
  const pct = Math.round((ratio || 0) * 100);
  const tier = ratio > 2 / 3 ? 's' : ratio > 0.5 ? 'g' : 'f';
  return (
    <div className="pl-bar-wrap">
      <div className={'pl-bar tier-' + tier}>
        <span className="pl-bar-fill" style={{ width: (animate ? pct : 0) + '%' }}><i className="pl-bar-shine" /></span>
        <i className="pl-mark m50"><em>过半</em></i>
        <i className="pl-mark m67"><em>三分二</em></i>
      </div>
      <div className="pl-bar-legend"><span>赞成率 <b>{pct}%</b></span><span className="muted">{total} 名议员参与</span></div>
    </div>
  );
}

/* ----------------------------------------------------------- discussion */
function Discussion({ pid, meId, isGm, toast }) {
  const [list, setList] = useState(null);
  const [txt, setTxt] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/parliament/proposals/${pid}/comments`).then(d => setList(d.comments)).catch(() => setList([])); }, [pid]);
  const post = async () => {
    const t = txt.trim(); if (!t) return; setBusy(true);
    try { const d = await api(`/parliament/proposals/${pid}/comments`, { method: 'POST', body: { text: t } }); setList(l => [...(l || []), d.comment]); setTxt(''); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const del = async (id) => { try { await api(`/parliament/proposals/${pid}/comments/${id}`, { method: 'DELETE' }); setList(l => l.filter(c => c.id !== id)); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="pl-discuss">
      {list === null ? <div className="pl-discuss-load">载入议论…</div> : (
        <>
          {list.length === 0 && <div className="pl-discuss-empty">尚无议论，发表你的见解。</div>}
          {list.map(c => (
            <div className="pl-cmt" key={c.id}>
              <Avatar src={c.author_avatar} name={c.author_name} size={28} />
              <div className="pl-cmt-body">
                <div className="pl-cmt-head"><b>{c.author_name}</b>{c.author_councilor && <CouncilorBadge size={11} />}<CreatorV tier={c.author_tier} size={12} /><span className="pl-cmt-time">{(c.created_at || '').slice(5, 16)}</span>
                  {(c.user_id === meId || isGm) && <button className="pl-cmt-del" onClick={() => del(c.id)} title="删除"><X size={12} /></button>}
                </div>
                <p>{c.text}</p>
              </div>
            </div>
          ))}
          <div className="pl-cmt-post">
            <input className="input" value={txt} maxLength={600} placeholder="发表议论…" onChange={e => setTxt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); post(); } }} />
            <button className="btn sm primary" disabled={busy || !txt.trim()} onClick={post}><Send size={14} /></button>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- proposal */
function ProposalCard({ p, ov, idx, onChange, toast }) {
  const [expanded, setExpanded] = useState(false);
  const [discuss, setDiscuss] = useState(false);
  const [shown, setShown] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  const st = STATUS[p.status] || STATUS.pending;
  const t = p.status === 'voting' ? p.live_tally : (p.tally || p.live_tally);
  const canVote = ov.is_councilor && p.status === 'voting' && !ov.locked;
  const long = (p.body || '').length > 160;
  const decided = ['passed_general', 'passed_special', 'failed'].includes(p.status);

  const act = async (path, opt) => { try { const d = await api(path, opt); onChange(d.proposal); } catch (e) { toast(e.message, 'err'); } };
  const vote = (choice) => act(`/parliament/proposals/${p.id}/vote`, { method: 'POST', body: { choice } });
  const endorse = () => act(`/parliament/proposals/${p.id}/endorse`, { method: 'POST' });

  return (
    <article ref={ref} className={'pl-doc st-' + st.cls + (shown ? ' in' : '') + (p.status === 'voting' ? ' live' : '')} style={{ '--d': Math.min(idx, 8) }}>
      <span className="pl-corner tl" /><span className="pl-corner tr" /><span className="pl-corner bl" /><span className="pl-corner br" />
      <div className={'pl-seal ' + st.cls}><span>{st.seal}</span></div>
      <div className="pl-doc-head">
        <span className="pl-no">第 {String(p.id).padStart(3, '0')} 号议案</span>
        <span className={'pl-status ' + st.cls}>{st.label}</span>
      </div>
      <h3 className="pl-title">{p.title}</h3>
      <div className="pl-author">
        <Avatar src={p.author_avatar} name={p.author_name} size={22} />
        <span>提案人 · {p.author_name}{p.author_verified && <BadgeCheck size={13} className="pl-verif" />}</span>
        <span className="pl-rule" />
        <span className="muted"><Sparkles size={12} /> {p.endorsements} 联署</span>
      </div>
      <div className="pl-divider" />
      <p className={'pl-body' + (long && !expanded ? ' clamp' : '')}>{p.body}</p>
      {long && <button className="pl-more" onClick={() => setExpanded(e => !e)}>{expanded ? <>收起 <ChevronUp size={13} /></> : <>展开全文 <ChevronDown size={13} /></>}</button>}

      {(p.status === 'voting' || decided) && (
        <div className="pl-tally">
          <SupportBar ratio={t.ratio} total={t.total} animate={shown} />
          <div className="pl-votes">
            <span className="v-for"><ThumbsUp size={13} /> 赞成 {t.for}</span>
            <span className="v-against"><ThumbsDown size={13} /> 反对 {t.against}</span>
            <span className="v-abstain"><MinusCircle size={13} /> 弃权 {t.abstain}</span>
          </div>
        </div>
      )}

      {canVote && (
        <div className="pl-vote-acts">
          <span className="pl-vote-label">议员表决</span>
          <button className={'btn sm' + (p.my_vote === 'for' ? ' primary' : '')} onClick={() => vote('for')}><ThumbsUp size={14} /> 赞成</button>
          <button className={'btn sm' + (p.my_vote === 'against' ? ' danger' : '')} onClick={() => vote('against')}><ThumbsDown size={14} /> 反对</button>
          <button className={'btn sm' + (p.my_vote === 'abstain' ? ' active' : '')} onClick={() => vote('abstain')}><MinusCircle size={14} /> 弃权</button>
        </div>
      )}

      <div className="pl-foot">
        <button className={'pl-endorse' + (p.my_endorsed ? ' on' : '')} onClick={endorse} disabled={ov.locked} title="公开联署支持（全体公民可参与）">
          <Sparkles size={14} /> {p.my_endorsed ? '已联署' : '联署支持'}
        </button>
        <button className={'pl-discuss-btn' + (discuss ? ' on' : '')} onClick={() => setDiscuss(d => !d)}>
          <MessageSquare size={14} /> 议论{p.comment_count ? ` · ${p.comment_count}` : ''}
        </button>
        <span className="pl-hint muted">{st.desc}</span>
      </div>

      {discuss && <Discussion pid={p.id} meId={ov.me_id} isGm={ov.is_gm} toast={toast} />}

      {ov.is_gm && (
        <div className="pl-gm">
          <span className="pl-gm-tag"><Gavel size={12} /> 主席团</span>
          {p.status === 'pending' && <button className="btn sm primary" onClick={() => act(`/parliament/proposals/${p.id}/adopt`, { method: 'POST' })} disabled={ov.locked}><Check size={13} /> 采纳付诸表决</button>}
          {p.status === 'voting' && <button className="btn sm primary" onClick={() => act(`/parliament/proposals/${p.id}/close`, { method: 'POST' })} disabled={ov.locked}><Scale size={13} /> 计票公布</button>}
          {(p.status === 'pending' || p.status === 'voting') && <button className="btn sm" onClick={() => act(`/parliament/proposals/${p.id}/reject`, { method: 'POST' })} disabled={ov.locked}><X size={13} /> 驳回</button>}
          <button className="btn sm danger" onClick={async () => { if (confirm('删除该议案？')) { try { await api(`/parliament/proposals/${p.id}`, { method: 'DELETE' }); onChange(null, p.id); } catch (e) { toast(e.message, 'err'); } } }}><Trash2 size={13} /></button>
        </div>
      )}
    </article>
  );
}

function NewProposal({ onClose, onCreated, toast }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim() || !body.trim()) { toast('请填写标题与正文', 'err'); return; }
    setBusy(true);
    try { const d = await api('/parliament/proposals', { method: 'POST', body: { title, body } }); toast('议案已提交，静候主席团采纳'); onCreated(d.proposal); onClose(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <h2 className="pl-modal-title"><Feather size={18} style={{ verticalAlign: -3, marginRight: 6 }} />起草议案</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>议案将<b>公开陈列于议事殿</b>，全体公民可见并可联署、议论。经主席团采纳后付诸议员表决：赞成逾 <b>50%</b> 成一般决议，逾 <b>67%</b> 成特别决议。</p>
      <div className="field"><label>议案标题</label><input className="input" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="一句话陈明动议" /></div>
      <div className="field"><label>议案正文</label><textarea className="textarea" rows={6} value={body} maxLength={2000} onChange={e => setBody(e.target.value)} placeholder="详述背景、条款与预期影响…" style={{ resize: 'vertical' }} /></div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>取消</button>
        <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={submit}><Check size={15} /> 提交议案</button>
      </div>
    </Modal>
  );
}

function Roster({ onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/parliament/councilors').then(setData).catch(() => setData({ councilors: [] })); }, []);
  return (
    <Modal onClose={onClose}>
      <h2 className="pl-modal-title"><Scale size={18} style={{ verticalAlign: -3, marginRight: 6 }} />议员名册</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>当前在任议员 {data?.councilors?.length ?? '—'} 名 · 议席 {data?.seats ?? '—'} 个。</p>
      <div className="pl-roster">
        {(data?.councilors || []).map(u => (
          <div className="pl-roster-row" key={u.id}>
            <Avatar src={u.avatar} name={u.display_name} size={38} />
            <div className="pl-roster-tx"><b>{u.display_name}</b><CreatorV tier={u.creator_tier} size={12} />{u.verified && <BadgeCheck size={13} style={{ color: 'var(--diamond)' }} />}</div>
            <CouncilorBadge size={12} />
          </div>
        ))}
        {data && data.councilors.length === 0 && <div className="empty" style={{ padding: 24 }}>暂无在任议员</div>}
      </div>
      <button className="btn block" style={{ marginTop: 14 }} onClick={onClose}>关闭</button>
    </Modal>
  );
}

const FILTERS = [['all', '全部'], ['voting', '表决中'], ['pending', '待采纳'], ['passed', '已通过'], ['archive', '存档']];

export default function Parliament() {
  const toast = useToast();
  const { user } = useAuth();
  const [ov, setOv] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [roster, setRoster] = useState(false);
  const [charterOpen, setCharterOpen] = useState(false);
  const [enter, setEnter] = useState(true);
  const hallRef = useRef(null);
  const colLRef = useRef(null);
  const colRRef = useRef(null);

  const load = () => Promise.all([
    api('/parliament/overview').then(d => setOv(d)).catch(() => setOv({})),
    api('/parliament/proposals').then(d => setList(d.proposals || [])).catch(e => toast(e.message, 'err')),
  ]).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // entrance overlay timing
  useEffect(() => { const t = setTimeout(() => setEnter(false), 2000); return () => clearTimeout(t); }, []);

  // scroll-driven parallax: hero recedes & dims, columns drift for depth
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const y = window.scrollY || 0;
        if (hallRef.current) {
          hallRef.current.style.transform = `translateY(${y * 0.22}px) scale(${Math.max(0.9, 1 - y / 5200)})`;
          hallRef.current.style.opacity = String(Math.max(0.18, 1 - y / 560));
        }
        if (colLRef.current) colLRef.current.style.transform = `translateY(${y * -0.08}px) skewX(-0.5deg)`;
        if (colRRef.current) colRRef.current.style.transform = `translateY(${y * -0.05}px) skewX(0.5deg)`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const toggleLock = async () => {
    if (!confirm(ov.locked ? '恢复议会运作？' : '封锁议会？议会将无限期休会，暂停一切提案与表决，直至你恢复。')) return;
    try { await api('/admin/council/lock', { method: 'POST', body: { value: !ov.locked } }); toast(ov.locked ? '议会已复会' : '议会已封锁'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const onChange = (updated, removedId) => {
    if (removedId) { setList(l => l.filter(p => p.id !== removedId)); return; }
    if (updated) setList(l => l.map(p => p.id === updated.id ? updated : p));
  };
  const onCreated = (p) => setList(l => [p, ...l]);

  const shown = useMemo(() => list.filter(p => {
    const okF = filter === 'all' ? true
      : filter === 'passed' ? (p.status === 'passed_general' || p.status === 'passed_special')
        : filter === 'archive' ? (p.status === 'failed' || p.status === 'rejected')
          : p.status === filter;
    if (!okF) return false;
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return (p.title + ' ' + p.body + ' ' + (p.author_name || '')).toLowerCase().includes(k);
  }), [list, filter, q]);
  const counts = useMemo(() => ({
    voting: list.filter(p => p.status === 'voting').length,
    passed: list.filter(p => p.status === 'passed_general' || p.status === 'passed_special').length,
  }), [list]);

  const locked = !!ov?.locked;
  const particles = useMemo(() => Array.from({ length: 18 }, () => ({
    l: Math.round(Math.random() * 100), d: (Math.random() * 9).toFixed(1), dur: (7 + Math.random() * 9).toFixed(1), s: (1 + Math.random() * 2.2).toFixed(1),
  })), []);

  return (
    <div className="pl-root pl-immersive">
      {enter && <Entrance />}
      <div className="pl-atmos" aria-hidden="true">
        <span className="pl-atmos-floor" />
        <span className="pl-atmos-col left" ref={colLRef} />
        <span className="pl-atmos-col right" ref={colRRef} />
        <span className="pl-atmos-vig" />
      </div>
      <ChamberMusic />

      <div className="topbar pl-topbar">
        <div style={{ flex: 1 }}>
          <h1 className="pl-h1">幻域议会</h1>
          <div className="sub pl-sub">PARLIAMENT&nbsp;OF&nbsp;HUANYU</div>
        </div>
        <button className="btn pl-rosterbtn" onClick={() => setRoster(true)} title="议员名册"><Users size={15} /> 名册</button>
        {ov?.is_gm && (
          <button className={'btn pl-lockbtn' + (locked ? ' primary' : '')} onClick={toggleLock} title={locked ? '恢复议会运作' : '封锁议会（无限期休会）'}>
            <Lock size={15} /> {locked ? '恢复议会' : '封锁议会'}
          </button>
        )}
        {ov?.is_councilor && !locked && <button className="btn primary pl-draftbtn" onClick={() => setCreating(true)}><Feather size={16} /> 起草议案</button>}
      </div>

      <div className="page pl-page" style={{ maxWidth: 980 }}>
        <section className={'pl-hall' + (locked ? ' locked' : '')} ref={hallRef}>
          <div className="pl-hall-rays" aria-hidden="true" />
          <div className="pl-hall-sweep" aria-hidden="true" />
          <div className="pl-hall-grain" aria-hidden="true" />
          <div className="pl-dust" aria-hidden="true">
            {particles.map((p, i) => <span key={i} style={{ left: p.l + '%', width: p.s + 'px', height: p.s + 'px', animationDelay: p.d + 's', animationDuration: p.dur + 's' }} />)}
          </div>
          <Crest size={96} />
          <div className="pl-hall-tx">
            <div className="pl-eyebrow">EST · 幻域 · 公议立邦</div>
            <h2 className="pl-hall-title">幻域议会</h2>
            <div className="pl-hall-latin">SENATVS · POPVLVSQVE</div>
            <p className="pl-motto">提案出于议员　决议成于公论　众智共治　立纲陈纪</p>
          </div>
          <div className="pl-hall-stats">
            <div className="pl-stat"><b><CountUp value={ov?.term ?? 0} format={false} /></b><span>届</span><i>当前届次</i></div>
            <span className="pl-stat-rule" />
            <div className="pl-stat"><b><CountUp value={ov?.council_size ?? 0} format={false} /><u>/{ov?.seats ?? '—'}</u></b><span>席</span><i>在任 / 议席</i></div>
            <span className="pl-stat-rule" />
            <div className="pl-stat"><b><CountUp value={counts.voting} format={false} /></b><span>案</span><i>表决进行</i></div>
            <span className="pl-stat-rule" />
            <div className="pl-stat"><b><CountUp value={counts.passed} format={false} /></b><span>决</span><i>决议达成</i></div>
          </div>
          {locked && <div className="pl-recess-stamp">休<br />会</div>}
        </section>

        {locked && (
          <div className="pl-lock-banner">
            <span className="pl-lock-seal"><Lock size={22} /></span>
            <div><b>本届议会现已休会</b><p>经管理层裁定，幻域议会无限期休会，暂停受理一切提案与表决，静待复会通知。</p></div>
          </div>
        )}

        <div className={'pl-charter' + (charterOpen ? ' open' : '')}>
          <button className="pl-charter-head" onClick={() => setCharterOpen(o => !o)}>
            <ScrollText size={15} /> <b>议事章程</b>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{charterOpen ? '收起' : '展开'} {charterOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
          </button>
          <div className="pl-charter-wrap"><ol className="pl-charter-body">
            <li><b>议员之设。</b>议员由管理层任命，名额按注册公民规模核定，每满百人增一席。</li>
            <li><b>提案之权。</b>唯议员得提交公共议案；议案一经提交即公开陈列，全体公民皆可查阅、联署与议论。</li>
            <li><b>采纳之序。</b>议案须经主席团采纳，方付诸议员表决。</li>
            <li><b>表决之制。</b>以参与表决之议员为基数：赞成<b>逾二分之一</b>者成<em>一般决议</em>；<b>逾三分之二</b>者成<em>特别决议</em>；未及半数则不予通过。</li>
            <li><b>休会之权。</b>管理层得宣布议会无限期休会，期间一切议事暂停，静待复会。</li>
          </ol></div>
        </div>

        <div className="pl-role">
          {ov?.is_councilor
            ? <span className="pl-role-badge councilor"><Scale size={14} /> 阁下为幻域议员，得提案并参与表决</span>
            : <span className="pl-role-badge"><Users size={14} /> 阁下为幻域公民，得查阅、联署与议论；议员之职须由管理层任命</span>}
          {ov?.is_gm && <span className="pl-role-badge gm"><Gavel size={14} /> 主席团：采纳 · 驳回 · 计票 · 休会</span>}
        </div>

        <div className="pl-toolbar">
          <div className="pl-tabs">
            {FILTERS.map(([k, l]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
                {l}{k === 'voting' && counts.voting > 0 ? ` · ${counts.voting}` : ''}
              </button>
            ))}
          </div>
          <div className="pl-search"><Search size={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="检索议案 / 提案人…" /></div>
        </div>

        {loading ? <div className="empty">载入中…</div> :
          shown.length === 0 ? (
            <div className="empty"><div className="big"><ScrollText size={42} /></div>
              {q ? '未检索到相关议案' : filter === 'all' ? '议事殿暂无议案' : '该类目下暂无议案'}
              {ov?.is_councilor && !locked && filter === 'all' && !q && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => setCreating(true)}><Feather size={15} /> 起草首份议案</button></div>}
            </div>
          ) : (
            <div className="pl-list">
              {shown.map((p, i) => <ProposalCard key={p.id} p={p} ov={{ ...(ov || {}), locked }} idx={i} onChange={onChange} toast={toast} />)}
            </div>
          )}
      </div>

      {creating && <NewProposal onClose={() => setCreating(false)} onCreated={onCreated} toast={toast} />}
      {roster && <Roster onClose={() => setRoster(false)} />}
    </div>
  );
}
