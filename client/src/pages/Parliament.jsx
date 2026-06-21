import React, { useEffect, useMemo, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import {
  Gavel, Scale, ThumbsUp, ThumbsDown, MinusCircle, Check, X, Plus,
  ShieldCheck, Users, Sparkles, BadgeCheck, Trash2, ChevronDown, ChevronUp, Lock, ScrollText
} from 'lucide-react';

// Formal council crest — scales of justice within a laurel wreath beneath a star.
function Crest({ size = 64 }) {
  return (
    <svg className="pl-crest" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="plg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4d488" /><stop offset="55%" stopColor="#dca73a" /><stop offset="100%" stopColor="#b07d1e" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#plg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="50" cy="50" r="46" strokeWidth="1.4" />
        <circle cx="50" cy="50" r="41" strokeWidth="2.4" />
        {/* star */}
        <path d="M50 14 l2.6 5.4 5.9 .8 -4.3 4.1 1 5.9 -5.2 -2.8 -5.2 2.8 1-5.9 -4.3-4.1 5.9-.8z" fill="url(#plg)" stroke="none" />
        {/* scales */}
        <path d="M50 32 v40 M36 78 h28" />
        <path d="M50 38 L30 46 M50 38 L70 46" />
        <path d="M22 46 a8 8 0 0 0 16 0 z" fill="url(#plg)" fillOpacity="0.18" />
        <path d="M62 46 a8 8 0 0 0 16 0 z" fill="url(#plg)" fillOpacity="0.18" />
        {/* laurels */}
        <path d="M30 74 C20 70 16 60 18 50" />
        <path d="M70 74 C80 70 84 60 82 50" />
        <path d="M22 56 q-4 1 -5 5 M21 63 q-4 1 -5 5 M24 49 q-4 0 -6 4" />
        <path d="M78 56 q4 1 5 5 M79 63 q4 1 5 5 M76 49 q4 0 6 4" />
      </g>
    </svg>
  );
}

const STATUS = {
  pending: { label: '征集中', seal: '待\n采', cls: 'pending', desc: '已公开，等待管理层采纳后付诸议员表决' },
  voting: { label: '审议表决', seal: '表\n决', cls: 'voting', desc: '议员表决中：赞成 >50% 通过一般决议，>67% 通过特别决议' },
  passed_general: { label: '一般决议 · 通过', seal: '通\n过', cls: 'g', desc: '赞成率逾半数，已作为一般决议通过' },
  passed_special: { label: '特别决议 · 通过', seal: '特\n别', cls: 's', desc: '赞成率逾三分之二，已作为特别决议通过' },
  failed: { label: '未获通过', seal: '未\n通', cls: 'failed', desc: '赞成率未达半数' },
  rejected: { label: '未予采纳', seal: '驳\n回', cls: 'rejected', desc: '管理层未予采纳' },
};

function SupportBar({ ratio, total }) {
  const pct = Math.round((ratio || 0) * 100);
  const tier = ratio > 2 / 3 ? 's' : ratio > 0.5 ? 'g' : 'f';
  return (
    <div className="pl-bar-wrap">
      <div className={'pl-bar tier-' + tier}>
        <span className="pl-bar-fill" style={{ width: pct + '%' }} />
        <i className="pl-mark m50"><em>过半</em></i>
        <i className="pl-mark m67"><em>三分二</em></i>
      </div>
      <div className="pl-bar-legend"><span>赞成率 <b>{pct}%</b></span><span className="muted">{total} 名议员参与表决</span></div>
    </div>
  );
}

function ProposalCard({ p, ov, idx, onChange, toast }) {
  const [expanded, setExpanded] = useState(false);
  const st = STATUS[p.status] || STATUS.pending;
  const t = p.status === 'voting' ? p.live_tally : (p.tally || p.live_tally);
  const canVote = ov.is_councilor && p.status === 'voting' && !ov.locked;
  const long = (p.body || '').length > 160;
  const decided = ['passed_general', 'passed_special', 'failed'].includes(p.status);

  const act = async (path, opt) => {
    try { const d = await api(path, opt); onChange(d.proposal); }
    catch (e) { toast(e.message, 'err'); }
  };
  const vote = (choice) => act(`/parliament/proposals/${p.id}/vote`, { method: 'POST', body: { choice } });
  const endorse = () => act(`/parliament/proposals/${p.id}/endorse`, { method: 'POST' });

  return (
    <article className={'pl-doc st-' + st.cls}>
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
        <span className="muted"><Sparkles size={12} /> {p.endorsements} 人联署</span>
      </div>
      <div className="pl-divider" />
      <p className={'pl-body' + (long && !expanded ? ' clamp' : '')}>{p.body}</p>
      {long && <button className="pl-more" onClick={() => setExpanded(e => !e)}>{expanded ? <>收起 <ChevronUp size={13} /></> : <>展开全文 <ChevronDown size={13} /></>}</button>}

      {(p.status === 'voting' || decided) && (
        <div className="pl-tally">
          <SupportBar ratio={t.ratio} total={t.total} />
          <div className="pl-votes">
            <span className="v-for"><ThumbsUp size={13} /> 赞成 {t.for}</span>
            <span className="v-against"><ThumbsDown size={13} /> 反对 {t.against}</span>
            <span className="v-abstain"><MinusCircle size={13} /> 弃权 {t.abstain}</span>
          </div>
        </div>
      )}

      {canVote && (
        <div className="pl-vote-acts">
          <span className="pl-vote-label">议员表决：</span>
          <button className={'btn sm' + (p.my_vote === 'for' ? ' primary' : '')} onClick={() => vote('for')}><ThumbsUp size={14} /> 赞成</button>
          <button className={'btn sm' + (p.my_vote === 'against' ? ' danger' : '')} onClick={() => vote('against')}><ThumbsDown size={14} /> 反对</button>
          <button className={'btn sm' + (p.my_vote === 'abstain' ? ' active' : '')} onClick={() => vote('abstain')}><MinusCircle size={14} /> 弃权</button>
        </div>
      )}

      <div className="pl-foot">
        <button className={'pl-endorse' + (p.my_endorsed ? ' on' : '')} onClick={endorse} disabled={ov.locked} title="公开联署支持（全体公民可参与）">
          <Sparkles size={14} /> {p.my_endorsed ? '已联署' : '联署支持'}
        </button>
        <span className="pl-hint muted">{st.desc}</span>
      </div>

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
      <h2 style={{ marginTop: 0, fontFamily: 'var(--serif)' }}><Gavel size={18} style={{ verticalAlign: -3, marginRight: 6 }} />提交议案</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>议案将<b>公开陈列于议事厅</b>，全体公民可见并可联署。经主席团采纳后付诸议员表决：赞成逾 <b>50%</b> 成一般决议，逾 <b>67%</b> 成特别决议。</p>
      <div className="field"><label>议案标题</label><input className="input" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="一句话陈明动议" /></div>
      <div className="field"><label>议案正文</label><textarea className="textarea" rows={6} value={body} maxLength={2000} onChange={e => setBody(e.target.value)} placeholder="详述背景、条款与预期影响…" style={{ resize: 'vertical' }} /></div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>取消</button>
        <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={submit}><Check size={15} /> 提交议案</button>
      </div>
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
  const [creating, setCreating] = useState(false);
  const [charterOpen, setCharterOpen] = useState(false);

  const load = () => Promise.all([
    api('/parliament/overview').then(d => setOv(d)).catch(() => setOv({})),
    api('/parliament/proposals').then(d => setList(d.proposals || [])).catch(e => toast(e.message, 'err')),
  ]).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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
    if (filter === 'all') return true;
    if (filter === 'passed') return p.status === 'passed_general' || p.status === 'passed_special';
    if (filter === 'archive') return p.status === 'failed' || p.status === 'rejected';
    return p.status === filter;
  }), [list, filter]);
  const counts = useMemo(() => ({
    voting: list.filter(p => p.status === 'voting').length,
    passed: list.filter(p => p.status === 'passed_general' || p.status === 'passed_special').length,
  }), [list]);

  const locked = !!ov?.locked;

  return (
    <>
      <div className="topbar pl-topbar">
        <div style={{ flex: 1 }}>
          <h1 className="pl-h1">幻域议会</h1>
          <div className="sub">PARLIAMENT OF HUANYU · 议事厅</div>
        </div>
        {ov?.is_gm && (
          <button className={'btn' + (locked ? ' primary' : '')} onClick={toggleLock} title={locked ? '恢复议会运作' : '封锁议会（无限期休会）'}>
            <Lock size={15} /> {locked ? '恢复议会' : '封锁议会'}
          </button>
        )}
        {ov?.is_councilor && !locked && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> 提交议案</button>}
      </div>

      <div className="page pl-page" style={{ maxWidth: 940 }}>
        {/* 议事厅横幅 */}
        <section className={'pl-chamber' + (locked ? ' locked' : '')}>
          <div className="pl-chamber-bg" aria-hidden="true" />
          <Crest size={72} />
          <div className="pl-chamber-tx">
            <h2>幻域议会 · 议事厅</h2>
            <p>公议立邦 · 众智共治　—　提案出于议员，决议成于公论</p>
            <div className="pl-chamber-stats">
              <div><b>第 {ov?.term ?? '—'} 届</b><span>当前届次</span></div>
              <div className="pl-stat-sep" />
              <div><b>{ov?.council_size ?? '—'}<i> / {ov?.seats ?? '—'}</i></b><span>在任议员 / 议席</span></div>
              <div className="pl-stat-sep" />
              <div><b>{counts.voting}</b><span>表决进行中</span></div>
              <div className="pl-stat-sep" />
              <div><b>{counts.passed}</b><span>决议达成</span></div>
            </div>
          </div>
        </section>

        {locked && (
          <div className="pl-lock-banner">
            <span className="pl-lock-seal"><Lock size={22} /></span>
            <div><b>本届议会现已休会</b><p>经管理层裁定，幻域议会无限期休会，暂停受理一切提案与表决，静待复会通知。</p></div>
          </div>
        )}

        {/* 议事规则 */}
        <div className="pl-charter">
          <button className="pl-charter-head" onClick={() => setCharterOpen(o => !o)}>
            <ScrollText size={15} /> <b>议事规则</b>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{charterOpen ? '收起' : '展开'} {charterOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
          </button>
          {charterOpen && (
            <ol className="pl-charter-body">
              <li><b>议员之设。</b>议员由管理层任命，名额按注册公民规模核定，每满百人增一席。</li>
              <li><b>提案之权。</b>唯议员得提交公共议案；议案一经提交即公开陈列，全体公民皆可查阅并联署。</li>
              <li><b>采纳之序。</b>议案须经主席团采纳，方付诸议员表决。</li>
              <li><b>表决之制。</b>以参与表决之议员为基数：赞成<b>逾二分之一</b>者，成<em>一般决议</em>；<b>逾三分之二</b>者，成<em>特别决议</em>；未及半数则不予通过。</li>
              <li><b>休会之权。</b>管理层得宣布议会无限期休会，期间一切议事暂停，静待复会。</li>
            </ol>
          )}
        </div>

        {/* 身份 */}
        <div className="pl-role">
          {ov?.is_councilor
            ? <span className="pl-role-badge councilor"><Scale size={14} /> 阁下为幻域议员，得提案并参与表决</span>
            : <span className="pl-role-badge"><Users size={14} /> 阁下为幻域公民，得查阅与联署；议员之职须由管理层任命</span>}
          {ov?.is_gm && <span className="pl-role-badge gm"><Gavel size={14} /> 主席团：采纳 · 驳回 · 计票 · 休会</span>}
        </div>

        <div className="pl-tabs">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
              {l}{k === 'voting' && counts.voting > 0 ? ` · ${counts.voting}` : ''}
            </button>
          ))}
        </div>

        {loading ? <div className="empty">载入中…</div> :
          shown.length === 0 ? (
            <div className="empty"><div className="big"><ScrollText size={42} /></div>
              {filter === 'all' ? '议事厅暂无议案' : '该类目下暂无议案'}
              {ov?.is_councilor && !locked && filter === 'all' && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> 提交首份议案</button></div>}
            </div>
          ) : (
            <div className="pl-list">
              {shown.map((p, i) => <ProposalCard key={p.id} p={p} ov={{ ...(ov || {}), locked }} idx={i} onChange={onChange} toast={toast} />)}
            </div>
          )}
      </div>

      {creating && <NewProposal onClose={() => setCreating(false)} onCreated={onCreated} toast={toast} />}
    </>
  );
}
