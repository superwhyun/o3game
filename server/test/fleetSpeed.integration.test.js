const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_fleet_speed_test');
test('economy speed changes construction independently from fleet and scout travel', { skip: !uri }, async () => {
  process.env.JWT_SECRET = 'fleet-speed-integration-test-only-at-least-32-characters';
  await mongoose.connect(uri);
  try {
    await mongoose.connection.dropDatabase();
    const Config = require('../models/GameConfig');
    const User = require('../models/User');
    const entities = require('../services/EntityConfigService');
    const config = await Config.getConfig();
    await entities.initialize();
    const user = await User.create({ username: 'speed_test', email: 'speed@example.test', password: 'test-password', planets: [{ galaxy: 1, system: 1, planet: 3, fleet: { lightFighter: 10, espionageProbe: 3 }, resources: { food: 1000 }, population: { version: 1, count: 100, baseHousing: 100, baseFood: 100, baseCulture: 100, foodCapacity: 1000, growthProgress: 0, starvationProgress: 0 } }] });
    const target = await User.create({ username: 'speed_target', email: 'target@example.test', password: 'test-password', planets: [{ galaxy: 1, system: 401, planet: 13 }] });
    const forms = require('../services/FleetFormationService');
    const destination = { galaxy: 1, system: 401, planet: 13 };
    const { calculateTravelSeconds } = require('../utils/fleetRules');
    const { calculateQueueDuration } = require('../utils/gameCalculations');
    const normalBuild = calculateQueueDuration('building', 'metalMine', 10, {}, 1, { serverSpeed: 1 });
    const fastBuild = calculateQueueDuration('building', 'metalMine', 10, {}, 1, { serverSpeed: 100 });
    assert.equal(fastBuild, Math.max(1, Math.floor(normalBuild / 100)));
    const duration = [];
    for (const speed of [1, 100]) {
      config.serverSpeed = speed;
      config.fleetSettings.flightSpeedMultiplier = 2;
      await config.save();
      const form = await forms.change(user._id, 'create', null, { originPlanetId: String(user.planets[0]._id) });
      await forms.change(user._id, 'update', form.formationId, { expectedRevision: 1, name: `속도 검증 ${speed}`, ships: { lightFighter: 1 } });
      const movement = await require('../services/FleetService').launch(user._id, { mission: 'attack', formationId: String(form.formationId), originPlanetId: String(user.planets[0]._id), expectedTargetPlanetId: String(target.planets[0]._id), expectedRevision: 2, requestId: randomUUID(), destination });
      const settings = { serverSpeed: speed, flightSpeedMultiplier: 2 };
      assert.equal((movement.arrivalTime - movement.startTime) / 1000, calculateTravelSeconds(user.planets[0], destination, entities.getEntity('ship', 'lightFighter').stats.speed, 100, settings));
      duration.push((movement.arrivalTime - movement.startTime) / 1000);
      const scout = await require('../services/ScoutService').launch(user._id, { originPlanetId: String(user.planets[0]._id), destination, requestId: randomUUID() });
      assert.equal((scout.arrivalTime - scout.startTime) / 1000, calculateTravelSeconds(user.planets[0], destination, entities.getEntity('ship', 'espionageProbe').stats.speed, 100, settings));
      const snapshot = (await require('../services/GameStateService').settleUserState(user._id)).snapshot;
      assert.equal(snapshot.serverSpeed, speed);
      assert.equal(snapshot.flightSpeedMultiplier, 2);
    }
    assert.equal(duration[0], duration[1]);
  } finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
