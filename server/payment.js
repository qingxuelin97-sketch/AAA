import crypto from 'node:crypto';
import db from './db.js';
import { applyTx, reversePaymentCredit } from './wallet.js';

const PROVIDER_ID = 'custom-hmac';
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const MAX_WEBHOOK_BYTES = 64 * 1024;
const ORDER_TTL_MS = 30 * 60_000;
const ORDER_WINDOW_MS = 60_000;
const MAX_ORDERS_PER_WINDOW = 5;
const MAX_OPEN_ORDERS = 3;
const ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export const PAYMENT_PACKAGES = Object.freeze([
  Object.freeze({ id: 'p1', cny: 6, diamond: 60, bonus: 0 }),
  Object.freeze({ id: 'p2', cny: 30, diamond: 300, bonus: 30 }),
  Object.freeze({ id: 'p3', cny: 68, diamond: 680, bonus: 120 }),
  Object.freeze({ id: 'p4', cny: 128, diamond: 1280, bonus: 320 }),
  Object.freeze({ id: 'p5', cny: 328, diamond: 3280, bonus: 1080 }),
  Object.freeze({ id: 'p6', cny: 648, diamond: 6480, bonus: 2880 }),
]);

function exposedError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

function parseSecrets() {
  const rotated = String(process.env.PAYMENT_WEBHOOK_SECRETS || '').trim();
  const entries = [];
  if (rotated) {
    for (const item of rotated.split(',')) {
      const split = item.indexOf(':');
      const version = split > 0 ? item.slice(0, split).trim() : '';
      const secret = split > 0 ? item.slice(split + 1) : '';
      if (!/^[A-Za-z0-9._-]{1,32}$/.test(version) || secret.length < 32 || entries.some(e => e.version === version)) return null;
      entries.push({ version, secret });
    }
  } else {
    const secret = String(process.env.PAYMENT_WEBHOOK_SECRET || '');
    if (secret.length >= 32) entries.push({ version: 'legacy', secret });
  }
  return entries.length ? entries : null;
}

function paymentConfig() {
  const provider = String(process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  const secrets = parseSecrets();
  const checkoutBase = String(process.env.PAYMENT_CHECKOUT_BASE_URL || '').trim();
  if (provider !== PROVIDER_ID || !secrets) return null;
  if (checkoutBase && !/^https:\/\//i.test(checkoutBase)) return null;
  return { provider, secrets, checkoutBase };
}

let cachedPaymentSchemaHealth = null;

// Full SQLite integrity checks can scan a large database. Cache the boot-time
// result so public package/availability endpoints cannot turn them into a cheap
// read-amplification attack. Deploy/migration checks may explicitly refresh it.
export function paymentSchemaHealth({ refresh = false } = {}) {
  if (!refresh && cachedPaymentSchemaHealth) return cachedPaymentSchemaHealth;
  try {
    const required = {
      users: ['diamond_debt', 'economic_hold', 'economic_hold_reason', 'economic_hold_at'],
      transactions: ['gross_diamond', 'diamond_debt_delta', 'diamond_debt_after', 'idempotency_key', 'reversal_of'],
      payment_orders: ['expires_at', 'credited_at', 'refunded_at', 'chargeback_at', 'credited_diamond', 'refund_amount_cents', 'last_event_id', 'review_reason'],
      payment_events: ['provider_tx_id', 'event_type', 'amount_cents', 'currency', 'key_version', 'payload_json', 'processing_status', 'error_code'],
    };
    for (const [table, columns] of Object.entries(required)) {
      const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      if (columns.some(column => !actual.has(column))) {
        cachedPaymentSchemaHealth = { ok: false, reason: `missing_${table}_column` };
        return cachedPaymentSchemaHealth;
      }
    }
    const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name));
    for (const name of [
      'idx_payment_orders_provider_tx', 'idx_payment_orders_client_request',
      'idx_payment_orders_user_created', 'idx_payment_orders_user_open',
      'idx_transactions_payment_credit', 'idx_transactions_idempotency', 'idx_transactions_reversal',
    ]) if (!indexes.has(name)) {
      cachedPaymentSchemaHealth = { ok: false, reason: `missing_index_${name}` };
      return cachedPaymentSchemaHealth;
    }
    const orderSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_orders'").get()?.sql || '';
    if (!orderSql.includes('chargeback') || !orderSql.includes('review_required')) {
      cachedPaymentSchemaHealth = { ok: false, reason: 'stale_payment_state_constraint' };
      return cachedPaymentSchemaHealth;
    }
    if (db.prepare('PRAGMA foreign_key_list(payment_events)').get()) {
      cachedPaymentSchemaHealth = { ok: false, reason: 'stale_payment_event_foreign_key' };
      return cachedPaymentSchemaHealth;
    }
    if (db.prepare('PRAGMA quick_check(1)').get()?.quick_check !== 'ok') {
      cachedPaymentSchemaHealth = { ok: false, reason: 'database_quick_check_failed' };
      return cachedPaymentSchemaHealth;
    }
    if (db.prepare('PRAGMA foreign_key_check').get()) {
      cachedPaymentSchemaHealth = { ok: false, reason: 'foreign_key_check_failed' };
      return cachedPaymentSchemaHealth;
    }
    cachedPaymentSchemaHealth = { ok: true, reason: null };
    return cachedPaymentSchemaHealth;
  } catch {
    cachedPaymentSchemaHealth = { ok: false, reason: 'schema_check_failed' };
    return cachedPaymentSchemaHealth;
  }
}

function requirePaymentReady() {
  const cfg = paymentConfig();
  if (!cfg) throw exposedError('在线支付尚未配置，充值保持关闭', 503, 'PAYMENT_DISABLED');
  const health = paymentSchemaHealth();
  if (!health.ok) throw exposedError('支付账本自检未通过，充值已安全关闭', 503, 'PAYMENT_SCHEMA_UNHEALTHY');
  return cfg;
}

export function paymentAvailability() {
  const cfg = paymentConfig();
  const health = cfg ? paymentSchemaHealth() : { ok: false, reason: 'not_configured' };
  return { available: !!cfg && health.ok, provider: cfg?.provider || null, reason: health.reason };
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
    expires_at: row.expires_at,
    paid_at: row.paid_at,
    credited_at: row.credited_at,
    refunded_at: row.refunded_at,
    chargeback_at: row.chargeback_at,
    review_reason: row.status === 'review_required' ? row.review_reason || '' : '',
  };
}

function expirePendingOrders(userId, now) {
  db.prepare(`UPDATE payment_orders SET status='expired', updated_at=?
    WHERE user_id=? AND status='pending' AND expires_at<=?`).run(now, userId, now);
}

export function getPaymentOrder(userId, orderId) {
  requirePaymentReady();
  if (!ID_RE.test(String(orderId || ''))) return null;
  const now = Date.now();
  db.transaction(() => expirePendingOrders(userId, now)).immediate();
  const row = db.prepare('SELECT * FROM payment_orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  return publicOrder(row, paymentConfig()?.checkoutBase || '');
}

function resolvePackage(pkg) {
  const id = typeof pkg === 'string' ? pkg : pkg?.id;
  const found = PAYMENT_PACKAGES.find(item => item.id === id);
  if (!found) throw exposedError('充值套餐不存在', 400, 'PAYMENT_PACKAGE_INVALID');
  const amountCents = found.cny * 100;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(found.diamond) || !Number.isSafeInteger(found.bonus)) {
    throw exposedError('服务端充值套餐配置无效', 503, 'PAYMENT_PACKAGE_UNSAFE');
  }
  return { ...found, amountCents };
}

export function createPaymentOrder(userId, requestedPackage, clientRequestId = null) {
  const cfg = requirePaymentReady();
  const pkg = resolvePackage(requestedPackage);
  const requestId = clientRequestId ? String(clientRequestId).trim() : null;
  if (requestId && !ID_RE.test(requestId)) throw exposedError('幂等键格式不正确', 400, 'IDEMPOTENCY_KEY_INVALID');
  const now = Date.now();
  const id = crypto.randomUUID();
  let row;
  db.transaction(() => {
    if (requestId) {
      const existing = db.prepare('SELECT * FROM payment_orders WHERE user_id = ? AND client_request_id = ?').get(userId, requestId);
      if (existing) {
        if (existing.package_id !== pkg.id) throw exposedError('同一幂等键不能用于不同充值套餐', 409, 'IDEMPOTENCY_KEY_CONFLICT');
        row = existing;
        return;
      }
    }
    expirePendingOrders(userId, now);
    const recent = db.prepare('SELECT COUNT(*) n FROM payment_orders WHERE user_id=? AND created_at>?').get(userId, now - ORDER_WINDOW_MS).n;
    if (recent >= MAX_ORDERS_PER_WINDOW) throw exposedError('创建充值订单过于频繁，请稍后再试', 429, 'PAYMENT_ORDER_RATE_LIMIT');
    const open = db.prepare("SELECT COUNT(*) n FROM payment_orders WHERE user_id=? AND status IN ('pending','paid')").get(userId).n;
    if (open >= MAX_OPEN_ORDERS) throw exposedError('请先完成现有充值订单', 409, 'TOO_MANY_OPEN_PAYMENT_ORDERS');
    db.prepare(`INSERT INTO payment_orders
      (id,user_id,provider,package_id,amount_cents,currency,diamond,bonus,status,client_request_id,created_at,updated_at,expires_at)
      VALUES (?,?,?,?,?,'CNY',?,?,'pending',?,?,?,?)`)
      .run(id, userId, cfg.provider, pkg.id, pkg.amountCents, pkg.diamond, pkg.bonus, requestId, now, now, now + ORDER_TTL_MS);
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

function validateRawBody(rawBody) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) throw exposedError('支付回调缺少原始请求体', 400, 'PAYMENT_RAW_BODY_REQUIRED');
  if (rawBody.length > MAX_WEBHOOK_BYTES) throw exposedError('支付回调请求体过大', 413, 'PAYMENT_WEBHOOK_TOO_LARGE');
}

export function verifyWebhook(provider, headers, rawBody) {
  const cfg = requirePaymentReady();
  if (provider !== cfg.provider) throw exposedError('支付通道未配置', 404, 'PAYMENT_PROVIDER_UNKNOWN');
  validateRawBody(rawBody);
  const timestamp = String(headers['x-payment-timestamp'] || '');
  const signature = String(headers['x-payment-signature'] || '').replace(/^sha256=/i, '');
  const requestedVersion = String(headers['x-payment-key-version'] || '');
  if (cfg.secrets.length > 1 && !requestedVersion) throw exposedError('支付回调缺少密钥版本', 401, 'PAYMENT_KEY_VERSION_REQUIRED');
  const selected = requestedVersion
    ? cfg.secrets.find(entry => entry.version === requestedVersion)
    : cfg.secrets[0];
  if (!selected) throw exposedError('支付回调密钥版本无效', 401, 'PAYMENT_KEY_VERSION_UNKNOWN');
  const ts = Number(timestamp);
  if (!/^\d{10,16}$/.test(timestamp) || !Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    throw exposedError('支付回调时间戳无效或已过期', 401, 'PAYMENT_TIMESTAMP_INVALID');
  }
  const expected = crypto.createHmac('sha256', selected.secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  if (!secureEqualHex(signature, expected)) throw exposedError('支付回调签名无效', 401, 'PAYMENT_SIGNATURE_INVALID');
  return { provider: cfg.provider, keyVersion: selected.version };
}

function validateEventPayload(payload, rawBody) {
  validateRawBody(rawBody);
  const eventId = String(payload?.event_id || '').trim();
  const orderId = String(payload?.order_id || '').trim();
  const providerTxId = String(payload?.transaction_id || '').trim();
  const amountCents = Number(payload?.amount_cents);
  const currency = String(payload?.currency || '').toUpperCase();
  const status = String(payload?.status || '').toLowerCase();
  if (![eventId, orderId, providerTxId].every(value => ID_RE.test(value))) {
    throw exposedError('支付回调标识格式无效', 400, 'PAYMENT_EVENT_ID_INVALID');
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || currency !== 'CNY') {
    throw exposedError('支付回调金额或币种无效', 400, 'PAYMENT_EVENT_AMOUNT_INVALID');
  }
  if (!['paid', 'failed', 'refunded', 'chargeback'].includes(status)) {
    throw exposedError('不支持的支付状态', 400, 'PAYMENT_EVENT_STATUS_INVALID');
  }
  const refundAmount = ['refunded', 'chargeback'].includes(status)
    ? Number(payload?.refund_amount_cents ?? amountCents)
    : 0;
  if (!Number.isSafeInteger(refundAmount) || refundAmount < 0) {
    throw exposedError('退款金额无效', 400, 'PAYMENT_REFUND_AMOUNT_INVALID');
  }
  return { eventId, orderId, providerTxId, amountCents, currency, status, refundAmount };
}

function markEvent(provider, eventId, status, errorCode = '') {
  db.prepare(`UPDATE payment_events SET processing_status=?, error_code=?, processed_at=?
    WHERE provider=? AND event_id=?`).run(status, errorCode, Date.now(), provider, eventId);
}

function markEventFailedIfPending(provider, eventId, errorCode = '') {
  db.prepare(`UPDATE payment_events SET processing_status='failed', error_code=?, processed_at=?
    WHERE provider=? AND event_id=? AND processing_status IN ('received','failed')`)
    .run(errorCode, Date.now(), provider, eventId);
}

export function applyVerifiedPayment(provider, payload, rawBody, verification = {}) {
  requirePaymentReady();
  const event = validateEventPayload(payload, rawBody);
  const keyVersion = String(verification.keyVersion || '').trim();
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(keyVersion)) throw exposedError('支付回调缺少验签结果', 500, 'PAYMENT_VERIFICATION_CONTEXT_REQUIRED');
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const payloadJson = rawBody.toString('utf8');
  let result;
  let deferredError = null;

  // Commit the immutable callback envelope before running the reducer. If a
  // later ledger/constraint operation fails, the event remains available for
  // audit and a safe idempotent retry instead of disappearing in a rollback.
  const recorded = db.transaction(() => {
    const priorEvent = db.prepare('SELECT * FROM payment_events WHERE provider = ? AND event_id = ?').get(provider, event.eventId);
    if (priorEvent) {
      if (priorEvent.order_id !== event.orderId || priorEvent.payload_hash !== payloadHash) {
        throw exposedError('支付事件编号冲突', 409, 'PAYMENT_EVENT_CONFLICT');
      }
      return { inserted: false, status: priorEvent.processing_status };
    }

    db.prepare(`INSERT INTO payment_events
      (provider,event_id,order_id,provider_tx_id,event_type,amount_cents,currency,refund_amount_cents,key_version,
       payload_hash,payload_json,processing_status,received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'received',?)`)
      .run(provider, event.eventId, event.orderId, event.providerTxId, event.status, event.amountCents,
        event.currency, event.refundAmount, keyVersion, payloadHash, payloadJson, Date.now());
    return { inserted: true, status: 'received' };
  }).immediate();

  if (!recorded.inserted && !['received', 'failed'].includes(recorded.status)) {
    return { duplicate: true, order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(event.orderId)) };
  }

  try {
    db.transaction(() => {
      // Another process may have completed this same previously-received event
      // while this request waited for SQLite's write lock.
      if (!recorded.inserted) {
        const live = db.prepare('SELECT processing_status FROM payment_events WHERE provider=? AND event_id=?')
          .get(provider, event.eventId);
        if (live && !['received', 'failed'].includes(live.processing_status)) {
          result = { duplicate: true, order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id=?').get(event.orderId)) };
          return;
        }
      }

      const order = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(event.orderId);
      if (!order || order.provider !== provider) {
        markEvent(provider, event.eventId, 'rejected', 'ORDER_NOT_FOUND');
        deferredError = exposedError('充值订单不存在', 404, 'PAYMENT_ORDER_NOT_FOUND');
        result = { duplicate: false, order: null };
        return;
      }

      if (order.amount_cents !== event.amountCents || order.currency !== event.currency) {
        markEvent(provider, event.eventId, 'rejected', 'AMOUNT_MISMATCH');
        deferredError = exposedError('支付金额或币种与订单不一致', 409, 'PAYMENT_AMOUNT_MISMATCH');
        result = { duplicate: false, order: publicOrder(order) };
        return;
      }
      if (order.provider_tx_id && order.provider_tx_id !== event.providerTxId) {
        markEvent(provider, event.eventId, 'rejected', 'PROVIDER_TX_CONFLICT');
        deferredError = exposedError('订单已绑定其他支付流水', 409, 'PAYMENT_PROVIDER_TX_CONFLICT');
        result = { duplicate: false, order: publicOrder(order) };
        return;
      }
      const txOwner = db.prepare(`SELECT id FROM payment_orders
        WHERE provider=? AND provider_tx_id=? AND id<>?`).get(provider, event.providerTxId, order.id);
      if (txOwner) {
        markEvent(provider, event.eventId, 'rejected', 'PROVIDER_TX_REUSED');
        deferredError = exposedError('支付流水已绑定其他订单', 409, 'PAYMENT_PROVIDER_TX_REUSED');
        result = { duplicate: false, order: publicOrder(order) };
        return;
      }

    const now = Date.now();
    const common = () => db.prepare(`UPDATE payment_orders SET provider_tx_id=COALESCE(provider_tx_id,?),
      last_event_id=?, updated_at=? WHERE id=?`).run(event.providerTxId, event.eventId, now, order.id);

    if (event.status === 'failed') {
      if (['pending', 'expired'].includes(order.status)) {
        db.prepare(`UPDATE payment_orders SET status='failed', provider_tx_id=COALESCE(provider_tx_id,?),
          last_event_id=?, updated_at=? WHERE id=?`).run(event.providerTxId, event.eventId, now, order.id);
      } else common();
      markEvent(provider, event.eventId, 'applied');
      result = { duplicate: false, order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id)) };
      return;
    }

    if (event.status === 'paid') {
      if (['refunded', 'chargeback', 'review_required'].includes(order.status)) {
        db.prepare(`UPDATE payment_orders SET provider_tx_id=COALESCE(provider_tx_id,?), paid_at=COALESCE(paid_at,?),
          last_event_id=?, updated_at=? WHERE id=?`).run(event.providerTxId, now, event.eventId, now, order.id);
      } else if (order.status === 'credited') {
        common();
      } else {
        db.prepare(`UPDATE payment_orders SET status='paid', provider_tx_id=COALESCE(provider_tx_id,?),
          paid_at=COALESCE(paid_at,?), last_event_id=?, updated_at=? WHERE id=?`)
          .run(event.providerTxId, now, event.eventId, now, order.id);
        const total = order.diamond + order.bonus;
        applyTx(order.user_id, {
          kind: 'recharge', diamond: total, memo: `充值订单 ${order.id}`,
          payment_order_id: order.id, idempotency_key: `payment-credit:${order.id}`,
          operation_id: `payment-credit:${order.id}`,
        });
        db.prepare(`UPDATE payment_orders SET status='credited', credited_at=COALESCE(credited_at,?),
          credited_diamond=?, updated_at=? WHERE id=?`).run(now, total, now, order.id);
      }
      markEvent(provider, event.eventId, 'applied');
      result = { duplicate: order.status === 'credited', order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id)) };
      return;
    }

    if (event.refundAmount !== order.amount_cents && ['refunded', 'chargeback'].includes(order.status)) {
      const terminalStatus = order.status === 'chargeback' || event.status === 'chargeback' ? 'chargeback' : 'refunded';
      db.prepare(`UPDATE payment_orders SET status=?, provider_tx_id=COALESCE(provider_tx_id,?),
        chargeback_at=CASE WHEN ?='chargeback' THEN COALESCE(chargeback_at,?) ELSE chargeback_at END,
        last_event_id=?, updated_at=? WHERE id=?`)
        .run(terminalStatus, event.providerTxId, terminalStatus, now, event.eventId, now, order.id);
      markEvent(provider, event.eventId, terminalStatus === order.status ? 'ignored' : 'applied', 'TERMINAL_STATE_PRESERVED');
      result = { duplicate: true, order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id)) };
      return;
    }

    if (event.refundAmount !== order.amount_cents) {
      const priorRefundTotal = order.refund_amount_cents || 0;
      const nextRefundTotal = event.refundAmount > Number.MAX_SAFE_INTEGER - priorRefundTotal
        ? Number.MAX_SAFE_INTEGER
        : priorRefundTotal + event.refundAmount;
      db.prepare(`UPDATE payment_orders SET status='review_required', provider_tx_id=COALESCE(provider_tx_id,?),
        refund_amount_cents=?, review_reason='partial_or_over_refund', last_event_id=?, updated_at=? WHERE id=?`)
        .run(event.providerTxId, nextRefundTotal, event.eventId, now, order.id);
      markEvent(provider, event.eventId, 'review', 'PARTIAL_OR_OVER_REFUND');
      result = { duplicate: false, review_required: true, order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id)) };
      return;
    }

    const credit = db.prepare("SELECT * FROM transactions WHERE payment_order_id=? AND kind='recharge'").get(order.id);
    let wallet = null;
    if (credit) {
      wallet = reversePaymentCredit(order.user_id, {
        original_transaction_id: credit.id,
        amount: order.diamond + order.bonus,
        kind: event.status === 'chargeback' ? 'recharge_chargeback' : 'recharge_refund',
        payment_order_id: order.id,
        idempotency_key: `payment-reversal:${order.id}`,
        operation_id: `payment-reversal:${order.id}`,
        memo: `${event.status === 'chargeback' ? '拒付' : '全额退款'}订单 ${order.id}`,
      });
    }
    const finalStatus = order.status === 'chargeback' || event.status === 'chargeback' ? 'chargeback' : 'refunded';
    db.prepare(`UPDATE payment_orders SET status=?, provider_tx_id=COALESCE(provider_tx_id,?),
      refund_amount_cents=?, refunded_at=CASE WHEN ?='refunded' THEN COALESCE(refunded_at,?) ELSE refunded_at END,
      chargeback_at=CASE WHEN ?='chargeback' THEN COALESCE(chargeback_at,?) ELSE chargeback_at END,
      last_event_id=?, updated_at=? WHERE id=?`)
      .run(finalStatus, event.providerTxId, order.amount_cents, finalStatus, now, finalStatus, now, event.eventId, now, order.id);
    markEvent(provider, event.eventId, 'applied');
    result = { duplicate: !!wallet?.idempotent, order: publicOrder(db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id)), wallet };
    }).immediate();
  } catch (error) {
    // The envelope was committed separately, so unexpected reducer failures
    // remain visible and can be retried without ever minting twice.
    try { markEventFailedIfPending(provider, event.eventId, String(error.code || 'REDUCER_FAILED').slice(0, 100)); } catch { /* preserve original error */ }
    throw error;
  }

  if (deferredError) throw deferredError;
  return result;
}
