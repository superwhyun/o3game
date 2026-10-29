const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { startFakeMetanomic } = require('./helpers/fakeMetanomic');

const SIG = '0x' + 'a'.repeat(130);
const WALLET = '0x' + 'be'.repeat(20);

async function harness() {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('shop_test'));
  const fake = await startFakeMetanomic();
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'shop-integration-secret-only-for-tests-2026';
  Object.assign(process.env, fake.env);
  const metanomic = require('../services/MetanomicClient');
  metanomic.setClientForTests(undefined);
  const client = metanomic.getClient();
  const User = require('../models/User'), Order = require('../models/CgcOrder'), Config = require('../models/GameConfig');
  const shop = require('../services/ShopService');
  await User.init(); await Order.init(); await Config.getConfig();
  const boss = await User.create({ username: 'pricer', email: 'pricer@test.invalid', password: randomUUID(), planets: [{ galaxy: 9, system: 9, planet: 1 }] });
  await shop.setPrices(boss._id, { 'emblem.crescent': '3', 'emblem.laurel': '3', 'emblem.comet': '4', 'emblem.dragon': '5', 'emblem.anchor': '4', 'emblem.skull': '5', 'speedup.1h': '0.5', 'speedup.6h': '2.5', 'speedup.24h': '8' });
  let slot = 0;
  const makeUser = (name, wallet = WALLET) => User.create({ username: name, email: `${name}@test.invalid`, password: randomUUID(), ...(wallet ? { wallet: { address: wallet, linkedAt: new Date() } } : {}), planets: [{ galaxy: 1, system: 1, planet: ++slot }] });
  const app = express(); app.use(express.json()); app.use('/api/shop', require('../routes/shop'));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://localhost:${server.address().port}/api/shop`;
  const call = async (user, method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: String(user._id) }, process.env.JWT_SECRET)}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const buy = (user, sku, quantity = 1, requestId = randomUUID()) => call(user, 'POST', '/orders', { sku, quantity, requestId });
  const pass = () => shop.processOrders(client);
  const orderOf = (id) => Order.findOne({ orderId: id });
  return { db, fake, client, shop, User, Order, Config, makeUser, call, buy, pass, orderOf, close: async () => { await new Promise((r) => server.close(r)); await fake.close(); await mongoose.disconnect(); await db.stop(); } };
}

test('a purchase is delivered exactly once and confirmed with the sale settlement', async () => {
  const h = await harness();
  try {
    const user = await h.makeUser('buyer');
    const created = await h.buy(user, 'emblem.dragon');
    assert.equal(created.status, 200);
    const order = await h.orderOf(created.body.order.orderId);
    assert.equal(order.status, 'CREATED');
    assert.ok(order.paymentId);
    assert.deepEqual(h.fake.callsTo('/payments')[0].body, { payer: WALLET, orderId: order.orderId, assetId: 'common-game-credit', amount: '5.000000', item: { sku: 'emblem.dragon', name: '용 문장', quantity: 1 } });

    const view = await h.call(user, 'GET', `/orders/${order.orderId}`);
    assert.ok(view.body.signing.authorization && view.body.signing.permit);
    assert.equal(view.body.signing.permitDeadline, h.fake.state.payments.get(order.paymentId).expiresAt);

    // Signature handling: wrong deadline, bad format, and a stranger's order are rejected.
    assert.equal((await h.call(user, 'POST', `/orders/${order.orderId}/authorizations`, { signature: 'nope' })).body.code, 'INVALID_SIGNATURE');
    assert.equal((await h.call(user, 'POST', `/orders/${order.orderId}/authorizations`, { signature: SIG, permitSignature: SIG, permitDeadline: 1 })).body.code, 'INVALID_DEADLINE');
    const stranger = await h.makeUser('stranger', '0x' + '11'.repeat(20));
    assert.equal((await h.call(stranger, 'POST', `/orders/${order.orderId}/authorizations`, { signature: SIG })).status, 404);

    const signed = await h.call(user, 'POST', `/orders/${order.orderId}/authorizations`, { signature: SIG, permitSignature: SIG, permitDeadline: view.body.signing.permitDeadline });
    assert.equal(signed.body.order.status, 'PROCESSING');
    assert.equal((await h.call(user, 'POST', `/orders/${order.orderId}/authorizations`, { signature: SIG })).body.code, 'ORDER_NOT_PAYABLE');

    await h.pass(); // authorization not final upstream yet
    assert.equal((await h.orderOf(order.orderId)).status, 'PROCESSING');
    assert.equal(h.fake.callsTo('/delivery-claims').length, 0);

    h.fake.finalize(); await h.pass(); // PAID -> claim requested
    assert.equal((await h.orderOf(order.orderId)).status, 'PAID');
    assert.equal(h.fake.callsTo('/delivery-claims').length, 1);
    assert.deepEqual((await h.User.findById(user._id)).entitlements.emblems, []); // nothing before the claim is final

    h.fake.finalize(); await h.pass(); // DELIVERY_CLAIMED -> deliver + fulfill
    let reloaded = await h.User.findById(user._id);
    assert.deepEqual([...reloaded.entitlements.emblems], ['dragon']);
    assert.equal((await h.orderOf(order.orderId)).status, 'DELIVERED');
    assert.equal(h.fake.callsTo('/fulfillments').length, 1);

    h.fake.finalize(); await h.pass(); await h.pass();
    assert.equal((await h.orderOf(order.orderId)).status, 'COMPLETED');
    reloaded = await h.User.findById(user._id);
    assert.deepEqual([...reloaded.entitlements.emblems], ['dragon']);
    assert.equal(h.fake.state.budget, 5_000_000n); // sale proceeds reached the game budget
    assert.equal(h.fake.callsTo('/delivery-claims').length, 1);
    assert.equal(h.fake.callsTo('/fulfillments').length, 1);

    // Owned emblems cannot be bought again.
    assert.equal((await h.buy(user, 'emblem.dragon')).body.code, 'ALREADY_OWNED');
    const catalog = (await h.call(user, 'GET', '/catalog')).body;
    assert.equal(catalog.products.find((p) => p.id === 'emblem.dragon').available, false);
    assert.equal(catalog.products.find((p) => p.id === 'emblem.comet').price, '4.000000');
  } finally { await h.close(); }
});

test('speed-up time is credited by quantity and a crash between delivery and fulfillment never grants twice', async () => {
  const h = await harness();
  try {
    const user = await h.makeUser('timer');
    const { body } = await h.buy(user, 'speedup.6h', 3);
    const order = await h.orderOf(body.order.orderId);
    assert.equal(order.totalMicro, '7500000');
    await h.call(user, 'POST', `/orders/${order.orderId}/authorizations`, { signature: SIG });
    h.fake.finalize(); await h.pass(); h.fake.finalize();

    h.fake.injectFailure('/fulfillments', { status: 503, code: 'UNAVAILABLE' });
    await h.pass(); // delivers, fulfill fails
    let row = await h.orderOf(order.orderId);
    assert.equal(row.status, 'DELIVERED');
    assert.equal(row.fulfillRequested, false);
    assert.equal((await h.User.findById(user._id)).entitlements.speedupSeconds, 3 * 21600);

    await h.pass(); // the restart path: nothing is granted again, the sale is confirmed
    assert.equal((await h.User.findById(user._id)).entitlements.speedupSeconds, 3 * 21600);
    assert.equal((await h.orderOf(order.orderId)).fulfillRequested, true);
    h.fake.finalize(); await h.pass();
    assert.equal((await h.orderOf(order.orderId)).status, 'COMPLETED');

    // A second processor racing the delivery cannot grant twice either.
    await Promise.all([h.shop.processOrders(h.client), h.shop.processOrders(h.client)]);
    assert.equal((await h.User.findById(user._id)).entitlements.speedupSeconds, 3 * 21600);
  } finally { await h.close(); }
});

test('requests are idempotent and a lost payment response is recovered with the same request', async () => {
  const h = await harness();
  try {
    const user = await h.makeUser('retry');
    const requestId = randomUUID();
    const [a, b] = await Promise.all([h.buy(user, 'speedup.1h', 1, requestId), h.buy(user, 'speedup.1h', 1, requestId)]);
    assert.equal(a.body.order.orderId, b.body.order.orderId);
    assert.equal(await h.Order.countDocuments({ userId: user._id }), 1);
    assert.equal(h.fake.state.payments.size, 1);

    h.fake.loseResponse((method, path) => method === 'POST' && path.endsWith('/payments'));
    const lost = await h.buy(user, 'speedup.1h', 2);
    assert.equal(lost.status, 200);
    assert.equal(lost.body.order.waiting, 'payment');
    assert.equal(h.fake.state.payments.size, 2); // processed upstream although the reply was lost
    await h.pass();
    const row = await h.orderOf(lost.body.order.orderId);
    assert.ok(row.paymentId);
    assert.equal(h.fake.state.payments.size, 2);

    // A definite upstream rejection is reported and the order is closed.
    h.fake.injectFailure('/payments', { status: 422, code: 'VALIDATION_ERROR' });
    const rejected = await h.buy(user, 'speedup.1h');
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'VALIDATION_ERROR');
    assert.equal((await h.Order.findOne({ userId: user._id }).sort({ createdAt: -1 })).status, 'FAILED');
  } finally { await h.close(); }
});

test('rules: wallet required, quantities, open-order cap, disabled products, wallet binding, CGC off', async () => {
  const h = await harness();
  try {
    const nowallet = await h.makeUser('nowallet', null);
    assert.equal((await h.buy(nowallet, 'speedup.1h')).body.code, 'WALLET_REQUIRED');
    const user = await h.makeUser('rules');
    assert.equal((await h.buy(user, 'nothing.here')).body.code, 'UNKNOWN_PRODUCT');
    assert.equal((await h.buy(user, 'emblem.comet', 2)).body.code, 'INVALID_QUANTITY');
    assert.equal((await h.buy(user, 'speedup.1h', 0)).body.code, 'INVALID_QUANTITY');
    assert.equal((await h.buy(user, 'speedup.1h', 25)).body.code, 'INVALID_QUANTITY');
    assert.equal((await h.call(user, 'POST', '/orders', { sku: 'speedup.1h', quantity: 1 })).body.code, 'INVALID_REQUEST');

    assert.equal((await h.buy(user, 'emblem.comet')).status, 200);
    assert.equal((await h.buy(user, 'emblem.comet')).body.code, 'ORDER_IN_PROGRESS');
    assert.equal((await h.buy(user, 'speedup.1h')).status, 200);
    assert.equal((await h.buy(user, 'speedup.1h')).status, 200);
    assert.equal((await h.buy(user, 'speedup.1h')).body.code, 'TOO_MANY_OPEN_ORDERS');

    const boss = await h.makeUser('boss', '0x' + '22'.repeat(20));
    await h.shop.setDisabled(boss._id, ['emblem.skull']);
    assert.equal((await h.buy(boss, 'emblem.skull')).body.code, 'PRODUCT_DISABLED');
    assert.equal((await h.call(boss, 'GET', '/catalog')).body.products.find((p) => p.id === 'emblem.skull').available, false);
    await assert.rejects(h.shop.setDisabled(boss._id, ['emblem.unknown']), (e) => e.code === 'UNKNOWN_PRODUCT');
    assert.equal(await mongoose.model('AuditLog').countDocuments({ action: 'shop.disabled' }), 1);

    // The signing wallet must be the one the order was made for.
    const order = (await h.buy(boss, 'speedup.1h')).body.order;
    await h.User.updateOne({ _id: boss._id }, { $set: { 'wallet.address': '0x' + '33'.repeat(20) } });
    assert.equal((await h.call(boss, 'POST', `/orders/${order.orderId}/authorizations`, { signature: SIG })).body.code, 'WALLET_MISMATCH');

    for (const name of Object.keys(h.fake.env)) delete process.env[name];
    require('../services/MetanomicClient').setClientForTests(undefined);
    const off = await h.buy(user, 'speedup.1h');
    assert.equal(off.status, 503); assert.equal(off.body.code, 'CGC_DISABLED');
  } finally { await h.close(); }
});

test('a purchase that can no longer be delivered is refunded before the delivery claim; expired payments close the order', async () => {
  const h = await harness();
  try {
    const user = await h.makeUser('refund');
    const order = (await h.buy(user, 'emblem.laurel')).body.order;
    await h.call(user, 'POST', `/orders/${order.orderId}/authorizations`, { signature: SIG });
    h.fake.finalize();
    // The player obtained the same emblem some other way while the payment was in flight.
    await h.User.updateOne({ _id: user._id }, { $addToSet: { 'entitlements.emblems': 'laurel' } });
    await h.pass();
    assert.equal(h.fake.callsTo('/delivery-claims').length, 0);
    assert.equal(h.fake.callsTo('/refunds').length, 1);
    h.fake.finalize(); await h.pass();
    assert.equal((await h.orderOf(order.orderId)).status, 'REFUNDED');
    assert.deepEqual([...(await h.User.findById(user._id)).entitlements.emblems], ['laurel']);

    const other = await h.makeUser('expiry', '0x' + '44'.repeat(20));
    const expiring = (await h.buy(other, 'speedup.1h')).body.order;
    const payment = [...h.fake.state.payments.values()].find((p) => p.orderId === expiring.orderId);
    payment.status = 'EXPIRED';
    await h.pass();
    assert.equal((await h.orderOf(expiring.orderId)).status, 'EXPIRED');
  } finally { await h.close(); }
});

test('prices come only from the administrator: unpriced products cannot be bought, changes are audited', { timeout: 120000 }, async () => {
  const h = await harness();
  try {
    const user = await h.makeUser('pricebuyer');
    const boss = await h.User.findOne({ username: 'pricer' });
    await h.shop.setPrices(boss._id, { 'speedup.1h': null });
    assert.equal((await h.buy(user, 'speedup.1h')).body.code, 'PRODUCT_DISABLED');
    const listed = (await h.call(user, 'GET', '/catalog')).body.products.find((p) => p.id === 'speedup.1h');
    assert.equal(listed.available, false);
    await assert.rejects(h.shop.setPrices(boss._id, { 'speedup.1h': '-1' }), (e) => e.code === 'INVALID_PRICE');
    await assert.rejects(h.shop.setPrices(boss._id, { 'speedup.1h': '0' }), (e) => e.code === 'INVALID_PRICE');
    await assert.rejects(h.shop.setPrices(boss._id, { 'nope.x': '1' }), (e) => e.code === 'UNKNOWN_PRODUCT');
    await h.shop.setPrices(boss._id, { 'speedup.1h': '1.25' });
    const order = (await h.buy(user, 'speedup.1h', 2)).body.order;
    assert.equal(order.totalMicro, '2500000');
    await h.shop.setPrices(boss._id, { 'speedup.1h': '9' }); // later price changes never touch an existing order
    assert.equal((await h.orderOf(order.orderId)).totalMicro, '2500000');
    assert.ok(await mongoose.model('AuditLog').countDocuments({ action: 'shop.prices' }) >= 3);
  } finally { await h.close(); }
});

test('administrators switch products and speed-up targets with an audit trail', { timeout: 120000 }, async () => {
  const h = await harness();
  try {
    const boss = await h.makeUser('shopboss', '0x' + '55'.repeat(20));
    const overview = await h.shop.adminOverview();
    assert.equal(overview.enabled, true);
    assert.deepEqual(overview.allowedTypes, ['building', 'research', 'ship']);
    assert.ok(overview.products.some((p) => p.id === 'speedup.1h' && p.price === '0.500000'));
    assert.deepEqual((await h.shop.setSpeedupTypes(boss._id, ['building', 'building', 'ship'])).allowedTypes, ['building', 'ship']);
    await assert.rejects(h.shop.setSpeedupTypes(boss._id, ['defense']), (e) => e.code === 'INVALID_TYPES');
    await assert.rejects(h.shop.setSpeedupTypes(boss._id, 'building'), (e) => e.code === 'INVALID_TYPES');
    assert.deepEqual((await h.shop.adminOverview()).allowedTypes, ['building', 'ship']);
    assert.equal(await mongoose.model('AuditLog').countDocuments({ action: 'shop.speedupTypes' }), 1);
  } finally { await h.close(); }
});
