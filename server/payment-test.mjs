import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, 'payment-test.tmp.sqlite');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });

process.env.DB_PATH = dbPath;
process.env.PAYMENT_PROVIDER = 'custom-hmac';
process.env.PAYMENT_WEBHOOK_SECRET = 'payment-test-secret-that-is-longer-than-32-characters';

const { default: db } = await import('./db.js');
const { createPaymentOrder, applyVerifiedPayment, verifyWebhook } = await import('./payment.js');

let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed++;
  console.log(`  ✓ ${message}`);
};

try {
  const userId = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,gold,diamond) VALUES ('payer','x','payer',0,0)").run().lastInsertRowid);
  const pkg = { id: 'p1', cny: 6, diamond: 60, bonus: 5 };
  const order = createPaymentOrder(userId, pkg, 'payment-test-order-0001');
  check(order.status === 'pending' && order.amount_cents === 600, '创建不可变金额的待支付订单');
  check(db.prepare('SELECT diamond FROM users WHERE id=?').get(userId).diamond === 0, '创建订单不会直接增加钻石');

  const timestamp = String(Date.now());
  const payload = {
    event_id: 'evt-1', order_id: order.id, transaction_id: 'provider-tx-1',
    amount_cents: 600, currency: 'CNY', status: 'paid',
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.`).update(raw).digest('hex');
  verifyWebhook('custom-hmac', { 'x-payment-timestamp': timestamp, 'x-payment-signature': signature }, raw);
  check(true, '正确的 HMAC 回调签名通过校验');
  assert.throws(() => verifyWebhook('custom-hmac', { 'x-payment-timestamp': timestamp, 'x-payment-signature': '0'.repeat(64) }, raw));
  check(true, '错误的回调签名被拒绝');

  const credited = applyVerifiedPayment('custom-hmac', payload, raw);
  check(credited.order.status === 'credited', '已验证支付进入 credited 终态');
  check(db.prepare('SELECT diamond FROM users WHERE id=?').get(userId).diamond === 65, '只按订单快照发放钻石与赠送额');
  check(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE payment_order_id=? AND kind='recharge'").get(order.id).n === 1, '充值订单只绑定一条钱包流水');

  const replay = applyVerifiedPayment('custom-hmac', payload, raw);
  check(replay.duplicate === true, '同一支付事件重放被识别为幂等请求');
  check(db.prepare('SELECT diamond FROM users WHERE id=?').get(userId).diamond === 65, '事件重放不会重复入账');

  const second = createPaymentOrder(userId, pkg, 'payment-test-order-0002');
  const wrong = { ...payload, event_id: 'evt-2', order_id: second.id, transaction_id: 'provider-tx-2', amount_cents: 1 };
  assert.throws(() => applyVerifiedPayment('custom-hmac', wrong, Buffer.from(JSON.stringify(wrong))), /金额|币种/);
  check(db.prepare('SELECT status FROM payment_orders WHERE id=?').get(second.id).status === 'pending', '金额不匹配时订单与余额均不变');

  const sameKey = createPaymentOrder(userId, pkg, 'payment-test-order-0002');
  check(sameKey.id === second.id, '客户端幂等键返回原订单而非重复建单');
} finally {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
}

console.log(`\n支付安全回归: ${passed} passed`);
