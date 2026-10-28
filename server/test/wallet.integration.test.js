const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');
const { startFakeMetanomic } = require('./helpers/fakeMetanomic');

test('wallet linking proves ownership once, binds one wallet per account and cannot be changed by the player', async () => {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('wallet_test'));
  const fake = await startFakeMetanomic();
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'wallet-integration-secret-only-for-tests-2026';
  process.env.CLIENT_URL = 'https://game.example';
  Object.assign(process.env, fake.env);
  const metanomic = require('../services/MetanomicClient');
  metanomic.setClientForTests(undefined);
  const User = require('../models/User');
  const Challenge = require('../models/WalletChallenge');
  const Audit = require('../models/AuditLog');
  const wallets = require('../services/WalletService');
  let server;
  try {
    await User.init(); await Challenge.init();
    let slot = 0;
    const make = (name, extra = {}) => User.create({ username: name, email: `${name}@test.invalid`, password: randomUUID(), planets: [{ galaxy: 1, system: 1, planet: ++slot }], ...extra });
    const alice = await make('alice'), bob = await make('bob'), carol = await make('carol'), boss = await make('boss', { isAdmin: true, adminRole: 'superadmin' });
    const token = (user) => jwt.sign({ userId: String(user._id) }, process.env.JWT_SECRET);
    const app = express(); app.use(express.json());
    app.use('/api/wallet', require('../routes/wallet'));
    app.use('/api/admin', require('../routes/admin'));
    server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://localhost:${server.address().port}/api`;
    const call = async (user, method, path, body) => {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() };
    };
    const account = privateKeyToAccount(generatePrivateKey());
    const roninForm = `ronin:${account.address.slice(2)}`;

    assert.equal((await call(null, 'GET', '/wallet')).status, 401);
    assert.deepEqual((await call(alice, 'GET', '/wallet')).body, { enabled: true, linked: false, address: null, linkedAt: null });
    assert.equal((await call(alice, 'POST', '/wallet/challenge', { address: 'nonsense' })).body.code, 'INVALID_ADDRESS');
    assert.equal((await call(alice, 'POST', '/wallet/challenge', { address: '0x' + '0'.repeat(40) })).body.code, 'INVALID_ADDRESS');

    // A ronin: prefixed address is accepted and the message binds origin, chain, address, nonce and request id.
    const challenge = (await call(alice, 'POST', '/wallet/challenge', { address: roninForm })).body;
    assert.equal(challenge.chainId, 202601);
    assert.match(challenge.message, /^game\.example wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n/);
    assert.ok(challenge.message.includes(account.address) && challenge.message.includes('URI: https://game.example') && challenge.message.includes('Chain ID: 202601') && challenge.message.includes(`Request ID: ${challenge.challengeId}`));
    assert.ok(challenge.expiresAt - Date.now() <= wallets.CHALLENGE_TTL_MS);

    // Someone else's signature, a garbage signature and another user's challenge are all rejected.
    const stranger = privateKeyToAccount(generatePrivateKey());
    assert.equal((await call(alice, 'POST', '/wallet/link', { challengeId: challenge.challengeId, signature: await stranger.signMessage({ message: challenge.message }) })).body.code, 'SIGNATURE_MISMATCH');
    assert.equal((await call(alice, 'POST', '/wallet/link', { challengeId: challenge.challengeId, signature: '0x1234' })).body.code, 'SIGNATURE_INVALID');
    const signature = await account.signMessage({ message: challenge.message });
    assert.equal((await call(bob, 'POST', '/wallet/link', { challengeId: challenge.challengeId, signature })).body.code, 'CHALLENGE_INVALID');
    assert.equal(await User.exists({ 'wallet.address': account.address.toLowerCase() }), null);

    const linked = await call(alice, 'POST', '/wallet/link', { challengeId: challenge.challengeId, signature });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.address, account.address.toLowerCase());
    assert.equal((await call(alice, 'GET', '/wallet')).body.linked, true);

    // One-time challenge, no second wallet, no re-linking, no sharing.
    assert.equal((await call(alice, 'POST', '/wallet/link', { challengeId: challenge.challengeId, signature })).body.code, 'CHALLENGE_INVALID');
    assert.equal((await call(alice, 'POST', '/wallet/challenge', { address: privateKeyToAccount(generatePrivateKey()).address })).body.code, 'WALLET_ALREADY_SET');
    assert.equal((await call(bob, 'POST', '/wallet/challenge', { address: account.address })).body.code, 'WALLET_IN_USE');

    // Expired challenges cannot be used.
    const past = new Date(Date.now() - 6 * 60 * 1000);
    const lateAccount = privateKeyToAccount(generatePrivateKey());
    const stale = await wallets.createChallenge(bob._id, lateAccount.address, past);
    assert.equal((await call(bob, 'POST', '/wallet/link', { challengeId: stale.challengeId, signature: await lateAccount.signMessage({ message: stale.message }) })).body.code, 'CHALLENGE_EXPIRED');

    // Two accounts racing for one wallet: exactly one wins, the unique index decides.
    const shared = privateKeyToAccount(generatePrivateKey());
    const [c1, c2] = [(await call(bob, 'POST', '/wallet/challenge', { address: shared.address })).body, (await call(carol, 'POST', '/wallet/challenge', { address: shared.address })).body];
    const [r1, r2] = await Promise.all([
      call(bob, 'POST', '/wallet/link', { challengeId: c1.challengeId, signature: await shared.signMessage({ message: c1.message }) }),
      call(carol, 'POST', '/wallet/link', { challengeId: c2.challengeId, signature: await shared.signMessage({ message: c2.message }) })
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.equal(await User.countDocuments({ 'wallet.address': shared.address.toLowerCase() }), 1);
    const loser = r1.status === 409 ? bob : carol;
    assert.equal((r1.status === 409 ? r1 : r2).body.code, 'WALLET_IN_USE');
    assert.equal((await call(loser, 'GET', '/wallet')).body.linked, false);

    // The same challenge submitted twice at once links exactly once.
    const dave = await make('dave'), twin = privateKeyToAccount(generatePrivateKey());
    const cd = (await call(dave, 'POST', '/wallet/challenge', { address: twin.address })).body;
    const sig = await twin.signMessage({ message: cd.message });
    const twice = await Promise.all([1, 2].map(() => call(dave, 'POST', '/wallet/link', { challengeId: cd.challengeId, signature: sig })));
    assert.deepEqual(twice.map((r) => r.status).sort(), [200, 400]);

    // Challenge issuance is capped per user.
    const erin = await make('erin');
    for (let i = 0; i < 5; i++) assert.equal((await call(erin, 'POST', '/wallet/challenge', { address: privateKeyToAccount(generatePrivateKey()).address })).status, 200);
    assert.equal((await call(erin, 'POST', '/wallet/challenge', { address: privateKeyToAccount(generatePrivateKey()).address })).status, 429);

    // Only a super administrator can unlink, with an audit record.
    assert.equal((await call(alice, 'DELETE', `/admin/users/${alice._id}/wallet`)).status, 403);
    assert.equal((await call(boss, 'DELETE', `/admin/users/${alice._id}/wallet`)).status, 200);
    assert.equal((await call(alice, 'GET', '/wallet')).body.linked, false);
    assert.equal((await call(boss, 'DELETE', `/admin/users/${alice._id}/wallet`)).status, 404);
    const audit = await Audit.findOne({ action: 'wallet.unlink' });
    assert.equal(audit.payload.address, account.address.toLowerCase());
    assert.equal(String(audit.actorId), String(boss._id));

    // With the integration disabled the wallet API reports it instead of failing obscurely.
    for (const name of Object.keys(fake.env)) delete process.env[name];
    metanomic.setClientForTests(undefined);
    wallets.resetChainCache();
    const disabled = await call(alice, 'POST', '/wallet/challenge', { address: account.address });
    assert.equal(disabled.status, 503); assert.equal(disabled.body.code, 'CGC_DISABLED');
    assert.equal((await call(alice, 'GET', '/wallet')).body.enabled, false);
  } finally {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await fake.close(); await mongoose.disconnect(); await db.stop();
  }
});
