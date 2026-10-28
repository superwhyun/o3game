const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
test('resource exchange is authenticated, owned, atomic and persisted with planet climates', { timeout: 120000 }, async () => {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  let server;
  try {
    await mongoose.connect(db.getUri('resource_exchange_test'));
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const User = require('../models/User');
    await require('../models/GameConfig').getConfig();
    await require('../services/EntityConfigService').initialize();
    await User.init();
    const make = (name, planet) => User.create({ username: name, email: `${name}@test.invalid`, password: randomBytes(16).toString('hex'), planets: [{ galaxy: 1, system: 1, planet, minTemp: -70, maxTemp: -30, resources: { metal: 1000, crystal: 0, deuterium: 0 } }] });
    const owner = await make('trader', 1), other = await make('otherTrader', 2);
    const express = require('express'), app = express(); app.use(express.json()); app.use('/api/game', require('../routes/game'));
    server = app.listen(0); await new Promise(resolve => server.on('listening', resolve));
    const token = jwt.sign({ userId: owner._id }, process.env.JWT_SECRET);
    const trade = async (input, authenticated = true) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/game/trade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ planetId: String(owner.planets[0]._id), from: 'metal', to: 'crystal', amount: 300, ...input }) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await trade({}, false)).status, 401);
    assert.equal((await trade({ planetId: String(other.planets[0]._id) })).status, 404);
    for (const amount of [0, -1, 1.5, '300']) assert.equal((await trade({ amount })).status, 400);
    const first = await trade({});
    assert.equal(first.status, 200);
    assert.equal(first.body.quote.received, 190);
    assert.equal(first.body.snapshot.exchange.rates.food, 2);
    assert.equal(first.body.snapshot.planets[0].environment.type, 'ice');
    assert.equal((await User.findById(owner._id)).planets[0].environmentType, 'ice');
    await User.updateOne({ _id: owner._id }, { $set: { 'planets.0.resources.metal': 1000 } });
    const simultaneous = await Promise.all([trade({ amount: 600 }), trade({ amount: 600 })]);
    assert.equal(simultaneous.filter(r => r.status === 200).length, 1);
    assert.ok(simultaneous.some(r => [400, 409].includes(r.status)));
    const stored = await User.findById(owner._id);
    assert.ok(stored.planets[0].resources.metal >= 400 && stored.planets[0].resources.metal < 401);
    assert.ok(stored.planets[0].resources.crystal >= 570 && stored.planets[0].resources.crystal < 571);
    const before = stored.planets[0].resources.metal;
    await User.updateOne({ _id: owner._id }, { $set: { 'planets.0.resources.crystal': first.body.snapshot.planets[0].storage.crystal } });
    assert.equal((await trade({ amount: 300 })).status, 400);
    assert.equal((await User.findById(owner._id)).planets[0].resources.metal, before);
    assert.equal((await User.findById(other._id)).planets[0].resources.metal, 1000);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await db.stop();
  }
});
