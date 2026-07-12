// 路由级错误边界 —— 把单页崩溃的爆炸半径从「整个应用白屏」缩到「该页显示
// 错误卡」。背景：全应用原本只有 main.jsx 一个根级 ErrorBoundary；tab
// KeepAlive 让四个 pane 常驻渲染树后，任何一个缓存页崩溃都会经根边界把
// 整屏打白、且看起来像「当前页崩溃」。此边界包住每个 pane 与非 tab 路由，
// 崩溃只影响自己，且上报的 component_stack 能定位真凶页。
import React from 'react';
import { logError } from '../logger.js';
import { RefreshCw } from 'lucide-react';

export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    logError('react_crash', (this.props.label || '路由') + '：' + (error?.message || '渲染崩溃'), {
      stack: error?.stack || '',
      component_stack: errorInfo?.componentStack || '',
      name: error?.name || '',
      route: this.props.label || '',
    });
  }

  retry = () => {
    // 换 key 让子树整棵重挂载（清掉可能已损坏的内存状态），不刷新整个应用
    this.setState(s => ({ error: null, retryKey: s.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="route-crash" role="alert">
          <b>这个页面出了点问题</b>
          <p className="muted">{String(this.state.error?.message || '渲染错误').slice(0, 120)}</p>
          <button className="btn sm" onClick={this.retry}><RefreshCw size={14} /> 重试</button>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
