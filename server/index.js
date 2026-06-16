import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/upload.js';
import characterRoutes from './routes/characters.js';
import settingsRoutes from './routes/settings.js';
import chatRoutes from './routes/chat.js';
import communityRoutes from './routes/community.js';
import userRoutes from './routes/users.js';
import economyRoutes from './routes/economy.js';
import scriptRoutes from './routes/scripts.js';
import socialRoutes from './routes/social.js';
import groupRoutes from './routes/groups.js';
import theaterRoutes from './routes/theater.js';
import metaRoutes from './routes/meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));

app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/users', userRoutes);
app.use('/api/economy', economyRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/theater', theaterRoutes);
app.use('/api/meta', metaRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve built client (production) with SPA fallback.
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '服务器错误' });
});

app.listen(PORT, () => console.log(`AI 聊天平台后端运行于 http://localhost:${PORT}`));
