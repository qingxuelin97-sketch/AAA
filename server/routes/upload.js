import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { authRequired } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '';
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  }
});

// Allow images (incl. animated gif/webp/apng) and short videos for dynamic backgrounds.
const allowed = /image\/(png|jpe?g|gif|webp|apng|avif)|video\/(mp4|webm|ogg)/;
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('不支持的文件类型，仅允许图片或短视频'));
  }
});

router.post('/', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const kind = req.file.mimetype.startsWith('video') ? 'video' : 'image';
  res.json({ url: '/uploads/' + req.file.filename, type: kind });
});

export default router;
