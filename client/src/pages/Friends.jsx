import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CreatorV, CouncilorBadge } from '../ui.jsx';
import { EmptyArt } from '../art.jsx';
import { useAutoGrow } from '../util.js';
import {
  Users, UserPlus, Search, Send, Check, X, MessageCircle, ArrowLeft, MoreVertical,
  Trash2, BadgeCheck, Inbox,
} from 'lucide-react';

export default function Friends() {
  const toast = useToast();
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [sel, setSel] = useState(null);          // selected friend id
  const [dm, setDm] = useState(null);            // { messages, peer, can_dm, friend }
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef();
  const dmInputRef = useRef();
  const [params] = useSearchParams();
  // 私信输入框随内容自动增高（与对话页一致），封顶后转内部滚动
  useAutoGrow(dmInputRef, text, 130);

  const loadFriends = () => api('/friends').then(d => setFriends(d.friends || [])).catch(() => {});
  const loadRequests = () => api('/friends/requests').then(setRequests).catch(() => {});
  useEffect(() => { loadFriends(); loadRequests(); }, []);
  useEffect(() => { const dmId = params.get('dm'); if (dmId) setSel(Number(dmId)); }, [params]);

  // load + poll the open DM thread。实时事件由 SSE 秒级推送（见下方 useRealtimeEvent），
  // 这里的轮询只作为 SSE 断线时的兜底（15s），避免漏收。
  useEffect(() => {
    if (!sel) { setDm(null); return; }
    let alive = true;
    const load = () => api('/dm/' + sel).then(d => { if (alive) setDm(d); }).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [sel]);

  // 实时私信：对方发来的消息秒级到达。若正打开该会话则追加并刷新列表，
  // 否则只刷新好友列表（last_message + 未读数 +1）。
  useRealtimeEvent('dm', (data) => {
    const fromId = data?.from?.id;
    if (sel && fromId === sel) {
      setDm(p => p ? { ...p, messages: [...p.messages, { ...data.message, mine: false }] } : p);
      // 标记已读 + 同步列表未读：复用 GET 触发服务端 mark-read。
      api('/dm/' + sel).then(d => setDm(d)).catch(() => {});
      loadFriends();
    } else {
      loadFriends();
    }
  });

  // 实时好友事件：有人发来申请 → 刷新 incoming；对方通过申请 → 刷新好友列表。
  useRealtimeEvent('friend', (data) => {
    if (data?.kind === 'request') { loadRequests(); loadFriends(); }
    else if (data?.kind === 'accepted') { loadRequests(); loadFriends(); toast(`${data.by?.display_name || '对方'} 通过了你的好友申请 🎉`); }
  });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [dm?.messages?.length]);

  // search to add
  useEffect(() => {
    if (!adding) return;
    const term = q.trim(); if (!term) { setResults([]); return; }
    const t = setTimeout(() => api('/users/search?q=' + encodeURIComponent(term)).then(d => setResults(d.users || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, adding]);

  const friendSet = useMemo(() => new Set(friends.map(f => f.id)), [friends]);
  const outSet = useMemo(() => new Set(requests.outgoing.map(r => r.id)), [requests]);

  const addFriend = async (id) => {
    try { const d = await api('/friends/request/' + id, { method: 'POST' }); toast(d.state === 'friends' ? '已成为好友 🎉' : '好友申请已发送'); loadRequests(); loadFriends(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const respond = async (reqId, action) => {
    try { await api(`/friends/requests/${reqId}/${action}`, { method: 'POST' }); toast(action === 'accept' ? '已添加为好友' : '已忽略'); loadRequests(); loadFriends(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const unfriend = async (id) => {
    if (!confirm('确定解除好友关系？')) return;
    try { await api('/friends/' + id, { method: 'DELETE' }); toast('已解除好友'); setSel(null); setMenu(false); loadFriends(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const send = async () => {
    const t = text.trim(); if (!t || !sel) return;
    setText('');
    try {
      const d = await api('/dm/' + sel, { method: 'POST', body: { text: t } });
      setDm(p => p ? { ...p, messages: [...p.messages, d.message] } : p);
      loadFriends();
    } catch (e) { toast(e.message, 'err'); setText(t); }
  };

  return (
    <div className={'friends-layout' + (sel ? ' has-dm' : '')}>
      {/* ---- left: list ---- */}
      <aside className="fr-list">
        <div className="fr-list-head">
          <b><Users size={17} /> 好友 <span className="muted" style={{ fontWeight: 400 }}>{friends.length}</span></b>
          <button className={'btn sm' + (adding ? ' primary' : '')} onClick={() => { setAdding(a => !a); setQ(''); setResults([]); }}>
            {adding ? <X size={15} /> : <><UserPlus size={15} /> 添加</>}
          </button>
        </div>

        {adding && (
          <div className="fr-add">
            <div className="fr-search"><Search size={15} className="muted" /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="搜索用户名 / 昵称 / ID 添加好友" /></div>
            <div className="fr-add-results">
              {q.trim() && results.length === 0 && <div className="fr-empty-sm">未找到用户</div>}
              {results.map(u => (
                <div className="fr-add-row" key={u.id}>
                  <Avatar src={u.avatar} name={u.display_name} size={34} />
                  <div className="fr-add-tx"><b>{u.display_name}</b><span>@{u.username}</span></div>
                  {friendSet.has(u.id) ? <span className="fr-tag">已是好友</span>
                    : outSet.has(u.id) ? <span className="fr-tag">待通过</span>
                      : <button className="btn sm primary" onClick={() => addFriend(u.id)}><UserPlus size={13} /> 加好友</button>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="fr-scroll">
          {requests.incoming.length > 0 && (
            <div className="fr-section">
              <div className="fr-section-t"><Inbox size={13} /> 好友申请 ({requests.incoming.length})</div>
              {requests.incoming.map(r => (
                <div className="fr-req" key={r.req_id}>
                  <Avatar src={r.avatar} name={r.display_name} size={38} />
                  <div className="fr-req-tx"><b>{r.display_name}<CreatorV tier={r.creator_tier} size={12} /></b><span>申请加你为好友</span></div>
                  <div className="fr-req-acts">
                    <button className="fr-ok" onClick={() => respond(r.req_id, 'accept')} title="接受"><Check size={16} /></button>
                    <button className="fr-no" onClick={() => respond(r.req_id, 'reject')} title="忽略"><X size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {friends.length === 0 && requests.incoming.length === 0 ? (
            <div className="fr-empty"><EmptyArt kind="friends" size={116} />还没有好友<br /><span>点击右上角「添加」结识新朋友</span></div>
          ) : (
            friends.map(f => (
              <button key={f.id} className={'fr-item' + (sel === f.id ? ' active' : '')} onClick={() => setSel(f.id)}>
                <div className="fr-ava"><Avatar src={f.avatar} name={f.display_name} size={44} />{f.online && <span className="fr-on" />}</div>
                <div className="fr-item-tx">
                  <b>{f.display_name}{f.verified && <BadgeCheck size={12} style={{ color: 'var(--diamond)' }} />}<CreatorV tier={f.creator_tier} size={11} />{f.is_councilor && <CouncilorBadge size={10} />}</b>
                  <span>{f.last_message ? (f.last_message.mine ? '我：' : '') + f.last_message.text : (f.online ? '在线' : '离线')}</span>
                </div>
                {f.unread > 0 && <span className="fr-unread">{f.unread}</span>}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ---- right: DM ---- */}
      <section className="fr-dm">
        {!sel || !dm ? (
          <div className="fr-dm-empty"><EmptyArt kind="chat" />选择一位好友开始私聊</div>
        ) : (
          <>
            <div className="fr-dm-head">
              <button className="btn ghost sm mobile-only" onClick={() => setSel(null)}><ArrowLeft size={16} /></button>
              <div className="fr-ava"><Avatar src={dm.peer.avatar} name={dm.peer.display_name} size={40} />{dm.peer.online && <span className="fr-on" />}</div>
              <div className="fr-dm-nm"><b>{dm.peer.display_name}<CreatorV tier={dm.peer.creator_tier} size={12} /></b><span>{dm.peer.online ? '在线' : '离线'}</span></div>
              <div className="fr-menu-wrap">
                <button className="speak fr-menu-btn" onClick={() => setMenu(o => !o)}><MoreVertical size={18} /></button>
                {menu && <><div className="fr-menu-mask" onClick={() => setMenu(false)} /><div className="fr-menu"><button className="danger" onClick={() => unfriend(dm.peer.id)}><Trash2 size={14} /> 解除好友</button></div></>}
              </div>
            </div>

            <div className="fr-dm-scroll" ref={scrollRef}>
              {dm.messages.length === 0 && <div className="fr-dm-tip">还没有聊天记录，发条消息打个招呼吧～</div>}
              {dm.messages.map(mm => (
                <div key={mm.id} className={'dm-msg ' + (mm.mine ? 'mine' : 'theirs')}>
                  {!mm.mine && <Avatar src={dm.peer.avatar} name={dm.peer.display_name} size={30} />}
                  <div className="dm-bubble">{mm.text}<span className="dm-time">{(mm.created_at || '').slice(11, 16)}</span></div>
                </div>
              ))}
            </div>

            <div className="fr-dm-input">
              <textarea ref={dmInputRef} rows={1} value={text} enterKeyHint="send" onChange={e => setText(e.target.value)} placeholder={dm.can_dm ? `给 ${dm.peer.display_name} 发消息…` : '对方不接受私信'} disabled={!dm.can_dm}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="send-btn" onClick={send} disabled={!text.trim() || !dm.can_dm}><Send size={17} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
