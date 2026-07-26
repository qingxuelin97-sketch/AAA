import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar, CreatorV, CouncilorBadge } from '../ui.jsx';
import { EmptyArt } from '../art.jsx';
import { useAutoGrow } from '../util.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import AppPressMenu from '../components/AppPressMenu.jsx';
import { useLongPress } from '../chat/hooks.js';
import { tick } from '../appgestures.js';
import { isAppMode } from '../appmode.js';
import { t } from '../appCopy.js';
import { useNav } from '../nav.js';
import { useAppOverlay } from '../overlay.jsx';
import {
  Users, UserPlus, Search, Send, Check, X, MessageCircle, ArrowLeft, MoreVertical,
  Trash2, BadgeCheck, Inbox,
} from 'lucide-react';

export default function Friends() {
  const toast = useToast();
  const nav = useNav();
  const appMode = isAppMode();
  const [friends, setFriends] = useState([]);
  const [frLoading, setFrLoading] = useState(true);
  const [frError, setFrError] = useState('');
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
  const dmPanelRef = useRef(null);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const [params] = useSearchParams();
  // App 将私信视作联系人列表上的第二层：Android Back / Escape 先关闭
  // 菜单，再回联系人列表；Web 不注册浮层，继续维持左右分栏。
  useAppOverlay(appMode && Boolean(sel), () => setSel(null), { rootRef: dmPanelRef });
  useAppOverlay(appMode && menu, () => setMenu(false), { rootRef: menuRef, returnFocusRef: menuButtonRef });
  // 私信输入框随内容自动增高（与对话页一致），封顶后转内部滚动
  useAutoGrow(dmInputRef, text, 130);

  // S7-G10 私信草稿（仅 App 壳）：按好友持久，切人各自恢复，发送/清空即删
  useEffect(() => {
    if (!appMode || !sel) return;
    try { setText(localStorage.getItem('huanyu_dmdraft_' + sel) || ''); } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);
  useEffect(() => {
    if (!appMode || !sel) return;
    const t = setTimeout(() => {
      try {
        if (text.trim()) localStorage.setItem('huanyu_dmdraft_' + sel, text);
        else localStorage.removeItem('huanyu_dmdraft_' + sel);
      } catch { /* */ }
    }, 300);
    return () => clearTimeout(t);
  }, [appMode, sel, text]);
  // S7-G10 私信气泡长按（仅 App）：复制原文
  const [dmPress, setDmPress] = useState(null); // { text, at }
  const bindDmPress = useLongPress((payload) => { tick(8); setDmPress(payload()); });

  const loadFriends = () => api('/friends')
    .then(d => { setFriends(d.friends || []); setFrError(''); })
    .catch((e) => setFrError(e.message || '好友列表载入失败，请稍后重试'))
    .finally(() => setFrLoading(false));
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
    else if (data?.kind === 'accepted') { loadRequests(); loadFriends(); toast(t(`${data.by?.display_name || '对方'} 通过了你的好友申请 🎉`, `${data.by?.display_name || '对方'} 通过了你的好友申请`)); }
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
    try { const d = await api('/friends/request/' + id, { method: 'POST' }); toast(d.state === 'friends' ? t('已成为好友 🎉', '已成为好友') : '好友申请已发送'); loadRequests(); loadFriends(); }
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
    <div className={(appMode ? 'qa-friends-page ' : '') + 'friends-layout' + (sel ? ' has-dm' : '')}
      data-view={appMode ? (sel ? 'conversation' : 'contacts') : undefined}>
      {/* ---- left: list ---- */}
      <aside className="fr-list">
        <div className="fr-list-head" role={appMode ? 'toolbar' : undefined} aria-label={appMode ? '好友页面工具栏' : undefined}>
          {appMode && (
            <AppIconButton className="fr-page-back" onClick={() => nav('/me')} label="返回我的">
              <ArrowLeft size={20} />
            </AppIconButton>
          )}
          <b><Users size={17} /> 好友 <span className="muted" style={{ fontWeight: 400 }}>{friends.length}</span></b>
          <AppButton variant="tertiary" selected={adding}
            className={(appMode ? 'fr-add-toggle ' : '') + 'btn sm' + (adding ? ' primary' : '')}
            aria-expanded={appMode ? adding : undefined} aria-controls={appMode ? 'friend-add-panel' : undefined}
            onClick={() => { setAdding(a => !a); setQ(''); setResults([]); }}>
            {adding ? <X size={15} /> : <><UserPlus size={15} /> 添加</>}
          </AppButton>
        </div>

        {adding && (
          <div className="fr-add" id={appMode ? 'friend-add-panel' : undefined}>
            <div className="fr-search"><Search size={15} className="muted" /><input autoFocus value={q} onChange={e => setQ(e.target.value)}
              aria-label={appMode ? '搜索要添加的好友' : undefined} placeholder="搜索用户名 / 昵称 / ID 添加好友" /></div>
            <div className="fr-add-results">
              {q.trim() && results.length === 0 && <div className="fr-empty-sm">未找到用户</div>}
              {results.map(u => (
                <div className="fr-add-row" key={u.id}>
                  <Avatar src={u.avatar} name={u.display_name} size={34} />
                  <div className="fr-add-tx"><b>{u.display_name}</b><span>@{u.username}</span></div>
                  {friendSet.has(u.id) ? <span className="fr-tag">已是好友</span>
                    : outSet.has(u.id) ? <span className="fr-tag">待通过</span>
                      : <AppButton className="btn sm primary" size="sm" variant="primary" onClick={() => addFriend(u.id)}><UserPlus size={13} /> 加好友</AppButton>}
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
                    <AppIconButton className="fr-ok" variant="filled" onClick={() => respond(r.req_id, 'accept')} label="接受好友申请" title="接受"><Check size={16} /></AppIconButton>
                    <AppIconButton className="fr-no" onClick={() => respond(r.req_id, 'reject')} label="忽略好友申请" title="忽略"><X size={16} /></AppIconButton>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!appMode && frLoading ? (
            <div className="lgw-skel-list" style={{ padding: '10px 12px' }} aria-hidden="true">
              {[0, 1, 2, 3].map(i => <div key={i} className="skel" />)}
            </div>
          ) : !appMode && frError && friends.length === 0 ? (
            <div className="fr-empty lgw-error" role="alert">
              <span className="lgw-error-ic"><Users size={20} /></span>
              <p className="lgw-error-msg">{frError}</p>
              <button className="btn primary lgw-error-retry" onClick={() => { setFrLoading(true); loadFriends(); }}>重新载入</button>
            </div>
          ) : friends.length === 0 && requests.incoming.length === 0 ? (
            appMode
              ? <div className="fr-empty"><EmptyArt kind="friends" size={116} />还没有好友<br /><span>点击右上角「添加」结识新朋友</span></div>
              : (
                <div className="fr-empty lgw-empty">
                  <EmptyArt kind="friends" size={116} />
                  <h2 className="lgw-empty-title">还没有好友</h2>
                  <p className="lgw-empty-sub">添加好友后可以互发私信，聊聊彼此的角色与脑洞。</p>
                  <div className="lgw-empty-cta">
                    <button className="btn primary" onClick={() => { setAdding(true); setQ(''); setResults([]); }}><UserPlus size={15} /> 搜索用户添加好友</button>
                  </div>
                </div>
              )
          ) : (
            friends.map(f => (
              <AppButton key={f.id} variant="tertiary" selected={sel === f.id}
                className={'fr-item' + (sel === f.id ? ' active' : '')} onClick={() => setSel(f.id)}>
                <div className="fr-ava"><Avatar src={f.avatar} name={f.display_name} size={44} />{f.online && <span className="fr-on" />}</div>
                <div className="fr-item-tx">
                  <b>{f.display_name}{f.verified && <BadgeCheck size={12} style={{ color: 'var(--diamond)' }} />}<CreatorV tier={f.creator_tier} size={11} />{f.is_councilor && <CouncilorBadge size={10} />}</b>
                  <span>{f.last_message ? (f.last_message.mine ? '我：' : '') + f.last_message.text : (f.online ? '在线' : '离线')}</span>
                </div>
                {f.unread > 0 && <span className="fr-unread">{f.unread}</span>}
              </AppButton>
            ))
          )}
        </div>
      </aside>

      {/* ---- right: DM ---- */}
      <section className="fr-dm" ref={dmPanelRef} tabIndex={appMode ? -1 : undefined}
        aria-label={appMode && dm?.peer ? `与 ${dm.peer.display_name} 的私信` : undefined}>
        {!sel || !dm ? (
          appMode && sel
            ? <div className="fr-dm-empty" role="status">正在打开对话…</div>
            : <div className="fr-dm-empty"><EmptyArt kind="chat" />选择一位好友开始私聊</div>
        ) : (
          <>
            <div className="fr-dm-head" role={appMode ? 'toolbar' : undefined} aria-label={appMode ? '私信会话工具栏' : undefined}>
              <AppIconButton className={'btn ghost sm mobile-only' + (appMode ? ' fr-dm-back' : '')} onClick={() => setSel(null)} label="返回好友列表">
                <ArrowLeft size={20} />
              </AppIconButton>
              <div className="fr-ava"><Avatar src={dm.peer.avatar} name={dm.peer.display_name} size={40} />{dm.peer.online && <span className="fr-on" />}</div>
              <div className="fr-dm-nm"><b>{dm.peer.display_name}<CreatorV tier={dm.peer.creator_tier} size={12} /></b><span>{dm.peer.online ? '在线' : '离线'}</span></div>
              <div className="fr-menu-wrap">
                <AppIconButton ref={menuButtonRef} className="speak fr-menu-btn" selected={menu}
                  onClick={() => setMenu(o => !o)} label="会话选项" aria-expanded={appMode ? menu : undefined}
                  aria-haspopup={appMode ? 'menu' : undefined} aria-controls={appMode ? 'friend-conversation-menu' : undefined}>
                  <MoreVertical size={20} />
                </AppIconButton>
                {menu && <><div className="fr-menu-mask" onClick={() => setMenu(false)} />
                  <div className="fr-menu" id={appMode ? 'friend-conversation-menu' : undefined} ref={menuRef}
                    role={appMode ? 'menu' : undefined} tabIndex={appMode ? -1 : undefined}>
                    <AppButton className="danger" tone="danger" variant="tertiary" role={appMode ? 'menuitem' : undefined}
                      onClick={() => unfriend(dm.peer.id)}><Trash2 size={14} /> 解除好友</AppButton>
                  </div></>}
              </div>
            </div>

            <div className="fr-dm-scroll" ref={scrollRef}>
              {dm.messages.length === 0 && <div className="fr-dm-tip">还没有聊天记录，发条消息打个招呼吧～</div>}
              {dm.messages.map(mm => {
                const pressPayload = () => {
                  const el = document.getElementById('dmb-' + mm.id);
                  const rect = el?.getBoundingClientRect();
                  return { text: mm.text, at: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 195, y: 420 } };
                };
                return (
                  <div key={mm.id} className={'dm-msg ' + (mm.mine ? 'mine' : 'theirs')}>
                    {!mm.mine && <Avatar src={dm.peer.avatar} name={dm.peer.display_name} size={30} />}
                    <div
                      className="dm-bubble"
                      id={appMode ? 'dmb-' + mm.id : undefined}
                      {...(appMode ? bindDmPress(pressPayload) : {})}
                      onContextMenu={appMode ? (e) => { e.preventDefault(); setDmPress({ text: mm.text, at: { x: e.clientX, y: e.clientY } }); } : undefined}
                    >
                      {mm.text}<span className="dm-time">{(mm.created_at || '').slice(11, 16)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="fr-dm-input">
              <textarea ref={dmInputRef} rows={1} value={text} enterKeyHint="send" onChange={e => setText(e.target.value)} placeholder={dm.can_dm ? `给 ${dm.peer.display_name} 发消息…` : '对方不接受私信'} disabled={!dm.can_dm}
                aria-label={appMode ? `给 ${dm.peer.display_name} 发消息` : undefined}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <AppIconButton className="send-btn" variant="filled" onClick={send} disabled={!text.trim() || !dm.can_dm} label="发送消息"><Send size={19} /></AppIconButton>
            </div>
          </>
        )}
      </section>
      {appMode && dmPress && (
        <AppPressMenu
          at={dmPress.at}
          onClose={() => setDmPress(null)}
          items={[{
            label: '复制',
            onSelect: async () => {
              try { await navigator.clipboard.writeText(dmPress.text || ''); toast('已复制'); }
              catch { toast('复制失败', 'err'); }
            },
          }]}
        />
      )}
    </div>
  );
}
