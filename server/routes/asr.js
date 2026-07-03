import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../auth.js';
import { aiLimiter } from '../limiters.js';
import { getPlatform, asrReady } from '../platform.js';
import { transcribe } from '../asr.js';

// 语音识别（语音转文字）—— 「通话」把用户说的话转成文字后再走对话补全。
// 统一使用平台（GM 后台配置）的 ASR 服务；未配置则返回 501，前端回退到浏览器识别或文本输入。
const router = Router();
// 音频只在内存里中转，不落盘（识别完即弃），上限 20MB。
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// 前端可先探测平台 ASR 是否就绪，据此决定用服务端识别还是浏览器兜底。
router.get('/status', authRequired, (req, res) => {
  const a = getPlatform().asr || {};
  res.json({ ready: asrReady(), provider: a.provider || '', model: a.model || '' });
});

router.post('/transcribe', authRequired, aiLimiter, upload.single('audio'), async (req, res) => {
  if (!asrReady()) return res.status(501).json({ error: '平台尚未配置语音识别服务' });
  if (!req.file || !req.file.buffer?.length) return res.status(400).json({ error: '没有收到音频' });
  const a = getPlatform().asr;
  const out = await transcribe({
    proto: a.protocol || 'openai',
    base: a.base_url,
    key: a.key,
    model: a.model,
    audio: req.file.buffer,
    mime: req.file.mimetype || 'audio/webm',
    filename: req.file.originalname || 'audio.webm',
    language: a.language || (req.body?.language || ''),
  });
  if (!out.ok) return res.status(out.status || 502).json({ error: out.error });
  res.json({ text: (out.text || '').trim() });
});

export default router;
