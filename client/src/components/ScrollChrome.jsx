import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';

// Thin top scroll-progress bar + a back-to-top button that fades in on long pages.
// Driven by window scroll (the app body scrolls; the topbar is sticky inside it).
export default function ScrollChrome() {
  const barRef = useRef(null);
  const btnRef = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let raf = 0;
    let shown = false;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - doc.clientHeight;
        const y = window.scrollY || doc.scrollTop || 0;
        const pct = max > 0 ? Math.min(1, y / max) : 0;
        // Write the progress bar directly — avoids a React re-render on every
        // scroll frame (the bar updates ~60×/s; reconciliation here is wasted).
        if (barRef.current) barRef.current.style.transform = `scaleX(${pct})`;
        const next = y > 560;
        if (next !== shown) { shown = next; setShow(next); } // re-render only on threshold cross
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <>
      <div ref={barRef} className="scroll-progress" style={{ transform: 'scaleX(0)' }} aria-hidden="true" />
      <button ref={btnRef} className={'to-top' + (show ? ' show' : '')} onClick={toTop} aria-label="回到顶部" title="回到顶部">
        <ArrowUp size={20} />
      </button>
    </>
  );
}
