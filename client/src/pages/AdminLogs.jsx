// GM 日志台 —— 全链路观测控制台。
// 六个子页：总览（统计/趋势/热力图/延迟分位/错误热点）· 检索（多维过滤 + 书签 +
// 导出）· 实时（live tail 控制台）· 链路（请求瀑布 / 会话轨迹）· 审计（GM 操作
// 留痕）· 设置（保留策略 / 告警规则引擎 / 归档管理 / 健康自检）。
// 从 Admin.jsx 拆出独立文件：日志台的体量已经是一个完整子应用。
import React, { useEffect, useRef, useState } from 'react';
import { api, getToken, getApiBase } from '../api.jsx';
import { Avatar, Modal } from '../ui.jsx';
import {
  AlertTriangle, Activity, TrendingUp, TrendingDown, Terminal, FileText, Download, Trash2,
  RefreshCw, Search, X, ChevronLeft, ChevronRight, UserCheck, Check, Zap, Copy, Radio,
  Pause, Play, GitBranch, Shield, Settings2, Plus, Archive, HeartPulse, Bookmark, Gauge,
} from 'lucide-react';
import { BarChart, LineChart } from '../components/Charts.jsx';
import { useRealtimeEvent } from '../realtime.jsx';

export const LEVEL_COLORS = { debug: 'var(--muted)', info: 'var(--accent-2)', warn: '#e0a530', error: 'var(--danger, #bb4b35)', fatal: '#a02020' };
export const LEVEL_LABELS = { debug: '调试', info: '信息', warn: '警告', error: '错误', fatal: '致命' };
const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const CATEGORIES = ['api', 'auth', 'admin', 'economy', 'chat', 'character', 'social', 'dm', 'parliament', 'upload', 'system', 'client', 'app'];

const fmtBytes = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';
const utcNow = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');

// 授权下载（api() 会解析 JSON，二进制走裸 fetch + blob）
async function authDownload(pathname, filename, toast) {
  try {
    toast('正在下载…');
    const token = getToken();
    const res = await fetch(getApiBase() + '/api' + pathname, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!res.ok) throw new Error('下载失败 (HTTP ' + res.status + ')');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已下载');
  } catch (e) { toast('下载失败：' + e.message, 'err'); }
}

/* ═══════════ 共享：日志详情弹窗 ═══════════ */

function LogDetailModal({ row, onClose, onDrill, toast }) {
  if (!row) return null;
  const copyJson = () => {
    try {
      const d = { ...row };
      try { d.extra = JSON.parse(d.extra); } catch { /* 保持原样 */ }
      navigator.clipboard?.writeText(JSON.stringify(d, null, 2));
      toast('已复制日志 JSON');
    } catch { toast('复制失败', 'err'); }
  };
  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: '0 0 14px', fontSize: 17, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="tag" style={{ background: 'var(--bg-2)', color: LEVEL_COLORS[row.level] || 'var(--muted)' }}>
          {LEVEL_LABELS[row.level] || row.level}
        </span>
        [{row.category}] {row.event}
        {row.count > 1 && <span className="tag" style={{ background: 'var(--danger-soft, rgba(187,75,53,0.12))', color: 'var(--danger, #bb4b35)' }}>×{row.count}</span>}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13, marginBottom: 14 }}>
        <div><span className="muted">ID：</span>{row.id || '—'}</div>
        <div><span className="muted">时间：</span>{row.ts}</div>
        <div><span className="muted">来源：</span>{row.source}</div>
        <div><span className="muted">用户：</span>{row.user_id ? `U${row.user_id}` : '—'}</div>
        <div><span className="muted">IP：</span>{row.ip || '—'}</div>
        <div><span className="muted">会话：</span>{row.session_id || '—'}</div>
        <div><span className="muted">请求ID：</span>{row.request_id || '—'}</div>
        <div><span className="muted">指纹：</span>{row.fingerprint || '—'}</div>
        <div><span className="muted">接口：</span>{row.method} {row.endpoint}</div>
        <div><span className="muted">状态/耗时：</span>{row.status} · {row.duration_ms}ms</div>
      </div>
      <div className="field">
        <label>消息</label>
        <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8, fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>{row.message}</div>
      </div>
      {row.ua && (
        <div className="field"><label>User-Agent</label><div style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>{row.ua}</div></div>
      )}
      {row.extra && (
        <div className="field">
          <label>扩展字段</label>
          <pre style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {(() => { try { return JSON.stringify(JSON.parse(row.extra), null, 2); } catch { return row.extra; } })()}
          </pre>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 16 }}>
        {row.request_id && <button className="btn sm" onClick={() => onDrill({ request_id: row.request_id })}>查看同请求链路</button>}
        {row.session_id && <button className="btn sm" onClick={() => onDrill({ session_id: row.session_id })}>查看同会话</button>}
        {row.fingerprint && <button className="btn sm" onClick={() => onDrill({ fingerprint: row.fingerprint })}>查看同类错误</button>}
        <button className="btn sm" onClick={copyJson}><Copy size={13} /> 复制 JSON</button>
        <button className="btn ghost" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  );
}

/* ═══════════ 共享：日志行 ═══════════ */

function LogRow({ r, onClick }) {
  return (
    <div className="adm-row" style={{ cursor: 'pointer' }} onClick={onClick}>
      <span className="tag" style={{ background: 'var(--bg-2)', color: LEVEL_COLORS[r.level] || 'var(--muted)', flexShrink: 0, fontSize: 11, fontWeight: 600 }}>
        {LEVEL_LABELS[r.level] || r.level}
      </span>
      {r.count > 1 && <span className="tag" style={{ background: 'var(--danger-soft, rgba(187,75,53,0.12))', color: 'var(--danger, #bb4b35)', flexShrink: 0, fontSize: 11 }}>×{r.count}</span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <b style={{ fontSize: 13 }}>[{r.category}] {r.event}</b>
        <div className="sub2" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.message}</div>
      </div>
      <span className="muted" style={{ fontSize: 11, flexShrink: 0, textAlign: 'right' }}>
        {r.source}{r.user_id ? ` · U${r.user_id}` : ''}{r.duration_ms > 1500 ? ' · 🐢' : ''}<br />{r.ts}
      </span>
    </div>
  );
}

/* ═══════════ 总览 ═══════════ */

function Delta({ cur, prev, downGood = false }) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (!pct) return null;
  const up = pct > 0;
  const good = downGood ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span style={{ fontSize: 11, color: good ? 'var(--accent-2)' : 'var(--danger, #bb4b35)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <Icon size={11} />{Math.abs(pct)}%
    </span>
  );
}

function Heatmap({ matrix }) {
  if (!matrix) return null;
  const max = Math.max(1, ...matrix.flat().map(c => c.n));
  const DOW = ['日', '一', '二', '三', '四', '五', '六'];
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(24, minmax(14px, 1fr))', gap: 2, minWidth: 460 }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="muted" style={{ fontSize: 9, textAlign: 'center' }}>{h % 4 === 0 ? h : ''}</span>
        ))}
        {matrix.map((row, d) => (
          <React.Fragment key={d}>
            <span className="muted" style={{ fontSize: 10, alignSelf: 'center' }}>周{DOW[d]}</span>
            {row.map((c, h) => {
              const alpha = c.n ? 0.12 + 0.78 * (c.n / max) : 0;
              const hasErr = c.errors > 0;
              return (
                <span key={h} title={`周${DOW[d]} ${h}:00 · ${c.n} 条${hasErr ? ` · ${c.errors} 错误` : ''}`}
                  style={{
                    aspectRatio: '1', borderRadius: 3, minHeight: 14,
                    background: c.n ? (hasErr ? `rgba(187,75,53,${Math.min(0.9, alpha + 0.15)})` : `rgba(94,140,120,${alpha})`) : 'var(--bg-2)',
                  }} />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>近 30 天 · 北京时间 星期 × 小时 活跃度（红 = 含错误）</div>
    </div>
  );
}

function OverviewPanel({ toast, onDrill, livePulse }) {
  const [stats, setStats] = useState(null);
  const [series, setSeries] = useState(null);
  const [seriesWindow, setSeriesWindow] = useState('hour');
  const [seriesMetric, setSeriesMetric] = useState('all');
  const [top, setTop] = useState(null);
  const [topDim, setTopDim] = useState('event');
  const [fingerprints, setFingerprints] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [latency, setLatency] = useState(null);

  const load = async () => {
    const [s, fp, hm, lat] = await Promise.all([
      api('/admin/logs/stats').then(d => d.stats).catch(() => null),
      api('/admin/logs/fingerprints?limit=8').then(d => d.fingerprints).catch(() => null),
      api('/admin/logs/heatmap').then(d => d.matrix).catch(() => null),
      api('/admin/logs/latency').catch(() => null),
    ]);
    setStats(s); setFingerprints(fp); setHeatmap(hm); setLatency(lat);
  };
  const loadSeries = (win) => api('/admin/logs/timeseries?window=' + win).then(d => setSeries(d.series)).catch(() => {});
  const loadTop = (dim) => api('/admin/logs/top?dim=' + dim + '&limit=8').then(d => setTop(d.top)).catch(() => {});

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadSeries(seriesWindow); /* eslint-disable-next-line */ }, [seriesWindow]);
  useEffect(() => { loadTop(topDim); /* eslint-disable-next-line */ }, [topDim]);

  const TOP_DIMS = [['event', '高频事件'], ['endpoint', '热点接口'], ['user', '活跃用户'], ['ip', '高频 IP'], ['category', '类别'], ['status', '状态码'], ['slow', '慢接口']];
  const fmtBucket = (b) => seriesWindow === 'hour' ? b.slice(11, 16) : b.slice(5);
  const seriesData = (series || []).map(s => ({ x: fmtBucket(s.bucket), y: seriesMetric === 'errors' ? (s.errors ?? 0) : s.n }));

  return (
    <>
      {stats && (
        <div className="adm-stats adm-stats-rich">
          <div className="adm-stat">
            <span className="adm-stat-ic"><FileText size={16} /></span>
            <b>{stats.total}</b><span>日志总数</span>
          </div>
          <div className="adm-stat" style={livePulse > 0 ? { animation: 'pulse 0.6s' } : {}}>
            <span className="adm-stat-ic" style={{ color: 'var(--danger, #bb4b35)' }}><AlertTriangle size={16} /></span>
            <b style={{ color: 'var(--danger, #bb4b35)' }}>{stats.recent_errors_24h_total}</b>
            <span>24h 错误 <Delta cur={stats.recent_errors_24h_total} prev={stats.prev_24h?.errors} downGood /></span>
          </div>
          {stats.api_24h && (
            <>
              <div className="adm-stat">
                <span className="adm-stat-ic"><Activity size={16} /></span>
                <b>{stats.api_24h.requests}</b>
                <span>24h 请求 <Delta cur={stats.api_24h.requests} prev={stats.prev_24h?.requests} /></span>
              </div>
              <div className="adm-stat">
                <span className="adm-stat-ic" style={{ color: stats.api_24h.error_rate > 5 ? 'var(--danger, #bb4b35)' : undefined }}><Gauge size={16} /></span>
                <b style={stats.api_24h.error_rate > 5 ? { color: 'var(--danger, #bb4b35)' } : undefined}>{stats.api_24h.error_rate}%</b>
                <span>错误率</span>
              </div>
              <div className="adm-stat">
                <span className="adm-stat-ic" style={{ color: '#e0a530' }}><Zap size={16} /></span>
                <b style={{ color: stats.api_24h.slow > 0 ? '#e0a530' : undefined }}>{stats.api_24h.slow}</b>
                <span>慢请求 <Delta cur={stats.api_24h.slow} prev={stats.prev_24h?.slow} downGood /></span>
              </div>
            </>
          )}
          {stats.by_level?.filter(x => x.n > 0).slice(0, 5).map(l => (
            <div key={l.level} className="adm-stat">
              <span className="adm-stat-ic" style={{ color: LEVEL_COLORS[l.level] || 'var(--muted)' }}><Activity size={14} /></span>
              <b style={{ color: LEVEL_COLORS[l.level] || 'var(--muted)' }}>{l.n}</b>
              <span>{LEVEL_LABELS[l.level] || l.level}</span>
            </div>
          ))}
        </div>
      )}

      <div className="chart-grid" style={{ marginTop: 18, gridTemplateColumns: '2fr 1fr' }}>
        <div className="card chart-card">
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, margin: 0, flex: 1 }}><TrendingUp size={15} style={{ verticalAlign: -3, marginRight: 5 }} />{seriesWindow === 'hour' ? '近 24 小时' : '近 30 天'}{seriesMetric === 'errors' ? '错误' : '日志'}趋势</h2>
            <div className="tabs-bar" style={{ margin: 0 }}>
              <button className={seriesWindow === 'hour' ? 'active' : ''} onClick={() => setSeriesWindow('hour')}>24小时</button>
              <button className={seriesWindow === 'day' ? 'active' : ''} onClick={() => setSeriesWindow('day')}>30天</button>
              <button className={seriesMetric === 'errors' ? 'active' : ''} onClick={() => setSeriesMetric(m => m === 'errors' ? 'all' : 'errors')}>仅错误</button>
            </div>
          </div>
          {series ? <LineChart data={seriesData} color={seriesMetric === 'errors' ? 'var(--danger, #bb4b35)' : 'var(--accent)'} unit="" /> : <div className="chart-empty">载入中…</div>}
        </div>
        <div className="card chart-card">
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, margin: 0, flex: 1 }}><Terminal size={15} style={{ verticalAlign: -3, marginRight: 5 }} />TOP 榜</h2>
            <select className="select" value={topDim} onChange={e => setTopDim(e.target.value)} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
              {TOP_DIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {top && top.length > 0 ? (
            <BarChart
              data={top.map(t => ({
                label: String(t.key ?? '—').slice(0, 14),
                value: topDim === 'slow' ? (t.avg_ms || 0) : (t.total || t.n),
              }))}
              color={topDim === 'slow' ? '#e0a530' : 'var(--accent)'} height={140}
              unit={topDim === 'slow' ? 'ms' : ''}
            />
          ) : <div className="chart-empty">暂无数据</div>}
        </div>
      </div>

      <div className="chart-grid" style={{ marginTop: 18, gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="section-title"><h2 style={{ fontSize: 16, margin: 0 }}><Activity size={15} style={{ verticalAlign: -3, marginRight: 5 }} />活跃热力图</h2></div>
          <div style={{ marginTop: 10 }}><Heatmap matrix={heatmap} /></div>
        </div>
        <div className="card">
          <div className="section-title"><h2 style={{ fontSize: 16, margin: 0 }}><Gauge size={15} style={{ verticalAlign: -3, marginRight: 5 }} />接口延迟（24h）</h2></div>
          {latency ? (
            <>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '10px 0', fontSize: 13 }}>
                <span><span className="muted">P50</span> <b>{latency.global.p50}ms</b></span>
                <span><span className="muted">P95</span> <b>{latency.global.p95}ms</b></span>
                <span><span className="muted">P99</span> <b style={{ color: latency.global.p99 > 1500 ? '#e0a530' : undefined }}>{latency.global.p99}ms</b></span>
                <span><span className="muted">最大</span> <b>{latency.global.max_ms}ms</b></span>
                <span><span className="muted">请求</span> <b>{latency.global.count}</b></span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr className="muted" style={{ textAlign: 'left' }}><th style={{ padding: '4px 6px' }}>接口</th><th>次数</th><th>均值</th><th>P95</th><th>P99</th></tr></thead>
                  <tbody>
                    {latency.endpoints.slice(0, 8).map(e => (
                      <tr key={e.endpoint} style={{ borderTop: '1px solid var(--bg-2)' }}>
                        <td style={{ padding: '4px 6px', fontFamily: 'monospace', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.endpoint}</td>
                        <td>{e.count}</td><td>{e.avg_ms}ms</td><td>{e.p95}ms</td>
                        <td style={{ color: e.p99 > 1500 ? '#e0a530' : undefined }}>{e.p99}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <div className="chart-empty">载入中…</div>}
        </div>
      </div>

      {fingerprints && fingerprints.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-title"><h2 style={{ fontSize: 16, margin: 0 }}><AlertTriangle size={15} style={{ verticalAlign: -3, marginRight: 5 }} />错误热点（按指纹聚合 · 点击筛出全部出现）</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {fingerprints.slice(0, 8).map((f) => (
              <div key={f.fingerprint} className="adm-row" style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => onDrill({ fingerprint: f.fingerprint })}>
                <span className="tag" style={{ background: 'var(--danger-soft, rgba(187,75,53,0.12))', color: 'var(--danger, #bb4b35)', flexShrink: 0 }}>×{f.total}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{f.event}</b>
                  <div className="sub2" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.message}</div>
                </div>
                <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>{f.last_ts}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn sm" onClick={() => { load(); loadSeries(seriesWindow); loadTop(topDim); }}><RefreshCw size={13} /> 刷新总览</button>
      </div>
    </>
  );
}

/* ═══════════ 检索 ═══════════ */

function SearchPanel({ toast, seed }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [fLevel, setFLevel] = useState('');
  const [fSource, setFSource] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fEvent, setFEvent] = useState('');
  const [fQ, setFQ] = useState('');
  const [fStatusClass, setFStatusClass] = useState('');
  const [fEndpoint, setFEndpoint] = useState('');
  const [fRequestId, setFRequestId] = useState('');
  const [fSessionId, setFSessionId] = useState('');
  const [fFingerprint, setFFingerprint] = useState('');
  const [timePreset, setTimePreset] = useState('all');
  const [fSince, setFSince] = useState('');
  const [fUntil, setFUntil] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [fUserId, setFUserId] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [userQ, setUserQ] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [views, setViews] = useState([]);
  const refreshTimerRef = useRef(null);
  useEffect(() => () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); }, []);

  // 从总览/链路等处点击穿透带进来的过滤种子
  useEffect(() => {
    if (!seed) return;
    setFRequestId(seed.request_id || '');
    setFSessionId(seed.session_id || '');
    setFFingerprint(seed.fingerprint || '');
    if (seed.user_id != null) setFUserId(String(seed.user_id));
    if (seed.level != null) setFLevel(seed.level);
    if (seed.category != null) setFCategory(seed.category);
    if (seed.event != null) setFEvent(seed.event);
    setPage(0);
    /* eslint-disable-next-line */
  }, [seed]);

  const toUtc = (local) => {
    if (!local) return '';
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 19).replace('T', ' ');
  };
  const presetSince = () => {
    if (timePreset === '1h') return utcNow(3600_000);
    if (timePreset === '24h') return utcNow(86400_000);
    if (timePreset === '7d') return utcNow(7 * 86400_000);
    if (timePreset === 'custom') return toUtc(fSince);
    return '';
  };

  const currentParams = () => {
    const p = {};
    if (fLevel) p.level = fLevel;
    if (fSource) p.source = fSource;
    if (fCategory) p.category = fCategory;
    if (fEvent) p.event = fEvent;
    if (fQ) p.q = fQ;
    if (fUserId) p.user_id = fUserId;
    if (fStatusClass) p.status_class = fStatusClass;
    if (fEndpoint) p.endpoint = fEndpoint;
    if (fRequestId) p.request_id = fRequestId;
    if (fSessionId) p.session_id = fSessionId;
    if (fFingerprint) p.fingerprint = fFingerprint;
    if (timePreset !== 'all') p.preset = timePreset;
    return p;
  };

  const queryStr = (extra = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(currentParams())) if (k !== 'preset') p.set(k, v);
    const since = presetSince();
    if (since) p.set('since', since);
    if (timePreset === 'custom' && fUntil) p.set('until', toUtc(fUntil));
    if (fRequestId || fSessionId) p.set('sort', 'asc'); // 链路视图按时间正序
    p.set('limit', extra.limit ?? pageSize);
    p.set('offset', (extra.page ?? page) * pageSize);
    for (const [k, v] of Object.entries(extra)) if (v != null && k !== 'page' && k !== 'limit') p.set(k, v);
    return p.toString();
  };

  const loadList = async (p = page) => {
    setLoading(true);
    try {
      const d = await api('/admin/logs?' + queryStr({ page: p }));
      setRows(d.rows || []); setTotal(d.total || 0);
    } catch (e) { toast(e.message, 'err'); }
    finally { setLoading(false); }
  };
  const loadViews = () => api('/admin/logs/views').then(d => setViews(d.views || [])).catch(() => {});

  useEffect(() => { loadViews(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadList(page); /* eslint-disable-next-line */ }, [page, pageSize, fLevel, fSource, fCategory, fEvent, fUserId, fStatusClass, fRequestId, fSessionId, fFingerprint, timePreset, seed]);

  const searchUsers = async () => {
    try { const d = await api('/admin/users' + (userQ.trim() ? '?q=' + encodeURIComponent(userQ.trim()) : '')); setUserResults(d.users || []); }
    catch (e) { toast(e.message, 'err'); }
  };
  const pickUser = (u) => {
    setSelectedUser(u); setFUserId(String(u.id)); setFCategory('auth'); setFEvent('login');
    setUserQ(''); setUserResults([]); setPage(0);
  };
  const clearUser = () => { setSelectedUser(null); setFUserId(''); setFCategory(''); setFEvent(''); setPage(0); };

  useRealtimeEvent('audit', () => {
    if (!autoRefresh) return;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { refreshTimerRef.current = null; loadList(); }, 1500);
  });

  const doExport = (format) => authDownload(
    '/admin/logs/export?' + queryStr({ page: 0, limit: 5000, format }),
    `logs-${new Date().toISOString().slice(0, 10)}.${format === 'ndjson' ? 'ndjson' : format}`, toast);

  const resetFilters = () => {
    setFLevel(''); setFSource(''); setFCategory(''); setFEvent(''); setFQ(''); setFUserId('');
    setFStatusClass(''); setFEndpoint(''); setFRequestId(''); setFSessionId(''); setFFingerprint('');
    setTimePreset('all'); setFSince(''); setFUntil(''); setSelectedUser(null); setUserResults([]); setPage(0);
  };

  const applyView = (v) => {
    resetFilters();
    const p = v.params || {};
    if (p.level) setFLevel(p.level);
    if (p.source) setFSource(p.source);
    if (p.category) setFCategory(p.category);
    if (p.event) setFEvent(p.event);
    if (p.q) setFQ(p.q);
    if (p.user_id) setFUserId(p.user_id);
    if (p.status_class) setFStatusClass(p.status_class);
    if (p.endpoint) setFEndpoint(p.endpoint);
    if (p.request_id) setFRequestId(p.request_id);
    if (p.session_id) setFSessionId(p.session_id);
    if (p.fingerprint) setFFingerprint(p.fingerprint);
    if (p.preset) setTimePreset(p.preset);
  };
  const saveView = async () => {
    const name = prompt('书签名称（保存当前过滤组合，全体 GM 共享）：');
    if (!name?.trim()) return;
    try {
      const d = await api('/admin/logs/views', { method: 'PUT', body: { views: [...views, { name: name.trim(), params: currentParams() }] } });
      setViews(d.views); toast('书签已保存');
    } catch (e) { toast(e.message, 'err'); }
  };
  const removeView = async (id) => {
    try {
      const d = await api('/admin/logs/views', { method: 'PUT', body: { views: views.filter(v => v.id !== id) } });
      setViews(d.views);
    } catch (e) { toast(e.message, 'err'); }
  };

  const drillDown = (patch) => {
    setDetail(null); setPage(0);
    if (patch.request_id != null) setFRequestId(patch.request_id);
    if (patch.session_id != null) setFSessionId(patch.session_id);
    if (patch.fingerprint != null) setFFingerprint(patch.fingerprint);
  };
  const chainChips = [
    fRequestId && { label: '请求链路 ' + fRequestId, clear: () => setFRequestId('') },
    fSessionId && { label: '会话 ' + fSessionId, clear: () => setFSessionId('') },
    fFingerprint && { label: '指纹 ' + fFingerprint, clear: () => setFFingerprint('') },
    fEndpoint && { label: '接口 ' + fEndpoint, clear: () => setFEndpoint('') },
  ].filter(Boolean);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      {/* 查询书签 */}
      <div className="card">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Bookmark size={14} style={{ color: 'var(--muted)' }} />
          {views.length === 0 && <span className="muted" style={{ fontSize: 12 }}>暂无书签 —— 设好过滤条件后点「存书签」，常用查询一键直达</span>}
          {views.map(v => (
            <span key={v.id} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'var(--accent-soft, rgba(120,140,255,0.12))', color: 'var(--accent-2)' }}
              onClick={() => applyView(v)}>
              {v.name}
              <button onClick={(e) => { e.stopPropagation(); removeView(v.id); }} title="删除书签" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'inline-flex' }}><X size={12} /></button>
            </span>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn sm" onClick={saveView}><Plus size={13} /> 存书签</button>
        </div>
      </div>

      {/* 登录日志 · 按账号查看 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 15, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserCheck size={15} style={{ verticalAlign: -3 }} /> 按账号查看
          </h2>
          {selectedUser && (
            <span className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-soft, rgba(120,140,255,0.12))', color: 'var(--accent-2)' }}>
              <Avatar src={selectedUser.avatar} name={selectedUser.display_name} size={16} />
              {selectedUser.display_name} @{selectedUser.username} · U{selectedUser.id}
              <button onClick={clearUser} title="取消选中" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'inline-flex' }}><X size={12} /></button>
            </span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>选中账号自动过滤其登录记录（category=auth · event=login），可再改过滤条件看其全部日志</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" placeholder="搜索用户名 / 昵称，或输入用户 ID（留空列出最新 50）" value={userQ} onChange={e => setUserQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchUsers()} style={{ flex: '1 1 240px', minWidth: 200 }} />
          <button className="btn" onClick={searchUsers}><Search size={14} /> 搜索账号</button>
        </div>
        {userResults.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {userResults.map(u => (
              <div key={u.id} className="adm-row" style={{ cursor: 'pointer', padding: '6px 8px' }} onClick={() => pickUser(u)}>
                <Avatar src={u.avatar} name={u.display_name} size={28} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{u.display_name}</b>
                  <div className="sub2" style={{ fontSize: 11 }}>@{u.username} · U{u.id}{u.is_gm ? ' · GM' : ''}{u.is_banned ? ' · 已封禁' : ''}</div>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>查看登录记录 <ChevronRight size={12} style={{ verticalAlign: -2 }} /></span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 过滤栏 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 100px', minWidth: 100 }}>
            <label>级别</label>
            <select className="select" value={fLevel} onChange={e => { setFLevel(e.target.value); setPage(0); }}>
              <option value="">全部</option>
              <option value="debug">调试+</option>
              <option value="info">信息+</option>
              <option value="warn">警告+</option>
              <option value="error">错误+</option>
              <option value="fatal">仅致命</option>
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 100px', minWidth: 100 }}>
            <label>来源</label>
            <select className="select" value={fSource} onChange={e => { setFSource(e.target.value); setPage(0); }}>
              <option value="">全部</option>
              <option value="server">服务端</option>
              <option value="client">网页端</option>
              <option value="app">APP端</option>
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 110px', minWidth: 110 }}>
            <label>类别</label>
            <select className="select" value={fCategory} onChange={e => { setFCategory(e.target.value); setPage(0); }}>
              <option value="">全部</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 100px', minWidth: 100 }}>
            <label>状态码</label>
            <select className="select" value={fStatusClass} onChange={e => { setFStatusClass(e.target.value); setPage(0); }}>
              <option value="">全部</option>
              <option value="2">2xx 成功</option>
              <option value="3">3xx 重定向</option>
              <option value="4">4xx 客户端错</option>
              <option value="5">5xx 服务端错</option>
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 110px', minWidth: 110 }}>
            <label>时间范围</label>
            <select className="select" value={timePreset} onChange={e => { setTimePreset(e.target.value); setPage(0); }}>
              <option value="all">全部时间</option>
              <option value="1h">最近 1 小时</option>
              <option value="24h">最近 24 小时</option>
              <option value="7d">最近 7 天</option>
              <option value="custom">自定义…</option>
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 110px', minWidth: 110 }}>
            <label>事件名</label>
            <input className="input" value={fEvent} onChange={e => { setFEvent(e.target.value); setPage(0); }} placeholder="如 login" />
          </div>
          <div className="field" style={{ flex: '1 1 130px', minWidth: 120 }}>
            <label>接口前缀</label>
            <input className="input" value={fEndpoint} onChange={e => setFEndpoint(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(0), loadList(0))} placeholder="如 /chat" />
          </div>
          <div className="field" style={{ flex: '2 1 180px', minWidth: 150 }}>
            <label>搜索</label>
            <input className="input" value={fQ} onChange={e => setFQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(0), loadList(0))} placeholder="消息/事件/接口" />
          </div>
          <button className="btn" onClick={() => { setPage(0); loadList(0); }}><Search size={14} /> 查询</button>
          <button className="btn" onClick={resetFilters}>重置</button>
        </div>
        {timePreset === 'custom' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
            <div className="field" style={{ flex: '1 1 180px', minWidth: 170 }}>
              <label>起始（本地时间）</label>
              <input className="input" type="datetime-local" value={fSince} onChange={e => setFSince(e.target.value)} />
            </div>
            <div className="field" style={{ flex: '1 1 180px', minWidth: 170 }}>
              <label>截止（本地时间）</label>
              <input className="input" type="datetime-local" value={fUntil} onChange={e => setFUntil(e.target.value)} />
            </div>
            <button className="btn" onClick={() => { setPage(0); loadList(0); }}>应用时间范围</button>
          </div>
        )}
        {chainChips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {chainChips.map((c, i) => (
              <span key={i} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-soft, rgba(120,140,255,0.12))', color: 'var(--accent-2)', fontFamily: 'monospace', fontSize: 11 }}>
                {c.label}
                <button onClick={() => { c.clear(); setPage(0); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'inline-flex' }}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            出错自动刷新（SSE）
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => loadList()} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /> 刷新</button>
          <button className="btn sm" onClick={() => doExport('json')}><Download size={13} /> JSON</button>
          <button className="btn sm" onClick={() => doExport('csv')}><Download size={13} /> CSV</button>
          <button className="btn sm" onClick={() => doExport('ndjson')}><Download size={13} /> NDJSON</button>
        </div>
      </div>

      {/* 日志列表 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, margin: 0, flex: 1 }}>日志列表 <span className="muted" style={{ fontSize: 13 }}>（共 {total} 条，第 {page + 1}/{Math.max(1, totalPages)} 页）</span></h2>
          <select className="select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
            {[30, 50, 100].map(n => <option key={n} value={n}>{n} 条/页</option>)}
          </select>
        </div>
        {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}>没有匹配的日志</div> : rows.map(r => (
          <LogRow key={r.id} r={r} onClick={() => setDetail(r)} />
        ))}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}><ChevronLeft size={14} /> 上一页</button>
            <span className="muted" style={{ fontSize: 13 }}>{page + 1} / {totalPages}</span>
            <button className="btn sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>下一页 <ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      <LogDetailModal row={detail} onClose={() => setDetail(null)} onDrill={drillDown} toast={toast} />
    </>
  );
}

/* ═══════════ 实时（live tail） ═══════════ */

function LivePanel({ toast }) {
  const [lines, setLines] = useState([]);
  const [paused, setPaused] = useState(false);
  const [minLevel, setMinLevel] = useState('debug');
  const [detail, setDetail] = useState(null);
  const [drillSeed, setDrillSeed] = useState(null);
  const pausedRef = useRef(false);
  const boxRef = useRef(null);
  pausedRef.current = paused;

  // 订阅：开面板即开 tail，每 4 分钟续订（服务端 10 分钟过期），关面板即退订。
  useEffect(() => {
    let alive = true;
    const enable = () => api('/admin/logs/tail', { method: 'POST', body: { enabled: true } }).catch(() => {});
    enable();
    const renew = setInterval(enable, 4 * 60_000);
    return () => {
      alive = false;
      clearInterval(renew);
      api('/admin/logs/tail', { method: 'POST', body: { enabled: false } }).catch(() => {});
    };
    /* eslint-disable-next-line */
  }, []);

  useRealtimeEvent('logline', (row) => {
    if (pausedRef.current || !row) return;
    setLines(ls => {
      const next = [...ls, row];
      return next.length > 400 ? next.slice(next.length - 400) : next;
    });
  });

  // 自动滚动到底
  useEffect(() => {
    if (!paused && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, paused]);

  const W = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
  const visible = lines.filter(l => (W[l.level] || 20) >= (W[minLevel] || 10));

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Radio size={15} style={{ color: paused ? 'var(--muted)' : 'var(--danger, #bb4b35)' }} /> 实时日志流
          </h2>
          <span className="muted" style={{ fontSize: 12 }}>全站新日志秒级直达（含访问日志）；离开本页自动断流</span>
          <div style={{ flex: 1 }} />
          <select className="select" value={minLevel} onChange={e => setMinLevel(e.target.value)} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
            {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABELS[lv]}+</option>)}
          </select>
          <button className="btn sm" onClick={() => setPaused(p => !p)}>
            {paused ? <><Play size={13} /> 继续</> : <><Pause size={13} /> 暂停</>}
          </button>
          <button className="btn sm" onClick={() => setLines([])}><Trash2 size={13} /> 清屏</button>
        </div>
        <div ref={boxRef} style={{
          marginTop: 12, height: 460, overflowY: 'auto', background: 'var(--bg-2)',
          borderRadius: 10, padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
        }}>
          {visible.length === 0 && <div className="muted" style={{ padding: 20, textAlign: 'center' }}>等待新日志…（试着在另一个标签页操作一下站点）</div>}
          {visible.map((l, i) => (
            <div key={l.id ? `${l.id}-${i}` : i} style={{ display: 'flex', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => setDetail(l)}>
              <span className="muted" style={{ flexShrink: 0 }}>{String(l.ts || '').slice(11)}</span>
              <span style={{ color: LEVEL_COLORS[l.level] || 'var(--muted)', flexShrink: 0, fontWeight: 700, width: 42 }}>{(l.level || '').toUpperCase().slice(0, 5)}</span>
              <span style={{ flexShrink: 0, color: 'var(--accent-2)' }}>[{l.category}]</span>
              <span style={{ flexShrink: 0 }}>{l.event}{l.dedup ? ' ×' : ''}</span>
              <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.message}{l.endpoint ? `  ${l.method} ${l.endpoint} ${l.status} ${l.duration_ms}ms` : ''}{l.user_id ? `  U${l.user_id}` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>缓冲 {lines.length}/400 条 · 点击任意一行看详情；「查看同请求链路」会跳到检索页</div>
      </div>
      <LogDetailModal row={detail} onClose={() => setDetail(null)} toast={toast}
        onDrill={(p) => { setDetail(null); setDrillSeed(p); }} />
      {drillSeed && <SearchJump seed={drillSeed} onDone={() => setDrillSeed(null)} />}
    </>
  );
}

// 从实时页跳到检索页：借助全局事件（父组件监听切子页）
function SearchJump({ seed, onDone }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('hy-logs-drill', { detail: seed }));
    onDone();
    /* eslint-disable-next-line */
  }, []);
  return null;
}

/* ═══════════ 链路 ═══════════ */

function TracePanel({ toast }) {
  const [mode, setMode] = useState('request'); // request | session
  const [key, setKey] = useState('');
  const [rows, setRows] = useState(null);
  const [detail, setDetail] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessUserId, setSessUserId] = useState('');
  const [loading, setLoading] = useState(false);

  const loadTrace = async (k = key, m = mode) => {
    const v = String(k || '').trim();
    if (!v) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ [m === 'request' ? 'request_id' : 'session_id']: v, sort: 'asc', limit: 500 });
      const d = await api('/admin/logs?' + p.toString());
      setRows(d.rows || []);
    } catch (e) { toast(e.message, 'err'); }
    finally { setLoading(false); }
  };
  const loadSessions = async () => {
    try {
      const p = new URLSearchParams({ limit: 20 });
      if (sessUserId.trim()) p.set('user_id', sessUserId.trim());
      const d = await api('/admin/logs/sessions?' + p.toString());
      setSessions(d.sessions || []);
    } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { loadSessions(); /* eslint-disable-next-line */ }, []);

  const t0 = rows?.length ? Date.parse(rows[0].ts.replace(' ', 'T') + 'Z') : 0;

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '0 1 130px' }}>
            <label>维度</label>
            <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="request">请求 ID</option>
              <option value="session">会话 ID</option>
            </select>
          </div>
          <div className="field" style={{ flex: '2 1 260px' }}>
            <label>{mode === 'request' ? 'request_id（响应头 X-Request-Id / 日志详情里可复制）' : 'session_id（客户端一次访问的全部足迹）'}</label>
            <input className="input" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadTrace()} placeholder={mode === 'request' ? 'req-…' : 'sess-…'} style={{ fontFamily: 'monospace' }} />
          </div>
          <button className="btn" onClick={() => loadTrace()} disabled={loading}><GitBranch size={14} /> 还原链路</button>
        </div>
      </div>

      {rows && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title"><h2 style={{ fontSize: 16, margin: 0 }}>链路瀑布 <span className="muted" style={{ fontSize: 13 }}>（{rows.length} 步，按时间正序）</span></h2></div>
          {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}>没有找到对应日志（可能已过保留期）</div> : (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rows.map((r, i) => {
                const dt = t0 ? Math.max(0, Date.parse(r.ts.replace(' ', 'T') + 'Z') - t0) : 0;
                return (
                  <div key={r.id} className="adm-row" style={{ cursor: 'pointer', padding: '6px 8px' }} onClick={() => setDetail(r)}>
                    <span className="muted" style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0, width: 64, textAlign: 'right' }}>+{(dt / 1000).toFixed(0)}s</span>
                    <span className="tag" style={{ background: 'var(--bg-2)', color: LEVEL_COLORS[r.level] || 'var(--muted)', flexShrink: 0, fontSize: 11, fontWeight: 600 }}>{LEVEL_LABELS[r.level] || r.level}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <b style={{ fontSize: 13 }}>{i + 1}. [{r.category}] {r.event}</b>
                      <div className="sub2" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.message}{r.endpoint ? ` · ${r.method} ${r.endpoint} → ${r.status} ${r.duration_ms}ms` : ''}
                      </div>
                    </div>
                    <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>{r.ts.slice(11)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>最近会话轨迹</h2>
          <span className="muted" style={{ fontSize: 12 }}>按 session_id 聚合的访问足迹，点击还原整段轨迹</span>
          <div style={{ flex: 1 }} />
          <input className="input" placeholder="按用户 ID 过滤" value={sessUserId} onChange={e => setSessUserId(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadSessions()} style={{ width: 140 }} />
          <button className="btn sm" onClick={loadSessions}><Search size={13} /> 查会话</button>
        </div>
        {sessions.length === 0 ? <div className="empty" style={{ padding: 18 }}>暂无带会话标识的日志</div> : sessions.map(s => (
          <div key={s.session_id} className="adm-row" style={{ cursor: 'pointer', padding: '6px 8px' }}
            onClick={() => { setMode('session'); setKey(s.session_id); loadTrace(s.session_id, 'session'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <span className="tag" style={{ background: 'var(--bg-2)', flexShrink: 0, fontFamily: 'monospace', fontSize: 11 }}>{s.session_id.slice(0, 18)}…</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{s.source === 'app' ? 'APP' : '网页'} 会话 · {s.n} 条{s.errors > 0 ? ` · ${s.errors} 错误` : ''}{s.user_id ? ` · U${s.user_id}` : ' · 未登录'}</b>
              <div className="sub2" style={{ fontSize: 12 }}>{s.first_ts} → {s.last_ts}</div>
            </div>
            {s.errors > 0 && <span className="tag" style={{ background: 'var(--danger-soft, rgba(187,75,53,0.12))', color: 'var(--danger, #bb4b35)', flexShrink: 0, fontSize: 11 }}>{s.errors} 错误</span>}
            <ChevronRight size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          </div>
        ))}
      </div>

      <LogDetailModal row={detail} onClose={() => setDetail(null)} toast={toast}
        onDrill={(p) => {
          setDetail(null);
          if (p.request_id) { setMode('request'); setKey(p.request_id); loadTrace(p.request_id, 'request'); }
          else if (p.session_id) { setMode('session'); setKey(p.session_id); loadTrace(p.session_id, 'session'); }
          else window.dispatchEvent(new CustomEvent('hy-logs-drill', { detail: p }));
        }} />
    </>
  );
}

/* ═══════════ 审计 ═══════════ */

function AuditPanel({ toast }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [fEvent, setFEvent] = useState('');
  const [detail, setDetail] = useState(null);
  const PAGE = 40;

  const load = async (p = page) => {
    try {
      const q = new URLSearchParams({ category: 'admin', limit: PAGE, offset: p * PAGE });
      if (fEvent) q.set('event', fEvent);
      const d = await api('/admin/logs?' + q.toString());
      setRows(d.rows || []); setTotal(d.total || 0);
    } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { load(page); /* eslint-disable-next-line */ }, [page, fEvent]);

  const totalPages = Math.ceil(total / PAGE);
  const EVENTS = ['', 'account_create', 'platform_config', 'mail_config', 'whitelist_add', 'whitelist_remove', 'whitelist_clear', 'code_create', 'code_delete', 'character_delete', 'script_delete', 'moment_delete', 'comment_delete', 'review_delete', 'logs_export', 'logs_retention', 'logs_alerts', 'logs_archive', 'purge_logs'];

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><Shield size={15} /> GM 操作审计</h2>
          <span className="muted" style={{ fontSize: 12 }}>全部 GM 敏感操作留痕（谁 · 何时 · 对谁 · 做了什么）；密钥类配置只记字段名</span>
          <div style={{ flex: 1 }} />
          <select className="select" value={fEvent} onChange={e => { setFEvent(e.target.value); setPage(0); }} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
            {EVENTS.map(ev => <option key={ev} value={ev}>{ev || '全部操作'}</option>)}
          </select>
          <button className="btn sm" onClick={() => load()}><RefreshCw size={13} /> 刷新</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}>暂无审计记录</div> : rows.map(r => (
            <div key={r.id} className="adm-row" style={{ cursor: 'pointer' }} onClick={() => setDetail(r)}>
              <span className="tag" style={{ background: 'var(--accent-soft, rgba(120,140,255,0.12))', color: 'var(--accent-2)', flexShrink: 0, fontSize: 11, fontFamily: 'monospace' }}>{r.event}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="sub2" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.message}</div>
              </div>
              <span className="muted" style={{ fontSize: 11, flexShrink: 0, textAlign: 'right' }}>操作者 U{r.user_id || '?'}<br />{r.ts}</span>
            </div>
          ))}
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}><ChevronLeft size={14} /> 上一页</button>
            <span className="muted" style={{ fontSize: 13 }}>{page + 1} / {totalPages}</span>
            <button className="btn sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>下一页 <ChevronRight size={14} /></button>
          </div>
        )}
      </div>
      <LogDetailModal row={detail} onClose={() => setDetail(null)} toast={toast}
        onDrill={(p) => { setDetail(null); window.dispatchEvent(new CustomEvent('hy-logs-drill', { detail: p })); }} />
    </>
  );
}

/* ═══════════ 设置 ═══════════ */

function AlertRuleEditor({ rules, setRules }) {
  const TYPE_LABELS = { error_burst: '错误风暴', slow_burst: '慢请求风暴', event_match: '事件监控' };
  const upd = (i, patch) => setRules(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const del = (i) => setRules(rs => rs.filter((_, j) => j !== i));
  const add = () => setRules(rs => [...rs, { name: '新规则', enabled: true, type: 'error_burst', threshold: 10, window_min: 5, cooldown_min: 15 }]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {rules.map((r, i) => (
        <div key={r.id || i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', padding: 10, background: 'var(--bg-2)', borderRadius: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', paddingBottom: 8 }}>
            <input type="checkbox" checked={!!r.enabled} onChange={e => upd(i, { enabled: e.target.checked })} /> 启用
          </label>
          <div className="field" style={{ flex: '1 1 110px', minWidth: 100 }}>
            <label>名称</label>
            <input className="input" value={r.name || ''} onChange={e => upd(i, { name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: '1 1 120px', minWidth: 110 }}>
            <label>类型</label>
            <select className="select" value={r.type} onChange={e => upd(i, { type: e.target.value })}>
              {Object.entries(TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {r.type === 'event_match' && (
            <>
              <div className="field" style={{ flex: '1 1 130px', minWidth: 120 }}>
                <label>事件名</label>
                <input className="input" value={r.event || ''} onChange={e => upd(i, { event: e.target.value })} placeholder="如 login_failed" />
              </div>
              <div className="field" style={{ flex: '0 1 100px', minWidth: 90 }}>
                <label>级别（可选）</label>
                <select className="select" value={r.level || ''} onChange={e => upd(i, { level: e.target.value || undefined })}>
                  <option value="">任意</option>
                  {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABELS[lv]}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="field" style={{ flex: '0 1 84px', minWidth: 76 }}>
            <label>阈值</label>
            <input className="input" type="number" min="1" value={r.threshold ?? ''} onChange={e => upd(i, { threshold: e.target.value })} />
          </div>
          <div className="field" style={{ flex: '0 1 84px', minWidth: 76 }}>
            <label>窗口(分)</label>
            <input className="input" type="number" min="1" value={r.window_min ?? ''} onChange={e => upd(i, { window_min: e.target.value })} />
          </div>
          <div className="field" style={{ flex: '0 1 84px', minWidth: 76 }}>
            <label>冷却(分)</label>
            <input className="input" type="number" min="1" value={r.cooldown_min ?? ''} onChange={e => upd(i, { cooldown_min: e.target.value })} />
          </div>
          <button className="btn sm ghost" onClick={() => del(i)} title="删除规则" style={{ marginBottom: 2 }}><Trash2 size={13} /></button>
        </div>
      ))}
      <div>
        <button className="btn sm" onClick={add}><Plus size={13} /> 添加规则</button>
        <span className="muted" style={{ fontSize: 11, marginLeft: 10 }}>最多 10 条；触发时站内通知全体 GM，各规则独立冷却</span>
      </div>
    </div>
  );
}

function SettingsPanel({ toast }) {
  const [retention, setRetention] = useState(null);
  const [rules, setRules] = useState(null);
  const [health, setHealth] = useState(null);
  const [archives, setArchives] = useState([]);
  const [saving, setSaving] = useState(false);
  const [purgeLevel, setPurgeLevel] = useState('');
  const [purgeDays, setPurgeDays] = useState('7');

  const load = async () => {
    const [r, a, h, ar] = await Promise.all([
      api('/admin/logs/retention').then(d => d.retention).catch(() => null),
      api('/admin/logs/alerts').then(d => d.rules).catch(() => null),
      api('/admin/logs/health').then(d => d.health).catch(() => null),
      api('/admin/logs/archives').then(d => d.archives).catch(() => []),
    ]);
    setRetention(r); setRules(a); setHealth(h); setArchives(ar);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const saveRetention = async () => {
    setSaving(true);
    try {
      const d = await api('/admin/logs/retention', { method: 'PUT', body: retention });
      setRetention(d.retention); toast('保留策略已保存');
    } catch (e) { toast(e.message, 'err'); }
    finally { setSaving(false); }
  };
  const saveRules = async () => {
    setSaving(true);
    try {
      const d = await api('/admin/logs/alerts', { method: 'PUT', body: { rules } });
      setRules(d.rules); toast('告警规则已保存');
    } catch (e) { toast(e.message, 'err'); }
    finally { setSaving(false); }
  };
  const doPurge = async (targeted) => {
    const hint = targeted
      ? `定向清理${purgeLevel ? `「${LEVEL_LABELS[purgeLevel]}」级别` : '全部级别'}早于 ${purgeDays} 天的日志？${retention?.archive ? '（已开启归档，清理前会先存档）' : ''}`
      : '按保留策略清理过期日志？';
    if (!confirm(hint)) return;
    try {
      const d = await api('/admin/logs/purge', { method: 'POST', body: targeted ? { level: purgeLevel || undefined, days: Number(purgeDays) } : {} });
      toast(`已清理 ${d.removed} 条日志`); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const doArchiveNow = async () => {
    try {
      const d = await api('/admin/logs/archives', { method: 'POST', body: { level: purgeLevel || undefined, days: Number(purgeDays) || 0 } });
      toast(d.count ? `已归档 ${d.count} 条 → ${d.file}` : '没有匹配的日志可归档');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const delArchive = async (file) => {
    if (!confirm(`删除归档文件 ${file}？`)) return;
    try { await api('/admin/logs/archives/' + encodeURIComponent(file), { method: 'DELETE' }); toast('已删除'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      {health && (
        <div className="card">
          <div className="section-title"><h2 style={{ fontSize: 16, margin: 0 }}><HeartPulse size={15} style={{ verticalAlign: -3, marginRight: 5 }} />健康自检</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 16px', fontSize: 13, marginTop: 10 }}>
            <div><span className="muted">日志行数：</span><b>{health.rows}</b>（事件 {health.events}）</div>
            <div><span className="muted">去重比：</span><b>{health.dedup_ratio}×</b></div>
            <div><span className="muted">近 1 小时摄入：</span><b>{health.ingest_last_hour}</b> 条</div>
            <div><span className="muted">实时流订阅：</span><b>{health.tail_subscribers}</b> 人</div>
            <div><span className="muted">最早日志：</span>{health.oldest_ts || '—'}</div>
            <div><span className="muted">最新日志：</span>{health.newest_ts || '—'}</div>
            <div><span className="muted">归档：</span>{health.archives.count} 个文件 · {fmtBytes(health.archives.bytes)}</div>
            <div><span className="muted">告警规则：</span>{health.alert_rules} 条</div>
          </div>
        </div>
      )}

      {retention && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title"><h2 style={{ fontSize: 16, margin: 0 }}><Settings2 size={15} style={{ verticalAlign: -3, marginRight: 5 }} />保留策略</h2></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
            {LEVELS.map(lv => (
              <div key={lv} className="field" style={{ flex: '1 1 90px', minWidth: 80 }}>
                <label style={{ color: LEVEL_COLORS[lv] }}>{LEVEL_LABELS[lv]}（天）</label>
                <input className="input" type="number" min="1" max="365" value={retention[lv] ?? ''}
                  onChange={e => setRetention(r => ({ ...r, [lv]: e.target.value }))} />
              </div>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', paddingBottom: 8 }}>
              <input type="checkbox" checked={!!retention.archive} onChange={e => setRetention(r => ({ ...r, archive: e.target.checked }))} />
              清理前归档（NDJSON.gz）
            </label>
            <button className="btn" onClick={saveRetention} disabled={saving}><Check size={14} /> 保存策略</button>
          </div>
        </div>
      )}

      {rules && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 16, margin: 0, flex: 1 }}><AlertTriangle size={15} style={{ verticalAlign: -3, marginRight: 5 }} />告警规则引擎</h2>
            <button className="btn sm" onClick={saveRules} disabled={saving}><Check size={13} /> 保存全部规则</button>
          </div>
          <AlertRuleEditor rules={rules} setRules={setRules} />
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title"><h2 style={{ fontSize: 16, margin: 0 }}><Trash2 size={15} style={{ verticalAlign: -3, marginRight: 5 }} />清理与归档</h2></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div className="field" style={{ flex: '1 1 110px', minWidth: 100 }}>
            <label>级别</label>
            <select className="select" value={purgeLevel} onChange={e => setPurgeLevel(e.target.value)}>
              <option value="">全部级别</option>
              {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABELS[lv]}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 130px', minWidth: 110 }}>
            <label>早于（天，0=全部）</label>
            <input className="input" type="number" min="0" max="365" value={purgeDays} onChange={e => setPurgeDays(e.target.value)} />
          </div>
          <button className="btn" onClick={doArchiveNow}><Archive size={14} /> 立即归档（不删除）</button>
          <button className="btn" onClick={() => doPurge(true)}><Trash2 size={14} /> 定向清理</button>
          <button className="btn ghost" onClick={() => doPurge(false)}><Trash2 size={14} /> 按保留策略清理</button>
        </div>
        {archives.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <b style={{ fontSize: 13 }}>归档文件（{archives.length}）</b>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {archives.map(a => (
                <div key={a.file} className="adm-row" style={{ padding: '6px 8px' }}>
                  <Archive size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 12, fontFamily: 'monospace' }}>{a.file}</b>
                    <div className="sub2" style={{ fontSize: 11 }}>{fmtBytes(a.bytes)} · {a.mtime.slice(0, 19).replace('T', ' ')}</div>
                  </div>
                  <button className="btn sm" onClick={() => authDownload('/admin/logs/archives/' + encodeURIComponent(a.file), a.file, toast)}><Download size={13} /></button>
                  <button className="btn sm ghost" onClick={() => delArchive(a.file)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ═══════════ 父容器：子页导航 ═══════════ */

export default function LogsTab({ toast }) {
  const [sub, setSub] = useState('overview');
  const [seed, setSeed] = useState(null);
  const [livePulse, setLivePulse] = useState(0);

  // 任意子页发起的「跳到检索并过滤」
  useEffect(() => {
    const h = (e) => { setSeed({ ...e.detail, _ts: Date.now() }); setSub('search'); };
    window.addEventListener('hy-logs-drill', h);
    return () => window.removeEventListener('hy-logs-drill', h);
  }, []);

  const drill = (params) => { setSeed({ ...params, _ts: Date.now() }); setSub('search'); };

  useRealtimeEvent('audit', () => setLivePulse(p => p + 1));
  useRealtimeEvent('audit_alert', (data) => {
    toast(`⚠️ 日志告警「${data?.rule_name || ''}」：${data?.window_min ?? '?'} 分钟内 ${data?.total ?? '?'} 条（阈值 ${data?.threshold ?? '?'}）`, 'err');
  });

  const SUBS = [
    ['overview', '总览', Activity],
    ['search', '检索', Search],
    ['live', '实时', Radio],
    ['trace', '链路', GitBranch],
    ['audit', '审计', Shield],
    ['settings', '设置', Settings2],
  ];

  return (
    <>
      <div className="tabs-bar" style={{ marginBottom: 14 }}>
        {SUBS.map(([k, l, Ic]) => (
          <button key={k} className={sub === k ? 'active' : ''} onClick={() => setSub(k)}>
            <Ic size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{l}
            {k === 'overview' && livePulse > 0 && sub !== 'overview' ? ` (+${livePulse})` : ''}
          </button>
        ))}
      </div>
      {sub === 'overview' && <OverviewPanel toast={toast} onDrill={drill} livePulse={livePulse} />}
      {sub === 'search' && <SearchPanel toast={toast} seed={seed} />}
      {sub === 'live' && <LivePanel toast={toast} />}
      {sub === 'trace' && <TracePanel toast={toast} />}
      {sub === 'audit' && <AuditPanel toast={toast} />}
      {sub === 'settings' && <SettingsPanel toast={toast} />}
    </>
  );
}
