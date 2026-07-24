// AppEmpty — APP 原生壳统一插画化空态。
// 替代各页「直接隐藏空段」或「一句话文案」的简陋处理：内联 SVG 插画 + 标题
// + 二级文案 + 多个 CTA，让用户在「为什么没有内容 / 下一步该做什么」上有
// 明确路径。
//
// 仅 APP 壳使用（html[data-app="1"] 作用域 .app-empty 样式）。
import React from 'react';

// 4 个内置插画：线性青色画风，与白+青设计体系一致。
// 用 currentColor 让 .app-empty-illu 的 color 控制主色。
const ILLU = {
  // 无角色 / 无内容
  chars: (
    <svg viewBox="0 0 120 96" fill="none" aria-hidden="true">
      <rect x="22" y="28" width="34" height="46" rx="8" stroke="currentColor" strokeWidth="2.4" opacity="0.5"/>
      <rect x="60" y="22" width="38" height="52" rx="8" stroke="currentColor" strokeWidth="2.4"/>
      <circle cx="79" cy="40" r="6" stroke="currentColor" strokeWidth="2.4"/>
      <path d="M68 64c2-7 8-11 11-11s9 4 11 11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
      <circle cx="34" cy="44" r="4" stroke="currentColor" strokeWidth="2" opacity="0.5"/>
      <path d="M26 66c2-5 5-8 8-8s6 3 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
    </svg>
  ),
  // 无消息 / 无会话
  msgs: (
    <svg viewBox="0 0 120 96" fill="none" aria-hidden="true">
      <path d="M20 30c0-4 3-7 7-7h66c4 0 7 3 7 7v34c0 4-3 7-7 7H48l-16 12v-12h-5c-4 0-7-3-7-7V30Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/>
      <circle cx="42" cy="47" r="3" fill="currentColor"/>
      <circle cx="60" cy="47" r="3" fill="currentColor"/>
      <circle cx="78" cy="47" r="3" fill="currentColor"/>
    </svg>
  ),
  // 无网络 / 离线
  offline: (
    <svg viewBox="0 0 120 96" fill="none" aria-hidden="true">
      <path d="M18 40c24-20 60-20 84 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.4"/>
      <path d="M30 56c16-13 44-13 60 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.6"/>
      <path d="M44 70c8-6 24-6 32 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
      <circle cx="60" cy="82" r="3" fill="currentColor"/>
      <path d="M30 28l60 52" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.7"/>
    </svg>
  ),
  // 无搜索结果 / 无匹配
  search: (
    <svg viewBox="0 0 120 96" fill="none" aria-hidden="true">
      <circle cx="50" cy="42" r="18" stroke="currentColor" strokeWidth="2.4"/>
      <path d="M64 56l18 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
      <path d="M44 42c0-4 3-7 7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.5"/>
      <path d="M30 78h40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3"/>
    </svg>
  ),
};

const DEFAULT_TEXT = {
  chars:   { title: '还没有内容', hint: '去发现页逛逛，或自己创建一个角色开启故事' },
  msgs:    { title: '暂无消息', hint: '开始一段对话，消息会出现在这里' },
  offline: { title: '无法加载', hint: '网络似乎出了点问题，稍后再试试' },
  search:  { title: '没有找到结果', hint: '换个关键词，或调整筛选条件再试试' },
};

export default function AppEmpty({ variant = 'chars', title, hint, actions }) {
  const illu = ILLU[variant] || ILLU.chars;
  const def = DEFAULT_TEXT[variant] || DEFAULT_TEXT.chars;
  return (
    <div className={'app-empty app-empty-' + variant}>
      <div className="app-empty-illu">{illu}</div>
      <div className="app-empty-body">
        <b className="app-empty-title">{title || def.title}</b>
        {(hint || def.hint) && <p className="app-empty-hint">{hint || def.hint}</p>}
      </div>
      {actions && actions.length > 0 && (
        <div className="app-empty-actions">
          {actions.map((a, i) => (
            <button key={i} className={'btn' + (a.primary ? ' primary' : '')} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
