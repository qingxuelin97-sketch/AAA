import React, { useEffect, useState } from 'react';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useToast, Modal, CoinIcon } from '../ui.jsx';
import { STYLE_PRESETS, SIZE_OPTS, composePrompt, generateImage, downloadImage } from '../imagegen.js';
import { Sparkles, Download, X, Wand2, Crown } from 'lucide-react';

// Compact text-to-image modal used inside chat to illustrate the current scene.
// Shares the same billed platform endpoint as the AI 绘图 page.
export default function IllustrateModal({ initialPrompt = '', onClose }) {
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [style, setStyle] = useState('anime');
  const [size, setSize] = useState('1024x1024');
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState(null);
  const [fee, setFee] = useState(null);
  const [ready, setReady] = useState(true);
  const [discount, setDiscount] = useState(1);

  useEffect(() => { api('/ai/images').then(d => { setFee(d.fee); setReady(d.ready); }).catch(() => {});
    api('/settings').then(d => setDiscount(d.settings?.image_fee?.discount ?? 1)).catch(() => {}); }, []);

  const canAfford = fee == null || (user?.gold ?? 0) >= fee;
  const go = async () => {
    if (!prompt.trim()) { toast('请先描述要画的画面', 'err'); return; }
    if (!ready) { toast('平台 AI 生图服务尚未开启', 'err'); return; }
    setBusy(true); setImg(null);
    try {
      const d = await generateImage({ prompt: composePrompt(prompt, style), size });
      setImg(d.image); await refreshUser();
      toast(`插图生成成功 · 消耗 ${d.fee} 金币`);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose}>
      <button className="modal-x" onClick={onClose} aria-label="关闭"><X size={18} /></button>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}><Wand2 size={17} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--accent)' }} />生成场景插图</h2>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        为当前剧情绘制一张插画 · 每张 <b><CoinIcon size={12} style={{ verticalAlign: -2 }} /> {fee ?? '—'} 金币</b>
        {discount < 1 && <span className="draw-vip" style={{ marginLeft: 6 }}><Crown size={11} /> {Math.round(discount * 10)}折</span>}
        ｜ 余额 {user?.gold ?? 0}
      </p>
      {!ready && <div className="hint" style={{ marginBottom: 8 }}>平台尚未开启 AI 生图服务，请联系管理员配置。</div>}
      <div className="field">
        <textarea className="textarea" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={1500}
          placeholder="描述这一幕的画面…" style={{ resize: 'vertical', lineHeight: 1.6 }} />
      </div>
      <div className="chip-wrap" style={{ marginBottom: 10 }}>
        {STYLE_PRESETS.filter(s => s.id !== 'none').map(sp => (
          <button key={sp.id} type="button" className={'draw-chip' + (style === sp.id ? ' on' : '')} onClick={() => setStyle(sp.id)}>{sp.name}</button>
        ))}
      </div>
      <div className="seg seg-3" style={{ marginBottom: 12 }}>
        {SIZE_OPTS.map(so => <button key={so.id} type="button" className={size === so.id ? 'active' : ''} onClick={() => setSize(so.id)}>{so.name}</button>)}
      </div>
      {busy && <div className="draw-stage-empty" style={{ minHeight: 140 }}><div className="draw-loader"><Wand2 size={26} /></div><p>绘制中…</p></div>}
      {img && !busy && (
        <div className="draw-result" style={{ marginBottom: 12 }}>
          <div className="draw-result-img"><img src={assetUrl(img)} alt={prompt} /></div>
          <div className="draw-result-bar"><button className="btn sm" onClick={() => downloadImage(img)}><Download size={14} /> 下载</button></div>
        </div>
      )}
      <button className="btn primary block" onClick={go} disabled={busy || !prompt.trim() || !ready || !canAfford}>
        {busy ? '绘制中…' : <><Sparkles size={15} /> {img ? '再画一张' : '生成插图'} · {fee ?? '—'} 金币</>}
      </button>
      {!canAfford && <div className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>金币不足，去钱包签到 / 兑换可获取金币。</div>}
    </Modal>
  );
}
