import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { uploadFile } from './api.jsx';
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
          ? <video className="preview" src={value} muted loop autoPlay playsInline />
          : <img className="preview" src={value} alt="" />
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

// 统一徽章/标签（设计系统）：new / rec 推荐 / online 在线 / offline 离线 / star 星夜同行。
const BADGE = {
  new: { cls: 'bdg-new', label: 'NEW' },
  rec: { cls: 'bdg-rec', label: '推荐' },
  online: { cls: 'bdg-online', label: '在线' },
  offline: { cls: 'bdg-offline', label: '离线' },
  star: { cls: 'bdg-star', label: '星夜同行' },
};
export function Badge({ kind = 'rec', children, dot = false }) {
  const b = BADGE[kind] || BADGE.rec;
  return <span className={'bdg ' + b.cls}>{dot && <i className="bdg-dot" />}{children || b.label}</span>;
}

export function Avatar({ src, name = '', size = 40, eager }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (src) return <img className="avatar" src={src} style={{ width: size, height: size }} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />;
  return (
    <div className="avatar" style={{
      width: size, height: size, display: 'grid', placeItems: 'center',
      fontSize: size * 0.42, fontWeight: 700, color: '#fff',
      background: 'linear-gradient(135deg, var(--accent), var(--accent-2))'
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
          {value ? <img src={value} alt="" /> : <UserRound size={size * 0.4} />}
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

// 自定义金币图标：硬币齿纹 + 双层高光 + 精致 ¥ + 金色径向渐变。
// 替代 lucide 朴素的 Coins，让货币一眼有质感。接口与 lucide 图标一致（size/className/style）。
export function CoinIcon({ size = 16, className, style, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true" {...p}>
      <defs>
        <radialGradient id="hyCoinG" cx="34%" cy="26%" r="82%">
          <stop offset="0%" stopColor="#fff6cc" />
          <stop offset="38%" stopColor="#f3c958" />
          <stop offset="74%" stopColor="#c98f25" />
          <stop offset="100%" stopColor="#8a5912" />
        </radialGradient>
        <radialGradient id="hyCoinRim" cx="50%" cy="50%" r="50%">
          <stop offset="86%" stopColor="#a9791f" stopOpacity="0" />
          <stop offset="100%" stopColor="#5b3d0a" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      {/* 硬币主体 */}
      <circle cx="12" cy="12" r="9.3" fill="url(#hyCoinG)" />
      <circle cx="12" cy="12" r="9.3" fill="url(#hyCoinRim)" />
      <circle cx="12" cy="12" r="9.3" fill="none" stroke="#5b3d0a" strokeWidth="1" />
      {/* 边缘齿纹（硬币纹路质感） */}
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="#6e4a0e" strokeWidth="1.3" strokeDasharray="0.55 0.85" opacity="0.55" />
      {/* 内圈装饰 */}
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="#6e4a0e" strokeWidth="0.6" opacity="0.4" />
      {/* ¥ 符号 */}
      <path d="M8.4 7.4 L12 11.5 L15.6 7.4" stroke="#4f3408" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11.5 V16.8" stroke="#4f3408" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 12.8 H15" stroke="#4f3408" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.5 14.6 H14.5" stroke="#4f3408" strokeWidth="1.3" strokeLinecap="round" />
      {/* 左上主高光 */}
      <path d="M6.4 6.2 a6 6 0 0 1 3.2-1.7" stroke="#fffbe6" strokeWidth="1.3" strokeLinecap="round" opacity="0.85" />
      {/* 顶部光点 */}
      <circle cx="9.2" cy="6.4" r="0.9" fill="#fffbe6" opacity="0.8" />
      {/* 右下反射 */}
      <path d="M16.5 17.2 a6 6 0 0 1-3 1.6" stroke="#fff1c0" strokeWidth="0.9" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

// 自定义钻石图标：明亮式切割 + 多切面折射明暗 + 腰围 + 桌面高光 + 星芒闪烁。
// 替代 lucide 的 Gem，呈现真实宝石立体感。星芒 .dia-sparkle 由 CSS 驱动闪烁。
export function DiamondIcon({ size = 16, className, style, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true" {...p}>
      <defs>
        <linearGradient id="hyDiaCrown" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#eafaff" />
          <stop offset="100%" stopColor="#9fdcec" />
        </linearGradient>
        <linearGradient id="hyDiaCrownR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe6f2" />
          <stop offset="100%" stopColor="#6cc0d8" />
        </linearGradient>
        <linearGradient id="hyDiaPav" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fcfe2" />
          <stop offset="100%" stopColor="#2c6f81" />
        </linearGradient>
        <linearGradient id="hyDiaPavR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5fb6cf" />
          <stop offset="100%" stopColor="#1d5566" />
        </linearGradient>
      </defs>
      {/* 冠部（上）左半 —— 亮 */}
      <path d="M8.6 4 L12 4 L12 9 L4.5 9 Z" fill="url(#hyDiaCrown)" />
      {/* 冠部右半 —— 稍暗，体现折光 */}
      <path d="M12 4 L15.4 4 L19.5 9 L12 9 Z" fill="url(#hyDiaCrownR)" />
      {/* 亭部（下）左半 */}
      <path d="M4.5 9 L12 9 L12 20 Z" fill="url(#hyDiaPav)" />
      {/* 亭部右半 —— 更深 */}
      <path d="M12 9 L19.5 9 L12 20 Z" fill="url(#hyDiaPavR)" />
      {/* 外轮廓 */}
      <path d="M8.6 4 H15.4 L19.5 9 L12 20 L4.5 9 Z" fill="none" stroke="#0f3d4d" strokeWidth="0.95" strokeLinejoin="round" />
      {/* 腰围线（最宽处，略粗） */}
      <path d="M4.5 9 H19.5" stroke="#0f3d4d" strokeWidth="1.1" strokeLinecap="round" />
      {/* 切面线 */}
      <path d="M8.6 4 L4.5 9 M15.4 4 L19.5 9 M4.5 9 L12 20 M19.5 9 L12 20 M12 4 V20" stroke="#0f3d4d" strokeWidth="0.5" opacity="0.45" />
      {/* 桌面高光（顶部白条） */}
      <path d="M9.1 4.6 H14.9" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0.85" />
      {/* 左上切面高光 */}
      <path d="M8.6 4 L7 6.4" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
      {/* 星芒（闪烁，由 .dia-sparkle CSS 驱动） */}
      <path className="dia-sparkle" d="M10.4 6.2 L10.7 7 L11.5 7.3 L10.7 7.6 L10.4 8.4 L10.1 7.6 L9.3 7.3 L10.1 7 Z" fill="#ffffff" opacity="0.9" />
    </svg>
  );
}
