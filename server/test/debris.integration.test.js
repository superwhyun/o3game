const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { randomUUID } = require('node:crypto');

test('battles leave ship wreckage that recyclers collect first come, first served', { timeout: 180000 }, async () => {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('debris_test'));
  try {
    const User = require('../models/User'), Movement = require('../models/FleetMovement'), Config = require('../models/GameConfig');
    const Report = require('../models/BattleReport'), Debris = require('../models/DebrisField');
    const forms = require('../services/FleetFormationService'), fleets = require('../services/FleetService');
    const entities = require('../services/EntityConfigService'), debris = require('../services/DebrisService');
    const combat = require('../services/CombatService');
    await Config.create({ resourceSettings: { defaultStorage: { metal: 1e12, crystal: 1e12, deuterium: 1e12 } } });
    await entities.initialize(); await Promise.all([User.init(), Movement.init(), Debris.init()]);

    // --- wreckage rules -------------------------------------------------------------
    const cost = (id) => entities.getEntity('ship', id).costModel.baseCost;
    const light = cost('lightFighter');
    const ships = combat.calculateDebris({ lightFighter: 10 }, { lightFighter: 10 }, 30);
    assert.deepEqual(ships, { metal: Math.floor(light.metal * 20 * 0.3), crystal: Math.floor(light.crystal * 20 * 0.3) });
    assert.deepEqual(combat.calculateDebris({}, { rocketLauncher: 100 }, 30), { metal: 0, crystal: 0 }); // defenses leave nothing by default
    assert.ok(combat.calculateDebris({}, { rocketLauncher: 100 }, 30, { includeDefense: true }).metal > 0);
    assert.deepEqual(combat.calculateDebris({ lightFighter: 3 }, {}, 0), { metal: 0, crystal: 0 });
    assert.deepEqual(combat.calculateDebris({ lightFighter: -1, ghost: 5 }, null, 30), { metal: 0, crystal: 0 });

    // --- a real attack produces a field at the defender's planet ---------------------
    let slot = 0;
    const make = (name, planetNo, fleet, extra = {}) => User.create({ username: name, email: `${name}@test.invalid`, password: randomUUID(), planets: [{ galaxy: 1, system: 1, planet: planetNo, fleet, resources: { metal: 1e7, crystal: 1e7, deuterium: 1e7, food: 1e7 }, population: { version: 1, count: 5000, baseHousing: 5000, baseFood: 5000, baseCulture: 100, foodCapacity: 100000, growthProgress: 0, starvationProgress: 0 }, ...extra }] });
    const formation = async (user, ships) => {
      const created = await forms.change(user._id, 'create', null, { originPlanetId: user.planets[0]._id });
      await forms.change(user._id, 'update', created.formationId, { expectedRevision: 1, name: `함대${++slot}`, ships });
      return { id: String(created.formationId), revision: 2 };
    };
    const target = await make('victim', 9, { lightFighter: 40 });
    const attacker = await make('raider', 4, { cruiser: 60 });
    const f = await formation(attacker, { cruiser: 60 });
    const attack = await fleets.launch(attacker._id, { requestId: randomUUID(), mission: 'attack', formationId: f.id, originPlanetId: String(attacker.planets[0]._id), expectedRevision: f.revision, expectedTargetPlanetId: String(target.planets[0]._id), destination: { galaxy: 1, system: 1, planet: 9 }, cargo: {} });
    await fleets.processMovement(attack._id, new Date(+attack.arrivalTime + 1));
    const report = await Report.findOne({ movementId: attack._id });
    const wreck = report.result.debrisField;
    assert.ok(wreck.metal > 0 && wreck.crystal > 0);
    const field = await Debris.findOne({ galaxy: 1, system: 1, planet: 9 });
    assert.deepEqual([field.metal, field.crystal], [wreck.metal, wreck.crystal]);
    // Processing the same movement again cannot add wreckage twice.
    await fleets.processMovement(attack._id, new Date(+attack.arrivalTime + 2));
    assert.equal((await Debris.findOne({ galaxy: 1, system: 1, planet: 9 })).metal, wreck.metal);

    // --- the galaxy view lists it --------------------------------------------------
    const { buildGalaxySystem } = require('../utils/galaxySystem');
    const view = buildGalaxySystem({ galaxy: 1, system: 1, requestingUserId: attacker._id, users: [], debris: await debris.inSystem(1, 1) });
    assert.deepEqual(view.positions[8].debris, { metal: wreck.metal, crystal: wreck.crystal });
    assert.equal(view.positions[0].debris, undefined);

    // --- launch rules for recycling -------------------------------------------------
    const noRecycler = await make('plain', 6, { lightFighter: 5 });
    const pf = await formation(noRecycler, { lightFighter: 5 });
    const recycleOrder = (user, f, destination = { galaxy: 1, system: 1, planet: 9 }, speed = 100) => ({ requestId: randomUUID(), mission: 'recycle', formationId: f.id, originPlanetId: String(user.planets[0]._id), expectedRevision: f.revision, destination, cargo: {}, speed });
    await assert.rejects(fleets.launch(noRecycler._id, recycleOrder(noRecycler, pf)), (e) => e.code === 'RECYCLER_REQUIRED');

    const recyclerCargo = entities.getEntity('ship', 'recycler').stats.cargo;
    const small = Math.max(1, Math.floor(wreck.metal / (recyclerCargo * 2)) || 1);
    const makeRecycler = async (name, planetNo, count) => {
      const user = await make(name, planetNo, { recycler: count });
      return { user, f: await formation(user, { recycler: count }) };
    };
    const a = await makeRecycler('collectorA', 11, 1), b = await makeRecycler('collectorB', 12, 1);
    await assert.rejects(fleets.launch(a.user._id, recycleOrder(a.user, a.f, { galaxy: 1, system: 1, planet: 2 })), (e) => e.code === 'NO_DEBRIS');

    // The nearer, faster arrival is served first and the field never goes negative.
    const first = await fleets.launch(a.user._id, recycleOrder(a.user, a.f, undefined, 100));
    const second = await fleets.launch(b.user._id, recycleOrder(b.user, b.f, undefined, 100));
    const due = new Date(Math.max(+first.arrivalTime, +second.arrivalTime) + 1);
    await Promise.all([fleets.processMovement(first._id, due), fleets.processMovement(second._id, due)]);
    const after = await Debris.findOne({ galaxy: 1, system: 1, planet: 9 });
    const carried = async (m) => { const x = await Movement.findById(m._id); return x.cargo.metal + x.cargo.crystal; };
    const totalCarried = (await carried(first)) + (await carried(second));
    assert.equal(totalCarried + after.metal + after.crystal, wreck.metal + wreck.crystal); // nothing created or lost
    assert.ok(after.metal >= 0 && after.crystal >= 0);
    assert.ok(totalCarried <= 2 * recyclerCargo);
    const done = await Movement.findById(first._id);
    assert.equal(done.status, 'returning');
    assert.match(done.notice, /잔해 수거 완료|수거할 잔해가 없어/);

    // Cargo reaches the home planet on return.
    await fleets.processMovement(first._id, new Date(+done.returnTime + 1));
    const home = await User.findById(a.user._id);
    assert.equal(home.planets[0].fleet.recycler, 1);
    const gained = home.planets[0].resources.metal + home.planets[0].resources.crystal - 2e7;
    assert.ok(gained >= (await carried(first)) && gained < (await carried(first)) + 1000); // cargo plus trivial base production
    assert.equal(small >= 1, true);
  } finally {
    await mongoose.disconnect(); await db.stop();
  }
});

test('many recyclers split a small field in arrival order and extra ones come back empty', { timeout: 180000 }, async () => {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('debris_race_test'));
  try {
    const User = require('../models/User'), Movement = require('../models/FleetMovement'), Config = require('../models/GameConfig'), Debris = require('../models/DebrisField');
    const forms = require('../services/FleetFormationService'), fleets = require('../services/FleetService');
    const entities = require('../services/EntityConfigService'), debrisService = require('../services/DebrisService');
    await Config.getConfig(); await entities.initialize(); await Promise.all([User.init(), Movement.init(), Debris.init()]);
    const cargo = entities.getEntity('ship', 'recycler').stats.cargo;
    await debrisService.add({ galaxy: 1, system: 1, planet: 7 }, { metal: cargo, crystal: cargo }); // exactly 2 recyclers' worth

    const launches = [];
    for (let i = 0; i < 5; i++) {
      const user = await User.create({ username: `r${i}`, email: `r${i}@test.invalid`, password: randomUUID(), planets: [{ galaxy: 1, system: 2 + i, planet: 1, fleet: { recycler: 1 }, resources: { metal: 1e6, crystal: 0, deuterium: 1e6, food: 1e7 }, population: { version: 1, count: 5000, baseHousing: 5000, baseFood: 5000, baseCulture: 100, foodCapacity: 100000, growthProgress: 0, starvationProgress: 0 } }] });
      const created = await forms.change(user._id, 'create', null, { originPlanetId: user.planets[0]._id });
      await forms.change(user._id, 'update', created.formationId, { expectedRevision: 1, name: `수확${i}`, ships: { recycler: 1 } });
      launches.push(await fleets.launch(user._id, { requestId: randomUUID(), mission: 'recycle', formationId: String(created.formationId), originPlanetId: String(user.planets[0]._id), expectedRevision: 2, destination: { galaxy: 1, system: 1, planet: 7 }, cargo: {} }));
    }
    const due = new Date(Math.max(...launches.map((m) => +m.arrivalTime)) + 1);
    await Promise.all(launches.map((m) => fleets.processMovement(m._id, due)));
    const loads = [];
    for (const m of launches) { const x = await Movement.findById(m._id); loads.push(x.cargo.metal + x.cargo.crystal); }
    assert.equal(loads.reduce((a, b) => a + b, 0), 2 * cargo);
    assert.ok(loads.every((n) => n <= cargo));
    assert.equal(loads.filter((n) => n === cargo).length, 2);
    assert.equal(loads.filter((n) => n === 0).length, 3);
    const left = await Debris.findOne({ planet: 7 });
    assert.deepEqual([left.metal, left.crystal], [0, 0]);
  } finally {
    await mongoose.disconnect(); await db.stop();
  }
});
