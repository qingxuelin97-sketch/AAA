import React from 'react';
import { Copy, Send, X } from 'lucide-react';
import { AppButton, AppIconButton } from '../AppControls.jsx';

export default function DiscoverShareSheet({ character, onClose, onCopy, onSystemShare }) {
  return (
    <div className="app-sheet-mask cbx-share-mask" onClick={onClose}>
      <section className="app-sheet cbx-share-sheet" role="dialog" aria-modal="true" aria-label={`分享 ${character.name}`} onClick={event => event.stopPropagation()}>
        <div className="app-sheet-grip" />
        <header><div><span>把故事送给朋友</span><h3>分享 {character.name}</h3></div><AppIconButton label="关闭" onClick={onClose}><X size={18} /></AppIconButton></header>
        <p>对方打开链接后，可以查看角色并开始自己的对话。</p>
        <div className="cbx-share-sheet__actions">
          <AppButton variant="secondary" onClick={onCopy}><Copy size={16} /> 复制链接</AppButton>
          <AppButton variant="primary" onClick={onSystemShare}><Send size={16} /> 系统分享</AppButton>
        </div>
      </section>
    </div>
  );
}
