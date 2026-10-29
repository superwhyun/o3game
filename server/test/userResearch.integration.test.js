const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_user_research_test');
test('research belongs to users, combines lab speed, queues levels across planets and migrates legacy progress', { skip: !uri }, async () => {
  await mongoose.connect(uri);
  try {
    await mongoose.connection.dropDatabase();
    const Config = require('../models/GameConfig');
    const User = require('../models/User');
    const Queue = require('../models/BuildingQueue');
    const construction = require('../services/ConstructionService');
    const { settleUserState } = require('../services/GameStateService');
    await Config.getConfig();
    await require('../services/EntityConfigService').initialize();
    const user = await User.create({ username: 'research_user', email: 'research@example.test', password: 'test-password', research: { intergalacticResearchNetwork: 1 }, planets: [
      { galaxy: 1, system: 200, planet: 3, buildings: { researchLab: 2 }, research: { energyTechnology: 1, espionageTechnology: 2 }, resources: { metal: 100000, crystal: 100000, deuterium: 100000 } },
      { galaxy: 1, system: 200, planet: 5, buildings: { researchLab: 3 }, research: { energyTechnology: 2, weaponsTechnology: 3 }, resources: { metal: 100000, crystal: 100000, deuterium: 100000 } },
      { galaxy: 1, system: 200, planet: 7, buildings: { researchLab: 1 }, resources: { metal: 100000, crystal: 100000, deuterium: 100000 } }
    ] });
    // Simulate pre-migration documents even though newly saved users already normalize.
    await User.updateOne({ _id: user._id }, { $unset: { research: 1, researchScopeVersion: 1 }, $set: { 'planets.0.research.energyTechnology': 1, 'planets.1.research.energyTechnology': 2 } });
    let state = await settleUserState(user._id);
    assert.equal(state.user.researchScopeVersion, 1);
    assert.equal(state.snapshot.research.energyTechnology, 2);
    assert.equal(state.snapshot.research.espionageTechnology, 2);
    assert.equal(state.snapshot.research.weaponsTechnology, 3);
    assert.equal(state.snapshot.researchInfrastructure.labLevel, 6);
    assert.equal(state.snapshot.researchInfrastructure.networkLevel, 1);
    assert.equal(state.snapshot.researchInfrastructure.labCount, 3);
    assert.ok(state.snapshot.planets.every(planet => planet.research.energyTechnology === 2));
    const ordered = await Promise.all([0, 1].map(index => construction.enqueue(user._id, { type: 'research', itemId: 'energyTechnology', planetId: String(index) })));
    const queue = await Queue.find({ userId: user._id, type: 'research' }).sort({ level: 1 });
    assert.deepEqual(queue.map(item => item.level), [3, 4]);
    assert.ok(+queue[1].startTime >= +queue[0].endTime);
    const { calculateQueueDuration } = require('../utils/gameCalculations');
    for (const item of queue) assert.equal(item.duration, calculateQueueDuration('research', 'energyTechnology', item.level, { researchLab: 5 }, 1, { serverSpeed: 1 }));
    assert.ok(queue[0].duration < calculateQueueDuration('research', 'energyTechnology', 3, { researchLab: 3 }, 1));
    await assert.rejects(construction.cancel(user._id, queue[0]._id), /뒤쪽/);
    await assert.rejects(construction.enqueue(user._id, { type: 'building', action: 'demolish', itemId: 'researchLab', planetId: '1' }), /공통 연구/);
    await assert.rejects(construction.enqueue(user._id, { type: 'building', itemId: 'researchLab', planetId: '2' }), /공통 연구/);
    await User.updateOne({ _id: user._id }, { $set: { currentPlanet: 2 } });
    state = await settleUserState(user._id);
    assert.equal(state.snapshot.queueState.research.itemId, 'energyTechnology');
    assert.equal(state.snapshot.queueState.queue.filter(item => item.type === 'research').length, 1);
    // Origin lab is included first; IRN adds the highest eligible remote lab.
    const third = await construction.enqueue(user._id, { type: 'research', itemId: 'energyTechnology', planetId: '2' });
    assert.equal(third.queueItem.level, 5);
    const last = await Queue.findById(third.queueItem.id);
    await Promise.all([settleUserState(user._id, new Date(+last.endTime + 1)), settleUserState(user._id, new Date(+last.endTime + 1))]);
    state = await settleUserState(user._id, new Date(+last.endTime + 1));
    assert.equal(state.snapshot.research.energyTechnology, 5);
    assert.ok(state.snapshot.planets.every(planet => planet.research.energyTechnology === 5));
    assert.equal(state.snapshot.queueState.research, null);
    const labWork = await construction.enqueue(user._id, { type: 'building', itemId: 'researchLab', planetId: '2' });
    await assert.rejects(construction.enqueue(user._id, { type: 'research', itemId: 'energyTechnology', planetId: '0' }), /연구소 건설·철거/);
    await construction.cancel(user._id, labWork.queueItem.id);
    state = await settleUserState(user._id);
    state.user.planets.push({ galaxy: 1, system: 200, planet: 9 });
    await state.user.save();
    assert.equal(state.user.planets.at(-1).research.energyTechnology, 5);
    await assert.rejects(construction.enqueue(user._id, { type: 'research', itemId: 'energyTechnology', planetId: '3' }), /연구를 시작할 행성/);
    const other = await User.create({ username: 'research_other', email: 'other@example.test', password: 'test-password', planets: [{ galaxy: 1, system: 200, planet: 11 }] });
    assert.equal((await settleUserState(other._id)).snapshot.research.energyTechnology, 0);
    const networkUser = await User.create({ username: 'network_user', email: 'network@example.test', password: 'test-password', research: { computerTechnology: 8, hyperspaceTechnology: 8 }, planets: [
      { galaxy: 1, system: 201, planet: 1, buildings: { researchLab: 10, metalStorage: 12, crystalStorage: 12, deuteriumTank: 12 }, resources: { metal: 1000000, crystal: 1000000, deuterium: 1000000 } },
      { galaxy: 1, system: 201, planet: 2, buildings: { researchLab: 12 } }
    ] });
    const beforeNetwork = await construction.enqueue(networkUser._id, { type: 'research', itemId: 'energyTechnology', planetId: '0' });
    assert.equal(beforeNetwork.queueItem.duration, calculateQueueDuration('research', 'energyTechnology', 1, { researchLab: 10 }, 1, { serverSpeed: 1 }));
    await construction.cancel(networkUser._id, beforeNetwork.queueItem.id);
    const networkResearch = await construction.enqueue(networkUser._id, { type: 'research', itemId: 'intergalacticResearchNetwork', planetId: '0' });
    const networkQueue = await Queue.findById(networkResearch.queueItem.id);
    await settleUserState(networkUser._id, new Date(+networkQueue.endTime + 1));
    const afterNetwork = await construction.enqueue(networkUser._id, { type: 'research', itemId: 'energyTechnology', planetId: '0' });
    assert.equal(afterNetwork.snapshot.research.intergalacticResearchNetwork, 1);
    assert.equal(afterNetwork.queueItem.duration, calculateQueueDuration('research', 'energyTechnology', 1, { researchLab: 22 }, 1, { serverSpeed: 1 }));
    // Cancelling a long unrelated research starts the next task immediately,
    // even when that task belongs to another colony.
    const repairUser = await User.create({username:'queue_repair', email:'queue-repair@example.test',password:'test-password',planets:[{galaxy:2,system:201,planet:1,buildings:{researchLab:5}},{galaxy:2,system:201,planet:2,buildings:{researchLab:5}}]});
    const now = Date.now();
    const blocker = await Queue.create({userId:repairUser._id,planetId:'0',type:'research',itemId:'gravitonTechnology',name:'blocker',level:1,duration:3600,startTime:new Date(now),endTime:new Date(now+3600000),status:'building'});
    const follower = await Queue.create({userId:repairUser._id,planetId:'1',type:'research',itemId:'impulseDrive',name:'follower',level:1,duration:2,startTime:new Date(now+3600000),endTime:new Date(now+3602000),status:'pending'});
    await construction.cancel(repairUser._id,blocker._id);
    const advanced = await Queue.findById(follower._id);
    assert.equal(advanced.status,'building');
    assert.ok(+advanced.endTime < Date.now()+3000);
    assert.equal(+advanced.endTime - +advanced.startTime,2000);
    assert.equal((await settleUserState(repairUser._id,new Date(+advanced.endTime+1))).snapshot.research.impulseDrive,1);
  } finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
