import React, { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

// Thin top scroll-progress bar + a back-to-top button that fades in on long pages.
// Driven by window scroll (the app body scrolls; the topbar is sticky inside it).
export default function ScrollChrome() {
  const [pct, setPct] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - doc.clientHeight;
        const y = window.scrollY || doc.scrollTop || 0;
        setPct(max > 0 ? Math.min(100, (y / max) * 100) : 0);
        setShow(y > 560);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <>
      <div className="scroll-progress" style={{ transform: `scaleX(${pct / 100})` }} aria-hidden="true" />
      <button className={'to-top' + (show ? ' show' : '')} onClick={toTop} aria-label="回到顶部" title="回到顶部">
        <ArrowUp size={20} />
      </button>
    </>
  );
}
