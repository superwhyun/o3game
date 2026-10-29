const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

test('colony rename validates input, enforces ownership and persists only the target name', { timeout: 120000 }, async () => {
  const externalUri = process.env.PLANET_NAMES_TEST_MONGODB_URI;
  if (externalUri && !/^planet_names_.*_test$/.test(new URL(externalUri).pathname.slice(1))) {
    throw new Error('A dedicated planet_names_*_test database is required');
  }
  const repl = externalUri ? null : await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let server;
  try {
    await mongoose.connect(externalUri || repl.getUri('planet_names_integration_test'));
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const User = require('../models/User');
    await require('../models/GameConfig').getConfig();
    await require('../services/EntityConfigService').initialize();
    await User.init();
    const owner = await User.create({ username: 'owner', email: 'owner@test.invalid', password: 'test-secret', planets: [
      { name: '모행성', galaxy: 1, system: 1, planet: 1, buildings: { metalMine: 3 } },
      { name: '제2 콜로니', galaxy: 1, system: 1, planet: 2, buildings: { crystalMine: 2 } }
    ] });
    const other = await User.create({ username: 'other', email: 'other@test.invalid', password: 'test-secret', planets: [
      { name: '다른 사용자', galaxy: 1, system: 1, planet: 3 }
    ] });
    const express = require('express');
    const app = express(); app.use(express.json());
    app.use('/api/game', require('../routes/game'));
    app.use('/api/auth', require('../routes/auth'));
    server = app.listen(0); await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: owner._id }, process.env.JWT_SECRET);
    async function rename(id, name, authenticated = true) {
      const response = await fetch(`${base}/api/game/planets/${id}/name`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name })
      });
      return { status: response.status, body: await response.json() };
    }
    const id = owner.planets[1]._id.toString();
    assert.equal((await rename(id, '무단 변경', false)).status, 401);
    assert.equal((await rename(other.planets[0]._id, '무단 변경')).status, 404);
    assert.equal((await rename('bad-id', '새 이름')).status, 400);
    for (const invalid of ['', '   ', '가'.repeat(31), '줄\n바꿈', { name: '객체' }, null]) {
      assert.equal((await rename(id, invalid)).status, 400);
    }
    const result = await rename(id, '  서울 콜로니 🌍  ');
    assert.equal(result.status, 200);
    assert.equal(result.body.name, '서울 콜로니 🌍');
    assert.equal(result.body.snapshot.planets[0].name, '모행성');
    assert.equal(result.body.snapshot.planets[1].name, '서울 콜로니 🌍');
    assert.equal(result.body.snapshot.planets[1].buildings.crystalMine, 2);
    assert.equal(result.body.snapshot.currentPlanet, 0);
    assert.ok(result.body.snapshot.stateRevision > owner.stateRevision);
    assert.equal((await User.findById(other._id)).planets[0].name, '다른 사용자');
    const reloaded = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await reloaded.json()).planets[1].name, '서울 콜로니 🌍');
    assert.equal((await rename(id, '🌍'.repeat(30))).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (repl) await repl.stop();
  }
});
