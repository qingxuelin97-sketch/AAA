import React, { useId, useState } from 'react';
import { useNav } from '../nav.js';
import BakedScreen, { PinkHit } from './BakedScreen.jsx';

const openCmdk = () => { try { window.dispatchEvent(new Event('huanyu-cmdk')); } catch { /* */ } };

export default function PinkDiscover({ character, liked, faved, mode, onMode, onLike, onFavorite, onShare, onChat, onCall }) {
  const nav = useNav();
  const [draft, setDraft] = useState('');
  const draftId = `pink-discover-${useId().replace(/:/g, '')}`;
  const submit = (event) => {
    event.preventDefault();
    if (character) onChat?.(character, draft.trim());
  };
  return (
    <BakedScreen screen="discover">
      <PinkHit className="pink-discover-follow" label="关注" aria-pressed={mode === 'follow'} onClick={() => onMode?.('follow')} />
      <PinkHit className="pink-discover-recommend" label="推荐" aria-pressed={mode === 'recommend'} onClick={() => onMode?.('recommend')} />
      <PinkHit className="pink-discover-new" label="新作" aria-pressed={mode === 'new'} onClick={() => onMode?.('new')} />
      <PinkHit className="pink-discover-search" label="搜索" onClick={openCmdk} />
      <PinkHit className="pink-discover-heart" label={liked ? '取消心动' : '心动'} aria-pressed={liked} onClick={() => character && onLike?.(character)} />
      <PinkHit className="pink-discover-comment" label="查看角色详情" onClick={() => character?.id && nav('/character/' + character.id)} />
      <PinkHit className="pink-discover-favorite" label={faved ? '取消收藏' : '收藏'} aria-pressed={faved} onClick={() => character && onFavorite?.(character)} />
      <PinkHit className="pink-discover-share" label="分享" onClick={() => character && onShare?.(character)} />
      <PinkHit className="pink-discover-profile" label={`查看${character?.name || '林晚栀'}`} onClick={() => character?.id && nav('/character/' + character.id)} />
      <form className="pink-discover-composer" onSubmit={submit}>
        <label className="pink-sr-only" htmlFor={draftId}>和她说点什么</label>
        <input id={draftId} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="和她说点什么..." />
      </form>
      <PinkHit className="pink-discover-voice" label="语音通话" onClick={() => character && onCall?.(character)} />
    </BakedScreen>
  );
}
