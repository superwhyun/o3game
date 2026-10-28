/**
 * CGC payout outbox. Business code calls enqueue() inside its own transaction;
 * process() (run by CgcPoller) delivers pending rows to Metanomic and follows
 * their operations until they are final.
 *
 * - The reward reference is also the idempotency key, so a row is paid at most once
 *   even when responses are lost or several instances run.
 * - An unknown outcome (timeout, dropped connection) is resolved by looking the
 *   reference up before sending again.
 * - A budget shortfall is a wait, not a failure: the row stays PENDING and is
 *   retried with a growing delay until the budget is topped up.
 */
const CgcReward = require('../models/CgcReward');
const metanomic = require('./MetanomicClient');
const { toMicro } = require('../utils/cgcAmount');

const handlers = new Map();
const BATCH = 25;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const NOT_RETRYABLE = new Set(['VALIDATION_ERROR', 'BUSINESS_REFERENCE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'UNKNOWN_ASSET', 'WALLET_REQUIRED']);

/** @param {string} kind @param {{ onCompleted?: Function, onFailed?: Function }} callbacks */
function registerHandlers(kind, callbacks) { handlers.set(kind, callbacks); }

/** Create the outbox row. Call inside the business transaction. */
async function enqueue({ kind, refId, userId, wallet, amountMicro, rewardRef }) {
  const micro = toMicro(amountMicro);
  if (micro <= 0n) throw new RangeError('reward amount must be positive');
  const [row] = await CgcReward.create([{ kind, refId: String(refId), userId, wallet, amountMicro: micro.toString(), rewardRef }]);
  return row;
}

const backoff = (attempts) => Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.min(attempts, 10));

async function settle(row, status, extra = {}) {
  const updated = await CgcReward.findOneAndUpdate(
    { _id: row._id, status: { $in: ['PENDING', 'SUBMITTED'] } },
    { $set: { status, ...extra, ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}) } },
    { returnDocument: 'after' }
  );
  if (!updated) return null; // another instance finished it first
  const callback = handlers.get(row.kind)?.[status === 'COMPLETED' ? 'onCompleted' : 'onFailed'];
  if (callback) await callback(updated);
  return updated;
}

async function submit(client, row, now) {
  let existing = null;
  if (row.attempts > 0) existing = await client.rewardByRef(row.rewardRef).catch(() => null);
  try {
    const result = existing
      ? { rewardId: existing.rewardId, operationId: existing.operationId }
      : await client.reward({ recipient: row.wallet, amountMicro: row.amountMicro, rewardRef: row.rewardRef });
    await CgcReward.updateOne({ _id: row._id, status: 'PENDING' }, { $set: { status: 'SUBMITTED', rewardId: result.rewardId, operationId: result.operationId, lastError: '' }, $inc: { attempts: 1 } });
  } catch (error) {
    const code = error.code || 'ERROR';
    const waiting = code === 'BUDGET_EXCEEDED' || error.retryable || [401, 403, 404].includes(error.status);
    if (waiting) {
      const delay = [401, 403, 404].includes(error.status) ? 60_000 : backoff(row.attempts + 1);
      await CgcReward.updateOne({ _id: row._id, status: 'PENDING' }, { $set: { nextAttemptAt: new Date(+now + delay), lastError: code }, $inc: { attempts: 1 } });
    } else if (NOT_RETRYABLE.has(code) || error.status === 409 || error.status === 422) {
      await settle(row, 'FAILED', { lastError: code });
    } else {
      await CgcReward.updateOne({ _id: row._id, status: 'PENDING' }, { $set: { nextAttemptAt: new Date(+now + backoff(row.attempts + 1)), lastError: code }, $inc: { attempts: 1 } });
    }
  }
}

async function follow(client, row, now) {
  try {
    const operation = await client.operation(row.operationId);
    if (operation.status === 'FINALIZED') await settle(row, 'COMPLETED');
    else if (operation.status === 'FAILED') await settle(row, 'FAILED', { lastError: operation.error || 'OPERATION_FAILED' });
  } catch (error) {
    if (!error.retryable && error.status !== 404) await CgcReward.updateOne({ _id: row._id }, { $set: { lastError: error.code || 'ERROR' } });
  }
}

/** One delivery pass. Returns how many rows were looked at. */
async function process(client = metanomic.getClient(), now = new Date()) {
  const due = await CgcReward.find({ status: 'PENDING', nextAttemptAt: { $lte: now } }).sort({ createdAt: 1 }).limit(BATCH);
  for (const row of due) await submit(client, row, now);
  const following = await CgcReward.find({ status: 'SUBMITTED' }).sort({ createdAt: 1 }).limit(BATCH);
  for (const row of following) await follow(client, row, now);
  return due.length + following.length;
}

/** Admin: make a failed row eligible again (e.g. after fixing a wallet or topping up). */
async function retryFailed(rewardRef) {
  return CgcReward.findOneAndUpdate({ rewardRef, status: 'FAILED' }, { $set: { status: 'PENDING', nextAttemptAt: new Date(0), lastError: '' } }, { returnDocument: 'after' });
}

module.exports = { registerHandlers, enqueue, process, retryFailed };
