import React, { useRef } from 'react';
import { useNav } from '../nav.js';
import { useLongPress } from '../chat/hooks.js';
import BakedScreen, { PinkHit } from './BakedScreen.jsx';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

export default function PinkMessages({ conversations = [], unread = 0, dmUnread = 0, tab = 'chatted', setTab, onPress }) {
  const nav = useNav();
  const rows = Array.isArray(conversations) ? conversations.slice(0, 4) : [];
  const pressedId = useRef(null);
  const bindPress = useLongPress(({ conversation, index }) => {
    pressedId.current = conversation?.id || null;
    const element = document.querySelector(`[data-pink-conversation="${index}"]`);
    const rect = element?.getBoundingClientRect?.();
    onPress?.({ cv: conversation, at: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null });
  });
  return (
    <BakedScreen screen="messages">
      <PinkHit className="pink-messages-search" label="搜索" onClick={openCmdk} />
      <PinkHit className="pink-messages-tab-chat" label="聊过" aria-pressed={tab === 'chatted'} onClick={() => setTab?.('chatted')} />
      <PinkHit className="pink-messages-tab-fav" label="收藏" aria-pressed={tab === 'liked'} onClick={() => setTab?.('liked')} />
      <PinkHit className="pink-messages-entry-interactions" label="互动消息" onClick={() => nav('/notifications', { state: { appBackTo: '/messages' } })}>
        {unread > 0 && <i className="pink-live-badge">{unread > 99 ? '99+' : unread}</i>}
      </PinkHit>
      <PinkHit className="pink-messages-entry-friends" label="好友私信" onClick={() => nav('/friends')}>
        {dmUnread > 0 && <i className="pink-live-badge">{dmUnread > 99 ? '99+' : dmUnread}</i>}
      </PinkHit>
      <PinkHit className="pink-messages-entry-groups" label="群聊房间" onClick={() => nav('/groups')} />
      <div className="pink-messages-conversations" role="list" aria-label="与角色的对话">
        {Array.from({ length: 4 }, (_, index) => {
          const conversation = rows[index];
          return <PinkHit key={conversation?.id || index} data-pink-conversation={index}
            label={conversation ? `打开与${conversation.character_name}的对话` : `参考对话 ${index + 1}`}
            disabled={!conversation}
            {...(conversation ? bindPress({ conversation, index }) : {})}
            onContextMenu={(event) => {
              if (!conversation) return;
              event.preventDefault();
              onPress?.({ cv: conversation, at: { x: event.clientX, y: event.clientY } });
            }}
            onClick={() => {
              if (!conversation) return;
              if (pressedId.current === conversation.id) { pressedId.current = null; return; }
              nav('/chats/' + conversation.id);
            }} />;
        })}
      </div>
    </BakedScreen>
  );
}
