import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './api.jsx';
import { ToastProvider } from './ui.jsx';
import Layout from './components/Layout.jsx';
import Auth from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Library from './pages/Library.jsx';
import CharacterEditor from './pages/CharacterEditor.jsx';
import Chat from './pages/Chat.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import Publish from './pages/Publish.jsx';
import Scripts from './pages/Scripts.jsx';
import ScriptDetail from './pages/ScriptDetail.jsx';
import ScriptEditor from './pages/ScriptEditor.jsx';
import Community from './pages/Community.jsx';
import Groups from './pages/Groups.jsx';
import GroupRoom from './pages/GroupRoom.jsx';
import Theater from './pages/Theater.jsx';
import TheaterRoom from './pages/TheaterRoom.jsx';
import Wallet from './pages/Wallet.jsx';
import Notifications from './pages/Notifications.jsx';
import Favorites from './pages/Favorites.jsx';
import Search from './pages/Search.jsx';
import CharacterView from './pages/CharacterView.jsx';
import Announcements from './pages/Announcements.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Admin from './pages/Admin.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty" style={{ paddingTop: 160 }}>载入中…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <Layout>{children}</Layout>;
}

const P = (el) => <Protected>{el}</Protected>;

export default function App() {
  const { user } = useAuth();
  return (
    <ToastProvider>
      <Routes>
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
        <Route path="/admin" element={P(<Admin />)} />
        <Route path="/chats" element={P(<Chat />)} />
        <Route path="/chats/:id" element={P(<Chat />)} />
        <Route path="/groups" element={P(<Groups />)} />
        <Route path="/group/:id" element={P(<GroupRoom />)} />
        <Route path="/theater" element={P(<Theater />)} />
        <Route path="/theater/:id" element={P(<TheaterRoom />)} />
        <Route path="/library" element={P(<Library />)} />
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
    </ToastProvider>
  );
}
