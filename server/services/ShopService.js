/**
 * CGC shop orders: create a payment at Metanomic, relay the player's signatures,
 * then grant the purchased rights exactly once.
 *
 * Money safety rules:
 * - The Metanomic request body is stored before it is sent; unknown outcomes are retried
 *   with the same body and idempotency key.
 * - Rights are granted only after Metanomic reports DELIVERY_CLAIMED, in one DB transaction
 *   keyed by the order (deliveredAt); the sale is then confirmed with fulfill().
 * - Everything that can fail the delivery is checked while the payment is still PAID,
 *   because a payment cannot be refunded after the delivery claim.
 */
const { randomUUID, createHash } = require('node:crypto');
const CgcOrder = require('../models/CgcOrder');
const User = require('../models/User');
const GameConfig = require('../models/GameConfig');
const AuditLog = require('../models/AuditLog');
const metanomic = require('./MetanomicClient');
const { atomic } = require('./transactions');
const { products, getProduct } = require('../data/shop');
const { formatCgc } = require('../utils/cgcAmount');

const MAX_OPEN_ORDERS = 3;
const OPEN = ['CREATED', 'PROCESSING'];
const ACTIVE = ['CREATED', 'PROCESSING', 'PAID', 'CLAIMED', 'DELIVERED'];
const BATCH = 50;

function fail(statusCode, code, message, extra = {}) {
  throw Object.assign(new Error(message), { statusCode, code, ...extra });
}

/** Translate upstream errors into API errors without leaking internals. */
function upstream(error) {
  if (error.code === 'CGC_DISABLED') throw error;
  if (error.name === 'MetanomicError') {
    const status = error.retryable ? 503 : 409;
    throw Object.assign(new Error(error.retryable ? '결제 서비스에 일시적으로 접속할 수 없습니다.' : '결제 요청이 거절되었습니다.'), { statusCode: status, code: error.code });
  }
  throw error;
}

const orderView = (order) => ({
  orderId: order.orderId, sku: order.sku, kind: order.kind, name: order.name, quantity: order.quantity,
  totalMicro: order.totalMicro, total: formatCgc(order.totalMicro), status: order.status, paymentStatus: order.paymentStatus,
  expiresAt: order.expiresAt, deliveredAt: order.deliveredAt, completedAt: order.completedAt, createdAt: order.createdAt,
  waiting: order.paymentId ? null : 'payment'
});

async function catalog(userId) {
  const [config, user] = await Promise.all([GameConfig.getConfig(), User.findById(userId).select('wallet entitlements').lean()]);
  const disabled = new Set(config.shop?.disabled || []);
  return {
    enabled: metanomic.isEnabled(),
    walletLinked: Boolean(user?.wallet?.address),
    entitlements: { emblems: user?.entitlements?.emblems || [], speedupSeconds: user?.entitlements?.speedupSeconds || 0 },
    products: products.map((product) => ({
      id: product.id, kind: product.kind, name: product.name, emblem: product.emblem, grants: product.grants,
      priceMicro: product.priceMicro, price: formatCgc(product.priceMicro), maxQuantity: product.maxQuantity,
      available: !disabled.has(product.id) && !(product.kind === 'emblem' && user?.entitlements?.emblems?.includes(product.emblem))
    }))
  };
}

async function createOrder(userId, { sku, quantity = 1, requestId }) {
  const client = metanomic.getClient();
  if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 100) fail(400, 'INVALID_REQUEST', 'requestId가 필요합니다.');
  const existing = await CgcOrder.findOne({ userId, requestId });
  if (existing) return existing;

  const product = getProduct(sku);
  if (!product) fail(404, 'UNKNOWN_PRODUCT', '존재하지 않는 상품입니다.');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > product.maxQuantity) fail(400, 'INVALID_QUANTITY', '수량이 올바르지 않습니다.');
  const [config, user] = await Promise.all([GameConfig.getConfig(), User.findById(userId).select('wallet entitlements')]);
  if (!user) fail(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
  if (!user.wallet?.address) fail(409, 'WALLET_REQUIRED', '먼저 지갑을 연결하십시오.');
  if ((config.shop?.disabled || []).includes(sku)) fail(409, 'PRODUCT_DISABLED', '현재 판매하지 않는 상품입니다.');
  if (product.kind === 'emblem' && user.entitlements?.emblems?.includes(product.emblem)) fail(409, 'ALREADY_OWNED', '이미 보유한 문장입니다.');
  const open = await CgcOrder.find({ userId, status: { $in: OPEN } }).select('sku').lean();
  if (open.length >= MAX_OPEN_ORDERS) fail(429, 'TOO_MANY_OPEN_ORDERS', '진행 중인 주문이 너무 많습니다. 기존 주문을 완료하거나 만료를 기다리십시오.');
  if (product.kind === 'emblem' && open.some((order) => order.sku === sku)) fail(409, 'ORDER_IN_PROGRESS', '이 문장의 주문이 이미 진행 중입니다.');

  const orderId = `ord_${randomUUID()}`;
  const totalMicro = (BigInt(product.priceMicro) * BigInt(quantity)).toString();
  const body = client.buildPaymentBody({ payer: user.wallet.address, orderId, amountMicro: totalMicro, item: { sku, name: product.name, quantity } });
  let order;
  try {
    order = await CgcOrder.create({
      orderId, userId, requestId, payerWallet: user.wallet.address, sku, kind: product.kind, name: product.name, quantity,
      unitPriceMicro: product.priceMicro, totalMicro, grants: product.grants || {}, paymentRequest: body
    });
  } catch (error) {
    if (error.code === 11000) return CgcOrder.findOne({ userId, requestId }); // concurrent duplicate request
    throw error;
  }
  await requestPayment(client, order, { throwOnReject: true });
  return CgcOrder.findById(order._id);
}

/** Send (or re-send) the stored payment request. Safe to repeat: orderId and key are fixed. */
async function requestPayment(client, order, { throwOnReject = false } = {}) {
  try {
    const payment = await client.createPayment(order.paymentRequest, `purchase:${order.orderId}`);
    await CgcOrder.updateOne({ _id: order.id, paymentId: null }, { $set: { paymentId: payment.paymentId, paymentStatus: payment.status, expiresAt: new Date(payment.expiresAt * 1000), updatedAt: new Date() } });
  } catch (error) {
    await CgcOrder.updateOne({ _id: order.id }, { $inc: { attempts: 1 }, $set: { lastError: error.code || 'ERROR', updatedAt: new Date() } });
    if (!error.retryable && error.name === 'MetanomicError') {
      await CgcOrder.updateOne({ _id: order.id, paymentId: null }, { $set: { status: 'FAILED' } });
      if (throwOnReject) upstream(error);
    } else if (throwOnReject && error.name !== 'MetanomicError') throw error;
    // Retryable / unknown outcome: the poller re-sends the same request.
  }
}

async function ownedOrder(userId, orderId) {
  const order = await CgcOrder.findOne({ orderId, userId });
  if (!order) fail(404, 'ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.');
  return order;
}

async function listOrders(userId) {
  return (await CgcOrder.find({ userId }).sort({ createdAt: -1 }).limit(30)).map(orderView);
}

/** Order status plus, while unpaid, the typed data the player must sign. */
async function getOrder(userId, orderId) {
  let order = await ownedOrder(userId, orderId);
  const view = { order: orderView(order) };
  if (order.paymentId && ['CREATED', 'PROCESSING'].includes(order.status)) {
    const payment = await metanomic.getClient().getPayment(order.paymentId).catch(upstream);
    await mirror(order, payment);
    order = await CgcOrder.findById(order._id);
    view.order = orderView(order);
    if (payment.status === 'CREATED') view.signing = { authorization: payment.authorization, permit: payment.permit, permitDeadline: payment.expiresAt };
  }
  return view;
}

async function relayAuthorization(userId, orderId, { signature, permitSignature, permitDeadline } = {}) {
  const client = metanomic.getClient();
  const order = await ownedOrder(userId, orderId);
  if (!order.paymentId) fail(409, 'PAYMENT_NOT_READY', '결제가 아직 준비되지 않았습니다. 잠시 후 다시 시도하십시오.');
  if (order.status !== 'CREATED') fail(409, 'ORDER_NOT_PAYABLE', '서명할 수 없는 주문 상태입니다.');
  const user = await User.findById(userId).select('wallet').lean();
  if (!user?.wallet?.address || user.wallet.address !== order.payerWallet) fail(403, 'WALLET_MISMATCH', '주문의 지갑과 계정의 지갑이 다릅니다.');
  const hex = /^0x[0-9a-fA-F]{130}$/;
  if (!hex.test(signature || '') || (permitSignature !== undefined && !hex.test(permitSignature))) fail(400, 'INVALID_SIGNATURE', '서명 형식이 올바르지 않습니다.');
  const payment = await client.getPayment(order.paymentId).catch(upstream);
  await mirror(order, payment);
  if (payment.status !== 'CREATED') fail(409, 'ORDER_NOT_PAYABLE', '서명할 수 없는 주문 상태입니다.');
  if (permitSignature !== undefined && permitDeadline !== payment.expiresAt) fail(400, 'INVALID_DEADLINE', 'permitDeadline은 주문의 만료 시각이어야 합니다.');

  const body = { signature, ...(permitSignature !== undefined ? { permitSignature, permitDeadline } : {}) };
  // Same signature body -> same key (safe retry); a re-signed body gets a new key.
  const key = `auth:${order.paymentId}:${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)}`;
  try { await client.relayAuthorization(order.paymentId, body, key); }
  catch (error) { upstream(error); }
  await CgcOrder.updateOne({ _id: order._id, status: 'CREATED' }, { $set: { status: 'PROCESSING', paymentStatus: 'PROCESSING', updatedAt: new Date() } });
  return orderView(await CgcOrder.findById(order._id));
}

/** Bring the local order in line with the payment state reported by Metanomic. */
async function mirror(order, payment) {
  const next = { paymentStatus: payment.status, updatedAt: new Date() };
  const set = (status) => { next.status = status; };
  switch (payment.status) {
    case 'CREATED': if (order.status === 'PROCESSING') set('CREATED'); break;
    case 'PROCESSING': if (order.status === 'CREATED') set('PROCESSING'); break;
    case 'PAID': if (['CREATED', 'PROCESSING'].includes(order.status)) set('PAID'); break;
    case 'DELIVERY_CLAIMED': if (['CREATED', 'PROCESSING', 'PAID'].includes(order.status)) set('CLAIMED'); break;
    case 'COMPLETED': next.completedAt = order.completedAt || new Date(); set('COMPLETED'); break;
    case 'REFUNDED': set('REFUNDED'); break;
    case 'EXPIRED': if (order.status !== 'COMPLETED') set('EXPIRED'); break;
    default: break;
  }
  await CgcOrder.updateOne({ _id: order._id, status: { $nin: ['COMPLETED', 'REFUNDED', 'FAILED'] } }, { $set: next });
}

/** Can the purchase still be delivered? Decided while the payment is PAID, before claiming. */
async function deliverable(order) {
  const user = await User.findById(order.userId).select('entitlements').lean();
  if (!user) return false;
  if (order.kind === 'emblem') {
    const product = getProduct(order.sku);
    return Boolean(product) && !user.entitlements?.emblems?.includes(product.emblem);
  }
  return Boolean(getProduct(order.sku));
}

/** Grant the rights once. Idempotent per order through deliveredAt. */
async function deliver(order) {
  const product = getProduct(order.sku);
  return atomic(async () => {
    const claimed = await CgcOrder.findOneAndUpdate({ _id: order._id, deliveredAt: null }, { $set: { deliveredAt: new Date(), status: 'DELIVERED', updatedAt: new Date() } });
    if (!claimed) return false;
    const update = { $inc: { stateRevision: 1 } };
    if (order.kind === 'emblem') update.$addToSet = { 'entitlements.emblems': product.emblem };
    else update.$inc['entitlements.speedupSeconds'] = (order.grants?.speedupSeconds || 0) * order.quantity;
    await User.updateOne({ _id: order.userId }, update);
    return true;
  });
}

async function advance(client, order) {
  if (!order.paymentId) {
    // A payment request that never got through is abandoned after the payment window.
    if (Date.now() - +order.createdAt > 15 * 60 * 1000) {
      await CgcOrder.updateOne({ _id: order._id, paymentId: null }, { $set: { status: 'EXPIRED', updatedAt: new Date() } });
      return;
    }
    return requestPayment(client, order);
  }
  let payment;
  try { payment = await client.getPayment(order.paymentId); }
  catch (error) { if (error.retryable || error.status === 404) return; throw error; }
  await mirror(order, payment);
  order = await CgcOrder.findById(order._id);
  if (['COMPLETED', 'REFUNDED', 'EXPIRED', 'FAILED'].includes(order.status)) return;

  if (payment.status === 'PAID' && !order.claimRequested && !order.refundRequested) {
    if (await deliverable(order)) {
      await client.claimDelivery(order.paymentId);
      await CgcOrder.updateOne({ _id: order._id }, { $set: { claimRequested: true } });
    } else {
      await client.refund(order.paymentId);
      await CgcOrder.updateOne({ _id: order._id }, { $set: { refundRequested: true, lastError: 'NOT_DELIVERABLE' } });
    }
    return;
  }
  if (payment.status === 'DELIVERY_CLAIMED') {
    if (!order.deliveredAt) await deliver(order);
    order = await CgcOrder.findById(order._id);
    if (order.deliveredAt && !order.fulfillRequested) {
      await client.fulfill(order.paymentId, `delivery:${order.paymentId}`);
      await CgcOrder.updateOne({ _id: order._id }, { $set: { fulfillRequested: true } });
    }
  }
}

/** Poller job: move every unfinished order forward one step. */
async function processOrders(client = metanomic.getClient()) {
  const orders = await CgcOrder.find({ status: { $in: ACTIVE } }).sort({ createdAt: 1 }).limit(BATCH);
  for (const order of orders) {
    try { await advance(client, order); }
    catch (error) { await CgcOrder.updateOne({ _id: order._id }, { $set: { lastError: error.code || error.message }, $inc: { attempts: 1 } }); }
  }
  return orders.length;
}

async function setDisabled(actorId, skus) {
  const known = new Set(products.map((p) => p.id));
  if (!Array.isArray(skus) || skus.some((sku) => !known.has(sku))) fail(400, 'UNKNOWN_PRODUCT', '알 수 없는 상품이 포함되어 있습니다.');
  const config = await GameConfig.getConfig();
  const previous = [...(config.shop?.disabled || [])];
  config.shop = { disabled: [...new Set(skus)] };
  config.updatedAt = new Date();
  config.updatedBy = actorId;
  await config.save();
  await AuditLog.create({ actorId, action: 'shop.disabled', payload: { previous, disabled: config.shop.disabled } });
  return { disabled: config.shop.disabled };
}

module.exports = { catalog, createOrder, listOrders, getOrder, relayAuthorization, processOrders, setDisabled, orderView, MAX_OPEN_ORDERS };
