const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
test('colony mission consumes one ship, transfers cargo, returns once and resolves competing claims', async () => {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('colonization_test'));
  const User = require('../models/User');
  const Config = require('../models/GameConfig');
  const Movement = require('../models/FleetMovement');
  const forms = require('../services/FleetFormationService');
  const fleets = require('../services/FleetService');
  const entities = require('../services/EntityConfigService');
  const { environmentOf } = require('../utils/colonizationRules');
  try {
    await Config.getConfig(); await entities.initialize(); await User.init(); await Movement.init();
    const make = async (name, slot) => {
      const user = await User.create({ username: name, email: `${name}@test.invalid`, password: randomUUID(), planets: [{ galaxy: 1, system: 1, planet: slot, fleet: { colonyShip: 2, smallCargo: 1, espionageProbe: 1 } }] });
      const created = await forms.change(user._id, 'create', null, { originPlanetId: user.planets[0]._id });
      await forms.change(user._id, 'update', created.formationId, { expectedRevision: 1, name: '개척 함대', ships: { colonyShip: 2, smallCargo: 1 } });
      return User.findById(user._id);
    };
    const a = await make('colonistA', 1), b = await make('colonistB', 2);
    const dest = { galaxy: 1, system: 1, planet: 3 };
    const order = user => ({ requestId: randomUUID(), mission: 'colonize', formationId: user.fleetFormations[0]._id.toString(), originPlanetId: user.planets[0]._id.toString(), expectedRevision: 2, destination: dest, cargo: { metal: 50, crystal: 20, deuterium: 10 } });
    const scouts = require('../services/ScoutService');
    const Report = require('../models/ScoutReport');
    const survey = await scouts.launch(a._id, { requestId: randomUUID(), originPlanetId: a.planets[0]._id.toString(), destination: dest });
    await scouts.processMovement(survey._id, new Date(+survey.arrivalTime + 1));
    const observation = await Report.findOne({ movementId: survey._id });
    assert.equal(observation.outcome, 'empty');
    assert.equal(observation.sections.environment.usable + observation.sections.environment.unusable, observation.sections.environment.total);
    const input = order(a), first = await fleets.launch(a._id, input);
    assert.equal(String((await fleets.launch(a._id, input))._id), String(first._id));
    const other = await fleets.launch(b._id, order(b));
    const now = new Date(Math.max(+first.arrivalTime, +other.arrivalTime) + 1);
    await Promise.all([fleets.processMovement(first._id, now), fleets.processMovement(other._id, now)]);
    const owners = await User.find({ planets: { $elemMatch: dest } });
    assert.equal(owners.length, 1);
    const colony = owners[0].planets.find(p => p.planet === 3);
    assert.equal(colony.diameter, environmentOf(dest).diameter);
    assert.equal(colony.resources.metal, 50);
    const { surveyOf } = require('../utils/colonizationRules');
    assert.deepEqual(surveyOf(colony, a.terraformingLevel), observation.sections.environment);
    const winner = owners[0]._id.toString();
    for (const m of [first, other]) {
      const returning = await Movement.findById(m._id);
      assert.equal(returning.fleet.colonyShip, String(m.userId) === winner ? 1 : 2);
      await fleets.processMovement(m._id, new Date(+returning.returnTime + 1));
      await fleets.processMovement(m._id, new Date(+returning.returnTime + 1));
      const user = await User.findById(m.userId);
      assert.equal(user.planets[0].fleet.colonyShip, String(m.userId) === winner ? 1 : 2);
      assert.equal(user.planets[0].fleet.smallCargo, 1);
      assert.equal(user.fleetFormations[0].status, 'ready');
    }
  } finally { await mongoose.disconnect(); await db.stop(); }
});
