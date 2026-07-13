import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'node:fs';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { uploadLimiter } from '../limiters.js';
import { log } from '../logger.js';
import { mediaMimeMatches } from '../mediaMagic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => {
    // 扩展名由 mimetype 决定（而非 originalname），杜绝伪造 .html/.svg 落盘。
    cb(null, crypto.randomBytes(12).toString('hex') + (EXT_BY_MIME[file.mimetype] || ''));
  }
});

// Allow images (incl. animated gif/webp/apng), short videos for dynamic
// backgrounds, and audio for character background music (BGM).
const allowed = /image\/(png|jpe?g|gif|webp|apng|avif)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|ogg|wav|x-wav|webm|aac|mp4|x-m4a)/;
// mimetype → 扩展名白名单：与 allowed 正则一一对应，落盘扩展名由此决定。
const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/apng': '.apng', 'image/avif': '.avif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
  'audio/x-wav': '.wav', 'audio/webm': '.weba', 'audio/aac': '.aac', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
};
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowed.test(file.mimetype) && EXT_BY_MIME[file.mimetype]) cb(null, true);
    else cb(new Error('不支持的文件类型，仅允许图片、短视频或音频'));
  }
});

const TOTAL_QUOTA = Math.max(10, Number(process.env.UPLOAD_USER_TOTAL_MB) || 250) * 1024 * 1024;
const DAILY_QUOTA = Math.max(5, Number(process.env.UPLOAD_USER_DAILY_MB) || 100) * 1024 * 1024;
const HEADER_BYTES = 256 * 1024;

const reserveUpload = db.transaction((userId, file) => {
  const total = db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM user_uploads WHERE user_id=?').get(userId).n;
  const daily = db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM user_uploads WHERE user_id=? AND created_at>=?')
    .get(userId, Date.now() - 86_400_000).n;
  if (total + file.size > TOTAL_QUOTA) throw Object.assign(new Error('个人上传空间已满，请删除旧资源后再试'), { status: 413, expose: true });
  if (daily + file.size > DAILY_QUOTA) throw Object.assign(new Error('今日上传流量已达上限，请明天再试'), { status: 429, expose: true });
  db.prepare('INSERT INTO user_uploads (user_id,filename,mime,bytes,created_at) VALUES (?,?,?,?,?)')
    .run(userId, file.filename, file.mimetype, file.size, Date.now());
});

router.post('/', authRequired, uploadLimiter, upload.single('file'), (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const absolute = req.file.path;
  try {
    const fd = fs.openSync(absolute, 'r');
    const header = Buffer.alloc(Math.min(HEADER_BYTES, req.file.size));
    try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
    if (!mediaMimeMatches(header, req.file.mimetype)) {
      throw Object.assign(new Error('文件内容与声明的媒体类型不一致'), { status: 400, expose: true });
    }
    reserveUpload(req.user.id, req.file);
  } catch (error) {
    try { fs.unlinkSync(absolute); } catch { /* */ }
    return next(error);
  }
  const kind = req.file.mimetype.startsWith('video') ? 'video' : req.file.mimetype.startsWith('audio') ? 'audio' : 'image';
  log({
    level: 'info', category: 'upload', event: 'upload',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size, kind },
    message: `用户 ${req.user.id} 上传文件 ${req.file.filename}（${req.file.mimetype}, ${req.file.size} 字节）`,
  });
  res.json({ url: '/uploads/' + req.file.filename, type: kind });
});

export default router;
