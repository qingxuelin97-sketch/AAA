import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  Compass,
  Home,
  MessageCircle,
  Plus,
  Search,
  Send,
  UserRound,
} from 'lucide-react';
import { useNav } from '../nav.js';
import { AppButton, AppIconButton, AppTabButton } from '../components/AppControls.jsx';

const TABS = [
  { id: 'today', label: '今日', icon: Home },
  { id: 'discover', label: '发现', icon: Compass },
  { id: 'messages', label: '消息', icon: MessageCircle, badgeCount: 12 },
  { id: 'me', label: '我的', icon: UserRound },
];

export default function AppControlsGallery() {
  const nav = useNav();
  const timerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [pressed, setPressed] = useState(true);
  const [activeTab, setActiveTab] = useState('today');

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

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
      </div>
    </main>
  );
}
