import React, { useMemo, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { AppButton, AppIconButton } from '../AppControls.jsx';

// The server has no public comment endpoint for a character card. This sheet
// therefore keeps a local, session-scoped discussion draft and turns the CTA
// into an actual chat draft, preserving the existing API boundary.
export default function DiscoverCommentSheet({ character, onClose, onStartChat }) {
  const [text, setText] = useState('');
  const examples = useMemo(() => [
    `想和 ${character.name} 从这个故事开始`,
    '这个设定很有意思，想了解更多',
  ], [character.name]);
  const submit = () => {
    const draft = text.trim();
    if (!draft) return;
    onStartChat(draft);
  };

  return (
    <div className="app-sheet-mask cbx-comment-mask" onClick={onClose}>
      <section className="app-sheet cbx-comment-sheet" role="dialog" aria-modal="true" aria-label={`回应 ${character.name}`} onClick={event => event.stopPropagation()}>
        <div className="app-sheet-grip" />
        <header className="cbx-comment-sheet__head">
          <div><span>和角色互动</span><h3>回应 {character.name}</h3></div>
          <AppIconButton label="关闭" onClick={onClose}><X size={18} /></AppIconButton>
        </header>
        <p className="cbx-comment-sheet__hint"><MessageCircle size={16} /> 你的回应会作为开场消息带入对话。</p>
        <div className="cbx-comment-sheet__suggestions">
          {examples.map(example => <button key={example} type="button" onClick={() => setText(example)}>{example}</button>)}
        </div>
        <label className="cbx-comment-sheet__field">
          <span>你的回应</span>
          <textarea value={text} onChange={event => setText(event.target.value)} placeholder="说点什么，开启这段故事…" rows={3} autoFocus />
        </label>
        <AppButton variant="primary" className="cbx-comment-sheet__send" disabled={!text.trim()} onClick={submit}>
          <Send size={16} /> 带着回应进入对话
        </AppButton>
      </section>
    </div>
  );
}
