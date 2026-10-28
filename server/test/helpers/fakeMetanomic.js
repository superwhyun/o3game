/**
 * In-memory stand-in for the Metanomic game API, following docs/GAME_INTEGRATION.md.
 * Operations stay QUEUED until finalize() unless autoFinalize is set, so tests can
 * exercise "accepted but not final" states, lost responses and injected failures.
 */
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { parseCgc, formatCgc } = require('../../utils/cgcAmount');

const AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function startFakeMetanomic({ gameId = 'game-fake', gameKey = 'fake-key', budgetMicro = 0n, autoFinalize = false } = {}) {
  const state = {
    gameId, gameKey, budget: BigInt(budgetMicro), reserved: 0n, incoming: 0n,
    rewards: new Map(), payments: new Map(), operations: new Map(), events: [], idempotency: new Map(),
    balances: new Map(), requests: [], autoFinalize,
    failures: [], lostResponses: []
  };

  const event = (type, resourceId, payload = {}) => {
    state.events.push({ eventId: randomUUID(), type, resourceId, payload, cursor: state.events.length + 1 });
  };
  const operation = (kind, resourceId, apply) => {
    const op = { operationId: `op_${randomUUID()}`, kind, resourceId, status: 'QUEUED', error: null, apply };
    state.operations.set(op.operationId, op);
    if (state.autoFinalize) finalizeOperation(op);
    return op;
  };
  function finalizeOperation(op, success = true) {
    if (['FINALIZED', 'FAILED'].includes(op.status)) return;
    op.status = success ? 'FINALIZED' : 'FAILED';
    if (success) op.apply?.(); else op.fail?.();
  }
  const view = (op, extra = {}) => ({ ...extra, operationId: op.operationId, status: op.status });
  const paymentView = (p) => ({
    paymentId: p.paymentId, gameId, orderId: p.orderId, assetId: p.assetId, deploymentId: 'fake-deployment',
    amount: p.amount, payer: p.payer, status: p.status, expiresAt: p.expiresAt, claimBy: p.claimBy, item: p.item,
    ...(p.status === 'CREATED' ? {
      authorization: { domain: { name: 'Metanomic', version: '1', chainId: 202601, verifyingContract: '0x' + '11'.repeat(20) }, types: { Payment: [{ name: 'paymentId', type: 'string' }] }, primaryType: 'Payment', message: { paymentId: p.paymentId, amount: p.amount } },
      permit: { domain: { name: 'CGC', version: '1', chainId: 202601, verifyingContract: '0x' + '22'.repeat(20) }, types: { Permit: [{ name: 'value', type: 'uint256' }] }, primaryType: 'Permit', message: { value: parseCgc(p.amount).toString() } }
    } : {})
  });

  const fail = (status, code, message = code) => { throw Object.assign(new Error(message), { status, code }); };

  function idem(req, scope, body, handler) {
    const key = req.headers['idempotency-key'];
    if (!key) fail(422, 'IDEMPOTENCY_KEY_REQUIRED');
    const id = `${scope}|${key}`;
    const contentHash = hash(body);
    const previous = state.idempotency.get(id);
    if (previous) {
      if (previous.contentHash !== contentHash) fail(409, 'IDEMPOTENCY_CONFLICT');
      return previous.response;
    }
    const response = handler();
    state.idempotency.set(id, { contentHash, response });
    return response;
  }

  function route(req, url, body) {
    const path = url.pathname.replace(/^\/v1/, '');
    const method = req.method;
    let m;
    if (method === 'GET' && path === '/assets') return [200, { assetId: 'common-game-credit' }];
    if (!/^Bearer (.+)$/.test(req.headers.authorization || '') || req.headers.authorization !== `Bearer ${gameKey}`) fail(401, 'UNAUTHENTICATED');

    if (method === 'GET' && (m = path.match(/^\/operations\/([^/]+)$/))) {
      const op = state.operations.get(m[1]);
      if (!op) fail(404, 'OPERATION_NOT_FOUND');
      return [200, view(op, { error: op.error })];
    }
    if (!path.startsWith(`/games/${gameId}`) && !path.startsWith('/payments/')) fail(403, 'GAME_ACCESS_DENIED');

    if (method === 'GET' && path === `/games/${gameId}/budget`) {
      const available = state.budget - state.reserved;
      return [200, { assetId: 'common-game-credit', deploymentId: 'fake-deployment', onchain: formatCgc(state.budget), reserved: formatCgc(state.reserved), available: formatCgc(available), blockNumber: '1', blockHash: '0x0', finalized: true }];
    }
    if (method === 'POST' && path === `/games/${gameId}/rewards`) {
      const { recipient, assetId, amount, rewardRef } = body;
      if (!/^0x[0-9a-fA-F]{40}$/.test(recipient || '') || !AMOUNT.test(amount || '') || !rewardRef || !assetId) fail(422, 'VALIDATION_ERROR');
      return [202, idem(req, 'rewards', body, () => {
        const old = state.rewards.get(rewardRef);
        if (old) {
          if (old.contentHash !== hash(body)) fail(409, 'BUSINESS_REFERENCE_CONFLICT');
          return view(state.operations.get(old.operationId), { rewardId: old.rewardId });
        }
        const value = parseCgc(amount);
        if (value <= 0n) fail(422, 'VALIDATION_ERROR');
        if (state.budget - state.reserved < value) fail(409, 'BUDGET_EXCEEDED');
        state.reserved += value;
        const rewardId = `reward_${randomUUID()}`;
        const op = operation('reward', rewardId, () => {
          state.reserved -= value; state.budget -= value;
          const key = recipient.toLowerCase();
          state.balances.set(key, (state.balances.get(key) || 0n) + value);
          event('chain.RewardPaid', rewardId, { recipient, amount });
        });
        op.fail = () => { state.reserved -= value; };
        state.rewards.set(rewardRef, { rewardId, operationId: op.operationId, contentHash: hash(body), recipient, amount, rewardRef, assetId });
        return view(op, { rewardId });
      })];
    }
    if (method === 'GET' && path === `/games/${gameId}/rewards`) {
      const ref = url.searchParams.get('rewardRef');
      const rows = [...state.rewards.values()].filter((r) => !ref || r.rewardRef === ref);
      return [200, { rewards: rows.map((r) => ({ rewardId: r.rewardId, recipient: r.recipient, amount: r.amount, rewardRef: r.rewardRef, operationId: r.operationId, status: state.operations.get(r.operationId).status })) }];
    }
    if (method === 'POST' && path === `/games/${gameId}/payments`) {
      const { payer, orderId, assetId, amount, item } = body;
      if (!/^0x[0-9a-fA-F]{40}$/.test(payer || '') || !AMOUNT.test(amount || '') || !orderId || !assetId || !item?.sku) fail(422, 'VALIDATION_ERROR');
      const old = [...state.payments.values()].find((p) => p.orderId === orderId);
      if (old) {
        if (old.contentHash !== hash(body)) fail(409, 'BUSINESS_REFERENCE_CONFLICT');
        return [200, paymentView(old)];
      }
      const payment = { paymentId: `pay_${randomUUID()}`, orderId, assetId, amount, payer, item, status: 'CREATED', expiresAt: Math.floor(Date.now() / 1000) + 900, claimBy: null, contentHash: hash(body), sequence: state.payments.size + 1 };
      state.payments.set(payment.paymentId, payment);
      return [200, paymentView(payment)];
    }
    if (method === 'GET' && path === `/games/${gameId}/payments`) {
      const statuses = (url.searchParams.get('status') || '').split(',').filter(Boolean);
      const orderId = url.searchParams.get('orderId');
      const cursor = Number(url.searchParams.get('cursor') || 0);
      const limit = Number(url.searchParams.get('limit') || 50);
      const rows = [...state.payments.values()].filter((p) => p.sequence > cursor && (!statuses.length || statuses.includes(p.status)) && (!orderId || p.orderId === orderId)).slice(0, limit);
      return [200, { payments: rows.map(paymentView), nextCursor: rows.length ? rows[rows.length - 1].sequence : cursor }];
    }
    if (method === 'GET' && (m = path.match(/^\/payments\/([^/]+)$/))) {
      const payment = state.payments.get(m[1]);
      if (!payment) fail(404, 'PAYMENT_NOT_FOUND');
      return [200, paymentView(payment)];
    }
    if (method === 'POST' && (m = path.match(/^\/payments\/([^/]+)\/(authorizations|delivery-claims|fulfillments|refunds)$/))) {
      const payment = state.payments.get(m[1]);
      if (!payment) fail(404, 'PAYMENT_NOT_FOUND');
      const action = m[2];
      return [202, idem(req, `payment:${payment.paymentId}:${action}`, body, () => {
        const need = { authorizations: 'CREATED', 'delivery-claims': 'PAID', fulfillments: 'DELIVERY_CLAIMED', refunds: 'PAID' }[action];
        if (payment.status !== need) fail(409, 'INVALID_PAYMENT_STATE');
        if (action === 'authorizations') {
          if (!/^0x[0-9a-fA-F]{130}$/.test(body.signature || '')) fail(422, 'VALIDATION_ERROR');
          payment.status = 'PROCESSING';
          const op = operation('pay', payment.paymentId, () => { payment.status = 'PAID'; event('payment.paid', payment.paymentId); });
          op.fail = () => { payment.status = 'CREATED'; };
          return view(op, { paymentId: payment.paymentId });
        }
        if (action === 'delivery-claims') {
          const op = operation('claimDelivery', payment.paymentId, () => { payment.status = 'DELIVERY_CLAIMED'; event('payment.delivery_claimed', payment.paymentId); });
          return view(op, { paymentId: payment.paymentId });
        }
        if (action === 'fulfillments') {
          if (!body.deliveryRef) fail(422, 'VALIDATION_ERROR');
          const op = operation('fulfill', payment.paymentId, () => { payment.status = 'COMPLETED'; state.budget += parseCgc(payment.amount); event('payment.completed', payment.paymentId); });
          return view(op, { paymentId: payment.paymentId });
        }
        const op = operation('refund', payment.paymentId, () => { payment.status = 'REFUNDED'; event('payment.refunded', payment.paymentId); });
        return view(op, { paymentId: payment.paymentId });
      })];
    }
    if (method === 'GET' && path === `/games/${gameId}/events`) {
      const cursor = Number(url.searchParams.get('cursor') || 0);
      const events = state.events.filter((e) => e.cursor > cursor).slice(0, 100);
      return [200, { events, nextCursor: events.length ? events[events.length - 1].cursor : cursor }];
    }
    fail(404, 'NOT_FOUND', `${method} ${path}`);
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
      state.requests.push({ method: req.method, path: url.pathname + url.search, body, headers: req.headers });
      const injected = state.failures.findIndex((f) => f.match(req.method, url.pathname));
      if (injected >= 0) {
        const [{ respond }] = state.failures.splice(injected, 1);
        if (respond === 'hang') return; // never answer: client times out
        res.writeHead(respond.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { code: respond.code, message: respond.code } }));
      }
      let status; let payload;
      try { [status, payload] = route(req, url, body); }
      catch (error) {
        status = error.status || 500;
        payload = { error: { code: error.code || 'INTERNAL_ERROR', message: error.message } };
      }
      const lost = state.lostResponses.findIndex((match) => match(req.method, url.pathname));
      if (lost >= 0) { state.lostResponses.splice(lost, 1); return req.socket.destroy(); }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1`;

  return {
    url, gameId, gameKey, state,
    env: { METANOMIC_ENABLED: '1', METANOMIC_API_URL: url, METANOMIC_GAME_ID: gameId, METANOMIC_GAME_KEY: gameKey },
    /** Finalize every queued operation (or the one with this id). */
    finalize(operationId) {
      for (const op of state.operations.values()) if (!operationId || op.operationId === operationId) finalizeOperation(op);
    },
    failOperation(operationId) { finalizeOperation(state.operations.get(operationId), false); },
    /** Next matching request answers with this HTTP error, or 'hang' to never answer. */
    injectFailure(match, respond) { state.failures.push({ match: typeof match === 'function' ? match : (method, path) => path.includes(match), respond }); },
    /** Process the next matching request but drop the connection before answering. */
    loseResponse(match) { state.lostResponses.push(typeof match === 'function' ? match : (method, path) => path.includes(match)); },
    addBudget(micro) { state.budget += BigInt(micro); },
    balanceOf(address) { return state.balances.get(address.toLowerCase()) || 0n; },
    callsTo(fragment) { return state.requests.filter((r) => r.path.includes(fragment)); },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); })
  };
}

module.exports = { startFakeMetanomic };
