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
import Inbox from './pages/Inbox.jsx';
import PostDetail from './pages/PostDetail.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty" style={{ paddingTop: 160 }}>载入中…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user } = useAuth();
  return (
    <ToastProvider>
      <Routes>
        <Route path="/auth" element={user ? <Navigate to="/" replace /> : <Auth />} />
        <Route path="/" element={<Protected><Home /></Protected>} />
        <Route path="/library" element={<Protected><Library /></Protected>} />
        <Route path="/character/new" element={<Protected><CharacterEditor /></Protected>} />
        <Route path="/character/:id/edit" element={<Protected><CharacterEditor /></Protected>} />
        <Route path="/chats" element={<Protected><Chat /></Protected>} />
        <Route path="/chats/:id" element={<Protected><Chat /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/profile" element={<Protected><Profile /></Protected>} />
        <Route path="/user/:id" element={<Protected><Profile /></Protected>} />
        <Route path="/publish" element={<Protected><Publish /></Protected>} />
        <Route path="/inbox" element={<Protected><Inbox /></Protected>} />
        <Route path="/post/:id" element={<Protected><PostDetail /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
