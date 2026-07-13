import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth } from '../api.jsx';
import { useRealtimeEvent, useRealtimeFeat } from '../realtime.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { useKeyboardInsetBar } from '../mobile.js';
import { useAutoGrow } from '../util.js';
import { mergeMessages, messageId } from '../groupMessages.js';
import { Send, ArrowLeft, Users, LogOut, MessageCircle } from 'lucide-react';

export default function GroupRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
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

  const leave = async () => {
    if (!confirm('确定退出该群聊？')) return;
    try { await api('/groups/' + id + '/leave', { method: 'POST' }); toast('已退出群聊'); nav('/groups'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const load = async () => {
    try {
      const d = await api('/groups/' + id);
      const ordered = mergeMessages([], d.messages);
      setGroup(d.group); setMembers(d.members); setMessages(ordered);
      lastId.current = ordered.reduce((max, message) => Math.max(max, messageId(message)), 0);
      stickToBottom.current = true;
    } catch (e) { toast(e.message, 'err'); }
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

  if (!group) return <div className="empty" style={{ paddingTop: 120 }}>载入中…</div>;

  return (
    <div className="chat-layout immersive">
      <div className="chat-main">
        <div className="chat-head">
          <button className="btn ghost sm" onClick={() => nav('/groups')}><ArrowLeft size={16} /></button>
          <Avatar src={group.avatar} name={group.name} size={40} />
          <div className="nm"><b>{group.name}</b><br /><span>{group.owner_name} 创建 · {group.description || '同好交流'}</span></div>
          <button className="btn ghost sm" onClick={() => setShowMembers(v => !v)} title="成员列表"><Users size={15} /> {members.length}</button>
          <button className="btn ghost sm" onClick={leave} title="退出群聊"><LogOut size={15} /></button>
        </div>
        {showMembers && (
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
        <div className="chat-scroll" ref={scrollRef} onScroll={trackScroll}>
          <div className="chat-thread group-thread">
          {messages.length === 0 && (
            <div className="empty" style={{ margin: 'auto' }}><div className="big"><MessageCircle size={42} /></div>还没有人发言，来打个招呼吧～</div>
          )}
          {messages.map((m) => {
            const mine = String(m.user_id) === String(user?.id);
            // 群聊里自己的消息同样带头像+昵称（多人场景需要身份锚点；
            // 「无头像」是 AI 对话页 user 侧的约定，搬到群聊就成了排版错位）。
            // 自己这侧优先用当前账号资料 —— 轮询消息里的快照可能滞后。
            const av = mine ? (user.avatar ?? m.avatar) : m.avatar;
            const nm = (mine ? (user.display_name || user.username) : m.display_name) || '匿名';
            return (
              <div key={m.id ?? `${m.user_id}:${m.created_at}:${m.content}`} className={'msg group-message ' + (mine ? 'user' : 'assistant')}>
                <Avatar src={av} name={nm} size={36} />
                <div className="group-message-body">
                  <div className="who">{nm}</div>
                  <div className="bubble">{m.content}</div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
        {/* 移动端 fixed 输入栏的占位，避免最后一条消息被遮挡 */}
        <div className="chat-input-spacer" aria-hidden="true" />
        <div className="chat-input-bar" ref={barRef}>
          <div className="box">
            <textarea ref={inputRef} rows={1} value={input} placeholder="说点什么…" enterKeyHint="send"
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="send-btn" onClick={send} disabled={sending || !input.trim()}><Send size={17} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
