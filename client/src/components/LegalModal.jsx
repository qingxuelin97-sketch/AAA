import React from 'react';
import { Modal } from '../ui.jsx';
import { LEGAL, LEGAL_LINKS } from '../legal.js';
import { X } from 'lucide-react';

// Shared legal document modal — renders any of 服务条款 / 隐私政策 / 版权声明 / 免责声明.
// `docKey` is one of the LEGAL keys; siblings let the reader jump between docs.
export function LegalModal({ docKey, onClose, onOpen }) {
  const doc = LEGAL[docKey];
  if (!doc) return null;
  const others = LEGAL_LINKS.filter(([k]) => k !== docKey);
  return (
    <Modal onClose={onClose}>
      <button className="modal-x" onClick={onClose} aria-label="关闭"><X size={18} /></button>
      <h2 style={{ margin: '0 0 4px' }}>{doc.title}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>最近更新：{doc.updated}</div>
      <p className="legal-intro">{doc.intro}</p>
      <div className="legal-body">
        {doc.sections.map((s, i) => (
          <section key={i}><h4>{s.h}</h4><p>{s.p}</p></section>
        ))}
      </div>
      <div className="legal-switch">
        {others.map(([k, label]) => (
          <button key={k} type="button" className="btn ghost sm" onClick={() => onOpen(k)}>{label}</button>
        ))}
        <button type="button" className="btn primary sm" onClick={onClose}>我已知悉</button>
      </div>
    </Modal>
  );
}

// Inline row of legal links. `onOpen(key)` opens the corresponding doc.
export function LegalLinks({ onOpen, className = '' }) {
  return (
    <div className={'legal-links ' + className}>
      {LEGAL_LINKS.map(([k, label], i) => (
        <React.Fragment key={k}>
          {i > 0 && <span className="legal-dot">·</span>}
          <button type="button" className="legal-link-btn" onClick={() => onOpen(k)}>{label}</button>
        </React.Fragment>
      ))}
    </div>
  );
}
