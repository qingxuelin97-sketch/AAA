import React from 'react';
import { Heart, MessageCircle, Star, Share2, History } from 'lucide-react';

// App-only action rail. Keeping the controls in a component makes the card's
// media layer independent from its interaction state and lets every action
// retain a 44px target when the card is scaled on smaller phones.
export default function DiscoverActionRail({ character, liked, faved, uses, onLike, onFavorite, onComments, onShare, onHistory }) {
  const actions = [
    { id: 'like', label: liked ? '已心动' : '心动', pressed: liked, icon: Heart, onClick: onLike, tone: 'rose' },
    { id: 'favorite', label: faved ? '已藏' : '收藏', pressed: faved, icon: Star, onClick: onFavorite, tone: 'gold' },
    { id: 'comments', label: uses > 9999 ? `${(uses / 10000).toFixed(1)}w` : String(uses || 0), icon: MessageCircle, onClick: onComments },
    { id: 'share', label: '分享', icon: Share2, onClick: onShare },
    { id: 'history', label: '历史', icon: History, onClick: onHistory },
  ];

  return (
    <nav className="fd2-acts cbx-action-rail" aria-label={`${character.name} 的操作`}>
      {actions.map(({ id, label, pressed, icon: Icon, onClick, tone }) => (
        <button
          key={id}
          type="button"
          className={`fd2-act cbx-action-rail__button${pressed ? ' on' : ''}${tone === 'gold' && pressed ? ' gold' : ''}`}
          data-action={id}
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          <Icon size={24} fill={pressed ? 'currentColor' : 'none'} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
