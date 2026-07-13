// 路由 chunk 注册表 —— 三件事一张表，单点维护：
//   1. 路由级代码分割的 import 工厂（App.jsx 的 lazyRetry 消费）；
//   2. warm 追踪：chunk 落地即标记。nav.js 据此决定「冷 chunk 跳过 View
//      Transition」—— VT 的 update callback 要等新页 commit，等待期整屏冻结，
//      冷 chunk 的网络拉取会把这段冻结吃满（最坏到保险丝超时）。跳过 VT 走
//      CSS 方向入场兜底，Suspense 期间画面完全自由，本次导航即把 chunk 焐热，
//      同一路由第二次起就有完整 VT。
//   3. 预热清单：AppLayout 空闲期分两波拉取（hot 高频页优先），consumer 不再
//      各自手写 import 清单（曾经 App.jsx / AppLayout 两份清单漂移）。
// 注册的 pattern 是「运行时路径」正则（HashRouter 的 hash 部分同形），
// 与 App.jsx 的 <Route path> 一一对应；新增页面在此登记一行即可全量接入。

const registry = [];

function chunk(pattern, load, { hot = false } = {}) {
  const entry = { pattern, warm: false, hot, load: null };
  entry.load = () => load().then(
    (m) => { entry.warm = true; return m; },
    (err) => { throw err; } // 失败不标 warm；重试语义由 App.jsx lazyRetry 负责
  );
  registry.push(entry);
  return entry.load;
}

// 目标路径的 chunk 是否已在本地。同一路径命中多个条目（如 '/' 在双壳下对应
// 两个组件）时任一已热即视为热 —— VT 只在 APP 壳生效，而 APP 壳的预热波
// 必然先焐热本壳用的那个组件。未注册的路径（/auth 等 eager 页）视为热。
export function isWarm(path) {
  const hits = registry.filter(e => e.pattern.test(path));
  return hits.length === 0 || hits.some(e => e.warm);
}

// 空闲预热：先高频（hot）一波，再全量一波 —— 首跳「点了没反应，隔半拍才进」
// 的 chunk 等待是延迟反馈体感的一部分（每个 gzip 后 ~5-20KB，空闲拉取无感）。
export function preheat() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  const cancel = window.cancelIdleCallback || clearTimeout;
  const pull = (list) => list.forEach(e => { if (!e.warm) e.load().catch(() => {}); });
  // Registry order puts the four tabs and Chat first. Warming only those five
  // avoids parsing and retaining the entire product during a cold start.
  const id = idle(() => pull(registry.filter(e => e.hot).slice(0, 5)));
  return () => cancel(id);
}

// —— 注册表本体（与 App.jsx 路由一一对应）——
// hot = APP 壳高频页：四路一级 tab + 高频二级页（沿用原 AppLayout 预热清单）。
export const loaders = {
  Home:            chunk(/^\/$/, () => import('./pages/Home.jsx')),
  DiscoverFeed:    chunk(/^\/$/, () => import('./pages/DiscoverFeed.jsx'), { hot: true }),
  AppHome:         chunk(/^\/today$/, () => import('./pages/AppHome.jsx'), { hot: true }),
  Messages:        chunk(/^\/messages$/, () => import('./pages/Messages.jsx'), { hot: true }),
  AppProfile:      chunk(/^\/me$/, () => import('./pages/AppProfile.jsx'), { hot: true }),
  Chat:            chunk(/^\/chats(\/|$)/, () => import('./pages/Chat.jsx'), { hot: true }),
  CharacterView:   chunk(/^\/character\/[^/]+$/, () => import('./pages/CharacterView.jsx'), { hot: true }),
  Notifications:   chunk(/^\/notifications$/, () => import('./pages/Notifications.jsx'), { hot: true }),
  Friends:         chunk(/^\/friends$/, () => import('./pages/Friends.jsx'), { hot: true }),
  Wallet:          chunk(/^\/wallet$/, () => import('./pages/Wallet.jsx'), { hot: true }),
  Settings:        chunk(/^\/settings$/, () => import('./pages/Settings.jsx'), { hot: true }),
  Theater:         chunk(/^\/theater$/, () => import('./pages/Theater.jsx'), { hot: true }),
  TheaterRoom:     chunk(/^\/theater\/[^/]+$/, () => import('./pages/TheaterRoom.jsx'), { hot: true }),
  Groups:          chunk(/^\/groups$/, () => import('./pages/Groups.jsx'), { hot: true }),
  GroupRoom:       chunk(/^\/group\/[^/]+$/, () => import('./pages/GroupRoom.jsx'), { hot: true }),
  Library:         chunk(/^\/library$/, () => import('./pages/Library.jsx')),
  CharacterEditor: chunk(/^\/character\/(new$|[^/]+\/edit$)/, () => import('./pages/CharacterEditor.jsx')),
  Profile:         chunk(/^\/(profile$|user\/)/, () => import('./pages/Profile.jsx')),
  Publish:         chunk(/^\/publish$/, () => import('./pages/Publish.jsx')),
  Scripts:         chunk(/^\/scripts$/, () => import('./pages/Scripts.jsx')),
  ScriptDetail:    chunk(/^\/script\/[^/]+$/, () => import('./pages/ScriptDetail.jsx')),
  ScriptEditor:    chunk(/^\/script\/(new$|[^/]+\/edit$)/, () => import('./pages/ScriptEditor.jsx')),
  Community:       chunk(/^\/community$/, () => import('./pages/Community.jsx')),
  Search:          chunk(/^\/search$/, () => import('./pages/Search.jsx')),
  Tags:            chunk(/^\/tags$/, () => import('./pages/Tags.jsx')),
  Announcements:   chunk(/^\/announcements$/, () => import('./pages/Announcements.jsx')),
  Leaderboard:     chunk(/^\/leaderboard$/, () => import('./pages/Leaderboard.jsx')),
  Events:          chunk(/^\/events$/, () => import('./pages/Events.jsx')),
  Admin:           chunk(/^\/admin$/, () => import('./pages/Admin.jsx')),
  Gacha:           chunk(/^\/gacha$/, () => import('./pages/Gacha.jsx')),
  Studio:          chunk(/^\/studio$/, () => import('./pages/Studio.jsx')),
  Parliament:      chunk(/^\/parliament$/, () => import('./pages/Parliament.jsx')),
  Achievements:    chunk(/^\/achievements$/, () => import('./pages/Achievements.jsx')),
  Insights:        chunk(/^\/insights$/, () => import('./pages/Insights.jsx')),
  Draw:            chunk(/^\/draw$/, () => import('./pages/Draw.jsx')),
  Vip:             chunk(/^\/vip$/, () => import('./pages/Vip.jsx')),
  Favorites:       chunk(/^\/favorites$/, () => import('./pages/Favorites.jsx')),
  Worldbooks:      chunk(/^\/worldbooks$/, () => import('./pages/Worldbooks.jsx')),
  WorldbookView:   chunk(/^\/worldbook\/[^/]+$/, () => import('./pages/WorldbookView.jsx')),
  WorldbookEditor: chunk(/^\/worldbook\/[^/]+\/edit$/, () => import('./pages/WorldbookEditor.jsx')),
  Atelier:         chunk(/^\/atelier$/, () => import('./pages/Atelier.jsx')),
  NovelReader:     chunk(/^\/atelier\/read\/[^/]+$/, () => import('./pages/NovelReader.jsx')),
  NovelWorkspace:  chunk(/^\/atelier\/[^/]+$/, () => import('./pages/NovelWorkspace.jsx')),
  Features:        chunk(/^\/features$/, () => import('./pages/Features.jsx')),
  Help:            chunk(/^\/help$/, () => import('./pages/Help.jsx')),
};
