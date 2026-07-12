import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './api.jsx';
import { ToastProvider } from './ui.jsx';
import { RealtimeProvider } from './realtime.jsx';
import Layout from './components/Layout.jsx';
import AppLayout from './components/AppLayout.jsx';
import { isAppMode } from './appmode.js';
import Auth from './pages/Auth.jsx';
// import 工厂集中在 routeChunks.js 注册表（同时供 warm 追踪与空闲预热消费，
// 见该文件头注释）；本文件只把工厂包上 lazyRetry。
import { loaders as L } from './routeChunks.js';

// Route-level code splitting — each page is fetched on demand so the initial
// bundle stays small and the discover page paints fast. The login screen and
// Layout shell stay eager (they're on the critical path for first paint).
//
// lazyRetry：chunk 加载失败（发版后缓存引旧哈希 404 / 瞬时网络失败）会让
// lazy() 把 rejection 抛到唯一的根级 ErrorBoundary —— 整个应用白屏成
// 「渲染错误」（真机反馈的「点击设置显示渲染错误」即此类）。策略：
// 300ms 后重试一次 → 仍失败且本会话没刷过 → 硬刷新一次拿新 index.html
// → 再失败才真正抛给边界。
const lazyRetry = (factory) => lazy(() =>
  factory().catch(() =>
    new Promise(r => setTimeout(r, 300)).then(factory).catch((err) => {
      try {
        if (!sessionStorage.getItem('huanyu_chunk_reload')) {
          sessionStorage.setItem('huanyu_chunk_reload', '1');
          location.reload();
          return new Promise(() => {}); // 刷新接管，挂起即可
        }
      } catch { /* */ }
      throw err;
    })
  )
);
const Home = lazyRetry(L.Home);
const Library = lazyRetry(L.Library);
const CharacterEditor = lazyRetry(L.CharacterEditor);
const Chat = lazyRetry(L.Chat);
const Settings = lazyRetry(L.Settings);
const Profile = lazyRetry(L.Profile);
const Publish = lazyRetry(L.Publish);
const Scripts = lazyRetry(L.Scripts);
const ScriptDetail = lazyRetry(L.ScriptDetail);
const ScriptEditor = lazyRetry(L.ScriptEditor);
const Community = lazyRetry(L.Community);
const Groups = lazyRetry(L.Groups);
const GroupRoom = lazyRetry(L.GroupRoom);
const Theater = lazyRetry(L.Theater);
const TheaterRoom = lazyRetry(L.TheaterRoom);
const Wallet = lazyRetry(L.Wallet);
const Notifications = lazyRetry(L.Notifications);
const Favorites = lazyRetry(L.Favorites);
const Search = lazyRetry(L.Search);
const CharacterView = lazyRetry(L.CharacterView);
const Announcements = lazyRetry(L.Announcements);
const Leaderboard = lazyRetry(L.Leaderboard);
const Events = lazyRetry(L.Events);
const Admin = lazyRetry(L.Admin);
const Gacha = lazyRetry(L.Gacha);
const Studio = lazyRetry(L.Studio);
const Parliament = lazyRetry(L.Parliament);
const Achievements = lazyRetry(L.Achievements);
const Friends = lazyRetry(L.Friends);
const Draw = lazyRetry(L.Draw);
const Features = lazyRetry(L.Features);
const Help = lazyRetry(L.Help);
const Tags = lazyRetry(L.Tags);
const Worldbooks = lazyRetry(L.Worldbooks);
const WorldbookEditor = lazyRetry(L.WorldbookEditor);
const WorldbookView = lazyRetry(L.WorldbookView);
const Atelier = lazyRetry(L.Atelier);
const NovelWorkspace = lazyRetry(L.NovelWorkspace);
const NovelReader = lazyRetry(L.NovelReader);
const AppHome = lazyRetry(L.AppHome);
const Messages = lazyRetry(L.Messages);
const AppProfile = lazyRetry(L.AppProfile);
const Vip = lazyRetry(L.Vip);
const Insights = lazyRetry(L.Insights);
const DiscoverFeed = lazyRetry(L.DiscoverFeed);

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty" style={{ paddingTop: 160 }}>载入中…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  // Pick the chrome at render time (after initAppMode resolved the flag): the
  // native/app shell or the responsive web shell.
  const Shell = isAppMode() ? AppLayout : Layout;
  return <Shell>{children}</Shell>;
}

const P = (el) => <Protected>{el}</Protected>;

export default function App() {
  const { user } = useAuth();
  return (
    <ToastProvider>
      <RealtimeProvider>
        <Suspense fallback={<div className="empty" style={{ paddingTop: 160 }}>载入中…</div>}>
          <Routes>
            <Route path="/auth" element={user ? <Navigate to="/" replace /> : <Auth />} />
            <Route path="/features" element={<Features />} />
            <Route path="/help" element={<Help />} />
            <Route path="/" element={P(isAppMode() ? <DiscoverFeed /> : <Home />)} />
            <Route path="/today" element={P(<AppHome />)} />
            <Route path="/scripts" element={P(<Scripts />)} />
            <Route path="/script/new" element={P(<ScriptEditor />)} />
            <Route path="/script/:id" element={P(<ScriptDetail />)} />
            <Route path="/script/:id/edit" element={P(<ScriptEditor />)} />
            <Route path="/community" element={P(<Community />)} />
            <Route path="/search" element={P(<Search />)} />
            <Route path="/tags" element={P(<Tags />)} />
            <Route path="/announcements" element={P(<Announcements />)} />
            <Route path="/leaderboard" element={P(<Leaderboard />)} />
            <Route path="/events" element={P(<Events />)} />
            <Route path="/gacha" element={P(<Gacha />)} />
            <Route path="/parliament" element={P(<Parliament />)} />
            <Route path="/achievements" element={P(<Achievements />)} />
            <Route path="/insights" element={P(<Insights />)} />
            <Route path="/draw" element={P(<Draw />)} />
            <Route path="/friends" element={P(<Friends />)} />
            <Route path="/admin" element={P(<Admin />)} />
            <Route path="/messages" element={P(<Messages />)} />
            <Route path="/me" element={P(<AppProfile />)} />
            <Route path="/vip" element={P(<Vip />)} />
            <Route path="/chats" element={P(<Chat />)} />
            <Route path="/chats/:id" element={P(<Chat />)} />
            <Route path="/groups" element={P(<Groups />)} />
            <Route path="/group/:id" element={P(<GroupRoom />)} />
            <Route path="/theater" element={P(<Theater />)} />
            <Route path="/theater/:id" element={P(<TheaterRoom />)} />
            <Route path="/library" element={P(<Library />)} />
            <Route path="/worldbooks" element={P(<Worldbooks />)} />
            <Route path="/worldbook/:id" element={P(<WorldbookView />)} />
            <Route path="/worldbook/:id/edit" element={P(<WorldbookEditor />)} />
            <Route path="/atelier" element={P(<Atelier />)} />
            <Route path="/atelier/read/:id" element={P(<NovelReader />)} />
            <Route path="/atelier/:id" element={P(<NovelWorkspace />)} />
            <Route path="/studio" element={P(<Studio />)} />
            <Route path="/favorites" element={P(<Favorites />)} />
            <Route path="/wallet" element={P(<Wallet />)} />
            <Route path="/notifications" element={P(<Notifications />)} />
            <Route path="/settings" element={P(<Settings />)} />
            <Route path="/character/new" element={P(<CharacterEditor />)} />
            <Route path="/character/:id" element={P(<CharacterView />)} />
            <Route path="/character/:id/edit" element={P(<CharacterEditor />)} />
            <Route path="/publish" element={P(<Publish />)} />
            <Route path="/profile" element={P(<Profile />)} />
            <Route path="/user/:id" element={P(<Profile />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </RealtimeProvider>
    </ToastProvider>
  );
}
