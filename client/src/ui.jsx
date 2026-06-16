import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { uploadFile } from './api.jsx';

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

// Reusable media uploader (avatar / cover / dynamic background).
export function Uploader({ value, type = 'image', onChange, variant = 'box', accept, label = '点击上传' }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
      <input ref={ref} type="file" accept={accept || 'image/*,video/mp4,video/webm'} hidden onChange={pick} />
      {busy ? <div className="muted">上传中…</div> : value ? (
        isVideo
          ? <video className="preview" src={value} muted loop autoPlay playsInline />
          : <img className="preview" src={value} alt="" />
      ) : (
        <div className="muted">
          <div style={{ fontSize: 24, marginBottom: 6 }}>⬆️</div>{label}
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

export function Modal({ children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}
