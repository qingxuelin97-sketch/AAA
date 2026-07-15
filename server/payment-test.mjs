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
process.env.PAYMENT_WEBHOOK_SECRETS = [
  'v2:payment-test-v2-secret-that-is-longer-than-32-characters',
  'v1:payment-test-v1-secret-that-is-longer-than-32-characters',
].join(',');

const { default: db } = await import('./db.js');
const {
  createPaymentOrder, getPaymentOrder, applyVerifiedPayment, verifyWebhook,
  paymentAvailability, paymentSchemaHealth, MAX_WEBHOOK_BYTES,
} = await import('./payment.js');
const { applyTx, assertEconomicAccess } = await import('./wallet.js');

let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed++;
  console.log(`  ✓ ${message}`);
};
const addUser = (name) => Number(db.prepare('INSERT INTO users (username,password_hash,display_name,gold,diamond) VALUES (?,?,?,?,?)')
  .run(name, 'x', name, 0, 0).lastInsertRowid);
const secretOf = (version) => version === 'v1'
  ? 'payment-test-v1-secret-that-is-longer-than-32-characters'
  : 'payment-test-v2-secret-that-is-longer-than-32-characters';
const signed = (payload, version = 'v2') => {
  const raw = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', secretOf(version)).update(`${timestamp}.`).update(raw).digest('hex');
  const headers = {
    'x-payment-timestamp': timestamp,
    'x-payment-signature': signature,
    'x-payment-key-version': version,
  };
  return { raw, headers, verification: verifyWebhook('custom-hmac', headers, raw) };
};
const deliver = (payload, version = 'v2') => {
  const proof = signed(payload, version);
  return applyVerifiedPayment('custom-hmac', payload, proof.raw, proof.verification);
};
let eventNo = 0;
let txNo = 0;
const event = (order, status, extra = {}) => ({
  event_id: `event-${String(++eventNo).padStart(6, '0')}`,
  order_id: order.id,
  transaction_id: `provider-tx-${String(++txNo).padStart(6, '0')}`,
  amount_cents: order.amount_cents,
  currency: 'CNY',
  status,
  ...extra,
});

try {
  check(paymentSchemaHealth().ok && paymentAvailability().available, '支付结构自检通过后才开放充值');

  const userId = addUser('payer');
  const order = createPaymentOrder(userId, { id: 'p1', cny: 1, diamond: 9999 }, 'payment-test-order-0001');
  check(order.status === 'pending' && order.amount_cents === 600 && order.diamond === 60,
    '订单只采用服务端套餐快照，不信任客户端金额');
  check(order.expires_at - order.created_at === 30 * 60_000, '充值订单在 30 分钟后过期');
  check(db.prepare('SELECT diamond FROM users WHERE id=?').get(userId).diamond === 0, '创建订单不会直接增加钻石');
  check(createPaymentOrder(userId, 'p1', 'payment-test-order-0001').id === order.id, '幂等重试返回原订单');
  assert.throws(() => createPaymentOrder(userId, 'unknown', 'payment-test-order-0002'), /套餐/);
  check(true, '未知套餐和客户端自造套餐被拒绝');

  const paidPayload = event(order, 'paid');
  const v2Proof = signed(paidPayload, 'v2');
  check(v2Proof.verification.keyVersion === 'v2', '当前 HMAC 密钥版本通过验签');
  const v1Proof = signed({ ...paidPayload, event_id: 'event-old-key' }, 'v1');
  check(v1Proof.verification.keyVersion === 'v1', '轮换窗口内的旧 HMAC 密钥仍可验签');
  assert.throws(() => verifyWebhook('custom-hmac', {
    ...v2Proof.headers, 'x-payment-key-version': undefined,
  }, v2Proof.raw), /密钥版本/);
  check(true, '多密钥配置下缺少密钥版本会被拒绝');
  assert.throws(() => verifyWebhook('custom-hmac', { ...v2Proof.headers, 'x-payment-key-version': 'v9' }, v2Proof.raw), /密钥版本/);
  check(true, '未知 HMAC 密钥版本会被拒绝');
  assert.throws(() => verifyWebhook('custom-hmac', v2Proof.headers, undefined), /原始请求体/);
  check(true, '缺少原始请求体时拒绝回调，不重新序列化 JSON');
  assert.throws(() => verifyWebhook('custom-hmac', v2Proof.headers, Buffer.alloc(MAX_WEBHOOK_BYTES + 1)), /过大/);
  check(true, '超过 64KiB 的支付回调被拒绝');

  const credited = applyVerifiedPayment('custom-hmac', paidPayload, v2Proof.raw, v2Proof.verification);
  check(credited.order.status === 'credited', 'paid 回调经原子记账进入 credited 终态');
  check(db.prepare('SELECT diamond FROM users WHERE id=?').get(userId).diamond === 60, '只按订单快照发放钻石');
  for (let i = 0; i < 100; i++) {
    const replay = applyVerifiedPayment('custom-hmac', paidPayload, v2Proof.raw, v2Proof.verification);
    assert.equal(replay.duplicate, true);
  }
  check(db.prepare("SELECT COUNT(*) n FROM transactions WHERE payment_order_id=? AND kind='recharge'").get(order.id).n === 1,
    '同一支付回调重放 100 次仍只入账一次');

  const refundPayload = event(order, 'refunded', { transaction_id: paidPayload.transaction_id, refund_amount_cents: 600 });
  const refunded = deliver(refundPayload);
  check(refunded.order.status === 'refunded' && db.prepare('SELECT diamond FROM users WHERE id=?').get(userId).diamond === 0,
    '全额退款自动回收对应钻石');
  for (let i = 0; i < 100; i++) deliver(refundPayload);
  check(db.prepare('SELECT COUNT(*) n FROM transactions WHERE reversal_of IS NOT NULL AND payment_order_id=?').get(order.id).n === 1,
    '退款回调重放 100 次仍只冲正一次');
  const chargebackAfterRefund = event(order, 'chargeback', { transaction_id: paidPayload.transaction_id, refund_amount_cents: 600 });
  check(deliver(chargebackAfterRefund).order.status === 'chargeback', '拒付优先级高于已记录的退款状态');
  check(db.prepare('SELECT COUNT(*) n FROM transactions WHERE reversal_of IS NOT NULL AND payment_order_id=?').get(order.id).n === 1,
    '退款后再收到拒付不会二次扣钻');
  const partialAfterChargeback = event(order, 'refunded', { transaction_id: paidPayload.transaction_id, refund_amount_cents: 100 });
  check(deliver(partialAfterChargeback).order.status === 'chargeback', '迟到的部分退款不会把 chargeback 终态降级为人工复核');

  const debtUser = addUser('debt-payer');
  const debtOrder = createPaymentOrder(debtUser, 'p2', 'payment-test-debt-0001');
  const debtPaid = event(debtOrder, 'paid');
  deliver(debtPaid);
  applyTx(debtUser, { kind: 'test_spend', diamond: -300, memo: 'test' });
  const debtRefund = event(debtOrder, 'refunded', { transaction_id: debtPaid.transaction_id, refund_amount_cents: 3000 });
  deliver(debtRefund);
  let debtWallet = db.prepare('SELECT diamond,diamond_debt,economic_hold,economic_hold_reason FROM users WHERE id=?').get(debtUser);
  check(debtWallet.diamond === 0 && debtWallet.diamond_debt === 300 && debtWallet.economic_hold === 1 && debtWallet.economic_hold_reason === 'payment_debt',
    '余额不足时归零并形成钻石债务和经济冻结');
  assert.throws(() => assertEconomicAccess(debtUser), error => error.status === 423 && error.code === 'ECONOMIC_HOLD');
  assert.throws(() => applyTx(debtUser, { kind: 'buy_script', gold: -1, memo: 'blocked laundering' }),
    error => error.status === 423 && error.code === 'ECONOMIC_HOLD');
  check(true, '经济冻结在钱包层统一阻断所有负向经济操作，不能借剧本、VIP 或 AI 费用洗出价值');
  applyTx(debtUser, { kind: 'reward', diamond: 100, memo: 'repay one' });
  debtWallet = db.prepare('SELECT diamond,diamond_debt,economic_hold FROM users WHERE id=?').get(debtUser);
  check(debtWallet.diamond === 0 && debtWallet.diamond_debt === 200 && debtWallet.economic_hold === 1,
    '后续钻石收入优先偿债且未还清时继续冻结');
  applyTx(debtUser, { kind: 'reward', diamond: 250, memo: 'repay two' });
  debtWallet = db.prepare('SELECT diamond,diamond_debt,economic_hold FROM users WHERE id=?').get(debtUser);
  check(debtWallet.diamond === 50 && debtWallet.diamond_debt === 0 && debtWallet.economic_hold === 0,
    '债务还清后只发放剩余钻石并自动解除支付冻结');

  const orderOutOfOrder = createPaymentOrder(addUser('out-of-order'), 'p1', 'payment-test-ooo-0001');
  const refundFirst = event(orderOutOfOrder, 'refunded', { refund_amount_cents: 600 });
  deliver(refundFirst);
  const paidLate = event(orderOutOfOrder, 'paid', { transaction_id: refundFirst.transaction_id });
  const lateResult = deliver(paidLate);
  check(lateResult.order.status === 'refunded' && db.prepare('SELECT COUNT(*) n FROM transactions WHERE payment_order_id=?').get(orderOutOfOrder.id).n === 0,
    '退款先于支付到达时，后续 paid 不会短暂或重复发币');

  const failedUser = addUser('failed-then-paid');
  const failedOrder = createPaymentOrder(failedUser, 'p1', 'payment-test-failed-0001');
  const failedEvent = event(failedOrder, 'failed');
  check(deliver(failedEvent).order.status === 'failed', '失败事件记录为 failed');
  const recoveredPaid = event(failedOrder, 'paid', { transaction_id: failedEvent.transaction_id });
  check(deliver(recoveredPaid).order.status === 'credited' && db.prepare('SELECT diamond FROM users WHERE id=?').get(failedUser).diamond === 60,
    '延迟 paid 可以从 failed 状态恢复并且只入账一次');

  const partialUser = addUser('partial-refund');
  const partialOrder = createPaymentOrder(partialUser, 'p1', 'payment-test-partial-0001');
  const partialPaid = event(partialOrder, 'paid');
  deliver(partialPaid);
  const partialRefund = event(partialOrder, 'refunded', { transaction_id: partialPaid.transaction_id, refund_amount_cents: 300 });
  const partialResult = deliver(partialRefund);
  check(partialResult.order.status === 'review_required' && db.prepare('SELECT diamond FROM users WHERE id=?').get(partialUser).diamond === 60,
    '部分退款进入人工复核，不自动错误扣除整笔钻石');

  const mismatchUser = addUser('amount-mismatch');
  const mismatchOrder = createPaymentOrder(mismatchUser, 'p1', 'payment-test-mismatch-0001');
  const mismatch = event(mismatchOrder, 'paid', { amount_cents: 1 });
  assert.throws(() => deliver(mismatch), /金额|币种/);
  check(db.prepare('SELECT processing_status FROM payment_events WHERE event_id=?').get(mismatch.event_id).processing_status === 'rejected'
    && db.prepare('SELECT status FROM payment_orders WHERE id=?').get(mismatchOrder.id).status === 'pending',
  '金额不符的已验签事件保留不可变审计记录但不会修改余额');

  const unknownOrder = event({ id: 'unknown-order-000001', amount_cents: 600 }, 'paid');
  assert.throws(() => deliver(unknownOrder), error => error.code === 'PAYMENT_ORDER_NOT_FOUND');
  const unknownAudit = db.prepare('SELECT processing_status,error_code FROM payment_events WHERE event_id=?').get(unknownOrder.event_id);
  check(unknownAudit?.processing_status === 'rejected' && unknownAudit?.error_code === 'ORDER_NOT_FOUND',
    '订单号不存在的已验签回调仍先保留不可变审计记录');

  const reusedTxUser = addUser('reused-provider-tx');
  const reusedOrderA = createPaymentOrder(reusedTxUser, 'p1', 'payment-reused-tx-order-a');
  const reusedPaidA = event(reusedOrderA, 'paid');
  deliver(reusedPaidA);
  const reusedOrderB = createPaymentOrder(reusedTxUser, 'p1', 'payment-reused-tx-order-b');
  const reusedPaidB = event(reusedOrderB, 'paid', { transaction_id: reusedPaidA.transaction_id });
  assert.throws(() => deliver(reusedPaidB), error => error.code === 'PAYMENT_PROVIDER_TX_REUSED');
  check(db.prepare('SELECT processing_status,error_code FROM payment_events WHERE event_id=?').get(reusedPaidB.event_id).error_code === 'PROVIDER_TX_REUSED'
    && db.prepare('SELECT status FROM payment_orders WHERE id=?').get(reusedOrderB.id).status === 'pending',
  '跨订单复用支付流水会被拒绝、留痕且不会触发唯一索引 500');

  const reducerUser = addUser('reducer-retry');
  const reducerOrder = createPaymentOrder(reducerUser, 'p1', 'payment-reducer-retry-0001');
  const reducerPaid = event(reducerOrder, 'paid');
  db.prepare('UPDATE users SET diamond=? WHERE id=?').run(Number.MAX_SAFE_INTEGER, reducerUser);
  assert.throws(() => deliver(reducerPaid), /安全整数/);
  check(db.prepare('SELECT processing_status FROM payment_events WHERE event_id=?').get(reducerPaid.event_id).processing_status === 'failed'
    && db.prepare('SELECT status FROM payment_orders WHERE id=?').get(reducerOrder.id).status === 'pending',
  '账本归并异常会回滚余额但保留已验签事件为 failed');
  db.prepare('UPDATE users SET diamond=0 WHERE id=?').run(reducerUser);
  check(deliver(reducerPaid).order.status === 'credited'
    && db.prepare("SELECT COUNT(*) n FROM transactions WHERE payment_order_id=? AND kind='recharge'").get(reducerOrder.id).n === 1,
  '同一 failed 事件可安全重试且最终只入账一次');

  const openUser = addUser('open-orders');
  for (let i = 0; i < 3; i++) createPaymentOrder(openUser, 'p1', `payment-open-order-${i}`);
  assert.throws(() => createPaymentOrder(openUser, 'p1', 'payment-open-order-3'), error => error.code === 'TOO_MANY_OPEN_PAYMENT_ORDERS');
  check(true, '同一用户最多保留 3 个未完成订单');

  const rateUser = addUser('rate-orders');
  let firstRateOrder;
  for (let i = 0; i < 5; i++) {
    const made = createPaymentOrder(rateUser, 'p1', `payment-rate-order-${i}`);
    if (i === 0) firstRateOrder = made;
    db.prepare("UPDATE payment_orders SET status='failed' WHERE id=?").run(made.id);
  }
  assert.throws(() => createPaymentOrder(rateUser, 'p1', 'payment-rate-order-5'), error => error.status === 429 && error.code === 'PAYMENT_ORDER_RATE_LIMIT');
  check(createPaymentOrder(rateUser, 'p1', 'payment-rate-order-0').id === firstRateOrder.id,
    '60 秒最多创建 5 单，幂等重试不占额度且在限流后仍可读取原单');

  const expiryUser = addUser('expired-late-paid');
  const expiryOrder = createPaymentOrder(expiryUser, 'p1', 'payment-test-expiry-0001');
  db.prepare('UPDATE payment_orders SET expires_at=? WHERE id=?').run(Date.now() - 1, expiryOrder.id);
  check(getPaymentOrder(expiryUser, expiryOrder.id).status === 'expired', '超过 30 分钟的待支付订单自动标记 expired');
  const expiryPaid = event(expiryOrder, 'paid');
  check(deliver(expiryPaid).order.status === 'credited', '已过期订单收到真实延迟 paid 时仍安全归并入账');

  db.exec('DROP INDEX idx_payment_orders_user_open');
  check(!paymentSchemaHealth({ refresh: true }).ok && !paymentAvailability().available,
    '关键支付索引缺失时支付健康检查 fail-closed');
  assert.throws(() => createPaymentOrder(userId, 'p1', 'payment-after-bad-schema'), error => error.status === 503 && error.code === 'PAYMENT_SCHEMA_UNHEALTHY');
  db.exec("CREATE INDEX idx_payment_orders_user_open ON payment_orders (user_id, status, expires_at)");
  check(paymentSchemaHealth({ refresh: true }).ok, '关键索引恢复后支付自检重新通过');
} finally {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
}

console.log(`\n支付安全回归: ${passed} passed`);
