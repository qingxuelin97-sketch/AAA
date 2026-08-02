import { useEffect, useState } from 'react';
import { api } from '../api.jsx';
import { isAppMode } from '../appmode.js';

const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
export const pinkAsset = (path) => `${base}app-pink-v1/${String(path || '').replace(/^\/+/, '')}`;

export const BAKED_PARTS = {
  today: ['01-header.png', '02-hero.png', '03-companions-task.png'],
  discover: ['01-header.png', '02-story.png', '03-actions-copy.png'],
  messages: ['01-header-entry.png', '02-conversations.png', '03-waiting-banner.png'],
  profile: ['01-identity.png', '02-benefits.png', '03-characters-settings.png'],
};

export const PINK_DEMO_REFERENCE = Object.freeze({
  version: 'pink-v1',
  profile: {
    display_name: '小鱼', public_uid: 'U1024', bio: '在故事里，遇见另一个自己。',
    stats: { characters: 12, scripts: 8, followers: 326, following: 48 },
    wallet: { gold: 2680, diamond: 120 }, membership: '幻域会员',
  },
  today: { hero: '陆沉舟', line: '我等了你很久', reward: 50 },
  discover: {
    author: '雾岛来信', character: '林晚栀', line: '末班车停运后，她似乎一直在等你。',
    tags: ['都市', '治愈'], metrics: { hearts: 23000, comments: 896, favorites: 12000, shares: 634 },
  },
  messages: {
    badges: { interactions: 3, friends: 2, groups: 4 },
    rows: [
      { name: '陆沉舟', preview: '醒了吗？窗外的阳光很好。', time: '09:32' },
      { name: '林晚栀', preview: '我还在那座车站。', time: '昨天' },
      { name: '闻溪', preview: '新的故事已经写好一半了。', time: '周一' },
      { name: '白砚', preview: '今晚要继续我们的约定吗？', time: '周日' },
    ],
  },
});

let cachedReference;
let referenceRequest;

export function isPinkDemoUser(user) {
  return Boolean(user && (
    user.username === 'app-demo'
    || user.app_reference === true
    || user.public_uid === 'U1024'
  ));
}

function resolvedTheme() {
  return document.documentElement.dataset.theme || 'light';
}

export function usePinkReference(user) {
  const [theme, setTheme] = useState(resolvedTheme);
  const demoUser = isPinkDemoUser(user);
  const [reference, setReference] = useState(() => demoUser ? (cachedReference || PINK_DEMO_REFERENCE) : null);

  useEffect(() => {
    const sync = () => setTheme(resolvedTheme());
    window.addEventListener('huanyu-theme', sync);
    return () => window.removeEventListener('huanyu-theme', sync);
  }, []);

  useEffect(() => {
    if (!isAppMode() || !user?.id || !demoUser) { setReference(null); return; }
    if (cachedReference) { setReference(cachedReference); return; }
    setReference(PINK_DEMO_REFERENCE);
    if (!referenceRequest) {
      referenceRequest = api('/me/app-reference?v=pink-v1')
        .then((data) => {
          cachedReference = data?.version === 'pink-v1'
            ? { ...PINK_DEMO_REFERENCE, ...data }
            : PINK_DEMO_REFERENCE;
          return cachedReference;
        })
        .catch(() => PINK_DEMO_REFERENCE)
        .finally(() => { referenceRequest = null; });
    }
    referenceRequest.then(setReference);
  }, [demoUser, user?.id]);

  const active = isAppMode() && theme === 'light';
  return { active, demo: active && demoUser, reference: reference || PINK_DEMO_REFERENCE };
}
