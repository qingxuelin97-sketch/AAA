// S7-G10 · 「新功能」Sheet：超级更新的自我介绍。纯静态清单（随版本手工
// 维护），App 专属入口（我的页页脚）；遵循 App overlay 隔离契约。
import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, CalendarCheck, Trophy, ImagePlus, Hand, Orbit,
  Pin, PenLine, BellRing, ListChecks,
} from 'lucide-react';
import { useAppOverlay } from '../overlay.jsx';
import { isAppMode } from '../appmode.js';
import { AppButton } from './AppControls.jsx';

export const WHATS_NEW_VERSION = 'S7';

const FEATURES = [
  { ic: Sparkles, title: '首启引导与兴趣画像', desc: '三屏世界观引导，选好兴趣后「为你推荐」立刻贴合口味' },
  { ic: CalendarCheck, title: '签到仪式与月历', desc: '连签周点、签到月历回看、7/30/100 天里程碑纪念印章' },
  { ic: Trophy, title: '成就殿堂 2.0', desc: '金银铜奖章分档、五分类徽章墙、荣誉成就与领取庆祝' },
  { ic: ImagePlus, title: '分享卡工坊', desc: '角色、成就、连签、台词、星轨五种卡面，本机合成一键分享' },
  { ic: Orbit, title: '本周与你相伴', desc: '今日页周报卡：逐日消息、活跃天数与本周最相伴的角色' },
  { ic: Pin, title: '会话整理', desc: '长按会话可置顶与免打扰，重要的故事永远在最上面' },
  { ic: PenLine, title: '会话草稿', desc: '没说完的话自动存草稿，列表可见、回来即续写' },
  { ic: Hand, title: '长按菜单与触感', desc: '会话、群聊、剧场台词的长按快捷操作；触感反馈可在设置关闭' },
  { ic: ListChecks, title: '任务一键全领', desc: '今日任务行内领取，活动中心可一键领取全部' },
  { ic: BellRing, title: '错误可恢复', desc: '每个页面的加载失败都有插画与重试出口，不再有死路' },
];

export default function WhatsNewSheet({ onClose, returnFocusRef }) {
  const appPortal = isAppMode();
  const sheetRef = useRef(null);
  useAppOverlay(true, onClose, { rootRef: sheetRef, isolate: appPortal, returnFocusRef });

  const sheet = (
    <div className="app-sheet-mask qa-whatsnew-mask" onClick={onClose}>
      <div
        ref={sheetRef}
        className="app-sheet qa-whatsnew"
        role="dialog"
        aria-modal="true"
        aria-label={`幻域 ${WHATS_NEW_VERSION} 新功能`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-sheet-grip" aria-hidden="true" />
        <header className="qa-whatsnew-head">
          <h2>仪式与相伴</h2>
          <p>幻域 {WHATS_NEW_VERSION} 超级更新 · 每一次打开都更像回家</p>
        </header>
        <div className="qa-whatsnew-list">
          {FEATURES.map((f) => (
            <div className="qa-whatsnew-row" key={f.title}>
              <span className="qa-whatsnew-ic" aria-hidden="true"><f.ic size={17} /></span>
              <div className="qa-whatsnew-tx"><b>{f.title}</b><span>{f.desc}</span></div>
            </div>
          ))}
        </div>
        <AppButton className="qa-whatsnew-done" variant="primary" size="lg" onClick={onClose}>开始体验</AppButton>
      </div>
    </div>
  );

  return appPortal && typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}
