const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_colonist_transfer_test');

test('colonists are reserved once, transferred exactly and returned on recall or failed claims', { skip: !uri }, async () => {
  await mongoose.connect(uri);
  try {
    await mongoose.connection.dropDatabase();
    const User = require('../models/User');
    const Config = require('../models/GameConfig');
    const Movement = require('../models/FleetMovement');
    const forms = require('../services/FleetFormationService');
    const fleets = require('../services/FleetService');
    await Config.create({ populationSettings: { initialPopulation: 30, growthHours: 1e9 } });
    await require('../services/EntityConfigService').initialize();
    await Promise.all([User.init(), Movement.init()]);
    const user = await User.create({ username: 'colonist_transfer', email: 'colonist@example.test', password: 'test-password', planets: [{ galaxy: 1, system: 450, planet: 1, fleet: { colonyShip: 2 } }] });
    const formation = async () => {
      const f = await forms.change(user._id, 'create', null, { originPlanetId: user.planets[0]._id });
      await forms.change(user._id, 'update', f.formationId, { expectedRevision: 1, name: `개척 ${f.formationId}`, ships: { colonyShip: 1 } });
      return f.formationId;
    };
    const firstForm = await formation();
    const order = (form, slot, count) => ({ requestId: randomUUID(), mission: 'colonize', formationId: form, originPlanetId: String(user.planets[0]._id), expectedRevision: 2, destination: { galaxy: 1, system: 450, planet: slot }, colonists: count });
    for (const count of [0, -1, 1.5, 31]) await assert.rejects(fleets.launch(user._id, order(firstForm, 2, count)), /인구/);
    assert.equal((await User.findById(user._id)).planets[0].population.count, 30);
    const input = order(firstForm, 2, 7);
    const mission = await fleets.launch(user._id, input);
    assert.equal(String((await fleets.launch(user._id, input))._id), String(mission._id));
    await assert.rejects(fleets.launch(user._id, { ...input, colonists: 8 }), /요청 ID/);
    assert.equal((await User.findById(user._id)).planets[0].population.count, 23);
    const arrival = new Date(+mission.arrivalTime + 1);
    await Promise.all([fleets.processMovement(mission._id, arrival), fleets.processMovement(mission._id, arrival)]);
    let owner = await User.findById(user._id);
    assert.equal(owner.planets[1].population.count, 7);
    assert.equal(owner.planets[0].population.count, 23);
    assert.equal((await Movement.findById(mission._id)).colonists, 0);
    const secondForm = await formation();
    const recalled = await fleets.launch(user._id, order(secondForm, 3, 5));
    assert.equal((await User.findById(user._id)).planets[0].population.count, 18);
    const back = await fleets.recall(user._id, recalled._id, new Date(+recalled.startTime + 1000));
    const returnedAt = new Date(+back.returnTime + 1);
    await Promise.all([fleets.processMovement(back._id, returnedAt), fleets.processMovement(back._id, returnedAt)]);
    owner = await User.findById(user._id);
    assert.equal(owner.planets[0].population.count, 23);
    assert.equal(owner.planets.length, 2);
    const ready = owner.fleetFormations.id(secondForm);
    const failedInput = { ...order(secondForm, 4, 4), expectedRevision: ready.revision };
    const failed = await fleets.launch(user._id, failedInput);
    await User.create({ username: 'claim_winner', email: 'winner@example.test', password: 'test-password', planets: [{ galaxy: 1, system: 450, planet: 4 }] });
    await fleets.processMovement(failed._id, new Date(+failed.arrivalTime + 1));
    const retreat = await Movement.findById(failed._id);
    assert.equal(retreat.status, 'returning');
    assert.equal(retreat.colonists, 4);
    await fleets.processMovement(failed._id, new Date(+retreat.returnTime + 1));
    await fleets.processMovement(failed._id, new Date(+retreat.returnTime + 1));
    owner = await User.findById(user._id);
    assert.equal(owner.planets[0].population.count, 23);
    assert.equal(owner.planets.reduce((n, p) => n + p.population.count, 0), 30);
    const concurrentUser = await User.create({ username: 'concurrent_colonists', email: 'concurrent@example.test', password: 'test-password', planets: [{ galaxy: 1, system: 451, planet: 1, fleet: { colonyShip: 2 } }] });
    const competing = [];
    for (const slot of [2, 3]) {
      const f = await forms.change(concurrentUser._id, 'create', null, { originPlanetId: concurrentUser.planets[0]._id });
      await forms.change(concurrentUser._id, 'update', f.formationId, { expectedRevision: 1, name: `동시 개척 ${slot}`, ships: { colonyShip: 1 } });
      competing.push({ requestId: randomUUID(), mission: 'colonize', formationId: f.formationId, originPlanetId: String(concurrentUser.planets[0]._id), expectedRevision: 2, destination: { galaxy: 1, system: 451, planet: slot }, colonists: 20 });
    }
    const attempts = await Promise.allSettled(competing.map(input => fleets.launch(concurrentUser._id, input)));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await User.findById(concurrentUser._id)).planets[0].population.count, 10);
  } finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
