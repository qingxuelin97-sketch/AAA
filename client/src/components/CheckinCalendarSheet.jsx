// S7 · 签到日历底部 Sheet（数据源：GET /economy/checkin/calendar，
// 由 transactions 推导的北京日签到史；月导航钳制近 12 个月）。
// 结构契约：portal + useAppOverlay 隔离 + grabber，同 CreateSheet 语义。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { api } from '../api.jsx';
import { useAppOverlay } from '../overlay.jsx';
import { isAppMode } from '../appmode.js';
import { streakSealForTier } from '../art.jsx';
import { AppIconButton } from './AppControls.jsx';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const monthIndexOf = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
};
const ymOf = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

export default function CheckinCalendarSheet({ onClose, returnFocusRef }) {
  const appPortal = isAppMode();
  const sheetRef = useRef(null);
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  useAppOverlay(true, onClose, { rootRef: sheetRef, isolate: appPortal, returnFocusRef });

  const load = (ym) => {
    setErr(false);
    api('/economy/checkin/calendar' + (ym ? `?month=${ym}` : ''))
      .then((d) => { setData(d); setMonth(d.month); })
      .catch(() => setErr(true));
  };
  useEffect(() => { load(''); }, []);

  const todayYm = data ? data.today.slice(0, 7) : '';
  const idx = month ? monthIndexOf(month) : 0;
  const canPrev = data && todayYm && monthIndexOf(todayYm) - idx < 11;
  const canNext = data && todayYm && idx < monthIndexOf(todayYm);

  // 北京日历几何：某月 1 日星期几 + 当月天数（纯日历运算，与宿主时区无关）
  let cells = [];
  if (data) {
    const [y, m] = month.split('-').map(Number);
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const marked = new Set(data.days);
    const todayDay = todayYm === month ? Number(data.today.slice(8)) : null;
    cells = [
      ...Array.from({ length: lead }, (_, i) => ({ key: 'pad' + i, pad: true })),
      ...Array.from({ length: total }, (_, i) => {
        const day = i + 1;
        return {
          key: 'd' + day,
          day,
          checked: marked.has(day),
          isToday: day === todayDay,
          future: todayYm === month && day > todayDay,
        };
      }),
    ];
  }

  const sheet = (
    <div className="app-sheet-mask qa-cal-mask" onClick={onClose}>
      <div
        ref={sheetRef}
        className="app-sheet qa-cal"
        role="dialog"
        aria-modal="true"
        aria-label="签到日历"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-sheet-grip" aria-hidden="true" />
        <header className="qa-cal-head">
          <img className="qa-cal-seal" src={streakSealForTier(data?.streak || 0)} width={54} height={54} alt="" draggable="false" />
          <div className="qa-cal-head-copy">
            <b>签到日历</b>
            <span className="qa-cal-streak">
              <Flame size={13} aria-hidden="true" /> 连续 {data?.streak ?? '—'} 天 · 本月 {data?.month_total ?? '—'} 次
            </span>
            {/* S7-G10 里程碑地平线：下一档（7 的倍数 / 30 / 100）还差几天 */}
            {Number.isFinite(data?.streak) && (() => {
              const s = data.streak;
              const target = Math.min(...[Math.ceil((s + 1) / 7) * 7, 30, 100].filter((t) => t > s));
              return <span className="qa-cal-horizon">距 {target} 天里程碑还差 {target - s} 天</span>;
            })()}
          </div>
          <div className="qa-cal-nav">
            <AppIconButton label="上一月" disabled={!canPrev} onClick={() => canPrev && load(ymOf(idx - 1))}>
              <ChevronLeft size={18} />
            </AppIconButton>
            <span className="qa-cal-month" aria-live="polite">{month || '…'}</span>
            <AppIconButton label="下一月" disabled={!canNext} onClick={() => canNext && load(ymOf(idx + 1))}>
              <ChevronRight size={18} />
            </AppIconButton>
          </div>
        </header>

        {err ? (
          <p className="qa-cal-error" role="alert">
            日历暂时打不开
            <button type="button" onClick={() => load(month)}>重试</button>
          </p>
        ) : (
          <div className="qa-cal-grid" role="grid" aria-label={`${month} 签到记录`}>
            {WEEKDAYS.map((w) => <span key={w} className="qa-cal-wd" role="columnheader">{w}</span>)}
            {cells.map((c) => c.pad
              ? <span key={c.key} className="qa-cal-cell pad" aria-hidden="true" />
              : (
                <span
                  key={c.key}
                  role="gridcell"
                  className={'qa-cal-cell' + (c.checked ? ' on' : '') + (c.isToday ? ' today' : '') + (c.future ? ' future' : '')}
                  aria-label={`${month}-${String(c.day).padStart(2, '0')}${c.checked ? '，已签到' : ''}${c.isToday ? '，今天' : ''}`}
                >
                  {c.day}
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  );

  return appPortal && typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}
