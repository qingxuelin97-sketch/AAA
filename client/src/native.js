// Native (Capacitor) integration — loaded ONLY inside the native app shell, never on web.
// Wires the hardware back button, status-bar theming and splash-screen dismissal.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { resolveTheme } from './theme.js';

export async function syncStatusBar() {
  try {
    const dark = resolveTheme() === 'dark';
    // Style.Light = light icons (use on dark background), Style.Dark = dark icons.
    await StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: dark ? '#15120e' : '#f4f2ec' });
    }
  } catch { /* plugin not available */ }
}

export async function initNative() {
  await syncStatusBar();
  // Android hardware back: navigate back, or exit at the root.
  try {
    App.addListener('backButton', () => {
      if (window.history.length > 1 && location.hash && location.hash !== '#/') window.history.back();
      else App.exitApp();
    });
  } catch { /* */ }
  // Re-apply status bar when the app resumes or the user toggles the theme.
  try { App.addListener('resume', syncStatusBar); } catch { /* */ }
  window.addEventListener('huanyu-theme', syncStatusBar);
  setTimeout(() => { SplashScreen.hide().catch(() => {}); }, 300);
}
