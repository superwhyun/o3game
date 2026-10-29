const test = require('node:test'), assert = require('node:assert/strict'), mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_deployment_test');
test('deployment changes fleet base once, preserves crew, supports recall, and restricts mission ownership', { skip: !uri }, async () => {
  await mongoose.connect(uri);
  try {
    await mongoose.connection.dropDatabase();
    const User = require('../models/User'), Movement = require('../models/FleetMovement');
    const forms = require('../services/FleetFormationService'), fleets = require('../services/FleetService');
    const config = await require('../models/GameConfig').getConfig();
    await require('../services/EntityConfigService').initialize();
    await User.init(); await Movement.init();
    const planet = (position, fleet = {}) => ({ name: `Planet-${position}`, galaxy: 1, system: 400, planet: position, fleet,
      resources: { metal: 10000, crystal: 10000, deuterium: 10000, food: 1000 },
      population: { version: 1, count: 100, baseHousing: 100, baseFood: 100, baseCulture: 100, foodCapacity: 1000, growthProgress: 0, starvationProgress: 0 } });
    const user = await User.create({ username: 'deployment', email: 'deployment@example.test', password: randomUUID(), planets: [planet(1, { smallCargo: 20 }), planet(2)] });
    const foreign = await User.create({ username: 'deployment-other', email: 'deployment-other@example.test', password: randomUUID(), planets: [planet(3)] });
    const first = String(user.planets[0]._id), second = String(user.planets[1]._id);
    const created = await forms.change(user._id, 'create', null, { originPlanetId: first });
    await forms.change(user._id, 'update', created.formationId, { expectedRevision: 1, name: '이동 함대', ships: { smallCargo: 5 } });
    const order = async (mission, destinationIndex, overrides = {}) => {
      const owner = await User.findById(user._id), f = owner.fleetFormations.id(created.formationId), target = owner.planets[destinationIndex];
      return { requestId: randomUUID(), formationId: String(f._id), expectedRevision: f.revision, originPlanetId: String(f.originPlanetId), expectedTargetPlanetId: String(target._id), destination: { galaxy: target.galaxy, system: target.system, planet: target.planet }, mission, ...overrides };
    };
    for (const mission of ['deploy', 'transport']) await assert.rejects(fleets.launch(user._id, await order(mission, 1, { expectedTargetPlanetId: String(foreign.planets[0]._id), destination: { galaxy: 1, system: 400, planet: 3 } })), e => e.statusCode === 409 && e.code === (mission === 'deploy' ? 'DEPLOY_TARGET_NOT_OWNED' : 'TRANSPORT_TARGET_NOT_OWNED'));
    await assert.rejects(fleets.launch(user._id, await order('attack', 1)), e => e.statusCode === 400);
    // Starvation blocks transport, but must not trap a fleet at its current base.
    await User.updateOne({ _id: user._id }, { $set: { 'planets.0.resources.food': 0, 'planets.0.population.baseFood': 0 } });
    await assert.rejects(fleets.launch(user._id, await order('transport', 1)), e => e.code === 'FLEET_SUPPLY_SHORTAGE');
    const payload = await order('deploy', 1, { cargo: { metal: 100 } });
    const [moving, duplicate] = await Promise.all([fleets.launch(user._id, payload), fleets.launch(user._id, payload)]);
    assert.equal(String(moving._id), String(duplicate._id));
    let owner = await User.findById(user._id);
    const crew = owner.fleetFormations.id(created.formationId).crew;
    assert.equal(owner.planets[0].fleet.smallCargo, 15);
    const due = new Date(+moving.arrivalTime + 1);
    await require('../services/GameStateService').settleUserState(user._id, due);
    const metalBefore = (await User.findById(user._id)).planets[1].resources.metal;
    await Promise.all([fleets.processMovement(moving._id, due), fleets.processMovement(moving._id, due)]);
    owner = await User.findById(user._id);
    let formation = owner.fleetFormations.id(created.formationId);
    assert.equal(String(formation.originPlanetId), second);
    assert.equal(formation.status, 'ready'); assert.equal(formation.crew, crew);
    assert.equal(formation.revision, 4); assert.equal(formation.activeMovementId, null);
    assert.equal(owner.planets[1].fleet.smallCargo, 5);
    assert.equal(owner.planets[1].resources.metal, metalBefore + 100);
    assert.equal((await Movement.findById(moving._id)).status, 'completed');
    assert.equal((await Movement.findById(moving._id)).returnTime, null);
    const support = require('../utils/fleetCrew');
    assert.equal(support.fleetSupport(owner, owner.planets[0], config).crew, 0);
    assert.equal(support.fleetSupport(owner, owner.planets[1], config).crew, crew);
    assert.equal(await Movement.countDocuments(), 1);
    // Relocation can be recalled while outbound; the fleet returns to its present base.
    assert.equal(owner.currentPlanet, 0); // Launch from another base without switching the selected planet.
    await assert.rejects(fleets.launch(user._id, await order('deploy', 0, { originPlanetId: first })), e => e.message.includes('출발 행성'));
    const recall = await fleets.launch(user._id, await order('deploy', 0, { cargo: { crystal: 20 } }));
    const turned = await fleets.recall(user._id, recall._id, new Date(+recall.startTime + 1000));
    await fleets.processMovement(recall._id, new Date(+turned.returnTime + 1));
    owner = await User.findById(user._id);
    assert.equal(String(owner.fleetFormations.id(created.formationId).originPlanetId), second);
    assert.equal(owner.planets[1].fleet.smallCargo, 5);
    // A transport unloads resources then returns, without changing the formation's base.
    const transport = await fleets.launch(user._id, await order('transport', 0, { cargo: { crystal: 40 } }));
    const transportDue = new Date(+transport.arrivalTime + 1);
    await require('../services/GameStateService').settleUserState(user._id, transportDue);
    const before = (await User.findById(user._id)).planets[0].resources.crystal;
    await fleets.processMovement(transport._id, transportDue);
    const returning = await Movement.findById(transport._id);
    assert.equal(returning.status, 'returning'); assert.equal(returning.cargo.crystal, 0);
    assert.equal((await User.findById(user._id)).planets[0].resources.crystal, before + 40);
    await fleets.processMovement(transport._id, new Date(+returning.returnTime + 1));
    owner = await User.findById(user._id);
    assert.equal(String(owner.fleetFormations.id(created.formationId).originPlanetId), second);
    assert.equal(owner.planets[1].fleet.smallCargo, 5);
    // Destination identity changes after launch: return all ships and loaded resources.
    const changed = await fleets.launch(user._id, await order('deploy', 0, { cargo: { metal: 50 } }));
    await User.updateOne({ _id: user._id }, { $set: { 'planets.0._id': new mongoose.Types.ObjectId() } });
    await fleets.processMovement(changed._id, new Date(+changed.arrivalTime + 1));
    const failed = await Movement.findById(changed._id);
    assert.equal(failed.status, 'returning'); assert.equal(failed.cargo.metal, 50);
    await fleets.processMovement(changed._id, new Date(+failed.returnTime + 1));
    owner = await User.findById(user._id);
    assert.equal(owner.planets[1].fleet.smallCargo, 5);
    assert.equal(String(owner.fleetFormations.id(created.formationId).originPlanetId), second);
    assert.equal(owner.fleetFormations.id(created.formationId).crew, crew);
  } finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
