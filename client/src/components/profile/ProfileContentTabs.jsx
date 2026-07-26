// 个人主页内容 Tab（分段 + 骨架 / 错误重试 / 空态 / 内容网格）——
// 从 pages/AppProfile.jsx 原样抽取（含 ProfileCharacterCover 封面回退组件）。
// 双端形态：
//   · app / 旧 Web 回落形态（web=false）：「我的角色 / 收藏」双 Tab，DOM 与
//     AppProfile 改前逐字节一致（app 布尔即原 appMode；tablist/tab/tabpanel
//     a11y 仅 App 侧输出，与改前相同）。数据与重试逻辑留在调用方，本组件
//     只负责渲染。
//   · web=true：通用受控形态 —— tabs 描述数组（key/label/count）+ 骨架 +
//     ProfileLoadError 重试；内容由调用方以 children 渲染（角色 / 剧本 /
//     动态三种网格形状各异，留在页面里最直白）。
import React, { useState } from 'react';
import { assetUrl } from '../../api.jsx';
import { AppButton } from '../AppControls.jsx';
import { CoverArt, EmptyArt, QuietAquaCharacterArt, isLegacyMonogramCover } from '../../art.jsx';
import ProfileLoadError from './ProfileLoadError.jsx';

export function ProfileCharacterCover({ character, app, eager = false }) {
  const [failed, setFailed] = useState(false);
  const source = character?.avatar;
  const useFallback = !source || failed || (app && isLegacyMonogramCover(source));
  if (useFallback) {
    return app
      ? <QuietAquaCharacterArt className="pf-cc-oracle-art" alt="" loading={eager ? 'eager' : 'lazy'} />
      : <div className="cover-art-box"><CoverArt name={character?.name} /></div>;
  }
  return (
    <img
      src={assetUrl(source)}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// ── Web Lumen 形态：受控分段 + 状态壳（骨架 / 错误 / 内容） ──
function WebContentTabs({ tabs = [], tab, onTab, loading = false, error = '', onRetry, label = '主页内容', children }) {
  return (
    <>
      <div className="pfw-tabs" role="tablist" aria-label={label}>
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`pfw-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="pfw-tab-panel"
            className={'pfw-tab' + (tab === t.key ? ' on' : '')}
            onClick={() => onTab(t.key)}
          >
            {t.label}{typeof t.count === 'number' ? <i className="pfw-tab-n">{t.count}</i> : null}
          </button>
        ))}
      </div>
      <div className="pfw-tab-panel" role="tabpanel" id="pfw-tab-panel" aria-labelledby={`pfw-tab-${tab}`}>
        {loading ? (
          <div className="pfw-content-grid" aria-hidden="true">
            {[0, 1, 2].map(i => <div key={i} className="pfw-skel-card" />)}
          </div>
        ) : error ? (
          <ProfileLoadError web message={error} onRetry={onRetry} />
        ) : children}
      </div>
    </>
  );
}

export default function ProfileContentTabs(props) {
  if (props.web) return <WebContentTabs {...props} />;
  // ── App / 旧形态：与 AppProfile.jsx 改前渲染逐字节一致 ──
  const { app, tab, setTab, chars, favs, contentError, onRetry, nav } = props;
  const tabListA11y = app ? { role: 'tablist', 'aria-label': '个人内容' } : {};
  const tabA11y = (name) => app ? {
    role: 'tab',
    id: `pf-tab-${name}`,
    'aria-selected': tab === name,
    'aria-controls': 'pf-content-panel'
  } : {};
  const panelA11y = app ? {
    role: 'tabpanel',
    id: 'pf-content-panel',
    'aria-labelledby': `pf-tab-${tab}`
  } : {};
  const content = tab === 'chars' ? chars : favs;
  return (
    <>
      {/* 内容 Tab */}
      <div className="pf-tabs" {...tabListA11y}>
        <AppButton
          className={tab === 'chars' ? 'on' : ''}
          variant="tertiary"
          selected={tab === 'chars'}
          onClick={() => setTab('chars')}
          {...tabA11y('chars')}
        >
          我的角色 {chars ? chars.length : ''}
        </AppButton>
        <AppButton
          className={tab === 'favs' ? 'on' : ''}
          variant="tertiary"
          selected={tab === 'favs'}
          onClick={() => setTab('favs')}
          {...tabA11y('favs')}
        >
          收藏 {favs ? favs.length : ''}
        </AppButton>
      </div>
      {content === null ? (
        <div className="pf-content-grid" {...panelA11y}>{[0, 1, 2].map(i => <div key={i} className="pf-cc-skel" />)}</div>
      ) : app && content.length === 0 && contentError ? (
        <ProfileLoadError message={contentError} onRetry={onRetry} panelProps={panelA11y} />
      ) : content.length === 0 ? (
        <div className="pf-empty" {...panelA11y}>
          <EmptyArt kind={tab === 'chars' ? 'library' : 'chat'} size={104} />
          <p>{tab === 'chars' ? '还没有创建角色' : '还没有收藏的角色'}</p>
          <AppButton className="btn primary sm" variant="primary" size="sm" onClick={() => nav(tab === 'chars' ? '/character/new' : '/')}>
            {tab === 'chars' ? '去创建' : '去发现'}
          </AppButton>
        </div>
      ) : (
        <div className="pf-content-grid" {...panelA11y}>
          {content.map((c, i) => (
            <button key={c.id} className="pf-cc" onClick={() => nav('/character/' + c.id)}>
              <div className="pf-cc-cover">
                <ProfileCharacterCover character={c} app={app} eager={app && i < 2} />
              </div>
              <b>{c.name}</b>
              <span>{c.tagline || '——'}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
