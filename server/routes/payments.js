import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { applyVerifiedPayment, verifyWebhook } from '../payment.js';
import { log } from '../logger.js';

const router = Router();
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '支付回调请求过于频繁' },
});

router.post('/:provider/webhook', webhookLimiter, (req, res, next) => {
  try {
    const rawBody = req.rawBody;
    const provider = String(req.params.provider || '').toLowerCase();
    const verification = verifyWebhook(provider, req.headers, rawBody);
    const result = applyVerifiedPayment(provider, req.body, rawBody, verification);
    log({
      level: 'info', source: 'server', category: 'payment', event: result.duplicate ? 'webhook_duplicate' : 'webhook_applied',
      message: `支付回调 ${result.order?.id || ''}`,
      endpoint: req.path, method: req.method, status: 200, request_id: req.requestId || '',
      extra: { provider, order_id: result.order?.id || '', duplicate: result.duplicate },
    });
    res.json({ ok: true, duplicate: result.duplicate, order: result.order });
  } catch (err) {
    next(err);
  }
});

export default router;
