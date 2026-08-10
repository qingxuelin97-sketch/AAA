import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useRealtimeEvent, useRealtimeFeat } from '../realtime.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { useKeyboardInsetBar } from '../mobile.js';
import { useAutoGrow } from '../util.js';
import { mergeMessages, messageId } from '../groupMessages.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import AppPressMenu from '../components/AppPressMenu.jsx';
import { useLongPress } from '../chat/hooks.js';
import { tick } from '../appgestures.js';
import { isAppMode } from '../appmode.js';
import { AppEmptyArt } from '../art.jsx';
import { Send, ArrowLeft, Users, LogOut, MessageCircle, X, UserPlus } from 'lucide-react';

// 仪与匣：发言人名固定内容语义色 —— 按成员 id 稳定散列到
// act/dia/gold/success。禁止按列表位置配色：同一成员在任何会话、
// 任何排序下颜色恒定；Web 分支不落该属性。
const IX_NAME_TONES = ['act', 'dia', 'gold', 'success'];
function ixNameTone(id) {
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return IX_NAME_TONES[h % IX_NAME_TONES.length];
}

export default function GroupRoom() {
  const app = isAppMode();
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [group, setGroup] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [pressMsg, setPressMsg] = useState(null); // App 群消息长按 { m, nm, at }
  // 长按群消息 → 复制 / @提及（binder 挂在气泡上，坐标取气泡中心）
  const bindMsgPress = useLongPress((payload) => { tick(8); setPressMsg(payload()); });
  // S7-G10 @提及高亮（仅 App 落 DOM；Web 保持纯文本零差异）
  const renderBubbleContent = (content) => {
    if (!app) return content;
    const parts = String(content || '').split(/(@[^\s@，。,！？!?]+)/g);
    if (parts.length === 1) return content;
    return parts.map((part, i) => (part.startsWith('@') ? <i key={i} className="gr-mention">{part}</i> : part));
  };
  const scrollRef = useRef();
  const lastId = useRef(0);
  const sendingRef = useRef(false);
  const stickToBottom = useRef(true);
  const forceScroll = useRef(false);
  const barRef = useRef(null);
  const inputRef = useRef(null);
  // 移动端沉浸式布局下输入栏是 fixed 的：键盘弹起时顶到键盘上方（与对话页一致）
  useKeyboardInsetBar(barRef, [group]);
  useAutoGrow(inputRef, input);

  // 私有群此前根本进不了人 —— join 的两个条件互斥（详见 server/routes/groups.js
  // 的注释），而「受邀」承诺的邀请端点全仓不存在。后端补上 /invite/:userId 之后，
  // 这里给群主一个入口，那句文案才算兑现。
  const isOwner = String(group?.owner_id) === String(user?.id);
  const invite = async () => {
    const raw = window.prompt('输入要邀请的用户 ID（可在对方主页地址里看到）');
    const uid = Number(String(raw || '').trim());
    if (!uid) return;
    try {
      const d = await api(`/groups/${id}/invite/${uid}`, { method: 'POST' });
      toast(`已把 ${d.member?.display_name || ('用户 ' + uid)} 拉进群`, 'ok');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const leave = async () => {
    if (!confirm('确定退出该群聊？')) return;
    try { await api('/groups/' + id + '/leave', { method: 'POST' }); toast('已退出群聊'); nav('/groups'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const d = await api('/groups/' + id);
      const ordered = mergeMessages([], d.messages);
      setGroup(d.group); setMembers(d.members); setMessages(ordered);
      lastId.current = ordered.reduce((max, message) => Math.max(max, messageId(message)), 0);
      stickToBottom.current = true;
    } catch (e) {
      setLoadError(e?.message || '群聊暂时无法载入');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // 他人消息经 SSE 秒达（服务端 group_msg 事件）。轮询自适应：服务端声明了
  // 推送能力且连接在线 → 放宽为断连兜底；否则（后端未升级 / SSE 断开）维持密轮询。
  const live = useRealtimeFeat('group_msg');
  useRealtimeEvent('group_msg', (d) => {
    if (!d || Number(d.group_id) !== Number(id)) return;
    const m = d.message;
    if (!m) return;
    lastId.current = Math.max(lastId.current, messageId(m));
    setMessages(list => mergeMessages(list, [m]));
  });
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api('/groups/' + id + '/messages?after=' + lastId.current);
        const fresh = d.messages || [];
        if (fresh.length) {
          setMessages(current => mergeMessages(current, fresh));
          lastId.current = fresh.reduce((max, message) => Math.max(max, messageId(message)), lastId.current);
        }
      } catch { /* */ }
    }, live ? 15000 : 4000);
    return () => clearInterval(t);
  }, [id, live]);

  useEffect(() => {
    if (!stickToBottom.current && !forceScroll.current) return;
    const forced = forceScroll.current;
    forceScroll.current = false;
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: forced ? 'smooth' : 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  const trackScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    stickToBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
  };

  const send = async () => {
    const content = input.trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const d = await api('/groups/' + id + '/messages', { method: 'POST', body: { content } });
      setInput('');
      forceScroll.current = true;
      setMessages(current => mergeMessages(current, [d.message]));
      lastId.current = Math.max(lastId.current, messageId(d.message));
    } catch (e) { toast(e.message, 'err'); }
    finally { sendingRef.current = false; setSending(false); }
  };

  if (!group) return app ? (
    <div className={'qa-group-room-loading' + (loadError ? ' is-error' : '')} role={loadError ? 'alert' : 'status'} aria-label={loadError ? '群聊载入失败' : '正在载入群聊'}>
      <header className="qa-group-room-loading-head">
        <AppIconButton label="返回群聊列表" onClick={() => nav('/groups')}><ArrowLeft size={20} /></AppIconButton>
        <span className="skel" /><span />
      </header>
      {loadError ? (
        <section className="qa-group-room-load-error">
          <MessageCircle size={28} aria-hidden="true" />
          <h1>无法打开这个群聊</h1>
          <p>{loadError}</p>
          <div>
            <AppButton variant="primary" loading={loading} disabled={loading} onClick={() => void load()}>重新载入</AppButton>
            <AppButton variant="secondary" onClick={() => nav('/groups')}>返回群聊</AppButton>
          </div>
        </section>
      ) : (
        <div className="qa-group-room-loading-thread" aria-hidden="true">
          <i className="skel" /><i className="skel" /><i className="skel" />
        </div>
      )}
    </div>
  ) : <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;

  const Composer = app ? 'footer' : 'div';

  return (
    <div className={app ? 'chat-layout immersive qa-group-room' : 'chat-layout immersive'}>
      <div className={app ? 'chat-main qa-group-room-main' : 'chat-main'}>
        {app ? (
          <header className="chat-head qa-group-room-header">
            <AppIconButton className="qa-group-room-back" label="返回群聊列表" onClick={() => nav('/groups')}><ArrowLeft size={20} /></AppIconButton>
            <div className="qa-group-room-identity">
              <Avatar src={group.avatar} name={group.name} size={38} />
              <span><b>{group.name}</b><small>{group.owner_name} 创建 · {group.description || '同好交流'}</small></span>
            </div>
            <AppIconButton className="qa-group-room-members-button" label={`查看 ${members.length} 位群成员`} pressed={showMembers} onClick={() => setShowMembers(true)} title="成员列表"><Users size={18} /><span>{members.length}</span></AppIconButton>
          </header>
        ) : (
          <div className="chat-head">
            <button className="btn ghost sm" onClick={() => nav('/groups')}><ArrowLeft size={16} /></button>
            <Avatar src={group.avatar} name={group.name} size={40} />
            <div className="nm"><b>{group.name}</b><br /><span>{group.owner_name} 创建 · {group.description || '同好交流'}</span></div>
            <button className="btn ghost sm" onClick={() => setShowMembers(v => !v)} title="成员列表"><Users size={15} /> {members.length}</button>
            <button className="btn ghost sm" onClick={leave} title="退出群聊"><LogOut size={15} /></button>
          </div>
        )}
        {app && members.length > 0 && (
          <button type="button" className="qa-group-room-roster" onClick={() => setShowMembers(true)} aria-label={`查看 ${members.length} 位群成员`}>
            <span className="qa-group-room-roster-avatars" aria-hidden="true">
              {members.slice(0, 5).map((member, index) => (
                <span className="qa-group-room-roster-avatar" key={member.user_id || member.id || member.username || index}>
                  <Avatar src={member.avatar} name={member.display_name} size={32} />
                  {index < 3 && <i />}
                </span>
              ))}
            </span>
            <span className="qa-group-room-roster-copy"><b>{members.length} 位成员</b><small>轻触查看群成员</small></span>
            <Users size={17} aria-hidden="true" />
          </button>
        )}
        {!app && showMembers && (
          <div className="group-members">
            {members.map((mb) => (
              <div key={mb.user_id || mb.id || mb.username} className="gm-row">
                <Avatar src={mb.avatar} name={mb.display_name} size={30} />
                <span>{mb.display_name || '匿名'}</span>
                {mb.role === 'owner' && <span className="gm-owner">群主</span>}
              </div>
            ))}
          </div>
        )}
        {app && showMembers && (
          <Modal onClose={() => setShowMembers(false)} className="qa-group-room-members-modal" backdropClassName="qa-group-room-members-backdrop">
            <div className="qa-group-room-members-head">
              <div><h2>群成员</h2><p>{members.length} 人 · 群主 {group.owner_name}</p></div>
              <AppIconButton label="关闭成员列表" onClick={() => setShowMembers(false)}><X size={19} /></AppIconButton>
            </div>
            <div className="qa-group-room-members-list" role="list">
              {members.map((mb) => (
                <div key={mb.user_id || mb.id || mb.username} className="gm-row qa-group-room-member" role="listitem">
                  <Avatar src={mb.avatar} name={mb.display_name} size={38} />
                  <span>{mb.display_name || '匿名'}</span>
                  {mb.role === 'owner' && <span className="gm-owner">群主</span>}
                </div>
              ))}
            </div>
            {isOwner && (
              <AppButton className="qa-group-room-invite" variant="secondary" onClick={invite}>
                <UserPlus size={16} /> 邀请成员
              </AppButton>
            )}
            {!isOwner && <AppButton className="qa-group-room-leave" variant="secondary" tone="danger" onClick={leave}><LogOut size={16} /> 退出群聊</AppButton>}
          </Modal>
        )}
        <div className={app ? 'chat-scroll qa-group-room-scroll' : 'chat-scroll'} ref={scrollRef} onScroll={trackScroll} role={app ? 'log' : undefined} aria-live={app ? 'polite' : undefined} aria-label={app ? `${group.name}的群聊消息` : undefined}>
          <div className="chat-thread group-thread">
          {messages.length === 0 && (app
            ? <div className="empty qa-group-room-empty" style={{ margin: 'auto' }}><AppEmptyArt kind="group" size={104} />还没有人发言，来打个招呼吧～</div>
            : <div className="empty" style={{ margin: 'auto' }}><div className="big"><MessageCircle size={42} /></div>还没有人发言，来打个招呼吧～</div>
          )}
          {messages.map((m) => {
            const mine = String(m.user_id) === String(user?.id);
            // 群聊里自己的消息同样带头像+昵称（多人场景需要身份锚点；
            // 「无头像」是 AI 对话页 user 侧的约定，搬到群聊就成了排版错位）。
            // 自己这侧优先用当前账号资料 —— 轮询消息里的快照可能滞后。
            const av = mine ? (user.avatar ?? m.avatar) : m.avatar;
            const nm = (mine ? (user.display_name || user.username) : m.display_name) || '匿名';
            const key = m.id ?? `${m.user_id}:${m.created_at}:${m.content}`;
            const pressPayload = () => {
              const el = document.getElementById('grm-' + key);
              const rect = el?.getBoundingClientRect();
              return { m, nm, at: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 195, y: 420 } };
            };
            return (
              <div key={key} className={'msg group-message ' + (mine ? 'user' : 'assistant')}>
                <Avatar src={av} name={nm} size={36} />
                <div className="group-message-body">
                  {/* data-ix-tone 仅 App 壳落 DOM：Web（?app=0）保持零差异 */}
                  <div className="who" data-ix-tone={app ? ixNameTone(m.user_id) : undefined}>{nm}</div>
                  <div
                    className="bubble"
                    id={app ? 'grm-' + key : undefined}
                    {...(app ? bindMsgPress(pressPayload) : {})}
                    onContextMenu={app ? (e) => { e.preventDefault(); setPressMsg({ m, nm, at: { x: e.clientX, y: e.clientY } }); } : undefined}
                  >
                    {renderBubbleContent(m.content)}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
        {/* 移动端 fixed 输入栏的占位，避免最后一条消息被遮挡 */}
        <div className="chat-input-spacer" aria-hidden="true" />
        <Composer className={app ? 'chat-input-bar qa-group-room-composer' : 'chat-input-bar'} ref={barRef} aria-label={app ? '群聊消息编辑器' : undefined}>
          <div className={app ? 'box qa-group-room-input-island' : 'box'}>
            <textarea className={app ? 'qa-group-room-textarea' : undefined} aria-label={app ? '输入群聊消息' : undefined} ref={inputRef} rows={1} value={input} placeholder="说点什么…" enterKeyHint="send"
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <AppIconButton className={app ? 'send-btn qa-group-room-send' : 'send-btn'} label="发送群聊消息" variant="filled" loading={sending} onClick={send} disabled={sending || !input.trim()}><Send size={17} /></AppIconButton>
          </div>
        </Composer>
      </div>
      {app && pressMsg && (
        <AppPressMenu
          at={pressMsg.at}
          onClose={() => setPressMsg(null)}
          items={[
            {
              label: '复制',
              onSelect: async () => {
                try { await navigator.clipboard.writeText(pressMsg.m.content || ''); toast('已复制'); }
                catch { toast('复制失败', 'err'); }
              },
            },
            {
              label: `@${pressMsg.nm}`,
              onSelect: () => {
                setInput((value) => (value ? value.replace(/\s*$/, ' ') : '') + `@${pressMsg.nm} `);
                inputRef.current?.focus();
              },
            },
          ]}
        />
      )}
    </div>
  );
}
