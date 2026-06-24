import React, { Suspense, useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './api.jsx';
import { ToastProvider } from './ui.jsx';
import Layout from './components/Layout.jsx';
import Auth from './pages/Auth.jsx';
import { lazyRoute, mapRoute, prefetchAllIdle } from './prefetch.js';

// Route-level code splitting — each page is fetched on demand so the initial
// bundle stays small and the discover page paints fast. The login screen and
// Layout shell stay eager (they're on the critical path for first paint).
// lazyRoute() additionally exposes `.preload()` so chunks can be warmed ahead of
// the click (see prefetch.js + Layout's pointer-intent prefetch) — this removes
// the cold-start stall where the first navigation blocks on a chunk download.
const Home = lazyRoute(() => import('./pages/Home.jsx'));
const Library = lazyRoute(() => import('./pages/Library.jsx'));
const CharacterEditor = lazyRoute(() => import('./pages/CharacterEditor.jsx'));
const Chat = lazyRoute(() => import('./pages/Chat.jsx'));
const Settings = lazyRoute(() => import('./pages/Settings.jsx'));
const Profile = lazyRoute(() => import('./pages/Profile.jsx'));
const Publish = lazyRoute(() => import('./pages/Publish.jsx'));
const Scripts = lazyRoute(() => import('./pages/Scripts.jsx'));
const ScriptDetail = lazyRoute(() => import('./pages/ScriptDetail.jsx'));
const ScriptEditor = lazyRoute(() => import('./pages/ScriptEditor.jsx'));
const Community = lazyRoute(() => import('./pages/Community.jsx'));
const Groups = lazyRoute(() => import('./pages/Groups.jsx'));
const GroupRoom = lazyRoute(() => import('./pages/GroupRoom.jsx'));
const Theater = lazyRoute(() => import('./pages/Theater.jsx'));
const TheaterRoom = lazyRoute(() => import('./pages/TheaterRoom.jsx'));
const Wallet = lazyRoute(() => import('./pages/Wallet.jsx'));
const Notifications = lazyRoute(() => import('./pages/Notifications.jsx'));
const Favorites = lazyRoute(() => import('./pages/Favorites.jsx'));
const Search = lazyRoute(() => import('./pages/Search.jsx'));
const CharacterView = lazyRoute(() => import('./pages/CharacterView.jsx'));
const Announcements = lazyRoute(() => import('./pages/Announcements.jsx'));
const Leaderboard = lazyRoute(() => import('./pages/Leaderboard.jsx'));
const Events = lazyRoute(() => import('./pages/Events.jsx'));
const Admin = lazyRoute(() => import('./pages/Admin.jsx'));
const Gacha = lazyRoute(() => import('./pages/Gacha.jsx'));
const Studio = lazyRoute(() => import('./pages/Studio.jsx'));
const Parliament = lazyRoute(() => import('./pages/Parliament.jsx'));
const Achievements = lazyRoute(() => import('./pages/Achievements.jsx'));
const Friends = lazyRoute(() => import('./pages/Friends.jsx'));
const Draw = lazyRoute(() => import('./pages/Draw.jsx'));

// Map the static nav destinations to their chunk so pointer-intent prefetch (in
// Layout) can warm exactly the route about to be opened. Param routes (e.g.
// /chats/:id) are reached from these list pages, which are covered here.
mapRoute('/', Home); mapRoute('/library', Library); mapRoute('/chats', Chat);
mapRoute('/settings', Settings); mapRoute('/profile', Profile); mapRoute('/publish', Publish);
mapRoute('/scripts', Scripts); mapRoute('/community', Community); mapRoute('/groups', Groups);
mapRoute('/theater', Theater); mapRoute('/wallet', Wallet); mapRoute('/notifications', Notifications);
mapRoute('/favorites', Favorites); mapRoute('/search', Search); mapRoute('/announcements', Announcements);
mapRoute('/leaderboard', Leaderboard); mapRoute('/events', Events); mapRoute('/admin', Admin);
mapRoute('/gacha', Gacha); mapRoute('/studio', Studio); mapRoute('/parliament', Parliament);
mapRoute('/achievements', Achievements); mapRoute('/friends', Friends); mapRoute('/draw', Draw);

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty" style={{ paddingTop: 160 }}>载入中…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <Layout>{children}</Layout>;
}

const P = (el) => <Protected>{el}</Protected>;

export default function App() {
  const { user } = useAuth();
  const location = useLocation();
  // Once signed in and past first paint, gently warm every route chunk during
  // idle time so the first click on any nav item is instant (no cold-start stall).
  useEffect(() => { if (user) prefetchAllIdle(); }, [user]);
  // Defer committing the new location until inside document.startViewTransition,
  // so the browser captures before/after snapshots and animates the swap. This is
  // router-agnostic (works with BrowserRouter/HashRouter — no data router needed).
  const [displayed, setDisplayed] = useState(location);
  const prev = useRef(location);
  useEffect(() => {
    if (location === prev.current) return;
    const commit = () => { prev.current = location; setDisplayed(location); };
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof document === 'undefined' || !document.startViewTransition || reduce) { commit(); return; }
    // Promise form (no flushSync) so a suspending lazy route can't crash the transition.
    document.startViewTransition(() => new Promise((resolve) => {
      commit();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  }, [location]);
  return (
    <ToastProvider>
      <Suspense fallback={<div className="empty" style={{ paddingTop: 160 }}>载入中…</div>}>
        <Routes location={displayed}>
          <Route path="/auth" element={user ? <Navigate to="/" replace /> : <Auth />} />
          <Route path="/" element={P(<Home />)} />
          <Route path="/scripts" element={P(<Scripts />)} />
          <Route path="/script/new" element={P(<ScriptEditor />)} />
          <Route path="/script/:id" element={P(<ScriptDetail />)} />
          <Route path="/script/:id/edit" element={P(<ScriptEditor />)} />
          <Route path="/community" element={P(<Community />)} />
          <Route path="/search" element={P(<Search />)} />
          <Route path="/announcements" element={P(<Announcements />)} />
          <Route path="/leaderboard" element={P(<Leaderboard />)} />
          <Route path="/events" element={P(<Events />)} />
          <Route path="/gacha" element={P(<Gacha />)} />
          <Route path="/parliament" element={P(<Parliament />)} />
          <Route path="/achievements" element={P(<Achievements />)} />
          <Route path="/draw" element={P(<Draw />)} />
          <Route path="/friends" element={P(<Friends />)} />
          <Route path="/admin" element={P(<Admin />)} />
          <Route path="/chats" element={P(<Chat />)} />
          <Route path="/chats/:id" element={P(<Chat />)} />
          <Route path="/groups" element={P(<Groups />)} />
          <Route path="/group/:id" element={P(<GroupRoom />)} />
          <Route path="/theater" element={P(<Theater />)} />
          <Route path="/theater/:id" element={P(<TheaterRoom />)} />
          <Route path="/library" element={P(<Library />)} />
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
    </ToastProvider>
  );
}
