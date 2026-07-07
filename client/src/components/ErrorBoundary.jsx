import React from 'react';
import { logError } from '../logger.js';

// React 错误边界 —— 捕获子树渲染时的同步异常（window.onerror 抓不到 React 渲染崩溃）。
// 仅捕获渲染阶段、生命周期、构造函数中的错误；事件处理器内的错误仍需 try/catch。
// 崩溃后展示降级 UI（刷新按钮），避免整页白屏。
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // 下次渲染时切换到降级 UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // 上报到服务端：堆栈 + 组件栈（errorInfo.componentStack 是 React 独有的调用栈）
    logError('react_crash', error?.message || 'React 渲染崩溃', {
      stack: error?.stack || '',
      component_stack: errorInfo?.componentStack || '',
      name: error?.name || '',
    });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    // 强制刷新当前页面（清掉可能已损坏的内存状态）
    try { location.reload(); } catch { /* */ }
  };

  render() {
    if (this.state.hasError) {
      // 自定义降级 UI（如果上层传了 fallback）
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback(this.state.error, this.handleReload)
          : this.props.fallback;
      }
      // 默认降级 UI：三端自适应
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '24px', textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: 'var(--bg, #0f1115)', color: 'var(--text, #e5e7eb)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>页面出了点问题</h2>
          <p style={{ margin: '0 0 20px', fontSize: 14, opacity: 0.7, maxWidth: 360 }}>
            应用遇到了一个渲染错误，已自动上报。刷新页面通常可以恢复。
          </p>
          {this.state.error && (
            <pre style={{
              maxWidth: '100%', overflow: 'auto', padding: 12, borderRadius: 8,
              background: 'rgba(0,0,0,0.3)', fontSize: 12, opacity: 0.5,
              maxHeight: 200, textAlign: 'left', marginBottom: 20,
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button onClick={this.handleReload} style={{
            padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--accent, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 500,
          }}>
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
