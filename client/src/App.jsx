import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './api.jsx';
import { ToastProvider } from './ui.jsx';
import { RealtimeProvider } from './realtime.jsx';
import Layout from './components/Layout.jsx';
import AppLayout from './components/AppLayout.jsx';
import { isAppMode } from './appmode.js';
import Auth from './pages/Auth.jsx';

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
const Home = lazyRetry(() => import('./pages/Home.jsx'));
const Library = lazyRetry(() => import('./pages/Library.jsx'));
const CharacterEditor = lazyRetry(() => import('./pages/CharacterEditor.jsx'));
const Chat = lazyRetry(() => import('./pages/Chat.jsx'));
const Settings = lazyRetry(() => import('./pages/Settings.jsx'));
const Profile = lazyRetry(() => import('./pages/Profile.jsx'));
const Publish = lazyRetry(() => import('./pages/Publish.jsx'));
const Scripts = lazyRetry(() => import('./pages/Scripts.jsx'));
const ScriptDetail = lazyRetry(() => import('./pages/ScriptDetail.jsx'));
const ScriptEditor = lazyRetry(() => import('./pages/ScriptEditor.jsx'));
const Community = lazyRetry(() => import('./pages/Community.jsx'));
const Groups = lazyRetry(() => import('./pages/Groups.jsx'));
const GroupRoom = lazyRetry(() => import('./pages/GroupRoom.jsx'));
const Theater = lazyRetry(() => import('./pages/Theater.jsx'));
const TheaterRoom = lazyRetry(() => import('./pages/TheaterRoom.jsx'));
const Wallet = lazyRetry(() => import('./pages/Wallet.jsx'));
const Notifications = lazyRetry(() => import('./pages/Notifications.jsx'));
const Favorites = lazyRetry(() => import('./pages/Favorites.jsx'));
const Search = lazyRetry(() => import('./pages/Search.jsx'));
const CharacterView = lazyRetry(() => import('./pages/CharacterView.jsx'));
const Announcements = lazyRetry(() => import('./pages/Announcements.jsx'));
const Leaderboard = lazyRetry(() => import('./pages/Leaderboard.jsx'));
const Events = lazyRetry(() => import('./pages/Events.jsx'));
const Admin = lazyRetry(() => import('./pages/Admin.jsx'));
const Gacha = lazyRetry(() => import('./pages/Gacha.jsx'));
const Studio = lazyRetry(() => import('./pages/Studio.jsx'));
const Parliament = lazyRetry(() => import('./pages/Parliament.jsx'));
const Achievements = lazyRetry(() => import('./pages/Achievements.jsx'));
const Friends = lazyRetry(() => import('./pages/Friends.jsx'));
const Draw = lazyRetry(() => import('./pages/Draw.jsx'));
const Features = lazyRetry(() => import('./pages/Features.jsx'));
const Help = lazyRetry(() => import('./pages/Help.jsx'));
const Tags = lazyRetry(() => import('./pages/Tags.jsx'));
const Worldbooks = lazyRetry(() => import('./pages/Worldbooks.jsx'));
const WorldbookEditor = lazyRetry(() => import('./pages/WorldbookEditor.jsx'));
const WorldbookView = lazyRetry(() => import('./pages/WorldbookView.jsx'));
const Atelier = lazyRetry(() => import('./pages/Atelier.jsx'));
const NovelWorkspace = lazyRetry(() => import('./pages/NovelWorkspace.jsx'));
const NovelReader = lazyRetry(() => import('./pages/NovelReader.jsx'));
const AppHome = lazyRetry(() => import('./pages/AppHome.jsx'));
const Messages = lazyRetry(() => import('./pages/Messages.jsx'));
const AppProfile = lazyRetry(() => import('./pages/AppProfile.jsx'));
const Vip = lazyRetry(() => import('./pages/Vip.jsx'));
const Insights = lazyRetry(() => import('./pages/Insights.jsx'));
const DiscoverFeed = lazyRetry(() => import('./pages/DiscoverFeed.jsx'));

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
