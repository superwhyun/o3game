const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../models/User');
const Config = require('../models/GameConfig');
const Queue = require('../models/BuildingQueue');
const entities = require('../services/EntityConfigService');
const { settleUserState } = require('../services/GameStateService');
const { calculateProduction } = require('../utils/planetEconomy');
const { randomBytes } = require('node:crypto');

test('population transition, queued facilities, configuration and concurrent settlement on real MongoDB', { timeout: 120000 }, async t => {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  let server;
  try {
    await mongoose.connect(db.getUri('population_economy_test'));
    const config = await Config.create({ resourceSettings: { defaultStorage: { metal: 1e12, crystal: 1e12, deuterium: 1e12 } } });
    await entities.initialize();
    await Promise.all([User.init(), Queue.init()]);
    let i = 0;
    const create = async (fields = {}) => User.create({ username: `population${++i}`, email: `population${i}@example.test`, password: randomBytes(12).toString('hex'), ...fields });
    const queue = async (user, id, level, endTime) => Queue.create({ userId: user._id, planetId: '0', type: 'building', itemId: id, level, name: id, duration: 60, startTime: new Date(+endTime - 60000), endTime });

    await t.test('new users receive initial residents and support', async () => {
      const user = await create();
      assert.equal(user.planets[0].population.version, 1);
      assert.equal(user.planets[0].population.count, 10);
      assert.equal(user.planets[0].resources.food, 240);
      const { snapshot } = await settleUserState(user._id);
      assert.equal(snapshot.planets[0].populationState.happiness, 50);
      assert.equal(snapshot.planets[0].storage.food, 1000);
    });

    await t.test('legacy economy is settled through queued completions before the one-time transition', async () => {
      const user = await create({ planets: [{ galaxy: 1, system: 300, planet: 1, diameter: 8000, baseUsablePercent: 40, areaVersion: 1, buildings: { metalMine: 40 }, resources: { metal: 0, crystal: 0, deuterium: 0 }, traits: { metal: 1, crystal: 1 } }] });
      const now = new Date(), start = new Date(+now - 2 * 3600000), middle = new Date(+now - 3600000);
      await User.updateOne({ _id: user._id }, { $unset: { 'planets.0.population': 1, 'planets.0.resources.food': 1 }, $set: { 'planets.0.lastUpdate': start } });
      await queue(user, 'metalMine', 41, middle);
      const before = calculateProduction({ buildings: { metalMine: 40 }, traits: { metal: 1, crystal: 1 } }).metal;
      const after = calculateProduction({ buildings: { metalMine: 41 }, traits: { metal: 1, crystal: 1 } }).metal;
      const result = await settleUserState(user._id, now);
      const p = result.snapshot.planets[0];
      assert.ok(Math.abs(p.resources.metal - before - after) < 1e-6);
      assert.equal(p.population.count, 41);
      assert.equal(p.population.growthProgress, 0);
      assert.equal(p.populationState.productionMultiplier, 1);
      assert.equal(p.area.used, 41);
      const again = await settleUserState(user._id, now);
      assert.deepEqual(again.snapshot.planets[0].population, p.population);
      assert.deepEqual(again.snapshot.planets[0].resources, p.resources);
    });

    await t.test('facility completion changes growth and capacity at its scheduled boundary exactly once', async () => {
      const user = await create();
      const start = new Date('2026-01-01T00:00:00Z');
      await User.updateOne({ _id: user._id }, { $set: { 'planets.0.lastUpdate': start } });
      for (const id of ['housing', 'hydroponicFarm', 'cultureCenter']) await queue(user, id, 1, new Date(+start + 3600000));
      const now = new Date(+start + 4 * 3600000);
      const results = await Promise.all(Array.from({ length: 6 }, () => settleUserState(user._id, now)));
      const stored = await User.findById(user._id);
      assert.equal(stored.planets[0].population.count, 12);
      assert.equal(stored.planets[0].buildings.housing, 1);
      assert.equal(stored.planets[0].buildings.hydroponicFarm, 1);
      assert.equal(stored.planets[0].buildings.cultureCenter, 1);
      assert.equal(await Queue.countDocuments({ userId: user._id, status: 'completed', applied: true }), 3);
      for (const result of results) {
        assert.equal(result.snapshot.planets[0].populationState.housing, 25);
        assert.equal(result.snapshot.planets[0].population.count, 12);
      }
      const unrelated = await create();
      assert.equal(unrelated.planets[0].population.count, 10);
    });

    await t.test('education and medical research take effect only after their queue boundary and persist', async () => {
      const user = await create();
      const start = new Date('2026-01-01T00:00:00Z');
      await User.updateOne({ _id: user._id }, { $set: {
        'planets.0.lastUpdate': start, 'planets.0.population.count': 20,
        'planets.0.buildings.metalMine': 2, 'planets.0.buildings.school': 1,
        'planets.0.buildings.clinic': 1
      } });
      const boundary = new Date(+start + 3600000);
      for (const id of ['educationTechnology', 'medicalTechnology', 'socialPolicy']) {
        await Queue.create({ userId: user._id, planetId: '0', type: 'research', itemId: id, level: 1,
          name: id, duration: 60, startTime: new Date(+boundary - 60000), endTime: boundary });
      }
      const before = (await settleUserState(user._id, start)).snapshot.planets[0];
      assert.equal(before.populationState.knowledge, 50);
      const after = (await settleUserState(user._id, new Date(+start + 2 * 3600000))).snapshot.planets[0];
      assert.equal(after.research.educationTechnology, 1);
      assert.equal(after.populationState.knowledge, 60);
      assert.equal(after.populationState.health, 60);
      assert.equal(after.populationState.happinessReasons.policy, 2);
      assert.ok(after.production.metal > before.production.metal);
      // The first hour uses the original rate; only the second uses the research bonus.
      assert.ok(Math.abs(after.resources.metal - before.resources.metal - before.production.metal - after.production.metal) < 1e-6);
      assert.equal((await User.findById(user._id)).planets[0].research.medicalTechnology, 1);
    });

    await t.test('starvation progress and satellite contribution survive saves and repeated settlement', async () => {
      const user = await create();
      const start = new Date('2026-01-01T00:00:00Z');
      await User.updateOne({_id:user._id}, {$set:{'planets.0.lastUpdate':start,'planets.0.population.count':14,'planets.0.resources.food':0,'planets.0.fleet.solarSatellite':3,'planets.0.maxTemp':40}});
      const first = (await settleUserState(user._id, new Date(+start + 3600000))).snapshot.planets[0];
      assert.equal(first.population.count,14);
      assert.equal(first.population.starvationProgress,0.5);
      assert.equal(first.populationState.nextStarvationSeconds,3600);
      assert.equal(first.energyState.sources.find(source => source.id === 'solarSatellite').amount,99);
      const now = new Date(+start + 2 * 3600000);
      const results = await Promise.all([settleUserState(user._id,now),settleUserState(user._id,now)]);
      assert.ok(results.every(result => result.snapshot.planets[0].population.count === 13));
      const saved = (await User.findById(user._id)).planets[0];
      assert.equal(saved.population.count,13);
      assert.equal(saved.population.starvationProgress,0);
    });

    await t.test('population settings persist, reject invalid coefficients and affect future settlement', async () => {
      config.populationSettings.growthHours = 1;
      await config.save();
      const user = await create();
      const start = new Date();
      await User.updateOne({ _id: user._id }, { $set: { 'planets.0.lastUpdate': start } });
      const result = await settleUserState(user._id, new Date(+start + 3600000));
      assert.equal(result.snapshot.planets[0].population.count, 11);
      const invalid = new Config({ populationSettings: { growthHours: 0, foodConsumptionPerPopulation: -1 } });
      await assert.rejects(invalid.validate(), /Validation/);
    });

    await t.test('population configuration API enforces roles, validates input and preserves other settings', async () => {
      const express = require('express');
      const jwt = require('jsonwebtoken');
      process.env.JWT_SECRET = randomBytes(32).toString('hex');
      const app = express();
      app.use(express.json());
      app.set('io', { emit() {} });
      app.use('/api/admin', require('../routes/admin'));
      server = app.listen(0);
      await new Promise(resolve => server.on('listening', resolve));
      const url = `http://127.0.0.1:${server.address().port}/api/admin/config`;
      const admin = await create({ isAdmin: true, adminRole: 'superadmin' });
      const ordinary = await create();
      const update = (user, populationSettings) => fetch(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET)}` },
        body: JSON.stringify({ populationSettings })
      });
      assert.equal((await update(ordinary, { growthHours: 3 })).status, 403);
      assert.equal((await update(admin, { growthHours: 0 })).status, 400);
      assert.equal((await Config.findOne()).populationSettings.growthHours, 1);
      const response = await update(admin, { growthHours: 3, productionSensitivity: .02 });
      assert.equal(response.status, 200);
      const saved = await Config.findOne();
      assert.equal(saved.populationSettings.growthHours, 3);
      assert.equal(saved.populationSettings.productionSensitivity, .02);
      assert.equal(saved.resourceSettings.defaultStorage.metal, 1e12);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await db.stop();
  }
});
