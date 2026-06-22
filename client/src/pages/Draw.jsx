import React, { useEffect, useRef, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import { STYLE_PRESETS, SIZE_OPTS, composePrompt, generateImage, downloadImage } from '../imagegen.js';
import { Sparkles, Coins, Wand2, Download, Trash2, Copy, ImageIcon, Crown, Info, X } from 'lucide-react';

// AI 绘图 — text-to-image studio. The image API is configured by GM in the admin
// console; each generation costs gold (VIP discount), shown transparently up-front.
export default function Draw() {
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('none');
  const [size, setSize] = useState('1024x1024');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [fee, setFee] = useState(null);
  const [ready, setReady] = useState(true);
  const [discount, setDiscount] = useState(1);
  const [viewing, setViewing] = useState(null);
  const stageRef = useRef(null);

  const load = () => api('/ai/images').then(d => { setHistory(d.images || []); setFee(d.fee); setReady(d.ready); })
    .catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); api('/settings').then(d => setDiscount(d.settings?.image_fee?.discount ?? 1)).catch(() => {}); /* eslint-disable-next-line */ }, []);

  const canAfford = fee == null || (user?.gold ?? 0) >= fee;

  const generate = async () => {
    const p = prompt.trim();
    if (!p) { toast('请先输入画面描述', 'err'); return; }
    if (!ready) { toast('平台 AI 生图服务尚未开启', 'err'); return; }
    if (!canAfford) { toast(`金币不足，本次需 ${fee} 金币`, 'err'); return; }
    setBusy(true); setResult(null);
    try {
      const d = await generateImage({ prompt: composePrompt(p, style), size });
      setResult(d);
      await refreshUser();
      load();
      toast(`生成成功 · 消耗 ${d.fee} 金币`);
      setTimeout(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const del = async (id) => {
    try { await api('/ai/images/' + id, { method: 'DELETE' }); setHistory(h => h.filter(x => x.id !== id)); if (viewing?.id === id) setViewing(null); }
    catch (e) { toast(e.message, 'err'); }
  };
  const reuse = (h) => { setPrompt(h.prompt); setSize(SIZE_OPTS.some(s => s.id === h.size) ? h.size : '1024x1024'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1><Wand2 size={20} style={{ verticalAlign: -3, marginRight: 7, color: 'var(--accent)' }} />AI 绘图</h1>
          <div className="sub">用文字描绘画面，让 AI 为你的故事绘制插画</div>
        </div>
        <span className="draw-cost-badge" title="每张生成的费用（已含会员折扣）">
          <Coins size={15} /> 每张 {fee ?? '—'} 金币{discount < 1 && <span className="draw-vip"><Crown size={11} /> {Math.round(discount * 10)}折</span>}
        </span>
      </div>

      <div className="page draw-page">
        {!ready && (
          <div className="ann-banner" style={{ cursor: 'default' }}>
            <span className="ann-ic"><Info size={19} /></span>
            <div className="ann-tx"><b>AI 生图服务尚未开启</b><p>管理员可在「GM 控制台 → 平台AI → AI 生图」中配置生图 API 后即可使用。</p></div>
          </div>
        )}

        <div className="draw-grid">
          <div className="card draw-panel">
            <div className="field">
              <label>画面描述 (Prompt)</label>
              <textarea className="textarea" rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={1500}
                placeholder="例如：黄昏下的古城墙，一位白衣剑客负手而立，远山如黛，飞鸟掠过晚霞……" style={{ resize: 'vertical', lineHeight: 1.6 }} />
              <div className="hint">{prompt.length}/1500 · 描述越具体（主体、环境、光线、氛围、镜头），出图越精准。</div>
            </div>

            <div className="field">
              <label>风格</label>
              <div className="chip-wrap">
                {STYLE_PRESETS.map(sp => (
                  <button key={sp.id} type="button" className={'draw-chip' + (style === sp.id ? ' on' : '')} onClick={() => setStyle(sp.id)}>{sp.name}</button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>画幅</label>
              <div className="seg seg-3">
                {SIZE_OPTS.map(so => (
                  <button key={so.id} type="button" className={size === so.id ? 'active' : ''} onClick={() => setSize(so.id)}>{so.name} · {so.ratio}</button>
                ))}
              </div>
            </div>

            <div className="draw-actions">
              <div className="draw-balance">
                余额 <b><Coins size={13} style={{ verticalAlign: -2 }} /> {user?.gold ?? 0}</b>
                {!canAfford && <span className="draw-warn">金币不足</span>}
              </div>
              <button className="btn primary draw-go" onClick={generate} disabled={busy || !prompt.trim() || !ready || !canAfford}>
                {busy ? <><span className="draw-spin" /> 绘制中…</> : <><Sparkles size={16} /> 生成 · {fee ?? '—'} 金币</>}
              </button>
            </div>
          </div>

          <div className="card draw-stage" ref={stageRef}>
            {busy ? (
              <div className="draw-stage-empty"><div className="draw-loader"><Wand2 size={30} /></div><p>正在为你绘制，请稍候…</p></div>
            ) : result ? (
              <div className="draw-result">
                <div className="draw-result-img" onClick={() => setViewing({ url: result.image, prompt: result.prompt, size: result.size, id: result.id })}>
                  <img src={result.image} alt={result.prompt} />
                </div>
                <div className="draw-result-bar">
                  <button className="btn sm" onClick={() => downloadImage(result.image)}><Download size={14} /> 下载</button>
                  <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(result.prompt); toast('已复制提示词'); }}><Copy size={14} /> 复制提示词</button>
                  <button className="btn sm primary" onClick={generate} disabled={!canAfford}><Sparkles size={14} /> 再画一张</button>
                </div>
              </div>
            ) : (
              <div className="draw-stage-empty"><div className="draw-ph"><ImageIcon size={34} /></div><p>在左侧描述画面，点击「生成」即可看到作品</p></div>
            )}
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 30 }}><h2><ImageIcon size={16} style={{ verticalAlign: -3, marginRight: 6 }} />我的绘廊</h2></div>
        {history.length === 0 ? (
          <div className="empty" style={{ padding: 36 }}><div className="big"><Wand2 size={40} /></div>还没有作品，去生成你的第一张插画吧</div>
        ) : (
          <div className="draw-gallery">
            {history.map(h => (
              <figure key={h.id} className="draw-tile" onClick={() => setViewing(h)}>
                <img src={h.url} alt={h.prompt} loading="lazy" />
                <figcaption>{h.prompt}</figcaption>
                <div className="draw-tile-acts" onClick={e => e.stopPropagation()}>
                  <button title="下载" onClick={() => downloadImage(h.url)}><Download size={14} /></button>
                  <button title="再次使用提示词" onClick={() => reuse(h)}><Copy size={14} /></button>
                  <button title="删除" onClick={() => del(h.id)}><Trash2 size={14} /></button>
                </div>
              </figure>
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <Modal onClose={() => setViewing(null)}>
          <button className="modal-x" onClick={() => setViewing(null)} aria-label="关闭"><X size={18} /></button>
          <img src={viewing.url} alt={viewing.prompt} style={{ width: '100%', borderRadius: 12, display: 'block' }} />
          <p className="muted" style={{ fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>{viewing.prompt}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn sm" onClick={() => downloadImage(viewing.url)}><Download size={14} /> 下载</button>
            <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(viewing.prompt); toast('已复制提示词'); }}><Copy size={14} /> 复制提示词</button>
            {viewing.id && <button className="btn sm danger" style={{ marginLeft: 'auto' }} onClick={() => del(viewing.id)}><Trash2 size={14} /> 删除</button>}
          </div>
        </Modal>
      )}
    </>
  );
}
