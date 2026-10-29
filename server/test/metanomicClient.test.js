const test = require('node:test');
const assert = require('node:assert/strict');
const { MetanomicClient, MetanomicError, readConfig, getClient, setClientForTests } = require('../services/MetanomicClient');
const { formatCgc, parseCgc } = require('../utils/cgcAmount');
const { startFakeMetanomic } = require('./helpers/fakeMetanomic');

const WALLET = '0x' + 'ab'.repeat(20);

test('CGC amounts convert exactly between micro units and 6 decimal strings', () => {
  assert.equal(formatCgc(0n), '0.000000');
  assert.equal(formatCgc('4000000'), '4.000000');
  assert.equal(formatCgc(1n), '0.000001');
  assert.equal(formatCgc(123456789n), '123.456789');
  assert.equal(parseCgc('4'), 4000000n);
  assert.equal(parseCgc('0.5'), 500000n);
  assert.equal(parseCgc('123.456789'), 123456789n);
  for (const bad of ['', '-1', '1.1234567', '01', '1e3', ' 1', 4, null]) assert.throws(() => parseCgc(bad));
  assert.throws(() => formatCgc(-1n));
  assert.throws(() => formatCgc(1.5));
});

test('configuration is off by default and validates required values when enabled', () => {
  assert.deepEqual(readConfig({}), { enabled: false });
  assert.throws(() => readConfig({ METANOMIC_ENABLED: '1', METANOMIC_API_URL: 'x' }), /METANOMIC_GAME_ID, METANOMIC_GAME_KEY/);
  const config = readConfig({ METANOMIC_ENABLED: '1', METANOMIC_API_URL: 'http://m/v1/', METANOMIC_GAME_ID: 'g', METANOMIC_GAME_KEY: 'k' });
  assert.equal(config.apiUrl, 'http://m/v1');
  assert.equal(config.assetId, 'common-game-credit');
  setClientForTests(undefined);
  assert.throws(() => getClient(), (error) => error.code === 'CGC_DISABLED' && error.statusCode === 503);
});

test('reward is idempotent per rewardRef and surfaces budget and conflict errors by code', async (t) => {
  const fake = await startFakeMetanomic({ budgetMicro: 10_000_000n });
  t.after(() => fake.close());
  const client = new MetanomicClient({ apiUrl: fake.url, gameId: fake.gameId, gameKey: fake.gameKey });

  const first = await client.reward({ recipient: WALLET, amountMicro: '4000000', rewardRef: 'monster:e1:u1' });
  const again = await client.reward({ recipient: WALLET, amountMicro: '4000000', rewardRef: 'monster:e1:u1' });
  assert.equal(first.rewardId, again.rewardId);
  assert.equal(first.status, 'QUEUED');
  assert.equal(fake.callsTo('/rewards').length, 2);
  assert.equal(fake.callsTo('/rewards')[0].body.amount, '4.000000');
  assert.equal(fake.callsTo('/rewards')[0].headers['idempotency-key'], 'monster:e1:u1');

  await assert.rejects(client.reward({ recipient: WALLET, amountMicro: '5000000', rewardRef: 'monster:e1:u1' }), (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409 && !error.retryable);
  await assert.rejects(client.reward({ recipient: WALLET, amountMicro: '99000000', rewardRef: 'monster:e1:u2' }), (error) => error.code === 'BUDGET_EXCEEDED' && !error.retryable);

  assert.equal((await client.operation(first.operationId)).status, 'QUEUED');
  fake.finalize();
  assert.equal((await client.operation(first.operationId)).status, 'FINALIZED');
  assert.equal(fake.balanceOf(WALLET), 4000000n);
  assert.equal((await client.rewardByRef('monster:e1:u1')).status, 'FINALIZED');
  assert.equal(await client.rewardByRef('nope'), null);
  assert.equal((await client.budget()).available, '6.000000');
});

test('payment lifecycle uses the documented endpoints and stable idempotency keys', async (t) => {
  const fake = await startFakeMetanomic({ autoFinalize: true });
  t.after(() => fake.close());
  const client = new MetanomicClient({ apiUrl: fake.url, gameId: fake.gameId, gameKey: fake.gameKey });
  const body = client.buildPaymentBody({ payer: WALLET, orderId: 'order-1', amountMicro: '4000000', item: { sku: 'emblem.crescent', name: '초승달 문장', quantity: 1 } });

  const payment = await client.createPayment(body, 'purchase:order-1');
  assert.equal(payment.status, 'CREATED');
  assert.ok(payment.authorization && payment.permit);
  assert.equal((await client.createPayment(body, 'purchase:order-1')).paymentId, payment.paymentId);
  await assert.rejects(client.claimDelivery(payment.paymentId), (error) => error.code === 'INVALID_PAYMENT_STATE');

  await client.relayAuthorization(payment.paymentId, { signature: '0x' + '1'.repeat(130), permitSignature: '0x' + '2'.repeat(130), permitDeadline: payment.expiresAt }, 'auth:1');
  assert.equal((await client.getPayment(payment.paymentId)).status, 'PAID');
  assert.deepEqual((await client.listPayments({ status: 'PAID,DELIVERY_CLAIMED' })).payments.map((p) => p.paymentId), [payment.paymentId]);

  await client.claimDelivery(payment.paymentId);
  assert.equal((await client.getPayment(payment.paymentId)).status, 'DELIVERY_CLAIMED');
  await client.fulfill(payment.paymentId);
  assert.equal((await client.getPayment(payment.paymentId)).status, 'COMPLETED');
  // Both the rejected early attempt and the real one used the same stable key.
  assert.deepEqual(new Set(fake.callsTo('/delivery-claims').map((r) => r.headers['idempotency-key'])), new Set([`claim:${payment.paymentId}`]));
  assert.equal(fake.callsTo('/fulfillments')[0].body.deliveryRef, `delivery:${payment.paymentId}`);
  assert.ok((await client.events(0)).events.some((e) => e.type === 'payment.completed'));
});

test('timeouts, dropped connections and 5xx are reported as unknown outcomes that can be retried with the same key', async (t) => {
  const fake = await startFakeMetanomic({ budgetMicro: 10_000_000n, autoFinalize: true });
  t.after(() => fake.close());
  const client = new MetanomicClient({ apiUrl: fake.url, gameId: fake.gameId, gameKey: fake.gameKey, timeoutMs: 150 });
  const input = { recipient: WALLET, amountMicro: '1000000', rewardRef: 'ref-1' };

  fake.injectFailure('/rewards', 'hang');
  await assert.rejects(client.reward(input), (error) => error instanceof MetanomicError && error.code === 'METANOMIC_TIMEOUT' && error.retryable && error.outcomeUnknown);

  fake.loseResponse('/rewards');
  await assert.rejects(client.reward(input), (error) => error.code === 'METANOMIC_UNREACHABLE' && error.outcomeUnknown);
  // The lost response had been processed; the retry returns the same reward instead of paying twice.
  const retry = await client.reward(input);
  assert.equal(fake.state.rewards.size, 1);
  assert.equal(retry.rewardId, fake.state.rewards.get('ref-1').rewardId);

  fake.injectFailure('/budget', { status: 503, code: 'FINALITY_UNAVAILABLE' });
  await assert.rejects(client.budget(), (error) => error.status === 503 && error.retryable && error.code === 'FINALITY_UNAVAILABLE');
  assert.equal(fake.balanceOf(WALLET), 1000000n);

  const wrongKey = new MetanomicClient({ apiUrl: fake.url, gameId: fake.gameId, gameKey: 'nope' });
  await assert.rejects(wrongKey.budget(), (error) => error.status === 401 && !error.retryable);
});
