const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
test('colony mission consumes one ship, settles escorts and formation without return and resolves competing claims', async () => {
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
      const mission = await Movement.findById(m._id);
      const won = String(m.userId) === winner;
      assert.equal(mission.fleet.colonyShip, won ? 1 : 2);
      assert.equal(mission.status, won ? 'completed' : 'returning');
      if (won) assert.equal(mission.returnTime, null);
      const finish = won ? new Date(+now + 86400000) : new Date(+mission.returnTime + 1);
      await fleets.processMovement(m._id, finish);
      await fleets.processMovement(m._id, finish);
      const user = await User.findById(m.userId);
      assert.equal(user.planets[0].fleet.colonyShip, won ? 0 : 2);
      assert.equal(user.planets[0].fleet.smallCargo, won ? 0 : 1);
      assert.equal(user.fleetFormations[0].status, 'ready');
      if(won){
        const settled=user.planets.find(p=>p.planet===3);
        assert.equal(settled.fleet.colonyShip,1);assert.equal(settled.fleet.smallCargo,1);
        assert.equal(String(user.fleetFormations[0].originPlanetId),String(settled._id));
      }
    }
    const loserId = String(a._id) === winner ? b._id : a._id;
    const latest = await User.findById(loserId);
    const blocked = { ...order(latest), expectedRevision: latest.fleetFormations[0].revision };
    await assert.rejects(fleets.launch(loserId, blocked), /이미 점령/);
    await forms.change(loserId, 'update', latest.fleetFormations[0]._id, { expectedRevision: latest.fleetFormations[0].revision, name: '수송 함대', ships: { smallCargo: 1 } });
    const noColony = await User.findById(loserId);
    await assert.rejects(fleets.launch(loserId, { ...order(noColony), expectedRevision: noColony.fleetFormations[0].revision, destination: { ...dest, planet: 5 } }), /식민선이 필요/);
    const c = await make('colonistC', 7);
    await forms.change(c._id, 'update', c.fleetFormations[0]._id, { expectedRevision: 2, name: '단독 식민선', ships: { colonyShip: 1 } });
    const single = await fleets.launch(c._id, { ...order(c), expectedRevision: 3, destination: { ...dest, planet: 6 }, cargo: {} });
    await fleets.processMovement(single._id, new Date(+single.arrivalTime + 1));
    const singleReturn = await Movement.findById(single._id);
    assert.equal(singleReturn.status,'completed');assert.equal(singleReturn.returnTime,null);
    await fleets.processMovement(single._id, new Date(+single.arrivalTime + 86400000));
    const final = await User.findById(c._id);
    assert.deepEqual(final.fleetFormations[0].ships, {});
    assert.match(final.fleetFormations[0].notice, /개척에 사용/);
    assert.equal(final.planets.length, 2);
    assert.equal(String(final.fleetFormations[0].originPlanetId),String(final.planets[1]._id));
    // Already successful missions from the previous implementation settle immediately,
    // even when the old scheduled return is far in the future.
    const d = await make('legacyColonist', 10);
    const legacy = await Movement.create({userId:d._id,username:d.username,mission:'colonize',formationId:d.fleetFormations[0]._id,originPlanetId:d.planets[0]._id,origin:{galaxy:1,system:1,planet:10},destination:{galaxy:1,system:1,planet:11},fleet:{colonyShip:1,smallCargo:1},startTime:new Date(),arrivalTime:new Date(),status:'returning',returnTime:new Date(Date.now()+86400000),notice:'식민지 개척 완료 · 식민선 1척을 사용했습니다.'});
    d.planets[0].fleet.colonyShip=0;d.planets[0].fleet.smallCargo=0;
    d.planets.push({galaxy:1,system:1,planet:11,resources:{metal:50,crystal:20,deuterium:10}});
    d.fleetFormations[0].status='onMission';d.fleetFormations[0].activeMovementId=legacy._id;await d.save();
    const SocketHandlers = require('../socket/handlers');
    const tick = Object.create(SocketHandlers.prototype);
    tick.io = {to:()=>({emit:()=>{}})};
    await Promise.all([tick.processFleetArrivals(),fleets.processMovement(legacy._id)]);
    const restored=await User.findById(d._id);
    assert.equal(restored.planets[0].fleet.colonyShip,0);
    assert.equal(restored.planets[1].fleet.colonyShip,1);assert.equal(restored.planets[1].fleet.smallCargo,1);
    assert.equal(Math.floor(restored.planets[1].resources.metal),50);
    assert.equal((await Movement.findById(legacy._id)).status,'completed');
  } finally { await mongoose.disconnect(); await db.stop(); }
});
