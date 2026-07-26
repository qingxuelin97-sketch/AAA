import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Bell,
  CalendarCheck,
  Check,
  Compass,
  Crown,
  Home,
  ImagePlus,
  MessageCircle,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useNav } from '../nav.js';
import { AppButton, AppIconButton, AppTabButton } from '../components/AppControls.jsx';
import { AppEmptyArt } from '../art.jsx';
import AppErrorState from '../components/AppErrorState.jsx';
import AppPressMenu from '../components/AppPressMenu.jsx';
import ShareCardSheet from '../components/ShareCardSheet.jsx';
import { useLongPress } from '../chat/hooks.js';

const TABS = [
  { id: 'today', label: '今日', icon: Home },
  { id: 'discover', label: '发现', icon: Compass },
  { id: 'messages', label: '消息', icon: MessageCircle, badgeCount: 12 },
  { id: 'me', label: '我的', icon: UserRound },
];

// S7 展区的静态示例数据：条形与月历只演示状态语言，不接后端。
const DEMO_WEEK = [3, 0, 6, 2, 0, 4, 1];
const DEMO_CAL = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  on: [2, 3, 4, 8, 9, 15, 16, 17, 18].includes(i + 1),
  today: i + 1 === 18,
  future: i + 1 > 18,
}));

export default function AppControlsGallery() {
  const nav = useNav();
  const timerRef = useRef(null);
  const errTimerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [pressed, setPressed] = useState(true);
  const [activeTab, setActiveTab] = useState('today');
  const [errBusy, setErrBusy] = useState(false);
  const [pressAt, setPressAt] = useState(null);
  const [shareDemo, setShareDemo] = useState(false);
  const pressAnchorRef = useRef(null);
  const bindDemoPress = useLongPress(() => {
    const box = pressAnchorRef.current?.getBoundingClientRect();
    setPressAt(box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: 195, y: 420 });
  });

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (errTimerRef.current !== null) window.clearTimeout(errTimerRef.current);
  }, []);

  const demoRetry = () => {
    if (errTimerRef.current !== null) window.clearTimeout(errTimerRef.current);
    setErrBusy(true);
    errTimerRef.current = window.setTimeout(() => {
      errTimerRef.current = null;
      setErrBusy(false);
    }, 1200);
  };

  const demoLoading = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setLoading(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setLoading(false);
    }, 1200);
  };

  return (
    <main className="qa-gallery" data-testid="app-controls-gallery">
      <div className="qa-gallery__frame">
        <header className="qa-gallery__header">
          <AppIconButton label="返回" onClick={() => nav('/today')}>
            <ArrowLeft />
          </AppIconButton>
          <h1>静水青控件</h1>
          <span aria-hidden="true" />
        </header>

        <section className="qa-gallery__section" aria-labelledby="gallery-buttons">
          <h2 id="gallery-buttons">按钮 · 44 / 48</h2>
          <div className="qa-gallery__row">
            <AppButton variant="primary">主要按钮</AppButton>
            <AppButton variant="secondary">次要按钮</AppButton>
            <AppButton variant="tertiary">弱按钮</AppButton>
            <AppButton variant="danger">危险操作</AppButton>
            <AppButton variant="primary" size="lg">
              <Send size={16} />认证提交
            </AppButton>
          </div>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-states">
          <h2 id="gallery-states">状态与语义</h2>
          <div className="qa-gallery__row">
            <AppButton variant="primary" loading={loading} onClick={demoLoading}>
              加载演示
            </AppButton>
            <AppButton variant="secondary" disabled>不可用</AppButton>
            <AppButton
              variant="secondary"
              selected={pressed}
              pressed={pressed}
              onClick={() => setPressed((value) => !value)}
            >
              <Check size={16} />通知开关
            </AppButton>
            <AppButton
              as="a"
              href="#gallery-buttons"
              variant="secondary"
              disabled
              data-testid="disabled-control-link"
            >
              不可用链接
            </AppButton>
          </div>
          <p className="qa-gallery__note">
            selected 只负责视觉；开关另用 pressed 暴露 aria-pressed。不可用链接会阻止导航并退出 Tab 序列。
          </p>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-icons">
          <h2 id="gallery-icons">图标按钮 · 44</h2>
          <div className="qa-gallery__row">
            <AppIconButton label="搜索"><Search /></AppIconButton>
            <AppIconButton label="通知" variant="secondary"><Bell /></AppIconButton>
            <AppIconButton label="创建" variant="filled"><Plus /></AppIconButton>
            <AppIconButton label="已选择的搜索" selected><Search /></AppIconButton>
            <AppIconButton label="不可用通知" disabled><Bell /></AppIconButton>
          </div>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-tabs">
          <h2 id="gallery-tabs">四项导航与数字角标</h2>
          <nav className="qa-gallery__tabs" aria-label="控件示例导航">
            {TABS.map((tab) => (
              <AppTabButton
                key={tab.id}
                icon={tab.icon}
                label={tab.label}
                badgeCount={tab.badgeCount}
                selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </nav>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-colour">
          <h2 id="gallery-colour">表面与固定语义色</h2>
          <div className="qa-gallery__swatches" aria-label="静水青色彩联系表">
            <span className="qa-gallery__swatch qa-gallery__swatch--canvas">页面底</span>
            <span className="qa-gallery__swatch qa-gallery__swatch--grouped">分组底</span>
            <span className="qa-gallery__swatch qa-gallery__swatch--surface">内容面</span>
            <span className="qa-gallery__swatch qa-gallery__swatch--action">动作色</span>
            <span className="qa-gallery__swatch qa-gallery__swatch--danger">危险</span>
            <span className="qa-gallery__swatch qa-gallery__swatch--success">成功</span>
            <span className="qa-gallery__swatch qa-gallery__swatch--reward">奖励</span>
            <span className="qa-gallery__swatch qa-gallery__swatch--unread">未读</span>
          </div>
        </section>

        {/* ---- S7「仪式与相伴」展区：新组件家族的评审样板 ---- */}
        <section className="qa-gallery__section" aria-labelledby="gallery-s7-empty">
          <h2 id="gallery-s7-empty">空态艺术与恢复出口</h2>
          <div className="qa-gallery__row qa-gallery__art-row">
            <figure className="qa-gallery__art"><AppEmptyArt kind="insights" size={96} /><figcaption>insights</figcaption></figure>
            <figure className="qa-gallery__art"><AppEmptyArt kind="noresult" size={96} /><figcaption>noresult</figcaption></figure>
            <figure className="qa-gallery__art"><AppEmptyArt kind="group" size={96} /><figcaption>group</figcaption></figure>
          </div>
          <div className="qa-gallery__errdemo">
            <AppErrorState
              kind="generic"
              title="加载失败示例"
              message="错误态必须给出重试出口；这里的重试是 1.2s 演示循环"
              onRetry={demoRetry}
              busy={errBusy}
            />
          </div>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-s7-streak">
          <h2 id="gallery-s7-streak">连签周点与签到月历</h2>
          <div className="qa-streak qa-streak--wallet qa-gallery__streak" aria-label="连签示例：连签 5 天">
            <span className="qa-streak-dots" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => (
                <i key={i} className={'qa-streak-dot' + (i < 5 ? ' on' : '')} />
              ))}
            </span>
            <span className="qa-streak-copy">连签 5 天</span>
            <span className="qa-streak-cal"><CalendarCheck size={14} aria-hidden="true" /> 日历</span>
          </div>
          <div className="qa-cal-grid qa-gallery__cal" role="img" aria-label="签到月历状态示例：实心已签、描环今日、置灰未来">
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w} className="qa-cal-wd">{w}</span>)}
            {DEMO_CAL.map((c) => (
              <span
                key={c.day}
                className={'qa-cal-cell' + (c.on ? ' on' : '') + (c.today ? ' today' : '') + (c.future ? ' future' : '')}
              >
                {c.day}
              </span>
            ))}
          </div>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-s7-medal">
          <h2 id="gallery-s7-medal">奖章三档与荣誉</h2>
          <div className="qa-ach-medals qa-gallery__medals">
            <span data-medal="gold"><Award size={13} /> 金 3</span>
            <span data-medal="silver"><Award size={13} /> 银 7</span>
            <span data-medal="bronze"><Award size={13} /> 铜 12</span>
            <span className="qa-ach-honor-badge"><Crown size={11} /> 荣誉</span>
          </div>
          <p className="qa-gallery__note">
            奖章档位由奖励额推导（与 Web 同公式）；荣誉成就 reward 为 0、只铭刻不可领取。
          </p>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-s7-weekly">
          <h2 id="gallery-s7-weekly">周报条形与统计行</h2>
          <div className="qa-weekly-card qa-gallery__weekly">
            <div className="qa-weekly-bars" role="img" aria-label="本周逐日消息示例：周三最高 6 条，周六为今日">
              {DEMO_WEEK.map((n, i) => (
                <div key={i} className={'qa-weekly-bar' + (i === 5 ? ' today' : '')}>
                  <i style={{ height: (n ? Math.max(14, Math.round((n / 6) * 100)) : 5) + '%' }} />
                  <span aria-hidden="true">{'一二三四五六日'[i]}</span>
                </div>
              ))}
            </div>
            <div className="qa-weekly-stats">
              <span><b>16</b> 条消息</span>
              <span><b>4</b> 天相伴</span>
              <span><b>3</b> 次签到</span>
              <span className="qa-weekly-gold"><b>+320</b> 金币</span>
            </div>
          </div>
        </section>

        <section className="qa-gallery__section" aria-labelledby="gallery-s7-press">
          <h2 id="gallery-s7-press">长按菜单与分享卡</h2>
          <div className="qa-gallery__row">
            <AppButton
              ref={pressAnchorRef}
              variant="secondary"
              {...bindDemoPress('demo')}
              onContextMenu={(e) => {
                e.preventDefault();
                const box = pressAnchorRef.current?.getBoundingClientRect();
                setPressAt(box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: 195, y: 420 });
              }}
            >
              <Sparkles size={16} /> 长按此处
            </AppButton>
            <AppButton variant="primary" onClick={() => setShareDemo(true)}>
              <ImagePlus size={16} /> 生成示例台词卡
            </AppButton>
          </div>
          <p className="qa-gallery__note">
            长按 450ms（或右键）弹出上下文菜单：portal + role=menu + 焦点锁 + 回焦；
            分享卡为运行时 canvas 合成的导出内容，1080×1440 与 DPR 解耦。
          </p>
        </section>
      </div>
      {pressAt && (
        <AppPressMenu
          at={pressAt}
          returnFocusRef={pressAnchorRef}
          onClose={() => setPressAt(null)}
          items={[
            { label: '打开对话', icon: <MessageCircle size={16} />, onSelect: () => {} },
            { label: '生成分享卡', icon: <ImagePlus size={16} />, onSelect: () => setShareDemo(true) },
            { label: '删除（演示）', icon: <Trash2 size={16} />, danger: true, onSelect: () => {} },
          ]}
        />
      )}
      {shareDemo && (
        <ShareCardSheet
          kind="quote"
          payload={{
            text: '贤者之泉就在森林最深处。但旅人，泉水的恩赐一生只此一次。',
            speaker: '森灵·薇尔',
            avatar: '',
            date: '2026-07-26',
            path: '/app-controls',
          }}
          onClose={() => setShareDemo(false)}
        />
      )}
    </main>
  );
}
