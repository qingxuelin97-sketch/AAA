// 「推送给玩家」：把一件内容（角色卡 / 剧本）定向送进对方的消息收件箱
// （/messages 收件箱 tab）。双壳共用：Modal 在 App 壳自动走 portal + 退场动效。
// payload 传 { character_id } 或 { script_id }，服务端解析/物化对应卡片 post。
import React, { useState } from 'react';
import { api } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import { AppButton } from './AppControls.jsx';
import { Send } from 'lucide-react';

export default function PushSheet({ title, payload, onClose }) {
  const toast = useToast();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!to.trim() || busy) return;
    setBusy(true);
    try {
      await api('/community/push', { method: 'POST', body: { ...payload, to_username: to.trim(), note: note.trim() } });
      toast(`已推送给「${to.trim()}」`);
      onClose();
    } catch (e) { toast(e.message || '推送失败，请稍后重试', 'err'); }
    finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} className="cv-push-modal">
      <h2 style={{ margin: '0 0 4px' }}><Send size={16} style={{ verticalAlign: -2, marginRight: 6 }} />推送给玩家</h2>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>把「{title}」直接送进对方的消息收件箱。</p>
      <label className="atl-seed-label" htmlFor="cv-push-to">收件人</label>
      <input id="cv-push-to" className="input" style={{ width: '100%', marginBottom: 10 }}
        placeholder="对方的用户名或昵称" maxLength={40} value={to}
        onChange={e => setTo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <label className="atl-seed-label" htmlFor="cv-push-note">附言（可选）</label>
      <input id="cv-push-note" className="input" style={{ width: '100%' }}
        placeholder="想对 TA 说的话" maxLength={100} value={note}
        onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <AppButton variant="tertiary" onClick={onClose} disabled={busy}>取消</AppButton>
        <AppButton variant="primary" loading={busy} disabled={busy || !to.trim()} onClick={submit}>推送</AppButton>
      </div>
    </Modal>
  );
}
