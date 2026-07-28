import React, { useEffect, useRef, useState } from 'react';

/*
 * 仪与匣 · split-flap 翻牌读数（SPEC §5：值变化 → 上半页 130ms 折下 +
 * 下半页 130ms 展开，多位数字按位错峰 40ms，一次播完即止）。
 * 旧值只经 data-ch 由 CSS content 呈现，不进文本流 —— e2e / 读屏读到的
 * 始终是当前值。reduced-motion 下时长令牌归零 = 直达终值。
 */
export default function IxFlip({ value, className }) {
  const text = String(value ?? '');
  const [prev, setPrev] = useState(null);
  const lastRef = useRef(text);
  useEffect(() => {
    if (text === lastRef.current) return;
    setPrev(lastRef.current);
    lastRef.current = text;
    // 130+130ms 加满错峰（≤8 位）后清场；reduced-motion 下动画为 0ms，清场只是移除节点
    const t = setTimeout(() => setPrev(null), 620);
    return () => clearTimeout(t);
  }, [text]);

  const chars = [...text];
  const prevChars = prev === null ? null : [...prev];
  return (
    <span className={'ix-flip' + (className ? ' ' + className : '')}>
      {chars.map((ch, i) => (
        <span className={'ix-flip-cell' + (prevChars && prevChars[i] !== ch ? ' turn' : '')} key={`${i}-${chars.length}`} style={{ '--ix-flip-i': i }}>
          <span className="ix-flip-ch">{ch}</span>
          {prevChars && prevChars[i] !== ch && prevChars[i] !== undefined && (
            <span className="ix-flip-old" data-ch={prevChars[i]} aria-hidden="true" />
          )}
        </span>
      ))}
    </span>
  );
}
