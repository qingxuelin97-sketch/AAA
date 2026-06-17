import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { uploadFile } from './api.jsx';
import { UploadCloud, UserRound } from 'lucide-react';
import { FACE_PRESETS, ANIME_PRESETS, ONLINE_AV } from './faces.js';

const STATIC_IMG = 'image/png,image/jpeg,image/webp,image/avif';
const DYNAMIC = 'image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={'toast ' + (toast.type === 'err' ? 'err' : '')}>{toast.msg}</div>}
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

export function Avatar({ src, name = '', size = 40 }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (src) return <img className="avatar" src={src} style={{ width: size, height: size }} alt="" />;
  return (
    <div className="avatar" style={{
      width: size, height: size, display: 'grid', placeItems: 'center',
      fontSize: size * 0.42, fontWeight: 700, color: '#fff',
      background: 'linear-gradient(135deg, var(--accent), var(--accent-2))'
    }}>{initial}</div>
  );
}

// Shimmer skeleton grid shown while card lists load.
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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}
