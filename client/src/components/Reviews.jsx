import React, { useEffect, useState } from 'react';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { Star, Trash2 } from 'lucide-react';

function Stars({ value, onPick, size = 16 }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map(n => onPick
        ? <button key={n} type="button" className={'star-btn' + (n <= value ? ' on' : '')} onClick={() => onPick(n)}><Star size={size} fill={n <= value ? 'currentColor' : 'none'} /></button>
        : <Star key={n} size={size} fill={n <= value ? 'currentColor' : 'none'} color={n <= value ? '#e0a93a' : '#d8d2c2'} />)}
    </span>
  );
}

export default function Reviews({ type, id }) {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/engage/reviews/${type}/${id}`).then(d => {
    setData(d); if (d.mine) { setRating(d.mine.rating); setText(d.mine.text || ''); }
  }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [type, id]);

  const submit = async () => {
    setBusy(true);
    try { await api(`/engage/reviews/${type}/${id}`, { method: 'POST', body: { rating, text } }); toast('评价已提交'); load(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const del = async (r) => {
    try { await api('/engage/reviews/' + r.id, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'err'); }
  };
  if (!data) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 17 }}>评价 ({data.count})</h2>
        {data.count > 0 && <span className="rating-pill"><Star size={15} fill="currentColor" /> {data.avg.toFixed(1)}</span>}
      </div>
      {user && (
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>{data.mine ? '修改你的评价' : '给个评价'}</span>
            <Stars value={rating} onPick={setRating} />
          </div>
          <textarea className="textarea" style={{ minHeight: 64 }} value={text} onChange={e => setText(e.target.value)} placeholder="说说你的体验…（可选）" />
          <button className="btn primary sm" style={{ marginTop: 8 }} onClick={submit} disabled={busy}>{busy ? '提交中…' : data.mine ? '更新评价' : '提交评价'}</button>
        </div>
      )}
      {data.reviews.length === 0 ? <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>还没有评价，来做第一个吧。</div> :
        data.reviews.map(r => (
          <div key={r.id} className="review">
            <Avatar src={r.author_avatar} name={r.author_name} size={36} />
            <div className="r-body">
              <div className="r-head"><b style={{ fontSize: 13.5 }}>{r.author_name}</b><Stars value={r.rating} size={13} /><span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{String(r.created_at || '').slice(0, 10)}</span></div>
              {r.text && <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{r.text}</div>}
            </div>
            {user && r.user_id === user.id && <button className="speak" onClick={() => del(r)} title="删除"><Trash2 size={13} /></button>}
          </div>
        ))}
    </div>
  );
}
