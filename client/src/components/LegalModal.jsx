import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui.jsx';
import { LEGAL, LEGAL_LINKS } from '../legal.js';
import { X, List, ChevronUp, Flag } from 'lucide-react';

// Shared legal document modal — renders any of 服务条款 / 隐私政策 / 版权声明 / 免责声明.
// `docKey` is one of the LEGAL keys; siblings let the reader jump between docs.
// 优化点：切换文档自动回顶 / 可折叠目录 / 重点条款徽标 / 回到顶部按钮。
export function LegalModal({ docKey, onClose, onOpen }) {
  const doc = LEGAL[docKey];
  const bodyRef = useRef(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);

  // 切换文档时回到顶部并收起目录。
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setTocOpen(false);
    setShowTop(false);
  }, [docKey]);

  if (!doc) return null;
  const others = LEGAL_LINKS.filter(([k]) => k !== docKey);

  const scrollTop = () => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  const onBodyScroll = (e) => {
    const el = e.currentTarget;
    setShowTop(el.scrollTop > 200);
  };

  return (
    <Modal onClose={onClose}>
      <button className="modal-x" onClick={onClose} aria-label="关闭"><X size={18} /></button>
      <h2 className="legal-title">{doc.title}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>最近更新：{doc.updated}</div>
      <p className="legal-intro">{doc.intro}</p>

      {/* 可折叠目录：条数较多时显示，便于快速跳转 */}
      {doc.sections.length > 4 && (
        <div className={'legal-toc' + (tocOpen ? ' open' : '')}>
          <button className="legal-toc-toggle" onClick={() => setTocOpen(o => !o)}>
            <List size={14} /> 目录（共 {doc.sections.length} 条）
            <ChevronUp size={14} className={'legal-toc-chev' + (tocOpen ? ' open' : '')} />
          </button>
          {tocOpen && (
            <div className="legal-toc-list">
              {doc.sections.map((s, i) => (
                <button
                  key={i}
                  className="legal-toc-item"
                  onClick={() => {
                    const el = bodyRef.current?.querySelector(`[data-idx="${i}"]`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    setTocOpen(false);
                  }}
                >
                  {s.h.replace(/【[^】]+】/g, '').trim()}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="legal-body" ref={bodyRef} onScroll={onBodyScroll}>
        {doc.sections.map((s, i) => {
          // 自动识别【重点条款】等方括号标注，渲染为徽标
          const m = s.h.match(/【([^】]+)】/);
          const cleanH = s.h.replace(/【[^】]+】/g, '').trim();
          return (
            <section key={i} data-idx={i}>
              <h4>
                {cleanH}
                {m && <span className="legal-key-badge"><Flag size={11} /> {m[1]}</span>}
              </h4>
              <p>{s.p}</p>
            </section>
          );
        })}
        <button className="legal-to-top-end" onClick={scrollTop}>
          <ChevronUp size={14} /> 回到顶部
        </button>
      </div>

      {/* 浮动回到顶部按钮 */}
      {showTop && (
        <button className="legal-fab-top" onClick={scrollTop} aria-label="回到顶部">
          <ChevronUp size={18} />
        </button>
      )}

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
