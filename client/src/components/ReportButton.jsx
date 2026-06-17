import React, { useState } from 'react';
import { api } from '../api.jsx';
import { useToast, Modal } from '../ui.jsx';
import { Flag } from 'lucide-react';

const REASONS = ['色情低俗', '辱骂攻击', '违法违规', '抄袭侵权', '垃圾广告', '其他'];

export default function ReportButton({ type, id, label = '举报', variant = 'ghost', size = 14 }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try { await api('/engage/report', { method: 'POST', body: { type, id, reason } }); toast('举报已提交，感谢反馈'); setOpen(false); setReason(''); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <button className={'btn ' + variant + ' sm'} onClick={e => { e.stopPropagation(); setOpen(true); }} title="举报">
        <Flag size={size} />{label ? ' ' + label : ''}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 style={{ marginTop: 0 }}>举报内容</h2>
          <div className="field"><label>请选择举报理由</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {REASONS.map(r => <button key={r} className={'cat-chip' + (reason === r ? ' active' : '')} onClick={() => setReason(r)}>{r}</button>)}
            </div>
          </div>
          <div className="row"><button className="btn block" onClick={() => setOpen(false)}>取消</button>
            <button className="btn primary block" onClick={submit} disabled={busy || !reason}>提交举报</button></div>
        </Modal>
      )}
    </>
  );
}
