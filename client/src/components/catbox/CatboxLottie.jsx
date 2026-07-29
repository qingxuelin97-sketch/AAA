import React, { useEffect, useRef, useState } from 'react';
import lottie from 'lottie-web/build/player/lottie_light';

const SOURCES = Object.freeze({
  doubleTapLike: '/reference-lottie/double-tap-like.json',
  chatBubbleLike: '/reference-lottie/chat-bubble-like.json',
  chatBubbleDislike: '/reference-lottie/chat-bubble-dislike.json',
  doubleTapGuide: '/reference-lottie/gesture-double-tap.json',
  longPressGuide: '/reference-lottie/gesture-long-press.json',
  swipeLeftGuide: '/reference-lottie/gesture-swipe-left.json',
  swipeUpGuide: '/reference-lottie/gesture-swipe-up.json',
});

export default function CatboxLottie({
  name,
  className = '',
  loop = false,
  autoplay = true,
  ariaLabel,
  onComplete,
  fallback = null,
}) {
  const nodeRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  ));

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = (event) => setReducedMotion(event.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!nodeRef.current || !SOURCES[name] || reducedMotion) return undefined;
    const animation = lottie.loadAnimation({
      container: nodeRef.current,
      renderer: 'svg',
      loop,
      autoplay,
      path: SOURCES[name],
      rendererSettings: { progressiveLoad: true, preserveAspectRatio: 'xMidYMid meet' },
    });
    if (onComplete) animation.addEventListener('complete', onComplete);
    return () => {
      if (onComplete) animation.removeEventListener('complete', onComplete);
      animation.destroy();
    };
  }, [name, loop, autoplay, onComplete, reducedMotion]);

  return (
    <span
      ref={nodeRef}
      className={`catbox-lottie catbox-lottie--${name} ${className}`.trim()}
      data-reference-asset={`lottie:${name}`}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {reducedMotion && fallback ? <span className="catbox-lottie__fallback">{fallback}</span> : null}
    </span>
  );
}

export { SOURCES as CATBOX_LOTTIE_SOURCES };
