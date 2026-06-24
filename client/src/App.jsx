import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './api.jsx';
import { ToastProvider } from './ui.jsx';
import Layout from './components/Layout.jsx';
import Auth from './pages/Auth.jsx';

// Route-level code splitting — each page is fetched on demand so the initial
// bundle stays small and the discover page paints fast. The login screen and
// Layout shell stay eager (they're on the critical path for first paint).
const Home = lazy(() => import('./pages/Home.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
const CharacterEditor = lazy(() => import('./pages/CharacterEditor.jsx'));
const Chat = lazy(() => import('./pages/Chat.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Publish = lazy(() => import('./pages/Publish.jsx'));
const Scripts = lazy(() => import('./pages/Scripts.jsx'));
const ScriptDetail = lazy(() => import('./pages/ScriptDetail.jsx'));
const ScriptEditor = lazy(() => import('./pages/ScriptEditor.jsx'));
const Community = lazy(() => import('./pages/Community.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const GroupRoom = lazy(() => import('./pages/GroupRoom.jsx'));
const Theater = lazy(() => import('./pages/Theater.jsx'));
const TheaterRoom = lazy(() => import('./pages/TheaterRoom.jsx'));
const Wallet = lazy(() => import('./pages/Wallet.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Favorites = lazy(() => import('./pages/Favorites.jsx'));
const Search = lazy(() => import('./pages/Search.jsx'));
const CharacterView = lazy(() => import('./pages/CharacterView.jsx'));
const Announcements = lazy(() => import('./pages/Announcements.jsx'));
const Leaderboard = lazy(() => import('./pages/Leaderboard.jsx'));
const Events = lazy(() => import('./pages/Events.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Gacha = lazy(() => import('./pages/Gacha.jsx'));
const Studio = lazy(() => import('./pages/Studio.jsx'));
const Parliament = lazy(() => import('./pages/Parliament.jsx'));
const Achievements = lazy(() => import('./pages/Achievements.jsx'));
const Friends = lazy(() => import('./pages/Friends.jsx'));
const Draw = lazy(() => import('./pages/Draw.jsx'));

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
