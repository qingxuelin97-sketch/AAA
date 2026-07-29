import React, { forwardRef, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Copy,
  Flag,
  Heart,
  MessageCircleReply,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Share2,
  ThumbsDown,
  Trash2,
  Volume2,
} from 'lucide-react';
import { APP_CHAT_MESSAGE_ACTIONS } from '../../appReference.js';
import { AppIconButton } from '../AppControls.jsx';
import { AppMaterialSurface } from '../AppMaterialSurface.jsx';
import CatboxLottie from './CatboxLottie.jsx';

const ACTION_META = Object.freeze({
  like: { label: '喜欢', Icon: Heart },
  dislike: { label: '不喜欢', Icon: ThumbsDown },
  report: { label: '举报', Icon: Flag },
  share: { label: '分享', Icon: Share2 },
  replay: { label: '重新生成', Icon: RefreshCcw },
  chatShare: { label: '分享台词', Icon: MessageCircleReply },
});

export const CatboxChatMediaHeader = forwardRef(function CatboxChatMediaHeader(
  { as = 'header', className = '', children, ...props },
  ref,
) {
  return (
    <AppMaterialSurface
      as={as}
      ref={ref}
      variant="clear"
      className={`catbox-chat-media-header ${className}`.trim()}
      data-reference-component="chat-media-header"
      {...props}
    >
      {children}
    </AppMaterialSurface>
  );
});

export const CatboxChatComposerSurface = forwardRef(function CatboxChatComposerSurface(
  { as = 'footer', className = '', children, ...props },
  ref,
) {
  return (
    <AppMaterialSurface
      as={as}
      ref={ref}
      variant="regular"
      className={`catbox-chat-composer ${className}`.trim()}
      data-reference-component="chat-composer"
      {...props}
    >
      {children}
    </AppMaterialSurface>
  );
});

export function CatboxChatMessageFrame({ className = '', speakerRole, children, ...props }) {
  return (
    <AppMaterialSurface
      as="article"
      variant="standard"
      className={`catbox-chat-message catbox-chat-message--${speakerRole || 'assistant'} ${className}`.trim()}
      data-reference-component="chat-message-card"
      data-speaker={speakerRole || 'assistant'}
      {...props}
    >
      {children}
    </AppMaterialSurface>
  );
}

export function CatboxChatActionBar({
  message,
  disabled = false,
  isLast = false,
  isPlaying = false,
  isBookmarked = false,
  onLike,
  onDislike,
  onReport,
  onShare,
  onReplay,
  onChatShare,
  onSpeak,
  onCopy,
  onReply,
  onBookmark,
  onEdit,
  onDelete,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactionBurst, setReactionBurst] = useState('');
  const isAssistant = message?.role === 'assistant';
  const ordered = useMemo(
    () => APP_CHAT_MESSAGE_ACTIONS.map((id) => ({ id, ...ACTION_META[id] })).filter((item) => item.Icon),
    [],
  );

  const invoke = (id) => {
    const handlers = {
      like: onLike,
      dislike: onDislike,
      report: onReport,
      share: onShare,
      replay: onReplay,
      chatShare: onChatShare,
    };
    handlers[id]?.(message);
    if (id === 'like') setReactionBurst('chatBubbleLike');
    if (id === 'dislike') setReactionBurst('chatBubbleDislike');
  };

  useEffect(() => {
    if (!reactionBurst) return undefined;
    const timer = window.setTimeout(() => setReactionBurst(''), 920);
    return () => window.clearTimeout(timer);
  }, [reactionBurst]);

  if (!isAssistant) {
    return (
      <div className="catbox-chat-user-actions" aria-label="我的消息操作">
        <button type="button" onClick={() => onEdit?.(message)} disabled={disabled}><Pencil size={14} />编辑</button>
        <button type="button" onClick={() => onReply?.(message)}><MessageCircleReply size={14} />引用</button>
        <button type="button" onClick={() => onCopy?.(message)}><Copy size={14} />复制</button>
        <button type="button" className="danger" onClick={() => onDelete?.(message)} disabled={disabled}><Trash2 size={14} />删除</button>
      </div>
    );
  }

  return (
    <div
      className="catbox-chat-actions"
      data-reference-component="chat-action-bar"
      data-action-order={APP_CHAT_MESSAGE_ACTIONS.join(',')}
    >
      {reactionBurst && (
        <CatboxLottie
          name={reactionBurst}
          className="catbox-chat-actions__burst"
          onComplete={() => setReactionBurst('')}
          fallback={reactionBurst === 'chatBubbleDislike'
            ? <ThumbsDown size={34} fill="currentColor" />
            : <Heart size={34} fill="currentColor" />}
        />
      )}
      <div className="catbox-chat-actions__primary" role="toolbar" aria-label="角色消息操作">
        {ordered.map(({ id, label, Icon }) => {
          const unavailable = disabled
            || (id === 'replay' && !isLast)
            || (id === 'chatShare' && !message?.content);
          return (
            <AppIconButton
              key={id}
              className={`catbox-chat-action catbox-chat-action--${id}`}
              label={label}
              disabled={unavailable}
              onClick={() => invoke(id)}
              selected={id === 'like' && message?.reaction === '❤️'}
            >
              <Icon size={15} fill={id === 'like' && message?.reaction === '❤️' ? 'currentColor' : 'none'} />
            </AppIconButton>
          );
        })}
        <AppIconButton
          className="catbox-chat-action catbox-chat-action--more"
          label="更多消息操作"
          pressed={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <MoreHorizontal size={16} />
        </AppIconButton>
      </div>
      {moreOpen && (
        <AppMaterialSurface variant="regular" className="catbox-chat-actions__more" role="menu">
          <button type="button" role="menuitem" onClick={() => { onSpeak?.(message); setMoreOpen(false); }}>
            <Volume2 size={15} />{isPlaying ? '停止播放' : '朗读'}
          </button>
          <button type="button" role="menuitem" onClick={() => { onCopy?.(message); setMoreOpen(false); }}>
            <Copy size={15} />复制
          </button>
          <button type="button" role="menuitem" onClick={() => { onReply?.(message); setMoreOpen(false); }}>
            <MessageCircleReply size={15} />引用回复
          </button>
          <button type="button" role="menuitem" onClick={() => { onBookmark?.(message); setMoreOpen(false); }}>
            <Bookmark size={15} />{isBookmarked ? '取消书签' : '加入书签'}
          </button>
          <button type="button" role="menuitem" className="danger" disabled={disabled}
            onClick={() => { onDelete?.(message); setMoreOpen(false); }}>
            <Trash2 size={15} />删除
          </button>
        </AppMaterialSurface>
      )}
    </div>
  );
}
