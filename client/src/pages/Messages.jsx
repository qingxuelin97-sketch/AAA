// 消息中心 —— app 壳「消息」tab 的聚合页。
// 顶部「赞过 | 聊过」双分段（对标主流角色社区的消息信息架构）：
//   聊过 = 会话列表 + 互动消息（通知）/ 好友私信 / 群聊 三个入口行；
//   赞过 = 收藏过的角色（随手回访、一键续聊）。
// 全部数据来自既有端点，无新协议：/chat/conversations · /characters/favorites/list
// /social/notifications · /dm。SSE 到达时角标秒级刷新。
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { EmptyArt, CoverArt } from '../art.jsx';
import { msgPreview } from '../util.js';
import { Logo } from '../assets.jsx';
import {
  Bell, ChevronRight, Heart, MessageCircle, Search, UserRound, Users, X, Flame
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

export default function Messages() {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('chatted'); // 'liked' | 'chatted'
  const [convs, setConvs] = useState(null);  // null = loading
  const [favs, setFavs] = useState(null);
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);

  const loadConvs = () => api('/chat/conversations').then(d => setConvs(d.conversations || [])).catch(() => setConvs([]));
  useEffect(() => {
    loadConvs();
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
    api('/dm').then(d => setDmUnread(d.unread_total || 0)).catch(() => {});
  }, []);
  useEffect(() => {
    if (tab === 'liked' && favs === null) {
      api('/characters/favorites/list').then(d => setFavs(d.characters || [])).catch(() => setFavs([]));
    }
  }, [tab, favs]);

  useRealtimeEvent('notification', () => setUnread(u => u + 1));
  useRealtimeEvent('dm', () => { api('/dm').then(d => setDmUnread(d.unread_total || 0)).catch(() => {}); });

  const delConv = async (e, cv) => {
    e.stopPropagation();
    if (!confirm('删除该对话？')) return;
    try { await api('/chat/conversations/' + cv.id, { method: 'DELETE' }); loadConvs(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const chatFav = async (c) => {
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch { nav('/character/' + c.id); }
  };

  return (
    <div className="msgs">
      {/* 顶部：品牌 · 双分段 · 搜索（对齐一级页自带头部的壳层形态） */}
      <div className="msgs-head">
        <span className="msgs-logo" aria-hidden="true"><Logo size={30} /></span>
        <div className="msgs-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chatted'} className={tab === 'chatted' ? 'on' : ''} onClick={() => setTab('chatted')}>聊过</button>
          <button role="tab" aria-selected={tab === 'liked'} className={tab === 'liked' ? 'on' : ''} onClick={() => setTab('liked')}>赞过</button>
        </div>
        <button className="msgs-search" onClick={openCmdk} aria-label="搜索"><Search size={20} /></button>
      </div>

      {tab === 'chatted' ? (
        <>
          {/* 互动消息 / 好友私信 / 群聊 —— 聚合入口行 */}
          <button className="msgs-entry" onClick={() => nav('/notifications')}>
            <span className="msgs-entry-ic noti"><Bell size={20} /></span>
            <span className="msgs-entry-tx">
              <b>互动消息</b>
              <small>{unread > 0 ? `${unread} 条新的赞 · 评论 · 关注` : '点击查看互动消息'}</small>
            </span>
            {unread > 0 && <i className="msgs-badge">{unread > 99 ? '99+' : unread}</i>}
            <ChevronRight size={18} className="msgs-entry-chev" />
          </button>
          <button className="msgs-entry" onClick={() => nav('/friends')}>
            <span className="msgs-entry-ic dm"><UserRound size={20} /></span>
            <span className="msgs-entry-tx">
              <b>好友私信</b>
              <small>{dmUnread > 0 ? `${dmUnread} 条未读私信` : '和创作者们聊聊'}</small>
            </span>
            {dmUnread > 0 && <i className="msgs-badge">{dmUnread > 99 ? '99+' : dmUnread}</i>}
            <ChevronRight size={18} className="msgs-entry-chev" />
          </button>
          <button className="msgs-entry" onClick={() => nav('/groups')}>
            <span className="msgs-entry-ic grp"><Users size={20} /></span>
            <span className="msgs-entry-tx">
              <b>群聊房间</b>
              <small>多人多 AI 同场闲聊</small>
            </span>
            <ChevronRight size={18} className="msgs-entry-chev" />
          </button>

          <div className="msgs-sep"><span>与角色的对话</span></div>

          {convs === null && (
            <div className="msgs-skel">{[0, 1, 2].map(i => <div key={i} className="msgs-skel-row" />)}</div>
          )}
          {convs && convs.length === 0 && (
            <div className="msgs-empty">
              <EmptyArt kind="chat" size={120} />
              <p>还没有对话 —— 去发现页挑一个角色开聊吧</p>
              <button className="btn primary sm" onClick={() => nav('/')}>去发现</button>
            </div>
          )}
          {convs && convs.map(cv => (
            <div key={cv.id} className="msgs-conv" role="button" tabIndex={0}
              onClick={() => nav('/chats/' + cv.id)}
              onKeyDown={e => e.key === 'Enter' && nav('/chats/' + cv.id)}>
              <Avatar src={cv.character_avatar} name={cv.character_name} size={50} />
              <div className="msgs-conv-tx">
                <b>{cv.character_name}</b>
                {/* 副标题优先展示最近一条消息摘要（面板消息显示「🎴 交互面板」占位），一眼续上剧情 */}
                <span>{msgPreview(cv.last_message) || (cv.title && cv.title !== cv.character_name ? cv.title : '点击继续对话')}</span>
              </div>
              {cv.affinity ? <span className="msgs-aff"><Flame size={11} /> {cv.affinity}</span> : null}
              <button className="msgs-del" onClick={e => delConv(e, cv)} aria-label="删除对话"><X size={15} /></button>
            </div>
          ))}
        </>
      ) : (
        <>
          {favs === null && (
            <div className="msgs-skel">{[0, 1, 2].map(i => <div key={i} className="msgs-skel-row" />)}</div>
          )}
          {favs && favs.length === 0 && (
            <div className="msgs-empty">
              <EmptyArt kind="library" size={120} />
              <p>还没有赞过的角色 —— 在发现流里双击卡面或点心心收藏</p>
              <button className="btn primary sm" onClick={() => nav('/')}>去逛逛</button>
            </div>
          )}
          {favs && favs.map(c => (
            <div key={c.id} className="msgs-conv" role="button" tabIndex={0}
              onClick={() => nav('/character/' + c.id)}
              onKeyDown={e => e.key === 'Enter' && nav('/character/' + c.id)}>
              {c.avatar
                ? <Avatar src={c.avatar} name={c.name} size={50} />
                : <div className="msgs-fav-ph"><CoverArt name={c.name} /></div>}
              <div className="msgs-conv-tx">
                <b>{c.name} <Heart size={12} className="msgs-fav-heart" fill="currentColor" /></b>
                <span>{c.tagline || `@${c.owner_name || '佚名'}`}</span>
              </div>
              <button className="msgs-chatgo" onClick={e => { e.stopPropagation(); chatFav(c); }}>
                <MessageCircle size={14} /> 续聊
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
