const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_area_settings_test');

test('area setting defaults, admin validation, existing/new planets and construction use the same bonus', { skip: !uri }, async () => {
  await mongoose.connect(uri);
  let server;
  try {
    await mongoose.connection.dropDatabase();
    const Config = require('../models/GameConfig');
    const User = require('../models/User');
    const { settleUserState } = require('../services/GameStateService');
    const construction = require('../services/ConstructionService');
    const { surveyOf } = require('../utils/colonizationRules');
    const jwt = require('jsonwebtoken');
    const express = require('express');
    process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
    const config = await Config.getConfig();
    assert.equal(config.areaSettings.bonusUsableFields, 40);
    await require('../services/EntityConfigService').initialize();
    const create = (name, fields = {}) => User.create({ username: name, email: `${name}@example.test`, password: 'test-password', ...fields });
    const admin = await create('area_admin', { isAdmin: true, adminRole: 'superadmin' });
    const player = await create('area_player', { planets: [{ galaxy: 1, system: 400, planet: 1, diameter: 12800, baseUsablePercent: 40, areaVersion: 1, buildings: { researchLab: 100, housing: 2 }, resources: { metal: 10000, crystal: 10000, deuterium: 10000 } }] });
    const app = express();
    app.use(express.json());
    const events = [];
    app.set('io', { emit: name => events.push(name) });
    app.use('/api/admin', require('../routes/admin'));
    server = app.listen(0);
    await new Promise(resolve => server.on('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/admin/config`;
    const update = (user, value) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET)}` }, body: JSON.stringify({ areaSettings: { bonusUsableFields: value } }) });
    assert.equal((await update(player, 80)).status, 403);
    for (const value of [-1, 1.5, null, 'bad', Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal((await update(admin, value)).status, 400);
      assert.equal((await Config.findOne()).areaSettings.bonusUsableFields, 40);
    }
    assert.equal((await settleUserState(player._id)).snapshot.planets[0].area.available, 40);
    assert.equal((await update(admin, 0)).status, 200);
    await assert.rejects(construction.enqueue(player._id, { type: 'building', itemId: 'metalMine', planetId: '0' }), /건설 공간 부족/);
    assert.equal((await update(admin, 80)).status, 200);
    const saved = await Config.findOne();
    assert.equal(saved.serverSpeed, 1);
    assert.equal(saved.areaSettings.bonusUsableFields, 80);
    const oldState = await settleUserState(player._id);
    assert.equal(oldState.snapshot.planets[0].area.usable, 182);
    assert.equal(oldState.snapshot.planets[0].area.available, 80);
    assert.equal(surveyOf(oldState.user.planets[0], 0, saved).usable, 182);
    const newPlayer = await create('area_new_player');
    const newState = await settleUserState(newPlayer._id);
    assert.equal(newState.snapshot.planets[0].area.bonusUsable, 80);
    const order = await construction.enqueue(player._id, { type: 'building', itemId: 'metalMine', planetId: '0' });
    assert.equal(order.snapshot.planets[0].area.available, 79);
    assert.equal(order.snapshot.planets[0].area.reserved, 1);
    assert.equal((await update(admin, 0)).status, 200);
    const reduced = await settleUserState(player._id);
    assert.equal(reduced.snapshot.planets[0].buildings.researchLab, 100);
    assert.equal(reduced.snapshot.planets[0].area.overCapacity, true);
    assert.equal((await update(admin, 10000)).status, 200);
    const capped = (await settleUserState(player._id)).snapshot.planets[0].area;
    assert.equal(capped.usable, capped.total);
    // Legacy installations without this config field also receive the default.
    await Config.updateOne({}, { $unset: { areaSettings: 1 } });
    assert.equal((await Config.getConfig()).areaSettings.bonusUsableFields, 40);
    assert.ok(events.includes('gameConfigUpdated'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
