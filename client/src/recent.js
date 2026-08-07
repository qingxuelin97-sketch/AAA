// 「最近看过」浏览历史（修缮⑩）：本地 recent_chars 是即时缓存（同步读、
// 离线可用），服务端 character_views 是真相（换设备不丢）。此前 DiscoverFeed
// 与 CharacterView 各写一份重复实现，字段还不一致（featured），在此合并。
import { api } from './api.jsx';

const KEY = 'recent_chars';
const CAP = 12;

export const readRecent = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
};

const itemOf = (c) => ({
  id: c.id, name: c.name, avatar: c.avatar, tagline: c.tagline,
  owner_name: c.owner_name, category: c.category, uses: c.uses, featured: c.featured,
});

export const pushRecent = (c) => {
  try {
    const prev = readRecent().filter(x => x.id !== c.id);
    localStorage.setItem(KEY, JSON.stringify([itemOf(c), ...prev].slice(0, CAP)));
  } catch { /* */ }
};

// 服务端历史回填：会话级只拉一次；服务端序优先、本地独有的（离线新看的）
// 追加在后，合并写回本地。未登录/离线静默保持纯本机行为。
let hydrated = null;
export const hydrateRecent = () => {
  if (!hydrated) {
    hydrated = api('/engage/recent').then(d => {
      const server = (d.characters || []).map(itemOf);
      const seen = new Set(server.map(x => x.id));
      const merged = [...server, ...readRecent().filter(x => x && x.id && !seen.has(x.id))].slice(0, CAP);
      try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* */ }
      return merged;
    }).catch(() => { hydrated = null; return readRecent(); });
  }
  return hydrated;
};
