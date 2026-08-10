// App 壳统一返回按钮。
//
// 为什么需要它：routeRegistry.js 的 dock 默认是 false，只有 4 条一级 tab 显式为 true，
// 所以除这 4 条之外的页面在 App 里既没有底栏、也没有任何返回控件。iOS PWA 没有硬件
// 返回键 —— 进去就出不来，只能杀进程。这不是「不好看」，是走不出去。
//
// 只在 App 壳渲染：Web 壳有浏览器的前进后退，不需要页内返回。
//
// 目标由 useAppNavigation().requestBack() 决定，**不在这里硬编码**。它已经实现了
// 完整的优先级链（先关浮层/收键盘 → location.state.appBackTo → 注册表 parent →
// 默认 tab），硬编码一个 to 会绕开前两级，比如从「我的」进来却回到「发现」。
//
// 样式无需新增：app-hig-v5.css:172-177 会把 .topbar 里第一个非 primary 按钮渲染成
// 无底色的 chevron 热区，.topbar 在 App 下本身已是 44pt 高。
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { AppIconButton } from './AppControls.jsx';
import { useAppNavigation } from '../appNavigation.jsx';
import { isAppMode } from '../appmode.js';

export default function AppBackButton({ label = '返回', className = '' }) {
  const { requestBack } = useAppNavigation();
  if (!isAppMode()) return null;
  return (
    <AppIconButton className={('qa-topbar-back ' + className).trim()} label={label} onClick={() => requestBack()}>
      <ArrowLeft size={20} />
    </AppIconButton>
  );
}
