const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { randomBytes, randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');

test('stored speed-up time shortens the active item, moves the chain behind it and is spent exactly once', { timeout: 120000 }, async () => {
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let server;
  try {
    await mongoose.connect(repl.getUri('speedup_test'));
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const User = require('../models/User'), Queue = require('../models/BuildingQueue'), Config = require('../models/GameConfig'), Usage = require('../models/SpeedupUsage');
    const entities = require('../services/EntityConfigService');
    const construction = require('../services/ConstructionService');
    await Config.create({ resourceSettings: { defaultStorage: { metal: 1e12, crystal: 1e12, deuterium: 1e12 } } });
    await entities.initialize();
    await Promise.all([User.init(), Queue.init(), Usage.init()]);
    const express = require('express'); const app = express(); app.use(express.json());
    app.use('/api/queue', require('../routes/buildingQueue'));
    server = app.listen(0); await new Promise((r) => server.on('listening', r));
    const base = `http://127.0.0.1:${server.address().port}/api/queue`;
    let slot = 0;
    const make = (seconds = 10_000) => User.create({ username: `u${++slot}`, email: `u${slot}@test.invalid`, password: randomBytes(24).toString('hex'), entitlements: { speedupSeconds: seconds }, planets: [{ galaxy: 1, system: slot, planet: 1, resources: { metal: 1e9, crystal: 1e9, deuterium: 1e9 } }, { galaxy: 1, system: slot, planet: 2 }] });
    const post = async (user, body) => {
      const response = await fetch(`${base}/speedup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET)}` }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const item = (user, props) => Queue.create({ userId: user._id, planetId: '0', type: 'building', itemId: 'metalMine', name: '금속 광산', level: 1, duration: 600, applied: false, costSnapshot: {}, ...props });
    const at = (ms) => new Date(Date.now() + ms);

    const user = await make();
    const head = await item(user, { status: 'building', startTime: at(-100_000), endTime: at(500_000) });
    const next = await item(user, { itemId: 'crystalMine', status: 'pending', startTime: head.endTime, endTime: at(1_100_000) });
    const otherPlanet = await item(user, { planetId: '1', status: 'building', startTime: at(-1000), endTime: at(900_000) });
    const research = await item(user, { type: 'research', itemId: 'energyTechnology', status: 'building', startTime: at(-1000), endTime: at(700_000) });

    const requestId = randomUUID();
    const first = await post(user, { queueId: String(head._id), seconds: 3600, requestId });
    assert.equal(first.status, 200);
    assert.ok(first.body.used >= 499 && first.body.used <= 501); // capped at the time left
    const [h, n, o, r] = await Promise.all([head, next, otherPlanet, research].map((doc) => Queue.findById(doc._id)));
    assert.ok(Math.abs(+h.endTime - Date.now()) < 2000);                       // active item is (about) done
    assert.equal(+n.startTime, +h.endTime);                                   // chain stays connected
    assert.equal(+n.endTime, +next.endTime - first.body.used * 1000);
    assert.equal(+o.endTime, +otherPlanet.endTime);                           // other chains are untouched
    assert.equal(+r.endTime, +research.endTime);
    const after = await User.findById(user._id);
    assert.equal(after.entitlements.speedupSeconds, 10_000 - first.body.used);
    assert.ok(after.stateRevision > user.stateRevision);

    // The same request is not charged twice.
    const repeat = await post(user, { queueId: String(head._id), seconds: 3600, requestId });
    assert.equal(repeat.status, 200); assert.equal(repeat.body.repeated, true);
    assert.equal((await User.findById(user._id)).entitlements.speedupSeconds, 10_000 - first.body.used);
    assert.equal(await Usage.countDocuments({ userId: user._id }), 1);

    // Waiting items cannot be sped up; partial use and exact accounting on another item.
    const waiting = await make();
    await item(waiting, { status: 'building', startTime: at(-1000), endTime: at(900_000) });
    const queued = await item(waiting, { itemId: 'crystalMine', status: 'pending', startTime: at(900_000), endTime: at(1_500_000) });
    assert.equal((await post(waiting, { queueId: String(queued._id), seconds: 60, requestId: randomUUID() })).body.code, 'NOT_ACTIVE_ITEM');
    assert.equal((await User.findById(waiting._id)).entitlements.speedupSeconds, 10_000);
    const research1 = await post(user, { queueId: String(research._id), seconds: 120, requestId: randomUUID() });
    assert.equal(research1.body.used, 120);
    assert.equal(+(await Queue.findById(research._id)).endTime, +research.endTime - 120_000);

    // Validation and balance rules.
    assert.equal((await post(user, { queueId: String(research._id), seconds: 0, requestId: randomUUID() })).body.code, 'INVALID_SECONDS');
    assert.equal((await post(user, { queueId: String(research._id), seconds: 5, requestId: 'x' })).body.code, 'INVALID_REQUEST');
    assert.equal((await post(user, { queueId: String(new mongoose.Types.ObjectId()), seconds: 5, requestId: randomUUID() })).body.code, 'QUEUE_NOT_ACTIVE');
    const poor = await make(30);
    const poorItem = await item(poor, { status: 'building', startTime: at(-1000), endTime: at(900_000) });
    const tooMuch = await post(poor, { queueId: String(poorItem._id), seconds: 31, requestId: randomUUID() });
    assert.equal(tooMuch.body.code, 'INSUFFICIENT_SPEEDUP');
    assert.equal((await User.findById(poor._id)).entitlements.speedupSeconds, 30);
    assert.equal((await post(poor, { queueId: String(poorItem._id), seconds: 30, requestId: randomUUID() })).body.used, 30);
    assert.equal((await User.findById(poor._id)).entitlements.speedupSeconds, 0);

    // Types the administrator switched off are refused; a failed request spends nothing.
    await Config.updateOne({}, { $set: { 'speedupSettings.allowedTypes': ['building'] } });
    assert.equal((await post(user, { queueId: String(research._id), seconds: 10, requestId: randomUUID() })).body.code, 'SPEEDUP_NOT_ALLOWED');
    // Ship production is covered like construction and research.
    await Config.updateOne({}, { $set: { 'speedupSettings.allowedTypes': ['building', 'research', 'ship'] } });
    const shipper = await make();
    const ship = await item(shipper, { type: 'ship', itemId: 'lightFighter', count: 5, status: 'building', startTime: at(-1000), endTime: at(5000_000) });
    assert.equal((await post(shipper, { queueId: String(ship._id), seconds: 3600, requestId: randomUUID() })).body.used, 3600);
    assert.ok(Math.abs(+(await Queue.findById(ship._id)).endTime - (+ship.endTime - 3_600_000)) < 1);
  } finally {
    await new Promise((r) => (server ? server.close(r) : r()));
    await mongoose.disconnect(); await repl.stop();
  }
});
