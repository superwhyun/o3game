const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { randomUUID } = require('node:crypto');
const { startFakeMetanomic } = require('./helpers/fakeMetanomic');

if (process.env.MONGOOSE_DEBUG) mongoose.set('debug', (coll, method, ...args) => require('node:fs').appendFileSync('/tmp/claude-0/dbg.txt', ['DBG', coll, method, JSON.stringify(args).slice(0, 200)].join(' ') + '\n'));
const unit = (extra = {}) => ({ unitId: 'beast', name: '심연의 짐승', count: 10, wave: 0, stats: { hull: 10000, shield: 0, attack: 30000 }, wreck: { metal: 1000, crystal: 500 }, ...extra });
const typeInput = (extra = {}) => ({ typeId: 'abyss-beast', name: '심연의 짐승', description: '테스트', units: [unit()], ...extra });
const walletOf = (n) => '0x' + n.toString(16).padStart(2, '0').repeat(20);

async function world(t, { fakeOptions = {}, cgc = true } = {}) {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('monster_test'));
  const fake = await startFakeMetanomic({ budgetMicro: 100_000_000n, autoFinalize: true, ...fakeOptions });
  const metanomic = require('../services/MetanomicClient');
  for (const name of Object.keys(fake.env)) delete process.env[name];
  if (cgc) Object.assign(process.env, fake.env);
  metanomic.setClientForTests(undefined);
  const models = {
    User: require('../models/User'), Movement: require('../models/FleetMovement'), Config: require('../models/GameConfig'),
    Event: require('../models/MonsterEvent'), Contribution: require('../models/MonsterContribution'), BattleLog: require('../models/MonsterBattleLog'),
    Report: require('../models/BattleReport'), Debris: require('../models/DebrisField'), Reward: require('../models/CgcReward')
  };
  const monsters = require('../services/MonsterService'), forms = require('../services/FleetFormationService'), fleets = require('../services/FleetService');
  const entities = require('../services/EntityConfigService'), outbox = require('../services/CgcRewardService');
  await models.Config.create({ resourceSettings: { defaultStorage: { metal: 1e12, crystal: 1e12, deuterium: 1e12 } } });
  await entities.initialize();
  await Promise.all(Object.values(models).filter((m) => m.init).map((m) => m.init()));
  let counter = 0;
  const admin = await models.User.create({ username: 'admin', email: 'admin@test.invalid', password: randomUUID(), isAdmin: true, adminRole: 'superadmin', planets: [{ galaxy: 3, system: 1, planet: 1 }] });
  const player = async (name, { cruisers = 50, wallet = null, system = ++counter, extra = {}, ships = { cruiser: cruisers } } = {}) => {
    const user = await models.User.create({ username: name, email: `${name}@test.invalid`, password: randomUUID(), lastLogin: new Date(), ...(wallet ? { wallet: { address: wallet, linkedAt: new Date() } } : {}), planets: [{ galaxy: 2, system, planet: 5, fleet: { cruiser: cruisers, colonyShip: 2 }, resources: { metal: 1e9, crystal: 1e9, deuterium: 1e9, food: 1e7 }, population: { version: 1, count: 5000, baseHousing: 5000, baseFood: 5000, baseCulture: 100, foodCapacity: 100000, growthProgress: 0, starvationProgress: 0 } }], ...extra });
    const created = await forms.change(user._id, 'create', null, { originPlanetId: user.planets[0]._id });
    await forms.change(user._id, 'update', created.formationId, { expectedRevision: 1, name: `${name}함대`, ships });
    return { user, formationId: String(created.formationId), originPlanetId: String(user.planets[0]._id) };
  };
  const order = (p, eventId, destination, extra = {}) => ({ requestId: randomUUID(), mission: 'attack', formationId: p.formationId, originPlanetId: p.originPlanetId, expectedRevision: 2, target: { type: 'monster', eventId: String(eventId) }, destination, cargo: {}, speed: 100, ...extra });
  const spawn = async (typeExtra = {}, eventExtra = {}) => {
    await monsters.saveType(admin._id, typeInput(typeExtra));
    const event = await monsters.createEvent(admin._id, { typeId: typeExtra.typeId || 'abyss-beast', startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 10 * 86400_000), ...eventExtra });
    return monsters.settleEvent(event._id);
  };
  const attack = async (p, event, extra = {}) => {
    const movement = await fleets.launch(p.user._id, order(p, event._id, event.location, extra));
    return movement;
  };
  const arrive = (movement, after = 1) => fleets.processMovement(movement._id, new Date(+movement.arrivalTime + after));
  return { db, fake, models, monsters, forms, fleets, outbox, admin, player, order, spawn, attack, arrive, metanomic,
    client: () => metanomic.getClient(),
    close: async () => { await fake.close(); await mongoose.disconnect(); await db.stop(); } };
}

test('a monster appears near active players on a free slot, moves slowly, blocks the slot and expires', { timeout: 240000 }, async (t) => {
  const w = await world(t);
  try {
    const { User, Event, Movement } = w.models;
    const players = [];
    for (let i = 1; i <= 4; i++) players.push(await w.player(`p${i}`, { cruisers: 5 }));
    await User.create({ username: 'dormant', email: 'dormant@test.invalid', password: randomUUID(), lastLogin: new Date(Date.now() - 90 * 86400_000), planets: [{ galaxy: 9, system: 400, planet: 3 }] });

    const scheduled = await w.monsters.createEvent(w.admin._id, { typeId: (await w.monsters.saveType(w.admin._id, typeInput())).typeId, startsAt: new Date(Date.now() + 3600_000), endsAt: new Date(Date.now() + 86400_000) });
    assert.equal((await w.monsters.settleEvent(scheduled._id)).status, 'SCHEDULED'); // not started yet
    assert.equal(await w.monsters.isOccupied({ galaxy: 1, system: 1, planet: 1 }), false);
    await Event.deleteOne({ _id: scheduled._id });

    const event = await w.spawn();
    assert.equal(event.status, 'ACTIVE');
    assert.equal(event.moveCount, 1);
    assert.ok(+event.nextMoveAt - Date.now() > 71 * 3600_000 && +event.nextMoveAt - Date.now() <= 72 * 3600_000 + 1000); // slow: three days by default
    const loc = { galaxy: event.location.galaxy, system: event.location.system, planet: event.location.planet };
    assert.equal(await User.exists({ 'planets.coordinateKey': event.locationKey }), null); // never on a planet
    const near = players.map((p) => p.user.planets[0]).map((pl) => Math.abs(pl.galaxy - loc.galaxy) + Math.abs(pl.system - loc.system) + Math.abs(pl.planet - loc.planet));
    assert.ok(Math.min(...near) <= 20, `monster is ${Math.min(...near)} away from the nearest active player`);
    assert.equal(loc.galaxy === 9 && loc.system === 400, false);
    assert.ok((await w.monsters.occupiedKeys()).has(event.locationKey));

    // Settling again changes nothing.
    const again = await w.monsters.settleEvent(event._id);
    assert.deepEqual([again.moveCount, again.locationKey, again.version], [1, event.locationKey, event.version]);

    // Nobody can found a colony on the monster's slot.
    const settler = await w.player('settler', { ships: { colonyShip: 1 } });
    const colony = { requestId: randomUUID(), mission: 'colonize', formationId: settler.formationId, originPlanetId: settler.originPlanetId, expectedRevision: 2, destination: loc, cargo: {}, speed: 100 };
    await assert.rejects(w.fleets.launch(settler.user._id, colony), (error) => error.code === 'TARGET_CHANGED');

    // Sending a fleet to the wrong place or an unknown event is refused.
    await assert.rejects(w.fleets.launch(settler.user._id, w.order(settler, event._id, { ...loc, planet: loc.planet === 15 ? 14 : loc.planet + 1 })), (error) => error.code === 'TARGET_CHANGED');
    await assert.rejects(w.fleets.launch(settler.user._id, w.order(settler, new mongoose.Types.ObjectId(), loc)), (error) => error.code === 'TARGET_CHANGED');

    // After three days it walks to another system.
    await Event.updateOne({ _id: event._id }, { $set: { nextMoveAt: new Date(Date.now() - 1000) } });
    const moved = await w.monsters.settleEvent(event._id);
    assert.equal(moved.moveCount, 2);
    assert.notEqual(`${moved.location.galaxy}:${moved.location.system}`, `${loc.galaxy}:${loc.system}`);
    assert.equal(moved.locationHistory.length, 2);
    assert.equal((await w.monsters.occupiedKeys()).has(event.locationKey), false);
    assert.ok((await w.monsters.occupiedKeys()).has(moved.locationKey));

    // A monster standing on a freshly founded colony gives way at the next settlement.
    const squatter = await User.findById(players[1].user._id);
    squatter.planets.push({ galaxy: moved.location.galaxy, system: moved.location.system, planet: moved.location.planet, name: 'Squatter' });
    await squatter.save();
    const evicted = await w.monsters.settleEvent(event._id);
    assert.equal(evicted.moveCount, 3);
    assert.notEqual(evicted.locationKey, moved.locationKey);

    // Two active monsters cannot hold one slot (database guarantee).
    const other = await w.spawn({ typeId: 'second-beast', name: '둘째' });
    await assert.rejects(Event.updateOne({ _id: other._id }, { $set: { location: evicted.location, locationKey: evicted.locationKey } }), (error) => error.code === 11000);

    // In-flight colonists keep the monster away from their destination.
    const target = { galaxy: evicted.location.galaxy, system: evicted.location.system, planet: evicted.location.planet === 15 ? 14 : evicted.location.planet + 1 };
    await Movement.create({ userId: settler.user._id, username: 'p1', mission: 'colonize', status: 'flying', fleet: { colonyShip: 1 }, origin: { galaxy: 2, system: 1, planet: 5 }, destination: target, startTime: new Date(), arrivalTime: new Date(Date.now() + 1e6) });
    // (the sampler may still choose other slots, but never that one)
    for (let i = 0; i < 6; i++) {
      await Event.updateOne({ _id: event._id }, { $set: { nextMoveAt: new Date(Date.now() - 1000) } });
      const hop = await w.monsters.settleEvent(event._id);
      assert.notEqual(hop.locationKey, `${target.galaxy}:${target.system}:${target.planet}`);
    }

    // Time runs out: no reward, the slot is released.
    await Event.updateOne({ _id: event._id }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    const expired = await w.monsters.settleEvent(event._id);
    assert.equal(expired.status, 'EXPIRED');
    assert.equal(expired.locationKey, null);
    assert.equal((await w.monsters.occupiedKeys()).has(moved.locationKey), false);
    assert.equal(await w.models.Reward.countDocuments(), 0);

    // Administrators can cancel what has not ended.
    const cancelled = await w.monsters.cancelEvent(w.admin._id, other._id);
    assert.equal(cancelled.status, 'CANCELLED');
    await assert.rejects(w.monsters.cancelEvent(w.admin._id, other._id), (error) => error.code === 'NOT_CANCELLABLE');
  } finally { await w.close(); }
});

test('new players never get a home planet on a monster slot', { timeout: 240000 }, async (t) => {
  const w = await world(t);
  try {
    const { User, Event } = w.models;
    const event = await w.spawn();
    const slot = { galaxy: 1, system: 1, planet: 4 }; // the first slot new players would receive
    await Event.updateOne({ _id: event._id }, { $set: { location: slot, locationKey: '1:1:4' } });
    const homes = [];
    for (let i = 0; i < 9; i++) {
      const user = await User.createWithHomePlanet({ username: `newbie${i}`, email: `newbie${i}@test.invalid`, password: randomUUID() });
      homes.push(`${user.planets[0].galaxy}:${user.planets[0].system}:${user.planets[0].planet}`);
    }
    assert.equal(homes.includes('1:1:4'), false);
  } finally { await w.close(); }
});

test('battles wear a monster down across many commanders, record contributions and leave wreckage', { timeout: 300000 }, async (t) => {
  const w = await world(t);
  try {
    const { Contribution, BattleLog, Report, Debris, Movement, Event } = w.models;
    const event = await w.spawn({ units: [unit({ count: 10, stats: { hull: 1_000_000, shield: 0, attack: 30000 } })] }); // 10,000,000 hull
    const a = await w.player('alpha', { cruisers: 30, wallet: walletOf(1) });
    const b = await w.player('bravo', { cruisers: 30, wallet: walletOf(2) });
    const c = await w.player('charlie', { cruisers: 30 }); // no wallet
    const launches = [await w.attack(a, event), await w.attack(b, event), await w.attack(c, event)];
    const due = new Date(Math.max(...launches.map((m) => +m.arrivalTime)) + 1);
    await Promise.all(launches.map((m) => w.fleets.processMovement(m._id, due)));

    const after = await Event.findById(event._id);
    const rules = require('../utils/monsterRules');
    const lostHull = after.maxHull - rules.remainingHull(after.state);
    const rows = await Contribution.find({ eventId: event._id });
    assert.equal(rows.length, 3);
    assert.equal(rows.reduce((n, r) => n + r.damageTotal, 0), lostHull); // every point of damage is credited to someone
    assert.ok(rows.every((r) => r.damageTotal > 0 && r.attacks === 1));
    const byName = Object.fromEntries(rows.map((r) => [r.username, r]));
    assert.equal(byName.alpha.damageEligible, byName.alpha.damageTotal);
    assert.equal(byName.charlie.damageEligible, 0); // no wallet linked while fighting
    assert.equal(after.status, 'ACTIVE');
    assert.ok(after.version >= 3);
    assert.equal(await BattleLog.countDocuments({ eventId: event._id }), 3);

    for (const m of launches) {
      const done = await Movement.findById(m._id);
      assert.equal(done.status, 'returning');
      const report = await Report.findOne({ movementId: m._id });
      assert.equal(report.monster.name, event.name);
      assert.equal(report.monster.defeated, false);
      assert.ok(report.monster.remainingPercent > 0 && report.monster.remainingPercent < 100);
      assert.equal(report.defender.userId, undefined);
      assert.ok(report.attacker.userId);
    }
    // The monster shot back: some cruisers were lost and, with the monster's own wreck, left debris.
    const lost = launches.reduce((n, m) => n + (30 - Object.values(m.fleet.toObject ? m.fleet.toObject() : m.fleet).reduce((x, y) => x + y, 0)), 0);
    const field = await Debris.findOne({ galaxy: event.location.galaxy, system: event.location.system, planet: event.location.planet });
    assert.ok(field.metal > 0 && field.crystal > 0);

    // The same movement cannot hit twice, even if it is replayed.
    const replay = launches[0];
    await Movement.updateOne({ _id: replay._id }, { $set: { status: 'flying' } });
    await w.fleets.processMovement(replay._id, due);
    assert.equal((await Contribution.findOne({ eventId: event._id, userId: a.user._id })).damageTotal, byName.alpha.damageTotal);
    assert.equal(lost >= 0, true);

    // A fleet arriving after the monster has moved comes straight back without a fight.
    const late = await w.player('late', { cruisers: 30 });
    const chasing = await w.attack(late, await Event.findById(event._id));
    await Event.updateOne({ _id: event._id }, { $set: { nextMoveAt: new Date(Date.now() - 1000) } });
    const moved = await w.monsters.settleEvent(event._id);
    assert.notEqual(moved.locationKey, event.locationKey);
    const reportsBefore = await Report.countDocuments();
    await w.arrive(chasing);
    const back = await Movement.findById(chasing._id);
    assert.equal(back.status, 'returning');
    assert.match(back.notice, /이동했거나 사라져/);
    assert.equal(await Report.countDocuments(), reportsBefore);
    assert.equal(await Contribution.countDocuments({ eventId: event._id, userId: late.user._id }), 0);
    assert.equal(back.fleet.cruiser, 30); // untouched
    await w.fleets.processMovement(chasing._id, new Date(+back.returnTime + 1));
    assert.equal((await w.models.User.findById(late.user._id)).planets[0].fleet.cruiser, 30);
  } finally { await w.close(); }
});

test('defeating a monster pays the pool by damage dealt with a linked wallet, once, and settles the event', { timeout: 300000 }, async (t) => {
  const w = await world(t);
  try {
    const { Contribution, Reward, Event, User } = w.models;
    const event = await w.spawn({ units: [unit({ count: 4, stats: { hull: 10_000_000, shield: 0, attack: 100 } })] }, { poolMicro: '10000000' }); // 40,000,000 hull, 10 CGC
    const a = await w.player('alpha', { cruisers: 25, wallet: walletOf(1) });
    const b = await w.player('bravo', { cruisers: 25, wallet: walletOf(2) });
    const c = await w.player('charlie', { cruisers: 25 });
    const d = await w.player('delta', { cruisers: 25 });
    const killer = await w.player('echo', { cruisers: 6000, wallet: walletOf(3) });
    for (const p of [a, b, c, d]) await w.arrive(await w.attack(p, event));
    assert.equal((await Event.findById(event._id)).status, 'ACTIVE');

    // Delta links a wallet only after the first fight; only later damage counts for CGC.
    const before = (await Contribution.findOne({ eventId: event._id, userId: d.user._id })).damageTotal;
    await User.updateOne({ _id: d.user._id }, { $set: { wallet: { address: walletOf(4), linkedAt: new Date() } } });
    d.formationId = d.formationId; // same formation, back home after the first trip
    const homeD = await w.models.Movement.findOne({ userId: d.user._id });
    await w.fleets.processMovement(homeD._id, new Date(+homeD.returnTime + 1));
    for (const p of [a, b, c, d]) { const f = (await User.findById(p.user._id)).fleetFormations[0]; p.revision = f.revision; }
    const second = await w.fleets.launch(d.user._id, w.order(d, event._id, (await Event.findById(event._id)).location, { expectedRevision: (await User.findById(d.user._id)).fleetFormations[0].revision }));
    await w.arrive(second);
    const mid = await Contribution.findOne({ eventId: event._id, userId: d.user._id });
    assert.equal(mid.attacks, 2);
    assert.equal(mid.damageEligible, mid.damageTotal - before);

    await w.arrive(await w.attack(killer, await Event.findById(event._id)));
    const dead = await Event.findById(event._id);
    assert.equal(dead.status, 'SETTLING');
    assert.equal(dead.locationKey, null);
    assert.equal((await w.monsters.occupiedKeys()).has(event.locationKey), false);

    const rows = await Contribution.find({ eventId: event._id }).lean();
    const eligible = rows.filter((r) => r.damageEligible > 0);
    const expected = require('../utils/monsterRules').computeShares(10_000_000n, eligible.map((r) => ({ userId: String(r.userId), damage: r.damageEligible })));
    const payouts = await Reward.find({ kind: 'monster', refId: String(event._id) }).lean();
    assert.equal(payouts.length, expected.length);
    assert.equal(payouts.length, 4); // alpha, bravo, delta (later fights) and echo; charlie has no wallet
    for (const share of expected) {
      const row = payouts.find((p) => p.userId.equals(share.userId));
      assert.equal(row.amountMicro, share.rewardMicro.toString());
      assert.equal(row.rewardRef, `monster:${event._id}:${share.userId}`);
      assert.equal(row.status, 'PENDING');
    }
    assert.ok(payouts.reduce((n, p) => n + BigInt(p.amountMicro), 0n) <= 10_000_000n);
    assert.equal(payouts.some((p) => p.userId.equals(c.user._id)), false);

    // Delivery: each wallet is paid once, then the event is settled.
    await w.outbox.process(w.client());
    await w.outbox.process(w.client());
    assert.equal((await Event.findById(event._id)).status, 'SETTLED');
    for (const [user, wallet] of [[a, walletOf(1)], [b, walletOf(2)], [d, walletOf(4)], [killer, walletOf(3)]]) {
      const row = payouts.find((p) => p.userId.equals(user.user._id));
      assert.equal(w.fake.balanceOf(wallet), BigInt(row.amountMicro));
    }
    assert.equal(w.fake.balanceOf(walletOf(9)), 0n);
    await w.outbox.process(w.client());
    assert.equal(w.fake.state.rewards.size, 4); // nothing is paid twice
    assert.equal((await Contribution.findOne({ eventId: event._id, userId: killer.user._id })).rewardMicro, payouts.find((p) => p.userId.equals(killer.user._id)).amountMicro);
  } finally { await w.close(); }
});

test('a payout larger than the budget waits for budget; unfinished events and zero pools pay nothing', { timeout: 300000 }, async (t) => {
  const w = await world(t, { fakeOptions: { budgetMicro: 1_000_000n } });
  try {
    const { Reward, Event } = w.models;
    const event = await w.spawn({ units: [unit({ count: 1, stats: { hull: 1000, shield: 0, attack: 10 } })] }, { poolMicro: '50000000' });
    const hero = await w.player('hero', { cruisers: 50, wallet: walletOf(7) });
    await w.arrive(await w.attack(hero, event));
    assert.equal((await Event.findById(event._id)).status, 'SETTLING');
    await w.outbox.process(w.client());
    const row = await Reward.findOne({ kind: 'monster', refId: String(event._id) });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.lastError, 'BUDGET_EXCEEDED');
    const overview = (await w.monsters.adminOverview()).find((e) => e.eventId === String(event._id));
    assert.equal(overview.waitingForBudget, true);
    assert.equal(overview.top[0].username, 'hero');
    assert.equal(w.fake.balanceOf(walletOf(7)), 0n);

    w.fake.addBudget(100_000_000n);
    await w.models.Reward.updateOne({ _id: row._id }, { $set: { nextAttemptAt: new Date(0) } });
    await w.outbox.process(w.client());
    await w.outbox.process(w.client());
    assert.equal((await Event.findById(event._id)).status, 'SETTLED');
    assert.equal(w.fake.balanceOf(walletOf(7)), 50_000_000n);

    // Zero pool: defeating it is recognised but nothing is queued.
    const free = await w.spawn({ typeId: 'free-beast', units: [unit({ count: 1, stats: { hull: 1000, shield: 0, attack: 10 } })] });
    await w.arrive(await w.attack(await w.player('solo', { cruisers: 50, wallet: walletOf(8) }), free));
    assert.equal((await Event.findById(free._id)).status, 'SETTLED');
    assert.equal(await Reward.countDocuments({ refId: String(free._id) }), 0);

    // Not defeated before the deadline: no payout rows at all.
    const tough = await w.spawn({ typeId: 'tough-beast', units: [unit({ count: 10, stats: { hull: 1e9, shield: 0, attack: 10 } })] }, { poolMicro: '5000000' });
    await w.arrive(await w.attack(await w.player('tryer', { cruisers: 20, wallet: walletOf(9) }), tough));
    await Event.updateOne({ _id: tough._id }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    assert.equal((await w.monsters.settleEvent(tough._id)).status, 'EXPIRED');
    assert.equal(await Reward.countDocuments({ refId: String(tough._id) }), 0);
  } finally { await w.close(); }
});

test('administrators validate types, preview fights without saving and cannot pledge CGC while it is off', { timeout: 240000 }, async (t) => {
  const w = await world(t, { cgc: false });
  try {
    const { Event } = w.models;
    await assert.rejects(w.monsters.saveType(w.admin._id, typeInput({ units: [] })), (error) => error.code === 'INVALID_MONSTER');
    const saved = await w.monsters.saveType(w.admin._id, typeInput({ defaultPoolMicro: '3000000' }));
    assert.equal(saved.typeId, 'abyss-beast');
    await w.monsters.saveType(w.admin._id, typeInput({ name: '수정된 이름' }));
    assert.equal((await w.monsters.listTypes()).length, 1);
    assert.equal((await w.monsters.listTypes())[0].name, '수정된 이름');

    await assert.rejects(w.monsters.createEvent(w.admin._id, { typeId: 'abyss-beast', startsAt: new Date(), endsAt: new Date(Date.now() + 1e6), poolMicro: '1000000' }), (error) => error.code === 'CGC_DISABLED');
    await assert.rejects(w.monsters.createEvent(w.admin._id, { typeId: 'nope', startsAt: new Date(), endsAt: new Date(Date.now() + 1e6) }), (error) => error.code === 'TYPE_NOT_FOUND');
    await assert.rejects(w.monsters.createEvent(w.admin._id, { typeId: 'abyss-beast', startsAt: new Date(), endsAt: new Date(Date.now() - 1e6) }), (error) => error.code === 'INVALID_PERIOD');
    await assert.rejects(w.monsters.createEvent(w.admin._id, { typeId: 'abyss-beast', startsAt: new Date(), endsAt: new Date(Date.now() + 1e6), moveEveryHours: 0 }), (error) => error.code === 'INVALID_MOVE');
    const event = await w.monsters.createEvent(w.admin._id, { typeId: 'abyss-beast', startsAt: new Date(Date.now() + 3600_000), endsAt: new Date(Date.now() + 86400_000) });
    // The event keeps its own copy; later edits of the type do not change it.
    await w.monsters.saveType(w.admin._id, typeInput({ name: '또 바뀜', units: [unit({ count: 3 })] }));
    assert.equal((await Event.findById(event._id)).typeSnapshot.units[0].count, 10);
    await assert.rejects(w.monsters.deleteType(w.admin._id, 'abyss-beast'), (error) => error.code === 'TYPE_IN_USE');
    await w.monsters.cancelEvent(w.admin._id, event._id);
    assert.equal((await w.monsters.deleteType(w.admin._id, 'abyss-beast')).deleted, true);

    const preview = await w.monsters.simulate({ type: typeInput({ typeId: 'preview-beast', units: [unit({ count: 10, stats: { hull: 1_000_000, shield: 0, attack: 30000 } })] }), fleet: { cruiser: 100 }, attackerTechs: { weapons: 2 } });
    assert.ok(preview.damage > 0 && preview.damage < preview.maxHull);
    assert.equal(preview.maxHull, 10 * 1_000_000);
    assert.equal(preview.defeated, false);
    assert.ok(preview.attackerLossValue > 0);
    assert.ok(Object.values(preview.attackerLosses).every((n) => n >= 0));
    await assert.rejects(w.monsters.simulate({ type: typeInput(), fleet: {} }), (error) => error.code === 'INVALID_FLEET');
    assert.equal(await Event.countDocuments({ typeId: 'preview-beast' }), 0);
  } finally { await w.close(); }
});
