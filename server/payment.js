import crypto from 'node:crypto';
import db from './db.js';
import { applyTx } from './wallet.js';

const PROVIDER_ID = 'custom-hmac';
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function paymentConfig() {
  const provider = String(process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  const secret = String(process.env.PAYMENT_WEBHOOK_SECRET || '');
  const checkoutBase = String(process.env.PAYMENT_CHECKOUT_BASE_URL || '').trim();
  if (provider !== PROVIDER_ID || secret.length < 32) return null;
  if (checkoutBase && !/^https:\/\//i.test(checkoutBase)) return null;
  return { provider, secret, checkoutBase };
}

export function paymentAvailability() {
  const cfg = paymentConfig();
  return { available: !!cfg, provider: cfg?.provider || null };
}

function publicOrder(row, checkoutBase = '') {
  if (!row) return null;
  const checkout_url = checkoutBase
    ? `${checkoutBase}${checkoutBase.includes('?') ? '&' : '?'}order_id=${encodeURIComponent(row.id)}`
    : null;
  return {
    id: row.id,
    package_id: row.package_id,
    amount_cents: row.amount_cents,
    currency: row.currency,
    diamond: row.diamond,
    bonus: row.bonus,
    status: row.status,
    checkout_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getPaymentOrder(userId, orderId) {
  const row = db.prepare('SELECT * FROM payment_orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  return publicOrder(row, paymentConfig()?.checkoutBase || '');
}

export function createPaymentOrder(userId, pkg, clientRequestId = null) {
  const cfg = paymentConfig();
  if (!cfg) {
    const err = new Error('在线支付尚未配置，充值保持关闭');
    err.status = 503;
    err.expose = true;
    throw err;
  }
  const requestId = clientRequestId ? String(clientRequestId).trim() : null;
  if (requestId && !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
    const err = new Error('幂等键格式不正确');
    err.status = 400;
    err.expose = true;
    throw err;
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  let row;
  db.transaction(() => {
    if (requestId) {
      const existing = db.prepare('SELECT * FROM payment_orders WHERE user_id = ? AND client_request_id = ?').get(userId, requestId);
      if (existing) {
        if (existing.package_id !== pkg.id) {
          const err = new Error('同一幂等键不能用于不同充值套餐');
          err.status = 409;
          err.expose = true;
          throw err;
        }
        row = existing;
        return;
      }
    }
    db.prepare(`INSERT INTO payment_orders
      (id,user_id,provider,package_id,amount_cents,currency,diamond,bonus,status,client_request_id,created_at,updated_at)
      VALUES (?,?,?,?,?,'CNY',?,?,'pending',?,?,?)`)
      .run(id, userId, cfg.provider, pkg.id, Math.round(pkg.cny * 100), pkg.diamond, pkg.bonus, requestId, now, now);
    row = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(id);
  }).immediate();
  return publicOrder(row, cfg.checkoutBase);
}

function secureEqualHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(actual || '')) return false;
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyWebhook(provider, headers, rawBody) {
  const cfg = paymentConfig();
  if (!cfg || provider !== cfg.provider) {
    const err = new Error('支付通道未配置');
    err.status = 404;
    err.expose = true;
    throw err;
  }
  const timestamp = String(headers['x-payment-timestamp'] || '');
  const signature = String(headers['x-payment-signature'] || '').replace(/^sha256=/i, '');
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    const err = new Error('支付回调时间戳无效或已过期');
    err.status = 401;
    err.expose = true;
    throw err;
  }
  const expected = crypto.createHmac('sha256', cfg.secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  if (!secureEqualHex(signature, expected)) {
    const err = new Error('支付回调签名无效');
    err.status = 401;
    err.expose = true;
    throw err;
  }
  return cfg;
}

export function applyVerifiedPayment(provider, payload, rawBody) {
  const eventId = String(payload?.event_id || '').trim();
  const orderId = String(payload?.order_id || '').trim();
  const providerTxId = String(payload?.transaction_id || '').trim();
  const amountCents = Number(payload?.amount_cents);
  const currency = String(payload?.currency || '').toUpperCase();
  const status = String(payload?.status || '').toLowerCase();
  if (!eventId || !orderId || !providerTxId || !Number.isSafeInteger(amountCents) || currency !== 'CNY') {
    const err = new Error('支付回调字段不完整');
    err.status = 400;
    err.expose = true;
    throw err;
  }
  if (!['paid', 'failed'].includes(status)) {
    const err = new Error('不支持的支付状态');
    err.status = 400;
    err.expose = true;
    throw err;
  }

  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  let result;
  db.transaction(() => {
    const priorEvent = db.prepare('SELECT * FROM payment_events WHERE provider = ? AND event_id = ?').get(provider, eventId);
    if (priorEvent) {
      if (priorEvent.order_id !== orderId || priorEvent.payload_hash !== payloadHash) {
        const err = new Error('支付事件编号冲突');
        err.status = 409;
        err.expose = true;
        throw err;
      }
      const priorOrder = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(orderId);
      result = { duplicate: true, order: publicOrder(priorOrder) };
      return;
    }

    const order = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(orderId);
    if (!order || order.provider !== provider) {
      const err = new Error('充值订单不存在');
      err.status = 404;
      err.expose = true;
      throw err;
    }
    if (order.amount_cents !== amountCents || order.currency !== currency) {
      const err = new Error('支付金额或币种与订单不一致');
      err.status = 409;
      err.expose = true;
      throw err;
    }
    if (order.provider_tx_id && order.provider_tx_id !== providerTxId) {
      const err = new Error('订单已绑定其他支付流水');
      err.status = 409;
      err.expose = true;
      throw err;
    }

    db.prepare('INSERT INTO payment_events (provider,event_id,order_id,payload_hash,received_at) VALUES (?,?,?,?,?)')
      .run(provider, eventId, orderId, payloadHash, Date.now());
    if (status === 'failed') {
      if (order.status === 'pending') {
        db.prepare("UPDATE payment_orders SET status='failed', provider_tx_id=?, updated_at=? WHERE id=?")
          .run(providerTxId, Date.now(), order.id);
      }
      result = { duplicate: false, order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(order.id)) };
      return;
    }
    if (order.status === 'credited') {
      result = { duplicate: true, order: publicOrder(order) };
      return;
    }
    if (order.status !== 'pending' && order.status !== 'paid') {
      const err = new Error(`订单状态 ${order.status} 不允许入账`);
      err.status = 409;
      err.expose = true;
      throw err;
    }

    const now = Date.now();
    db.prepare("UPDATE payment_orders SET status='paid', provider_tx_id=?, paid_at=COALESCE(paid_at,?), updated_at=? WHERE id=?")
      .run(providerTxId, now, now, order.id);
    const total = order.diamond + order.bonus;
    const wallet = applyTx(order.user_id, {
      kind: 'recharge',
      diamond: total,
      memo: `充值订单 ${order.id}`,
      payment_order_id: order.id,
    });
    db.prepare("UPDATE payment_orders SET status='credited', updated_at=? WHERE id=?").run(Date.now(), order.id);
    result = {
      duplicate: false,
      order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(order.id)),
      wallet,
    };
  }).immediate();
  return result;
}
