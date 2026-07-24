// netquality — APP 网络质量感知。
// ----------------------------------------------------------------------------
// 统一封装「网络好坏 / 在线离线 / 连接类型」的判定，供 DiscoverFeed 视频降级、
// 图片加载策略、心跳频率等消费。原生壳用 @capacitor/network（含 wifi/cellular/
// none），web 壳降级到 navigator.onLine + navigator.connection.effectiveType。
//
// 派发两类事件：
//   · 'huanyu-network'  —— { online: bool, connectionType: 'wifi'|'cellular'|'none'|'unknown' }
//   · 'huanyu-netquality' —— { quality: 'fast'|'slow'|'offline' }
import { isNativeShell } from './appmode.js';

// 原生 Network 插件懒加载。
let nativeNet = null;
let nativeNetTried = false;
async function ensureNativeNet() {
  if (nativeNetTried) return nativeNet;
  nativeNetTried = true;
  if (!isNativeShell()) return null;
  try { nativeNet = await import('@capacitor/network'); } catch { /* */ }
  return nativeNet;
}

// 预热：native.js initNative() 调用。
export function prepareNetwork() { ensureNativeNet(); }

// 当前网络质量快照（同步返回，首次可能用 web 降级值）。
export function getNetQuality() {
  if (typeof navigator === 'undefined') return 'fast';
  if (navigator.onLine === false) return 'offline';
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const et = c?.effectiveType;
  if (et === '2g' || et === 'slow-2g') return 'slow';
  if (et === '3g') return 'slow';
  if (c?.saveData) return 'slow';
  return 'fast';
}

export function isOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

// 初始化监听：派发 huanyu-network / huanyu-netquality 事件。
// 返回 cleanup 函数。可在 AppLayout 的 useEffect 里调用。
export function initNetworkWatch() {
  let unsub = null;
  let curQuality = getNetQuality();

  const emit = (online, connectionType) => {
    const quality = online ? (curQuality === 'slow' ? 'slow' : 'fast') : 'offline';
    try {
      window.dispatchEvent(new CustomEvent('huanyu-network', { detail: { online, connectionType } }));
      window.dispatchEvent(new CustomEvent('huanyu-netquality', { detail: { quality } }));
    } catch { /* */ }
  };

  // web 降级监听（原生壳也保留作即时兜底，原生事件稍后覆盖）。
  const onWebOnline = () => emit(true, 'unknown');
  const onWebOffline = () => emit(false, 'none');
  const onConnChange = () => {
    curQuality = getNetQuality();
    window.dispatchEvent(new CustomEvent('huanyu-netquality', { detail: { quality: curQuality } }));
  };
  window.addEventListener('online', onWebOnline);
  window.addEventListener('offline', onWebOffline);
  const conn = typeof navigator !== 'undefined' && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
  conn?.addEventListener?.('change', onConnChange);

  // 原生 Network 插件：更可靠，含连接类型。
  ensureNativeNet().then((m) => {
    if (!m) return;
    m.Network.getStatus().then((s) => {
      curQuality = s.connected ? 'fast' : 'offline';
      emit(s.connected, s.connectionType);
    }).catch(() => {});
    m.Network.addListener('networkStatusChange', (s) => {
      curQuality = s.connected ? 'fast' : 'offline';
      emit(s.connected, s.connectionType);
    }).then?.(h => { unsub = h; });
  }).catch(() => {});

  return () => {
    window.removeEventListener('online', onWebOnline);
    window.removeEventListener('offline', onWebOffline);
    conn?.removeEventListener?.('change', onConnChange);
    try { unsub?.remove?.(); } catch { /* */ }
  };
}
