const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { startFakeMetanomic } = require('./helpers/fakeMetanomic');

const WALLET = '0x' + 'cd'.repeat(20);
const userId = () => new mongoose.Types.ObjectId();

async function harness(options = {}) {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('outbox_test'));
  const fake = await startFakeMetanomic(options);
  const { MetanomicClient } = require('../services/MetanomicClient');
  const client = new MetanomicClient({ apiUrl: fake.url, gameId: fake.gameId, gameKey: fake.gameKey, timeoutMs: 200 });
  const rewards = require('../services/CgcRewardService');
  const CgcReward = require('../models/CgcReward');
  const Lease = require('../models/Lease');
  await CgcReward.init(); await Lease.init();
  const settled = { completed: [], failed: [] };
  rewards.registerHandlers('test', { onCompleted: (row) => settled.completed.push(row.rewardRef), onFailed: (row) => settled.failed.push(row.rewardRef) });
  return { db, fake, client, rewards, CgcReward, Lease, settled, close: async () => { await fake.close(); await mongoose.disconnect(); await db.stop(); } };
}
const enqueue = (h, ref, amountMicro = '1000000', wallet = WALLET) => h.rewards.enqueue({ kind: 'test', refId: ref, userId: userId(), wallet, amountMicro, rewardRef: ref });

test('outbox pays each reference once, follows the operation to completion and reports it', async () => {
  const h = await harness({ budgetMicro: 10_000_000n });
  try {
    await enqueue(h, 'r1', '2500000');
    await assert.rejects(enqueue(h, 'r1'), (error) => error.code === 11000); // one row per reference
    await h.rewards.process(h.client);
    assert.equal((await h.CgcReward.findOne({ rewardRef: 'r1' })).status, 'SUBMITTED');
    assert.equal(h.fake.callsTo('/rewards').filter((r) => r.method === 'POST').length, 1);
    assert.equal(h.fake.callsTo('/rewards')[0].body.amount, '2.500000');

    await h.rewards.process(h.client); // still queued upstream: nothing changes, nothing is resent
    assert.equal(h.fake.callsTo('/rewards').filter((r) => r.method === 'POST').length, 1);
    assert.deepEqual(h.settled.completed, []);

    h.fake.finalize();
    await h.rewards.process(h.client);
    const row = await h.CgcReward.findOne({ rewardRef: 'r1' });
    assert.equal(row.status, 'COMPLETED');
    assert.deepEqual(h.settled.completed, ['r1']);
    assert.equal(h.fake.balanceOf(WALLET), 2500000n);
    await h.rewards.process(h.client);
    assert.deepEqual(h.settled.completed, ['r1']); // callback fires once
  } finally { await h.close(); }
});

test('lost responses and timeouts resolve to a single payout', async () => {
  const h = await harness({ budgetMicro: 10_000_000n, autoFinalize: true });
  try {
    await enqueue(h, 'lost');
    h.fake.loseResponse((method, path) => method === 'POST' && path.endsWith('/rewards'));
    await h.rewards.process(h.client);
    let row = await h.CgcReward.findOne({ rewardRef: 'lost' });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.attempts, 1);
    assert.equal(h.fake.state.rewards.size, 1); // the lost request had been processed

    await h.rewards.process(h.client, new Date(Date.now() + 60_000)); // after the retry delay
    row = await h.CgcReward.findOne({ rewardRef: 'lost' });
    assert.equal(row.status, 'COMPLETED'); // adopted the existing reward and followed it in the same pass
    assert.equal(h.fake.state.rewards.size, 1);
    assert.equal(h.fake.balanceOf(WALLET), 1000000n);

    await enqueue(h, 'slow');
    h.fake.injectFailure('/rewards', 'hang');
    await h.rewards.process(h.client);
    assert.equal((await h.CgcReward.findOne({ rewardRef: 'slow' })).status, 'PENDING');
    await h.rewards.process(h.client, new Date(Date.now() + 60_000));
    await h.rewards.process(h.client);
    assert.equal((await h.CgcReward.findOne({ rewardRef: 'slow' })).status, 'COMPLETED');
    assert.equal(h.fake.balanceOf(WALLET), 2000000n);
  } finally { await h.close(); }
});

test('an empty budget makes the row wait and it is paid once budget is added', async () => {
  const h = await harness({ budgetMicro: 500_000n, autoFinalize: true });
  try {
    await enqueue(h, 'big', '3000000');
    await h.rewards.process(h.client);
    let row = await h.CgcReward.findOne({ rewardRef: 'big' });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.lastError, 'BUDGET_EXCEEDED');
    assert.ok(+row.nextAttemptAt > Date.now());
    assert.deepEqual(h.settled.failed, []);

    await h.rewards.process(h.client); // not due yet: no new request
    assert.equal(h.fake.callsTo('/rewards').length, 1);

    h.fake.addBudget(5_000_000n);
    await h.rewards.process(h.client, new Date(Date.now() + 10 * 60_000));
    await h.rewards.process(h.client);
    row = await h.CgcReward.findOne({ rewardRef: 'big' });
    assert.equal(row.status, 'COMPLETED');
    assert.equal(h.fake.balanceOf(WALLET), 3000000n);
  } finally { await h.close(); }
});

test('definite upstream failures fail the row once and can be retried by an administrator', async () => {
  const h = await harness({ budgetMicro: 10_000_000n });
  try {
    await enqueue(h, 'bad-op');
    await h.rewards.process(h.client);
    h.fake.failOperation([...h.fake.state.operations.keys()][0]);
    await h.rewards.process(h.client);
    assert.equal((await h.CgcReward.findOne({ rewardRef: 'bad-op' })).status, 'FAILED');
    assert.deepEqual(h.settled.failed, ['bad-op']);
    await h.rewards.process(h.client);
    assert.deepEqual(h.settled.failed, ['bad-op']);

    await enqueue(h, 'bad-wallet', '1000000', 'not-a-wallet');
    await h.rewards.process(h.client);
    assert.equal((await h.CgcReward.findOne({ rewardRef: 'bad-wallet' })).status, 'FAILED');
    assert.equal(h.fake.state.rewards.has('bad-wallet'), false);

    // A new reference cannot reuse the failed one; the same row can be retried explicitly.
    assert.equal((await h.rewards.retryFailed('bad-op')).status, 'PENDING');
    assert.equal(await h.rewards.retryFailed('bad-op'), null);
  } finally { await h.close(); }
});

test('only the lease holder runs the poller and a crashed holder is replaced', async () => {
  const h = await harness({ budgetMicro: 10_000_000n, autoFinalize: true });
  try {
    const { acquire } = h.Lease;
    const now = new Date();
    assert.equal(await acquire.call(h.Lease, 'job', 'a', 15_000, now), true);
    assert.equal(await acquire.call(h.Lease, 'job', 'a', 15_000, now), true); // renew
    assert.equal(await acquire.call(h.Lease, 'job', 'b', 15_000, now), false);
    assert.equal(await acquire.call(h.Lease, 'job', 'b', 15_000, new Date(+now + 16_000)), true);
    assert.equal(await acquire.call(h.Lease, 'job', 'a', 15_000, new Date(+now + 17_000)), false);

    // Many concurrent claimants: exactly one wins.
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => acquire.call(h.Lease, 'race', `h${i}`, 15_000, now)));
    assert.equal(results.filter(Boolean).length, 1);

    // Two processors working the same rows still pay once (the reference is the idempotency key).
    await enqueue(h, 'dup');
    await Promise.all([h.rewards.process(h.client), h.rewards.process(h.client)]);
    await h.rewards.process(h.client);
    assert.equal(h.fake.state.rewards.size, 1);
    assert.equal(h.fake.balanceOf(WALLET), 1000000n);
  } finally { await h.close(); }
});

test('the poller does nothing while the integration is disabled', async () => {
  const poller = require('../services/CgcPoller');
  for (const name of ['METANOMIC_ENABLED']) delete process.env[name];
  assert.deepEqual(await poller.tick(), { ran: false });
  assert.equal(poller.start(), false);
});
