import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { uploadFile, assetUrl } from './api.jsx';
import { UploadCloud, UserRound, CheckCircle2, AlertTriangle, Info, Scale, BadgeCheck, ShieldCheck, Crown } from 'lucide-react';
import { FACE_PRESETS, ANIME_PRESETS, ONLINE_AV } from './faces.js';

const STATIC_IMG = 'image/png,image/jpeg,image/webp,image/avif';
const DYNAMIC = 'image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm';

const ToastCtx = createContext(null);
const TOAST_IC = { ok: CheckCircle2, err: AlertTriangle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((msg, type = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => {
          const Ic = TOAST_IC[t.type] || TOAST_IC.ok;
          return (
            <div key={t.id} className={'toast toast-' + (t.type === 'err' ? 'err' : t.type === 'info' ? 'info' : 'ok')}>
              <span className="toast-ic"><Ic size={17} /></span>
              <span className="toast-msg">{t.msg}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Reusable media uploader.
//  - dynamic={true}  → allows image (incl. GIF) and short video  (chat backgrounds)
//  - dynamic={false} → static image only — no GIF/video           (avatars, covers)
export function Uploader({ value, type = 'image', onChange, variant = 'box', dynamic = false, label = '点击上传' }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!dynamic && (file.type === 'image/gif' || file.type.startsWith('video'))) {
      toast('此处仅支持静态图片（PNG / JPG / WebP）', 'err');
      e.target.value = ''; return;
    }
    setBusy(true);
    try {
      const d = await uploadFile(file);
      onChange(d.url, d.type);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  const isVideo = type === 'video' || /\.(mp4|webm|ogg)$/i.test(value || '');

  return (
    <div className={'uploader ' + (variant === 'avatar' ? 'avatar-up' : '')} onClick={() => ref.current.click()}>
      <input ref={ref} type="file" accept={dynamic ? DYNAMIC : STATIC_IMG} hidden onChange={pick} />
      {busy ? <div className="muted">上传中…</div> : value ? (
        isVideo
          ? <video className="preview" src={assetUrl(value)} muted loop autoPlay playsInline />
          : <img className="preview" src={assetUrl(value)} alt="" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
          <UploadCloud size={22} /><span style={{ fontSize: 13 }}>{label}</span>
        </div>
      )}
    </div>
  );
}

// Tiered creator verification badge (V).
//  bronze 铜V 创作者 · yellow 黄V 知名创作者 · gold 金V 殿堂创作者(top1)
const CREATOR_V = {
  bronze: { label: '创作者认证', cls: 'cv-bronze' },
  yellow: { label: '知名创作者', cls: 'cv-yellow' },
  gold: { label: '殿堂创作者 · TOP 1', cls: 'cv-gold' },
};
export function CreatorV({ tier, size = 15 }) {
  const info = CREATOR_V[tier];
  if (!info) return null;
  return (
    <span className={'creator-v ' + info.cls} title={info.label} style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}>V</span>
  );
}

// Refined councilor (议员) insignia — navy & gold with a scales-of-justice glyph.
export function CouncilorBadge({ size = 13 }) {
  return (
    <span className="council-badge" title="幻域议会议员">
      <Scale size={Math.round(size * 0.82)} /> 议员
    </span>
  );
}

// Unified identity chip row for profiles — every badge shares one chip shape and
// size so the header reads as a tidy, deliberate set rather than a jumble. Order
// is fixed (官方 → 管理 → 议员 → 创作者 → 会员) and official accounts never show a
// creator chip (creator_tier is already nulled server-side for official users).
const CREATOR_CHIP = {
  bronze: { label: '创作者认证', cls: 'idb-cv-bronze' },
  yellow: { label: '知名创作者', cls: 'idb-cv-yellow' },
  gold: { label: '殿堂创作者', cls: 'idb-cv-gold' },
};
export function IdentityBadges({ u, className = '' }) {
  if (!u) return null;
  const tier = !u.official ? CREATOR_CHIP[u.creator_tier] : null;
  const chips = [];
  if (u.verified || u.official) chips.push(
    <span key="official" className="idb idb-official" title={u.verified_note || '官方认证'}>
      <BadgeCheck size={13} /> {u.verified_note || (u.official ? '官方账号' : '官方认证')}
    </span>);
  if (u.is_gm) chips.push(<span key="gm" className="idb idb-gm"><ShieldCheck size={13} /> 超级管理员</span>);
  if (u.is_councilor) chips.push(<span key="council" className="idb idb-council"><Scale size={12} /> 议员</span>);
  if (tier) chips.push(<span key="cv" className={'idb ' + tier.cls}><span className="idb-v">V</span> {tier.label}</span>);
  if (u.svip) chips.push(<span key="svip" className="idb idb-svip">SVIP</span>);
  else if (u.vip) chips.push(<span key="vip" className="idb idb-vip"><Crown size={12} /> VIP</span>);
  if (!chips.length) return null;
  return <div className={'idb-row ' + className}>{chips}</div>;
}

// 无图头像回退：有光泽的单字头像位（「白+青」重设计打磨）。
// 渐变底（每角色按名字取一组同色系）+ 内高光/底压暗 + 居中衬线单字，替代扁平色块。
const AV_GRADS = [
  ['#43DBC9', '#0A8C93'], // teal
  ['#F2BAD1', '#8A5A9E'], // rose→purple
  ['#F7D9A2', '#C98A3F'], // gold
  ['#B3C8F5', '#4A5F9E'], // blue
  ['#A6EDE2', '#3C8F6B'], // green
  ['#D7C3F5', '#6A4A9E'], // violet
  ['#FBC7A4', '#C56A3C'], // amber
];
export function Avatar({ src, name = '', size = 40, eager }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (src) return <img className="avatar" src={assetUrl(src)} style={{ width: size, height: size }} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />;
  const [a, b] = AV_GRADS[(name || '?').charCodeAt(0) % AV_GRADS.length];
  return (
    <div className="avatar avatar-mono" style={{
      width: size, height: size, display: 'grid', placeItems: 'center',
      fontSize: size * 0.44, fontWeight: 600, color: 'rgba(255,255,255,0.95)',
      fontFamily: "'Noto Serif SC', var(--serif)", textShadow: '0 1px 3px rgba(0,0,0,0.22)',
      background: `linear-gradient(140deg, ${a}, ${b})`,
      boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.5), inset 0 -7px 13px rgba(0,0,0,0.17)'
    }}>{initial}</div>
  );
}

// Shimmer skeleton grid shown while card lists load.
// Smoothly counts a number up to `value` on mount/update — adds tactile heft to stats.
export function CountUp({ value, dur = 900, format = true }) {
  const [n, setN] = useState(0);
  const raf = useRef();
  const prev = useRef(0);
  useEffect(() => {
    const to = Number(value) || 0; const from = prev.current;
    if (to === from) { setN(to); return; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(to); prev.current = to; return; }
    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setN(Math.round(from + (to - from) * e));
      if (p < 1) raf.current = requestAnimationFrame(tick); else prev.current = to;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, dur]);
  return <>{format ? n.toLocaleString() : n}</>;
}

export function GridSkeleton({ n = 8 }) {
  return (
    <div className="grid">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skel-card">
          <div className="skel sk-cover" />
          <div className="sk-body">
            <div className="skel sk-line" style={{ width: '70%', height: 14 }} />
            <div className="skel sk-line" style={{ width: '100%' }} />
            <div className="skel sk-line" style={{ width: '85%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Avatar chooser — pick a realistic human-face preset (男/女) or upload your own.
export function AvatarPicker({ value, onChange, size = 112 }) {
  const [open, setOpen] = useState(false);
  const [g, setG] = useState('f');
  const list = g === 'a' ? ANIME_PRESETS : FACE_PRESETS.filter(p => p.gender === g);
  return (
    <>
      <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
        <div className="avatar-pick" style={{ width: size, height: size }} onClick={() => setOpen(true)} title="选择或上传头像">
          {value ? <img src={assetUrl(value)} alt="" /> : <UserRound size={size * 0.4} />}
          <span className="avatar-pick-edit">更换</span>
        </div>
      </div>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 style={{ marginTop: 0 }}>选择头像</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>从真人风格脸模预设中挑选，或上传自定义图片。</p>
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={g === 'f' ? 'active' : ''} onClick={() => setG('f')}>女生脸模</button>
            <button className={g === 'm' ? 'active' : ''} onClick={() => setG('m')}>男生脸模</button>
            <button className={g === 'a' ? 'active' : ''} onClick={() => setG('a')}>二次元</button>
          </div>
          <div className="face-grid">
            {list.map(p => (
              <button key={p.id} className={'face-opt' + (value === p.url ? ' on' : '')} onClick={() => { onChange(p.url); setOpen(false); }}>
                <img src={p.url} alt="" />
              </button>
            ))}
          </div>
          {g === 'a' && (
            <>
              <div className="muted" style={{ fontSize: 12, margin: '12px 0 6px' }}>在线二次元头像 · 实时随机（来自开源社区图接口，每次不同）</div>
              <div className="face-grid">
                {ONLINE_AV.map(p => (
                  <button key={p.name} className={'face-opt' + (value === p.url ? ' on' : '')} title={p.name} onClick={() => { onChange(p.url); setOpen(false); }}>
                    <img src={p.url} alt={p.name} loading="lazy" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
            <div style={{ width: 88 }}>
              <Uploader variant="avatar" value={value} onChange={(url) => { onChange(url); }} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, flex: 1 }}>也可上传自定义图片（点击左侧圆形）。上传后点击右上角关闭即可。</div>
          </div>
          <button className="btn block" style={{ marginTop: 14 }} onClick={() => setOpen(false)}>完成</button>
        </Modal>
      )}
    </>
  );
}

export function Modal({ children, onClose }) {
  // ESC 关闭 + 无障碍语义：桌面端用户习惯按 ESC 关闭弹窗，并补充 dialog 角色供读屏识别。
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// 金币：浮雕星纹玻璃币（「白+青」重设计货币纹样）。
// viewBox 40×40，外层 drop-shadow 增浮雕感；星芸暗刻仅 ≥20px 显示（小尺寸省略更干净）。
// 接口与 lucide 图标一致（size/className/style），全站货币点复用。
export function CoinIcon({ size = 16, className, style, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}
      style={{ filter: 'drop-shadow(0 2px 3px rgba(110,72,10,.42))', ...style }} aria-hidden="true" {...p}>
      <defs>
        <radialGradient id="hyCoinFace" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#FFF7D6" />
          <stop offset="46%" stopColor="#F4CE71" />
          <stop offset="100%" stopColor="#CE9636" />
        </radialGradient>
        <linearGradient id="hyCoinRim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F9E4A0" />
          <stop offset="52%" stopColor="#E0AC4C" />
          <stop offset="100%" stopColor="#B57F28" />
        </linearGradient>
      </defs>
      {/* 外圈 + 币面 */}
      <circle cx="20" cy="20" r="19" fill="url(#hyCoinRim)" />
      <circle cx="20" cy="20" r="14.4" fill="url(#hyCoinFace)" stroke="#B8842A" strokeWidth="0.7" />
      {/* 星芸暗刻（仅较大尺寸） */}
      {size >= 20 && (
        <path d="M20 11.6l2.5 5.2 5.7.5-4.3 3.8 1.3 5.6L20 23.8l-5.2 2.9 1.3-5.6-4.3-3.8 5.7-.5z"
          fill="#C0871F" opacity="0.5" />
      )}
      {/* 高光弧 */}
      <ellipse cx="14.6" cy="13.4" rx="4.4" ry="2.5" fill="#FFF8DC" opacity="0.72" transform="rotate(-30 14.6 13.4)" />
    </svg>
  );
}

// 钻石：切面宝石（「白+青」重设计货币纹样）。
// viewBox 40×40，冠/亭多切面 + 桌面高光；外层 drop-shadow 增折射立体感。替代 lucide 的 Gem。
export function DiamondIcon({ size = 16, className, style, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}
      style={{ filter: 'drop-shadow(0 2px 3px rgba(18,104,124,.4))', ...style }} aria-hidden="true" {...p}>
      <defs>
        <linearGradient id="hyGemTop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ECFCFF" />
          <stop offset="100%" stopColor="#A2E6F3" />
        </linearGradient>
        <linearGradient id="hyGemBtm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#69CDE3" />
          <stop offset="100%" stopColor="#268BAD" />
        </linearGradient>
      </defs>
      {/* 冠部 */}
      <polygon points="7,15 33,15 20,6" fill="#CFF6FF" />
      <polygon points="7,15 20,6 20,15" fill="#AFE8FA" />
      {/* 桌面 + 亭部多切面 */}
      <polygon points="7,15 33,15 27,21 13,21" fill="url(#hyGemTop)" />
      <polygon points="7,15 13,21 20,35" fill="url(#hyGemBtm)" />
      <polygon points="33,15 27,21 20,35" fill="#3AA0BE" />
      <polygon points="13,21 27,21 20,35" fill="#54B8D4" />
      {/* 桌面高光 */}
      <polygon points="9,15 14,15 12,18.5" fill="#fff" opacity="0.7" />
    </svg>
  );
}
