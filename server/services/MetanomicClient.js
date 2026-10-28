/**
 * Server-side client for the Metanomic common-coin (CGC) HTTP API.
 *
 * - The game API key lives only in the server environment.
 * - Every state-changing call carries an Idempotency-Key. A timeout or 5xx means
 *   the outcome is unknown: callers retry with the SAME key and body and must not
 *   invent a new order id or reward reference.
 * - Amounts are decimal strings with at most 6 places (see utils/cgcAmount).
 */
const { formatCgc } = require('../utils/cgcAmount');

const DEFAULT_TIMEOUT_MS = 10_000;

class MetanomicError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, retryable?: boolean, outcomeUnknown?: boolean }} [info]
   */
  constructor(message, { status = 0, code = 'METANOMIC_ERROR', retryable = false, outcomeUnknown = false } = {}) {
    super(message);
    this.name = 'MetanomicError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.outcomeUnknown = outcomeUnknown;
  }
}

function readConfig(env = process.env) {
  const enabled = env.METANOMIC_ENABLED === '1' || env.METANOMIC_ENABLED === 'true';
  if (!enabled) return { enabled: false };
  const missing = ['METANOMIC_API_URL', 'METANOMIC_GAME_ID', 'METANOMIC_GAME_KEY'].filter((name) => !env[name]);
  if (missing.length) throw new Error(`METANOMIC_ENABLED requires ${missing.join(', ')}`);
  return {
    enabled: true,
    apiUrl: env.METANOMIC_API_URL.replace(/\/+$/, ''),
    gameId: env.METANOMIC_GAME_ID,
    gameKey: env.METANOMIC_GAME_KEY,
    assetId: env.METANOMIC_ASSET_ID || 'common-game-credit'
  };
}

class MetanomicClient {
  constructor({ apiUrl, gameId, gameKey, assetId = 'common-game-credit', fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.gameId = gameId;
    this.gameKey = gameKey;
    this.assetId = assetId;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, { body, key, query } = {}) {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [name, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.gameKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(key ? { 'Idempotency-Key': key } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (cause) {
      const timeout = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
      throw new MetanomicError(timeout ? 'Metanomic request timed out' : 'Metanomic is unreachable', {
        code: timeout ? 'METANOMIC_TIMEOUT' : 'METANOMIC_UNREACHABLE',
        retryable: true,
        outcomeUnknown: method !== 'GET'
      });
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new MetanomicError(payload?.error?.message || `Metanomic responded ${response.status}`, {
        status: response.status,
        code: payload?.error?.code || (retryable ? 'METANOMIC_UNAVAILABLE' : 'METANOMIC_REJECTED'),
        retryable,
        outcomeUnknown: response.status >= 500
      });
    }
    if (payload === null) {
      throw new MetanomicError('Metanomic returned an unreadable response', { status: response.status, code: 'BAD_RESPONSE', retryable: true, outcomeUnknown: method !== 'GET' });
    }
    return payload;
  }

  gamePath(suffix = '') { return `/games/${encodeURIComponent(this.gameId)}${suffix}`; }
  paymentPath(paymentId, suffix = '') { return `/payments/${encodeURIComponent(paymentId)}${suffix}`; }

  assets() { return this.request('GET', '/assets'); }
  budget() { return this.request('GET', this.gamePath('/budget')); }
  operation(operationId) { return this.request('GET', `/operations/${encodeURIComponent(operationId)}`); }
  events(cursor = 0) { return this.request('GET', this.gamePath('/events'), { query: { cursor } }); }

  /** @param {{ recipient: string, amountMicro: string|bigint, rewardRef: string, metadata?: object }} input */
  reward({ recipient, amountMicro, rewardRef, metadata }) {
    return this.request('POST', this.gamePath('/rewards'), {
      key: rewardRef,
      body: { recipient, assetId: this.assetId, amount: formatCgc(amountMicro), rewardRef, ...(metadata ? { metadata } : {}) }
    });
  }
  async rewardByRef(rewardRef) {
    const result = await this.request('GET', this.gamePath('/rewards'), { query: { rewardRef } });
    return result.rewards?.[0] ?? null;
  }

  /**
   * @param {object} body exactly the stored request body (payer, orderId, assetId, amount, item)
   * @param {string} key idempotency key, e.g. `purchase:{orderId}`
   */
  createPayment(body, key) { return this.request('POST', this.gamePath('/payments'), { body, key }); }
  buildPaymentBody({ payer, orderId, amountMicro, item }) {
    return { payer, orderId, assetId: this.assetId, amount: formatCgc(amountMicro), item };
  }
  getPayment(paymentId) { return this.request('GET', this.paymentPath(paymentId)); }
  listPayments({ status, cursor = 0, limit = 50, orderId } = {}) {
    return this.request('GET', this.gamePath('/payments'), { query: { status, cursor, limit, orderId } });
  }
  relayAuthorization(paymentId, body, key) { return this.request('POST', this.paymentPath(paymentId, '/authorizations'), { body, key }); }
  claimDelivery(paymentId) { return this.request('POST', this.paymentPath(paymentId, '/delivery-claims'), { body: {}, key: `claim:${paymentId}` }); }
  fulfill(paymentId, deliveryRef = `delivery:${paymentId}`) {
    return this.request('POST', this.paymentPath(paymentId, '/fulfillments'), { body: { deliveryRef }, key: `fulfill:${paymentId}` });
  }
  refund(paymentId) { return this.request('POST', this.paymentPath(paymentId, '/refunds'), { body: {}, key: `refund:${paymentId}` }); }
}

let shared;
function getConfig() { return readConfig(); }
function isEnabled() { return getConfig().enabled; }

/** The process-wide client. Throws a 503 CGC_DISABLED error when the integration is off. */
function getClient() {
  if (shared) return shared;
  const config = getConfig();
  if (!config.enabled) throw Object.assign(new Error('CGC 연동이 비활성화되어 있습니다.'), { statusCode: 503, code: 'CGC_DISABLED' });
  shared = new MetanomicClient(config);
  return shared;
}
function setClientForTests(client) { shared = client; }

module.exports = { MetanomicClient, MetanomicError, readConfig, isEnabled, getClient, setClientForTests };
