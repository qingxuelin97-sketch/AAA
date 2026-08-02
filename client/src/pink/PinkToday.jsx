import React from 'react';
import { useNav } from '../nav.js';
import BakedScreen, { PinkHit } from './BakedScreen.jsx';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

export default function PinkToday({ hero, resume = [], unread = 0, checked, onChat, onCheckin }) {
  const nav = useNav();
  const companions = Array.isArray(resume) ? resume.slice(0, 5) : [];
  return (
    <BakedScreen screen="today">
      <PinkHit className="pink-today-search" label="搜索" onClick={openCmdk} />
      <PinkHit className="pink-today-bell" label={unread ? `通知，${unread} 条未读` : '通知'} onClick={() => nav('/notifications', { state: { appBackTo: '/today' } })}>
        {unread > 0 && <i className="pink-live-dot" />}
      </PinkHit>
      <PinkHit className="pink-today-hero" label="查看陆沉舟" onClick={() => hero?.id && nav('/character/' + hero.id)} />
      <PinkHit className="pink-today-cta" label="继续故事" onClick={() => {
        if (hero?.conversation_id) nav('/chats/' + hero.conversation_id);
        else if (hero) onChat?.(hero);
      }} />
      <div className="pink-today-companions" role="group" aria-label="最近陪伴">
        {Array.from({ length: 5 }, (_, index) => {
          const conversation = companions[index];
          return <PinkHit key={index} label={conversation ? `继续与${conversation.character_name}的故事` : `最近陪伴 ${index + 1}`}
            disabled={!conversation} onClick={() => conversation && nav('/chats/' + conversation.id)} />;
        })}
      </div>
      <PinkHit className="pink-today-task" label={checked ? '今天已签到' : '每日签到，领取 50 金币'} onClick={onCheckin} disabled={checked} />
    </BakedScreen>
  );
}
