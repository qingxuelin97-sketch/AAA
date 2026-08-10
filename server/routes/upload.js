import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'node:fs';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { uploadLimiter } from '../limiters.js';
import { log } from '../logger.js';
import { mediaMimeMatches } from '../mediaMagic.js';
import { ensureUploadDir, uploadPathFor, UPLOAD_DIR } from '../storage.js';

const router = Router();

const storage = multer.diskStorage({
  destination: ensureUploadDir(),
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

// 我上传的资源（用于「空间已满」时让用户看清占用并自助清理）。
// missing=true 表示库里有记录但文件已不在盘上——托管平台重建容器后的典型状态，
// 这类记录仍在吃配额，删掉即可释放。
router.get('/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT filename, mime, bytes, created_at FROM user_uploads WHERE user_id=? ORDER BY created_at DESC LIMIT 500')
    .all(req.user.id);
  const items = rows.map((r) => {
    const abs = uploadPathFor(r.filename);
    return { ...r, url: '/uploads/' + r.filename, missing: !(abs && fs.existsSync(abs)) };
  });
  res.json({ uploads: items, total_bytes: rows.reduce((s, r) => s + r.bytes, 0), quota_bytes: TOTAL_QUOTA });
});

// 删除自己的上传。此前 reserveUpload 在配额满时提示「请删除旧资源后再试」，
// 但删除端点根本不存在——用户被要求做一件做不到的事，配额一旦占满就永久卡死。
// 文件缺失时也照常删记录：那正是需要被清理的幽灵配额。
router.delete('/:filename', authRequired, (req, res) => {
  const { filename } = req.params;
  const abs = uploadPathFor(filename);
  if (!abs) return res.status(400).json({ error: '文件名非法' });
  // 所有权校验走 DB 而非文件系统：文件可能已经不在盘上，但配额记录还在。
  const row = db.prepare('SELECT * FROM user_uploads WHERE filename=? AND user_id=?').get(filename, req.user.id);
  if (!row) return res.status(404).json({ error: '资源不存在或不属于你' });
  db.prepare('DELETE FROM user_uploads WHERE filename=? AND user_id=?').run(filename, req.user.id);
  let fileRemoved = false;
  try { fs.unlinkSync(abs); fileRemoved = true; } catch { /* 文件已不在盘上，记录删掉即可 */ }
  log({
    level: 'info', category: 'upload', event: 'upload_delete',
    user_id: req.user.id, ip: req.ip, ua: req.header('user-agent') || '',
    endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
    extra: { filename, bytes: row.bytes, file_removed: fileRemoved },
    message: `用户 ${req.user.id} 删除上传 ${filename}（释放 ${row.bytes} 字节${fileRemoved ? '' : '，文件此前已丢失'}）`,
  });
  res.json({ ok: true, freed_bytes: row.bytes, file_removed: fileRemoved });
});

// —— 启动体检：幽灵配额 ——
// 「库里有记录、盘上没文件」的行仍然占着用户配额。托管平台上每次部署都会批量产生
// 这种行（容器重建，DB 在持久盘上活着而文件没了）。
// 这里只统计并留痕，**不自动删除**：UPLOAD_DIR 若被配错，自动清理会把真实数据的
// 记录一次性抹掉。清理交给用户自助（DELETE /upload/:filename）或 GM 按日志判断。
try {
  const rows = db.prepare('SELECT filename, bytes FROM user_uploads').all();
  let ghosts = 0, ghostBytes = 0;
  for (const r of rows) {
    const abs = uploadPathFor(r.filename);
    if (!abs || !fs.existsSync(abs)) { ghosts++; ghostBytes += r.bytes; }
  }
  if (ghosts) {
    log({ level: 'warn', source: 'server', category: 'upload', event: 'upload_ghost_quota',
      message: `${ghosts} 条上传记录对应的文件已不在盘上，占用配额 ${(ghostBytes / 1048576).toFixed(1)} MB（UPLOAD_DIR=${UPLOAD_DIR}）`,
      extra: { ghosts, ghost_bytes: ghostBytes, upload_dir: UPLOAD_DIR } });
  }
} catch { /* 全新库无表 */ }

export default router;
