const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_battle_recall_test');
test('battle privacy/read state and recall timing, retries and resource conservation', { skip: !uri }, async () => {
  process.env.JWT_SECRET = 'battle-recall-test-only-secret-at-least-32-characters';
  await mongoose.connect(uri);
  let server;
  try {
    await mongoose.connection.dropDatabase();
    const User = require('../models/User');
    const Movement = require('../models/FleetMovement');
    const Report = require('../models/BattleReport');
    const fleets = require('../services/FleetService');
    await require('../models/GameConfig').getConfig();
    await require('../services/EntityConfigService').initialize();
    const createUser = (username, planet) => User.create({ username, email: `${username}@example.test`, password: 'test-password', planets: [{ galaxy: 1, system: 1, planet, fleet: { lightFighter: 0, espionageProbe: 0 }, resources: { metal: 100, crystal: 100, deuterium: 100 }, buildings: {} }] });
    const owner = await createUser('attacker', 3);
    const defender = await createUser('defender', 5);
    const outsider = await createUser('outsider', 7);
    const report = await Report.create({ attacker: { userId: owner._id, username: owner.username }, defender: { userId: defender._id, username: defender.username }, result: { winner: 'attacker', loot: { metal: 50, crystal: 20, deuterium: 10 } } });
    const express = require('express');
    const app = express(); app.use(express.json()); app.use('/api/game', require('../routes/game'));
    server = app.listen(0); await new Promise(resolve => server.on('listening', resolve));
    const jwt = require('jsonwebtoken');
    const request = async (actor, path, method = 'GET') => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/game${path}`, { method, headers: actor ? { Authorization: 'Bearer ' + jwt.sign({ userId: actor._id }, process.env.JWT_SECRET) } : {} });
      return { status: res.status, data: await res.json() };
    };
    assert.equal((await request(null, '/reports')).status, 401);
    assert.equal((await request(outsider, '/reports')).data.reports.length, 0);
    assert.equal((await request(owner, '/reports')).data.unreadCount, 1);
    assert.equal((await request(outsider, `/reports/${report._id}/read`, 'PATCH')).status, 404);
    assert.equal((await request(owner, `/reports/${report._id}/read`, 'PATCH')).status, 200);
    assert.equal((await request(owner, '/reports')).data.unreadCount, 0);
    assert.equal((await request(defender, '/reports')).data.unreadCount, 1);
    assert.equal((await Report.findById(report._id)).fuelConsumed, null);
    assert.equal((await request(owner, '/reports?before=bad')).status, 400);
    const now = new Date();
    const movement = await Movement.create({ userId: owner._id, username: owner.username, originPlanetId: owner.planets[0]._id, targetUserId: defender._id, targetPlanetId: defender.planets[0]._id, mission: 'attack', fleet: { lightFighter: 4 }, initialFleet: { lightFighter: 4 }, cargo: { metal: 25 }, origin: { galaxy: 1, system: 1, planet: 3 }, destination: { galaxy: 1, system: 1, planet: 5 }, startTime: new Date(+now - 10000), arrivalTime: new Date(+now + 90000) });
    assert.equal((await request(outsider, `/fleets/${movement._id}/recall`, 'POST')).status, 404);
    const recalls = await Promise.all([fleets.recall(owner._id, movement._id, now), fleets.recall(owner._id, movement._id, now)]);
    assert.equal(recalls[0].status, 'returning');
    assert.equal(+recalls[0].returnTime, +now + 10000);
    assert.equal(+recalls[1].returnTime, +recalls[0].returnTime);
    assert.equal((await request(owner, `/fleets/${movement._id}/recall`, 'POST')).status, 200);
    await fleets.processMovement(movement._id, new Date(+now + 9999));
    assert.equal((await Movement.findById(movement._id)).status, 'returning');
    await require('../services/GameStateService').settleUserState(owner._id, new Date(+now + 10001));
    const stockBefore = (await User.findById(owner._id)).planets[0].resources.metal;
    await Promise.all([fleets.processMovement(movement._id, new Date(+now + 10001)), fleets.processMovement(movement._id, new Date(+now + 10001))]);
    const after = await User.findById(owner._id);
    assert.equal(after.planets[0].fleet.lightFighter, 4);
    assert.equal(after.planets[0].resources.metal, stockBefore + 25);
    assert.equal(await Report.countDocuments(), 1); // Recalled attack produces no battle or loot.
    const late = await Movement.create({ ...movement.toObject(), _id: new mongoose.Types.ObjectId(), status: 'flying', recalledAt: null, arrivalTime: now });
    await assert.rejects(fleets.recall(owner._id, late._id, now), error => error.statusCode === 409);
    const spy = await Movement.create({ ...movement.toObject(), _id: new mongoose.Types.ObjectId(), mission: 'spy', fleet: { espionageProbe: 2 }, initialFleet: { espionageProbe: 2 }, cargo: {}, status: 'flying', recalledAt: null, arrivalTime: new Date(+now + 90000) });
    const returnedSpy = await fleets.recall(owner._id, spy._id, now);
    await fleets.processMovement(spy._id, new Date(+returnedSpy.returnTime + 1));
    assert.equal((await User.findById(owner._id)).planets[0].fleet.espionageProbe, 2);
    assert.equal(await require('../models/ScoutReport').countDocuments(), 0);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
