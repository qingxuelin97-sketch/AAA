import React, { useEffect, useMemo, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import {
  Landmark, Gavel, Scale, ThumbsUp, ThumbsDown, MinusCircle, Check, X, Plus,
  ShieldCheck, Users, Sparkles, BadgeCheck, Trash2, Megaphone, ChevronDown, ChevronUp
} from 'lucide-react';

const STATUS = {
  pending: { label: '征集中 · 待采纳', cls: 'pending', desc: '已公开，等待管理员采纳后进入议员表决' },
  voting: { label: '审议表决中', cls: 'voting', desc: '议员正在表决：赞成率 >50% 通过一般决议，>67% 通过特别决议' },
  passed_general: { label: '一般决议 · 已通过', cls: 'g', desc: '赞成率超过 50%，作为一般决议通过' },
  passed_special: { label: '特别决议 · 已通过', cls: 's', desc: '赞成率超过 67%，作为特别决议通过' },
  failed: { label: '未获通过', cls: 'failed', desc: '赞成率未达 50%' },
  rejected: { label: '已驳回', cls: 'rejected', desc: '管理员未予采纳' },
};

// Dual-threshold support bar with 50% / 67% markers.
function SupportBar({ ratio, total }) {
  const pct = Math.round((ratio || 0) * 100);
  const tier = ratio > 2 / 3 ? 's' : ratio > 0.5 ? 'g' : 'f';
  return (
    <div className="pl-bar-wrap">
      <div className={'pl-bar tier-' + tier}>
        <span className="pl-bar-fill" style={{ width: pct + '%' }} />
        <i className="pl-mark m50" title="一般决议 50%" />
        <i className="pl-mark m67" title="特别决议 67%" />
      </div>
      <div className="pl-bar-legend">
        <span>赞成 <b>{pct}%</b></span>
        <span className="muted">{total} 票参与</span>
      </div>
    </div>
  );
}

function ProposalCard({ p, ov, onChange, toast }) {
  const [expanded, setExpanded] = useState(false);
  const st = STATUS[p.status] || STATUS.pending;
  const t = p.status === 'voting' ? p.live_tally : (p.tally || p.live_tally);
  const canVote = ov.is_councilor && p.status === 'voting';
  const long = (p.body || '').length > 150;

  const act = async (path, opt) => {
    try { const d = await api(path, opt); onChange(d.proposal); }
    catch (e) { toast(e.message, 'err'); }
  };
  const vote = (choice) => act(`/parliament/proposals/${p.id}/vote`, { method: 'POST', body: { choice } });
  const endorse = () => act(`/parliament/proposals/${p.id}/endorse`, { method: 'POST' });

  return (
    <div className={'pl-card st-' + st.cls}>
      <div className="pl-card-head">
        <span className={'pl-status ' + st.cls}>{st.label}</span>
        <div className="pl-author">
          <Avatar src={p.author_avatar} name={p.author_name} size={22} />
          <span>{p.author_name}{p.author_verified && <BadgeCheck size={13} className="pl-verif" />}</span>
          <span className="muted">· 议员提案</span>
        </div>
      </div>
      <h3 className="pl-title">{p.title}</h3>
      <p className={'pl-body' + (long && !expanded ? ' clamp' : '')}>{p.body}</p>
      {long && (
        <button className="pl-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? <>收起 <ChevronUp size={13} /></> : <>展开全文 <ChevronDown size={13} /></>}
        </button>
      )}

      {(p.status === 'voting' || p.status === 'passed_general' || p.status === 'passed_special' || p.status === 'failed') && (
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
          <button className={'btn sm' + (p.my_vote === 'for' ? ' primary' : '')} onClick={() => vote('for')}><ThumbsUp size={14} /> 赞成</button>
          <button className={'btn sm' + (p.my_vote === 'against' ? ' danger' : '')} onClick={() => vote('against')}><ThumbsDown size={14} /> 反对</button>
          <button className={'btn sm' + (p.my_vote === 'abstain' ? ' active' : '')} onClick={() => vote('abstain')}><MinusCircle size={14} /> 弃权</button>
          {p.my_vote && <span className="pl-voted">已投：{p.my_vote === 'for' ? '赞成' : p.my_vote === 'against' ? '反对' : '弃权'}</span>}
        </div>
      )}

      <div className="pl-foot">
        <button className={'pl-endorse' + (p.my_endorsed ? ' on' : '')} onClick={endorse} title="公开联署支持（所有人可参与）">
          <Sparkles size={14} /> 联署 {p.endorsements > 0 && <b>{p.endorsements}</b>}
        </button>
        <span className="pl-hint muted">{st.desc}</span>
      </div>

      {ov.is_gm && (
        <div className="pl-gm">
          <span className="pl-gm-tag"><Gavel size={12} /> 管理席</span>
          {p.status === 'pending' && <button className="btn sm primary" onClick={() => act(`/parliament/proposals/${p.id}/adopt`, { method: 'POST' })}><Check size={13} /> 采纳并进入表决</button>}
          {p.status === 'voting' && <button className="btn sm primary" onClick={() => act(`/parliament/proposals/${p.id}/close`, { method: 'POST' })}><Scale size={13} /> 计票并公布结果</button>}
          {(p.status === 'pending' || p.status === 'voting') && <button className="btn sm" onClick={() => act(`/parliament/proposals/${p.id}/reject`, { method: 'POST' })}><X size={13} /> 驳回</button>}
          <button className="btn sm danger" onClick={async () => { if (confirm('删除该提案？')) { try { await api(`/parliament/proposals/${p.id}`, { method: 'DELETE' }); onChange(null, p.id); } catch (e) { toast(e.message, 'err'); } } }}><Trash2 size={13} /></button>
        </div>
      )}
    </div>
  );
}

function NewProposal({ onClose, onCreated, toast }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim() || !body.trim()) { toast('请填写标题与内容', 'err'); return; }
    setBusy(true);
    try { const d = await api('/parliament/proposals', { method: 'POST', body: { title, body } }); toast('提案已提交，等待管理员采纳'); onCreated(d.proposal); onClose(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginTop: 0 }}><Gavel size={18} style={{ verticalAlign: -3, marginRight: 6 }} />提交公共提案</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>提案将<b>公开展示给所有用户</b>。被管理员采纳后进入议员表决：赞成率超过 50% 通过一般决议，超过 67% 通过特别决议。</p>
      <div className="field"><label>提案标题</label><input className="input" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="一句话概括你的提案" /></div>
      <div className="field"><label>提案正文</label><textarea className="textarea" rows={6} value={body} maxLength={2000} onChange={e => setBody(e.target.value)} placeholder="详细说明提案的背景、内容与预期影响…" style={{ resize: 'vertical' }} /></div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>取消</button>
        <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={submit}><Check size={15} /> 提交提案</button>
      </div>
    </Modal>
  );
}

const FILTERS = [['all', '全部'], ['voting', '表决中'], ['pending', '待采纳'], ['passed', '已通过'], ['archive', '历史']];

export default function Parliament() {
  const toast = useToast();
  const { user } = useAuth();
  const [ov, setOv] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);

  const load = () => Promise.all([
    api('/parliament/overview').then(d => setOv(d)).catch(() => setOv({})),
    api('/parliament/proposals').then(d => setList(d.proposals || [])).catch(e => toast(e.message, 'err')),
  ]).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1><Landmark size={20} style={{ verticalAlign: -3, marginRight: 7 }} />幻域议会</h1>
          <div className="sub">公共提案 · 议员表决 · 一般 / 特别决议</div>
        </div>
        {ov?.is_councilor && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> 发起提案</button>}
      </div>

      <div className="page" style={{ maxWidth: 920 }}>
        <div className="pl-hero">
          <div className="pl-hero-ic"><Landmark size={26} /></div>
          <div className="pl-hero-tx">
            <b>人人可见 · 议员共治</b>
            <p>任何被任命的<strong>议员</strong>都可提交公共提案，全体用户均可查看并<strong>联署</strong>支持。提案被管理员采纳后进入议员表决——参与表决者中赞成<strong>超过 50%</strong> 通过<em>一般决议</em>，<strong>超过 67%</strong> 通过<em>特别决议</em>。</p>
          </div>
          <div className="pl-hero-stats">
            <div><b>{ov?.council_size ?? '—'}{ov?.seats != null && <span className="pl-seat-cap"> / {ov.seats}</span>}</b><span><Users size={12} /> 议员 / 议席</span></div>
            <div><b>{counts.voting}</b><span><Gavel size={12} /> 表决中</span></div>
            <div><b>{counts.passed}</b><span><Check size={12} /> 已通过</span></div>
            {ov?.term != null && <div><b>第 {ov.term} 届</b><span><Landmark size={12} /> 当前届次</span></div>}
          </div>
        </div>

        <div className="pl-role">
          {ov?.is_councilor
            ? <span className="pl-role-badge councilor"><ShieldCheck size={15} /> 你是幻域议员，可发起提案并参与表决</span>
            : <span className="pl-role-badge"><Users size={15} /> 你当前是普通公民，可查看与联署提案；成为议员需管理员任命</span>}
          {ov?.is_gm && <span className="pl-role-badge gm"><Gavel size={15} /> 管理席：可采纳 / 驳回 / 计票</span>}
        </div>

        <div className="tabs-bar" style={{ marginTop: 16 }}>
          {FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
              {l}{k === 'voting' && counts.voting > 0 ? ` (${counts.voting})` : ''}
            </button>
          ))}
        </div>

        {loading ? <div className="empty">载入中…</div> :
          shown.length === 0 ? (
            <div className="empty"><div className="big"><Megaphone size={44} /></div>
              {filter === 'all' ? '议会暂无提案' : '该分类下暂无提案'}
              {ov?.is_councilor && filter === 'all' && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> 发起第一个提案</button></div>}
            </div>
          ) : (
            <div className="pl-list">
              {shown.map(p => <ProposalCard key={p.id} p={p} ov={ov || {}} onChange={onChange} toast={toast} />)}
            </div>
          )}
      </div>

      {creating && <NewProposal onClose={() => setCreating(false)} onCreated={onCreated} toast={toast} />}
    </>
  );
}
