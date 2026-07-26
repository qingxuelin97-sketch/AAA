// 消息中心 —— app 壳「消息」tab 的聚合页。
// 顶部「赞过 | 聊过」双分段（对标主流角色社区的消息信息架构）：
//   聊过 = 会话列表 + 互动消息（通知）/ 好友私信 / 群聊 三个入口行；
//   赞过 = 收藏过的角色（随手回访、一键续聊）。
// 全部数据来自既有端点，无新协议：/chat/conversations · /characters/favorites/list
// /social/notifications · /dm。SSE 到达时角标秒级刷新。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNav } from '../nav.js';
import { api } from '../api.jsx';
import { useRealtimeEvent } from '../realtime.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { EmptyArt, CoverArt, QuietAquaCharacterArt, isLegacyMonogramCover } from '../art.jsx';
import { msgPreview } from '../util.js';
import { Logo } from '../assets.jsx';
import { isAppMode } from '../appmode.js';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { useAppOverlay } from '../overlay.jsx';
import { useAppTabActive } from '../appTabActivity.js';
import {
  Bell, ChevronRight, Heart, MessageCircle, Search, UserRound, Users, X, Flame, Ellipsis
} from 'lucide-react';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

function AppSection({ appMode, children, ...props }) {
  return appMode ? <section {...props}>{children}</section> : <>{children}</>;
}

function AppPortraitFallback({ name }) {
  return <QuietAquaCharacterArt className="msgs-fav-art" alt={name ? `${name}角色封面` : '角色封面'} loading="lazy" />;
}

const conversationTime = (conversation) => {
  const raw = conversation?.updated_at || conversation?.last_message_at || conversation?.last_at;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

function AppConversationRow({ cv, nav, onDelete }) {
  const time = conversationTime(cv);
  const open = () => nav('/chats/' + cv.id);
  return (
    <div className="msgs-conv msgs-conv--app">
      <button type="button" className="msgs-conv-main" onClick={open}>
        {isLegacyMonogramCover(cv.character_avatar)
          ? <span className="msgs-fav-ph"><AppPortraitFallback name={cv.character_name} /></span>
          : <Avatar src={cv.character_avatar} name={cv.character_name} size={50} />}
        <span className="msgs-conv-tx">
          <b>{cv.character_name}</b>
          <span>{msgPreview(cv.last_message) || (cv.title && cv.title !== cv.character_name ? cv.title : '点击继续对话')}</span>
        </span>
        <span className="msgs-conv-meta">
          {time && <time dateTime={cv.updated_at || cv.last_message_at || cv.last_at}>{time}</time>}
          {cv.affinity ? <span className="msgs-aff"><Flame size={11} /> {cv.affinity}</span> : null}
        </span>
      </button>
      <AppIconButton className="msgs-del" onClick={event => onDelete(event, cv)} label={`管理与${cv.character_name || '角色'}的对话`}>
        <Ellipsis size={17} />
      </AppIconButton>
    </div>
  );
}

function AppFavoriteRow({ character, nav, onChat }) {
  return (
    <div className="msgs-conv msgs-conv--app">
      <button type="button" className="msgs-conv-main" onClick={() => nav('/character/' + character.id)}>
        {character.avatar && !isLegacyMonogramCover(character.avatar)
          ? <Avatar src={character.avatar} name={character.name} size={50} />
          : <span className="msgs-fav-ph"><AppPortraitFallback name={character.name} /></span>}
        <span className="msgs-conv-tx">
          <b>{character.name} <Heart size={12} className="msgs-fav-heart" fill="currentColor" /></b>
          <span>{character.tagline || `@${character.owner_name || '佚名'}`}</span>
        </span>
      </button>
      <AppButton className="msgs-chatgo" size="sm" onClick={() => onChat(character)}>
        <MessageCircle size={14} /> 续聊
      </AppButton>
    </div>
  );
}

export default function Messages() {
  const nav = useNav();
  const toast = useToast();
  const appMode = isAppMode();
  const [tab, setTab] = useState('chatted'); // 'liked' | 'chatted'
  const [convs, setConvs] = useState(null);  // null = loading
  const [favs, setFavs] = useState(null);
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [convError, setConvError] = useState('');
  const [favError, setFavError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDialogRef = useRef(null);
  const deleteTriggerRef = useRef(null);
  const closeDeleteDialog = () => {
    if (!deleting) setDeleteTarget(null);
  };
  useAppOverlay(Boolean(deleteTarget), closeDeleteDialog, {
    rootRef: deleteDialogRef,
    isolate: true,
    returnFocusRef: deleteTriggerRef,
  });

  const loadConvs = () => {
    setConvError('');
    return api('/chat/conversations')
      .then(d => setConvs(d.conversations || []))
      .catch((error) => { setConvs([]); setConvError(error.message || '暂时无法载入对话'); });
  };
  useEffect(() => {
    loadConvs();
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
    api('/dm').then(d => setDmUnread(d.unread_total || 0)).catch(() => {});
  }, []);
  useEffect(() => {
    if (tab === 'liked' && favs === null) {
      setFavError('');
      api('/characters/favorites/list')
        .then(d => setFavs(d.characters || []))
        .catch((error) => { setFavs([]); setFavError(error.message || '暂时无法载入收藏'); });
    }
  }, [tab, favs]);

  useRealtimeEvent('notification', () => setUnread(u => u + 1));
  useRealtimeEvent('dm', () => { api('/dm').then(d => setDmUnread(d.unread_total || 0)).catch(() => {}); });
  useEffect(() => {
    if (!appMode) return undefined;
    const clear = () => setUnread(0);
    window.addEventListener('huanyu-noti-read', clear);
    return () => window.removeEventListener('huanyu-noti-read', clear);
  }, [appMode]);
  useAppTabActive('/messages', () => {
    if (!appMode) return;
    loadConvs();
    api('/social/notifications').then(d => setUnread(d.unread || 0)).catch(() => {});
    api('/dm').then(d => setDmUnread(d.unread_total || 0)).catch(() => {});
    if (tab === 'liked') {
      setFavError('');
      api('/characters/favorites/list')
        .then(d => setFavs(d.characters || []))
        .catch((error) => { setFavError(error.message || '暂时无法载入收藏'); });
    }
  });

  const removeConv = async (cv) => {
    if (appMode) {
      if (deleting) return;
      setDeleting(true);
    }
    try {
      await api('/chat/conversations/' + cv.id, { method: 'DELETE' });
      if (appMode) {
        setConvs(rows => (rows || []).filter(row => row.id !== cv.id));
        setDeleteTarget(null);
        toast('对话已删除');
      } else {
        loadConvs();
      }
    } catch (err) { toast(err.message, 'err'); }
    finally { if (appMode) setDeleting(false); }
  };
  const delConv = async (e, cv) => {
    e.stopPropagation();
    if (appMode) {
      deleteTriggerRef.current = e.currentTarget;
      setDeleteTarget(cv);
      return;
    }
    if (!confirm('删除该对话？')) return;
    await removeConv(cv);
  };
  const chatFav = async (c) => {
    try { const d = await api('/chat/conversations', { method: 'POST', body: { character_id: c.id } }); nav('/chats/' + d.conversation.id); }
    catch (error) {
      if (appMode) toast(error.message || '暂时无法开始对话', 'err');
      else nav('/character/' + c.id);
    }
  };

  return (
    <div className={appMode ? 'msgs qa-messages-page qa3-messages' : 'msgs'}>
      {appMode ? (
        <>
          <header className="msgs-head">
            <h1>消息</h1>
            <AppIconButton className="msgs-search" onClick={openCmdk} label="搜索"><Search size={20} /></AppIconButton>
          </header>
          <div className="msgs-tabs" role="tablist" aria-label="消息筛选">
            <AppButton variant="tertiary" selected={tab === 'chatted'} role="tab" aria-selected={tab === 'chatted'}
              className={tab === 'chatted' ? 'on' : ''} onClick={() => setTab('chatted')}>聊过</AppButton>
            <AppButton variant="tertiary" selected={tab === 'liked'} role="tab" aria-selected={tab === 'liked'}
              className={tab === 'liked' ? 'on' : ''} onClick={() => setTab('liked')}>收藏</AppButton>
          </div>
        </>
      ) : (
        <div className="msgs-head">
          <span className="msgs-logo" aria-hidden="true"><Logo size={30} /></span>
          <div className="msgs-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'chatted'} className={tab === 'chatted' ? 'on' : ''} onClick={() => setTab('chatted')}>聊过</button>
            <button role="tab" aria-selected={tab === 'liked'} className={tab === 'liked' ? 'on' : ''} onClick={() => setTab('liked')}>赞过</button>
          </div>
          <button className="msgs-search" onClick={openCmdk} aria-label="搜索"><Search size={20} /></button>
        </div>
      )}

      {tab === 'chatted' ? (
        <>
          <AppSection appMode={appMode} className="msgs-entry-group" aria-label="消息入口">
            <button className="msgs-entry" onClick={() => appMode
              ? nav('/notifications', { state: { appBackTo: '/messages' } })
              : nav('/notifications')}>
              <span className="msgs-entry-ic noti"><Bell size={20} /></span>
              <span className="msgs-entry-tx">
                <b>互动消息</b>
                <small>{unread > 0 ? `${unread} 条新的赞 · 评论 · 关注` : appMode ? '有人回应了你的故事或评论' : '点击查看互动消息'}</small>
              </span>
              {unread > 0 && <i className="msgs-badge">{unread > 99 ? '99+' : unread}</i>}
              <ChevronRight size={18} className="msgs-entry-chev" />
            </button>
            <button className="msgs-entry" onClick={() => nav('/friends')}>
              <span className="msgs-entry-ic dm"><UserRound size={20} /></span>
              <span className="msgs-entry-tx">
                <b>好友私信</b>
                <small>{dmUnread > 0 ? `${dmUnread} 条未读私信` : appMode ? '新消息和私信通知' : '和创作者们聊聊'}</small>
              </span>
              {dmUnread > 0 && <i className="msgs-badge">{dmUnread > 99 ? '99+' : dmUnread}</i>}
              <ChevronRight size={18} className="msgs-entry-chev" />
            </button>
            <button className="msgs-entry" onClick={() => nav('/groups')}>
              <span className="msgs-entry-ic grp"><Users size={20} /></span>
              <span className="msgs-entry-tx"><b>群聊房间</b><small>{appMode ? '你加入的群聊更新' : '多人多 AI 同场闲聊'}</small></span>
              <ChevronRight size={18} className="msgs-entry-chev" />
            </button>
          </AppSection>

          {appMode
            ? <h2 className="msgs-section-title">与角色的对话</h2>
            : <div className="msgs-sep"><span>与角色的对话</span></div>}
          <AppSection appMode={appMode} className="msgs-conv-group" aria-label="角色对话">
            {convs === null && (
              <div className="msgs-skel">{[0, 1, 2].map(i => <div key={i} className="msgs-skel-row" />)}</div>
            )}
            {appMode && convs && convs.length === 0 && convError && (
              <div className="msgs-empty msgs-error" role="alert">
                <p>{convError}</p>
                <AppButton variant="secondary" size="sm" onClick={() => { setConvs(null); loadConvs(); }}>重新载入</AppButton>
              </div>
            )}
            {!appMode && convs && convs.length === 0 && convError && (
              <div className="msgs-empty msgs-error lgw-error" role="alert">
                <span className="lgw-error-ic"><MessageCircle size={20} /></span>
                <p className="lgw-error-msg">{convError}</p>
                <button className="btn primary lgw-error-retry" onClick={() => { setConvs(null); loadConvs(); }}>重新载入</button>
              </div>
            )}
            {convs && convs.length === 0 && !convError && (
              <div className="msgs-empty">
                <EmptyArt kind="chat" size={120} />
                <p>还没有对话 —— 去发现页挑一个角色开聊吧</p>
                <AppButton className="btn primary sm" variant="primary" size="sm" onClick={() => nav('/')}>去发现</AppButton>
              </div>
            )}
            {convs && convs.map(cv => (
              appMode ? (
                <AppConversationRow key={cv.id} cv={cv} nav={nav} onDelete={delConv} />
              ) : (
              <div key={cv.id} className="msgs-conv" role="button" tabIndex={0}
                onClick={() => nav('/chats/' + cv.id)}
                onKeyDown={e => e.key === 'Enter' && nav('/chats/' + cv.id)}>
                {appMode && isLegacyMonogramCover(cv.character_avatar)
                  ? <div className="msgs-fav-ph"><CoverArt name={cv.character_name} /></div>
                  : <Avatar src={cv.character_avatar} name={cv.character_name} size={50} />}
                <div className="msgs-conv-tx">
                  <b>{cv.character_name}</b>
                  <span>{msgPreview(cv.last_message) || (cv.title && cv.title !== cv.character_name ? cv.title : '点击继续对话')}</span>
                </div>
                {cv.affinity ? <span className="msgs-aff"><Flame size={11} /> {cv.affinity}</span> : null}
                <button className="msgs-del" onClick={e => delConv(e, cv)} aria-label="删除对话"><X size={15} /></button>
              </div>
              )
            ))}
          </AppSection>
        </>
      ) : (
        <>
          <AppSection appMode={appMode} className="msgs-conv-group msgs-liked-group" aria-label="收藏的角色">
          {favs === null && (
            <div className="msgs-skel">{[0, 1, 2].map(i => <div key={i} className="msgs-skel-row" />)}</div>
          )}
          {appMode && favs && favs.length === 0 && favError && (
            <div className="msgs-empty msgs-error" role="alert">
              <p>{favError}</p>
              <AppButton variant="secondary" size="sm" onClick={() => setFavs(null)}>重新载入</AppButton>
            </div>
          )}
          {!appMode && favs && favs.length === 0 && favError && (
            <div className="msgs-empty msgs-error lgw-error" role="alert">
              <span className="lgw-error-ic"><Heart size={20} /></span>
              <p className="lgw-error-msg">{favError}</p>
              <button className="btn primary lgw-error-retry" onClick={() => setFavs(null)}>重新载入</button>
            </div>
          )}
          {favs && favs.length === 0 && !favError && (
            <div className="msgs-empty">
              <EmptyArt kind="library" size={120} />
              <p>{appMode
                ? '还没有收藏的角色 —— 在发现流点星标即可稍后回访'
                : '还没有赞过的角色 —— 在发现流里双击卡面或点心心收藏'}</p>
              <AppButton className="btn primary sm" variant="primary" size="sm" onClick={() => nav('/')}>去逛逛</AppButton>
            </div>
          )}
          {favs && favs.map(c => (
            appMode ? (
              <AppFavoriteRow key={c.id} character={c} nav={nav} onChat={chatFav} />
            ) : (
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
              <AppButton className="msgs-chatgo" size="sm" onClick={e => { e.stopPropagation(); chatFav(c); }}>
                <MessageCircle size={14} /> 续聊
              </AppButton>
            </div>
            )
          ))}
          </AppSection>
        </>
      )}

      {appMode && deleteTarget && typeof document !== 'undefined' && createPortal(
        <div className="app-sheet-mask msgs-delete-mask" onClick={closeDeleteDialog}>
          <section ref={deleteDialogRef} className="msgs-delete-sheet" role="alertdialog" aria-modal="true"
            aria-labelledby="msgs-delete-title" aria-describedby="msgs-delete-copy"
            aria-busy={deleting || undefined} tabIndex={-1}
            onClick={event => event.stopPropagation()}>
            <h2 id="msgs-delete-title">删除这段对话？</h2>
            <p id="msgs-delete-copy">与「{deleteTarget.character_name || '角色'}」的这段云端对话记录将被删除，此操作无法撤销。</p>
            <div className="msgs-delete-actions">
              <AppButton variant="tertiary" disabled={deleting} onClick={closeDeleteDialog}>取消</AppButton>
              <AppButton variant="danger" tone="danger" loading={deleting} onClick={() => removeConv(deleteTarget)}>删除</AppButton>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
