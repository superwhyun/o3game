/**
 * Event monsters: scheduling, slow relocation, battles against the existing combat engine,
 * damage contribution and the CGC payout when one is defeated.
 *
 * Everything time-based is settled lazily (settleEvent) from reads, battles and a periodic
 * sweep, so a server restart never loses or doubles a move. Battle application and
 * contribution bookkeeping happen in the fleet movement's own transaction.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const FleetMovement = require('../models/FleetMovement');
const BattleReport = require('../models/BattleReport');
const GameConfig = require('../models/GameConfig');
const AuditLog = require('../models/AuditLog');
const MonsterType = require('../models/MonsterType');
const MonsterEvent = require('../models/MonsterEvent');
const MonsterContribution = require('../models/MonsterContribution');
const MonsterBattleLog = require('../models/MonsterBattleLog');
const CgcReward = require('../models/CgcReward');
const Combat = require('./CombatService');
const Debris = require('./DebrisService');
const rewards = require('./CgcRewardService');
const metanomic = require('./MetanomicClient');
const { atomic, afterCommit } = require('./transactions');
const { coordinateKey, isValidCoordinate } = require('../utils/universe');
const rules = require('../utils/monsterRules');
const { attackWaves } = require('../utils/combatWaves');
const { calculateSurvivors } = require('../utils/attackRules');
const { plain } = require('../utils/formationRules');
const { formatCgc } = require('../utils/cgcAmount');

const ACTIVE_PLAYER_DAYS = 14;
const SPAWN_ATTEMPTS = 300;
const RETRY_MS = 60 * 60 * 1000;
let notifier = null;

function fail(statusCode, code, message) {
  throw Object.assign(new Error(message), { statusCode, code });
}
const sameCoords = (a, b) => a && b && ['galaxy', 'system', 'planet'].every((k) => a[k] === b[k]);
const coordsOf = (value) => ({ galaxy: value.galaxy, system: value.system, planet: value.planet });
const distance = (a, b) => Math.abs(a.galaxy - b.galaxy) + Math.abs(a.system - b.system) + Math.abs(a.planet - b.planet);

/** Called with (type, payload) after a monster appears, moves or dies. Set by the socket layer. */
function setNotifier(fn) { notifier = fn; }
const notify = (type, event) => afterCommit(() => { try { notifier?.(type, brief(event)); } catch { /* best effort */ } });

const brief = (event) => ({
  eventId: String(event._id), name: event.name, typeId: event.typeId, status: event.status,
  location: event.location ? coordsOf(event.location) : null, endsAt: event.endsAt
});

// ───────────────────────────── types (administrator) ─────────────────────────────

async function saveType(actorId, input) {
  const normalized = rules.validateMonsterType(input);
  const now = new Date();
  const type = await MonsterType.findOneAndUpdate(
    { typeId: normalized.typeId },
    { $set: { ...normalized, updatedBy: actorId, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: 'after' }
  );
  await AuditLog.create({ actorId, action: 'monster.type.save', payload: { typeId: type.typeId } });
  return type;
}

async function deleteType(actorId, typeId) {
  const used = await MonsterEvent.exists({ typeId, status: { $in: ['SCHEDULED', 'ACTIVE'] } });
  if (used) fail(409, 'TYPE_IN_USE', '진행 중이거나 예정된 이벤트가 있는 괴수는 삭제할 수 없습니다.');
  const removed = await MonsterType.findOneAndDelete({ typeId });
  if (!removed) fail(404, 'TYPE_NOT_FOUND', '괴수 종류를 찾을 수 없습니다.');
  await AuditLog.create({ actorId, action: 'monster.type.delete', payload: { typeId } });
  return { deleted: true };
}

const listTypes = () => MonsterType.find().sort({ createdAt: 1 }).lean();

// ───────────────────────────── events (administrator) ─────────────────────────────

async function createEvent(actorId, input) {
  const type = await MonsterType.findOne({ typeId: String(input?.typeId ?? '') }).lean();
  if (!type) fail(404, 'TYPE_NOT_FOUND', '괴수 종류를 찾을 수 없습니다.');
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt) || +endsAt <= +startsAt) fail(400, 'INVALID_PERIOD', '기간이 올바르지 않습니다.');
  if (+endsAt <= Date.now()) fail(400, 'INVALID_PERIOD', '이미 끝난 기간입니다.');
  const poolMicro = String(input.poolMicro ?? type.defaultPoolMicro ?? '0');
  if (!/^(0|[1-9][0-9]{0,17})$/.test(poolMicro)) fail(400, 'INVALID_POOL', '보상 풀이 올바르지 않습니다.');
  if (BigInt(poolMicro) > 0n && !metanomic.isEnabled()) fail(409, 'CGC_DISABLED', 'CGC 연동이 꺼져 있어 보상 풀을 설정할 수 없습니다.');
  const moveEveryHours = input.moveEveryHours ?? 72, maxDistance = input.maxDistance ?? 20;
  if (!(Number.isFinite(moveEveryHours) && moveEveryHours >= 1 && moveEveryHours <= 24 * 30)) fail(400, 'INVALID_MOVE', '이동 주기가 올바르지 않습니다.');
  if (!(Number.isInteger(maxDistance) && maxDistance >= 1 && maxDistance <= 200)) fail(400, 'INVALID_DISTANCE', '이동 거리가 올바르지 않습니다.');
  const snapshot = JSON.parse(JSON.stringify({ typeId: type.typeId, name: type.name, description: type.description, units: type.units, techs: type.techs, regenPerHour: type.regenPerHour, model: type.model }));
  const state = rules.initialState(snapshot);
  const event = await MonsterEvent.create({
    name: String(input.name || type.name).slice(0, 80), typeId: type.typeId, typeSnapshot: snapshot, startsAt, endsAt, poolMicro,
    moveEveryHours, maxDistance, state, maxHull: rules.maxHull(snapshot), createdBy: actorId
  });
  await AuditLog.create({ actorId, action: 'monster.event.create', payload: { eventId: String(event._id), typeId: type.typeId, poolMicro } });
  return event;
}

async function cancelEvent(actorId, eventId) {
  const event = await MonsterEvent.findOneAndUpdate(
    { _id: eventId, status: { $in: ['SCHEDULED', 'ACTIVE'] } },
    { $set: { status: 'CANCELLED', locationKey: null, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: 'after' }
  );
  if (!event) fail(409, 'NOT_CANCELLABLE', '취소할 수 없는 이벤트입니다.');
  await AuditLog.create({ actorId, action: 'monster.event.cancel', payload: { eventId: String(eventId) } });
  return event;
}

async function relocateNow(actorId, eventId, now = new Date()) {
  const event = await MonsterEvent.findOne({ _id: eventId, status: 'ACTIVE' });
  if (!event) fail(409, 'NOT_ACTIVE', '진행 중인 이벤트가 아닙니다.');
  const moved = await relocate(event, now, { force: true });
  if (!moved) fail(409, 'NO_FREE_SLOT', '이동할 수 있는 빈 행성 자리를 찾지 못했습니다.');
  await AuditLog.create({ actorId, action: 'monster.event.relocate', payload: { eventId: String(eventId) } });
  return MonsterEvent.findById(eventId);
}

// ───────────────────────────── placement ─────────────────────────────

/** Coordinates that currently hold an active monster. */
async function occupiedKeys() {
  const rows = await MonsterEvent.find({ status: 'ACTIVE', locationKey: { $type: 'string' } }).select('locationKey').lean();
  return new Set(rows.map((row) => row.locationKey));
}
async function isOccupied(coords) {
  return Boolean(await MonsterEvent.exists({ status: 'ACTIVE', locationKey: coordinateKey(coords) }));
}

async function slotIsFree(coords, event) {
  const key = coordinateKey(coords);
  if (await User.exists({ 'planets.coordinateKey': key })) return false;
  if (await MonsterEvent.exists({ status: 'ACTIVE', locationKey: key, _id: { $ne: event._id } })) return false;
  if (await FleetMovement.exists({ mission: 'colonize', status: 'flying', 'destination.galaxy': coords.galaxy, 'destination.system': coords.system, 'destination.planet': coords.planet })) return false;
  return true;
}

/**
 * Pick a free planet slot near active players: sample an active planet, then a random offset
 * within `maxDistance` (same distance measure as fleet travel), skipping the previous system.
 */
async function pickLocation(event, now) {
  const rng = rules.seededRandom(`${event._id}:${event.moveCount}`);
  const since = new Date(+now - ACTIVE_PLAYER_DAYS * 86_400_000);
  const project = { $project: { _id: 0, galaxy: '$planets.galaxy', system: '$planets.system', planet: '$planets.planet' } };
  let bases = await User.aggregate([{ $match: { lastLogin: { $gte: since } } }, { $unwind: '$planets' }, { $sample: { size: 80 } }, project]);
  if (!bases.length) bases = await User.aggregate([{ $unwind: '$planets' }, { $sample: { size: 80 } }, project]);
  if (!bases.length) return null;
  const previous = event.location;
  const limit = event.maxDistance;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const base = bases[Math.floor(rng() * bases.length)];
    const offset = { galaxy: Math.floor(rng() * 5) - 2, system: Math.floor(rng() * (2 * limit + 1)) - limit, planet: Math.floor(rng() * 29) - 14 };
    const candidate = { galaxy: base.galaxy + offset.galaxy, system: base.system + offset.system, planet: base.planet + offset.planet };
    if (!isValidCoordinate(candidate)) continue;
    if (distance(base, candidate) > limit) continue;
    if (previous && previous.galaxy === candidate.galaxy && previous.system === candidate.system) continue;
    if (await slotIsFree(candidate, event)) return candidate;
  }
  return null;
}

async function relocate(event, now, { force = false } = {}) {
  const location = await pickLocation(event, now);
  if (!location) {
    await MonsterEvent.updateOne({ _id: event._id, version: event.version }, { $set: { nextMoveAt: new Date(+now + RETRY_MS) }, $inc: { version: 1 } });
    return false;
  }
  try {
    const moved = await MonsterEvent.findOneAndUpdate(
      { _id: event._id, status: 'ACTIVE', version: event.version },
      {
        $set: { location, locationKey: coordinateKey(location), nextMoveAt: new Date(+now + event.moveEveryHours * 3_600_000), updatedAt: now },
        $inc: { version: 1, moveCount: 1 },
        $push: { locationHistory: { $each: [{ ...location, at: now }], $slice: -50 } }
      },
      { returnDocument: 'after' }
    );
    if (moved) notify('moved', moved);
    return Boolean(moved);
  } catch (error) {
    if (error.code === 11000) return false; // someone took the slot first; try again next sweep
    throw error;
  }
}

// ───────────────────────────── lifecycle ─────────────────────────────

/** Bring one event up to date: start, expire, move, resolve slot conflicts. Idempotent. */
async function settleEvent(eventId, now = new Date()) {
  let event = await MonsterEvent.findById(eventId);
  if (!event) return null;
  if (event.status === 'SCHEDULED' && +event.startsAt <= +now) {
    if (+event.endsAt <= +now) {
      await MonsterEvent.updateOne({ _id: event._id, status: 'SCHEDULED' }, { $set: { status: 'EXPIRED', updatedAt: now } });
    } else if (!event.retryAt || +event.retryAt <= +now) {
      const location = await pickLocation(event, now);
      if (!location) {
        await MonsterEvent.updateOne({ _id: event._id, status: 'SCHEDULED' }, { $set: { retryAt: new Date(+now + RETRY_MS) } });
      } else {
        try {
          const started = await MonsterEvent.findOneAndUpdate(
            { _id: event._id, status: 'SCHEDULED' },
            {
              $set: { status: 'ACTIVE', location, locationKey: coordinateKey(location), nextMoveAt: new Date(+now + event.moveEveryHours * 3_600_000), 'state.lastRegenAt': now, updatedAt: now },
              $inc: { version: 1, moveCount: 1 }, $push: { locationHistory: { ...location, at: now } }
            },
            { returnDocument: 'after' }
          );
          if (started) notify('spawned', started);
        } catch (error) { if (error.code !== 11000) throw error; }
      }
    }
  } else if (event.status === 'ACTIVE') {
    if (+event.endsAt <= +now) {
      const expired = await MonsterEvent.findOneAndUpdate({ _id: event._id, status: 'ACTIVE' }, { $set: { status: 'EXPIRED', locationKey: null, updatedAt: now }, $inc: { version: 1 } }, { returnDocument: 'after' });
      if (expired) notify('expired', expired);
    } else if (+event.nextMoveAt <= +now || await User.exists({ 'planets.coordinateKey': event.locationKey })) {
      await relocate(event, now);
    }
  }
  return MonsterEvent.findById(eventId);
}

/** Periodic sweep so starts, expiries and moves happen even when nobody is looking. */
async function sweep(now = new Date()) {
  const due = await MonsterEvent.find({ status: { $in: ['SCHEDULED', 'ACTIVE'] } }).select('_id').lean();
  for (const row of due) {
    try { await settleEvent(row._id, now); } catch (error) { console.error('Monster sweep failed:', String(row._id), error.message); }
  }
  return due.length;
}

// ───────────────────────────── battles ─────────────────────────────

/**
 * The monster as it stands at `now`, without changing anything: transactions must not run
 * the lifecycle (it handles duplicate-key races that would abort an open transaction).
 * An event whose move or end time has passed counts as gone until the next sweep acts on it.
 */
async function standingAt(eventId, destination, now = new Date()) {
  const event = await MonsterEvent.findById(eventId);
  const stale = event && (+event.endsAt <= +now || +event.nextMoveAt <= +now);
  if (!event || event.status !== 'ACTIVE' || stale || !sameCoords(event.location, destination)) return null;
  return event;
}

/** Order checks for sending a fleet at a monster; returns the event. */
async function assertTargetable(eventId, destination) {
  const event = await standingAt(eventId, destination);
  if (!event) fail(409, 'TARGET_CHANGED', '괴수가 이동했거나 사라졌습니다. 다시 확인하십시오.');
  return event;
}

function sendHome(movement, now, notice) {
  movement.notice = notice;
  movement.status = 'returning';
  movement.returnStartTime = now;
  movement.returnTime = new Date(+now + (+movement.arrivalTime - +movement.startTime));
}

/**
 * Resolve a fleet arriving at a monster. Runs inside the movement's transaction.
 * Returns the user ids whose state changed.
 */
async function resolveAttack(owner, movement, now) {
  const origin = owner.planets.find((p) => sameCoords(p, movement.origin));
  let event = await standingAt(movement.targetMonsterEventId, movement.destination, now);
  if (!event) {
    sendHome(movement, now, '괴수가 이미 이동했거나 사라져 전투 없이 귀환합니다.');
    await movement.save();
    return [String(owner._id)];
  }
  // A movement hits a monster once. (A duplicate-key error cannot be caught here: it would abort the transaction.)
  if (await MonsterBattleLog.exists({ eventId: event._id, movementId: movement._id })) return [];
  await MonsterBattleLog.create([{ eventId: event._id, movementId: movement._id }]);

  const snapshot = event.typeSnapshot;
  const before = rules.applyRegen(snapshot, event.state, now);
  const { waves, inlineUnits } = rules.buildDefense(snapshot, before);
  const result = await Combat.simulateBattle8Wave(
    movement.combatWaves || attackWaves(plain(movement.fleet), movement.fleetDeck), waves,
    { attacker: plain(origin?.research), defender: snapshot.techs }, null, String(movement._id), { inlineUnits }
  );
  const after = rules.stateAfter(snapshot, before, result.defenderRemaining || {}, now);
  const damage = Math.floor(result.defenderHullDamage || 0);
  const defeated = rules.remainingCount(after) === 0;
  const survivors = calculateSurvivors(plain(movement.fleet), result.attackerLosses || {});
  const config = await GameConfig.getConfig();
  const ratio = Math.max(0, config.combatSettings?.debrisFieldPercentage ?? 30) / 100;
  const lostWreck = Combat.calculateDebris(result.attackerLosses || {}, {}, config.combatSettings?.debrisFieldPercentage ?? 30);
  const { wreck } = rules.destroyedWreck(snapshot, before, after);
  const field = { metal: lostWreck.metal + Math.floor(wreck.metal * ratio), crystal: lostWreck.crystal + Math.floor(wreck.crystal * ratio) };

  const updated = await MonsterEvent.findOneAndUpdate(
    { _id: event._id, status: 'ACTIVE', version: event.version },
    {
      $set: { state: after, updatedAt: now, ...(defeated ? { status: 'DEFEATED', defeatedAt: now, locationKey: null } : {}) },
      $inc: { version: 1 }
    },
    { returnDocument: 'after' }
  );
  if (!updated) throw Object.assign(new Error('Monster changed during the battle'), { code: 'MONSTER_CONFLICT' });
  event = updated;

  const shipsLost = Object.values(result.attackerLosses || {}).reduce((a, b) => a + b, 0);
  const eligible = Boolean(owner.wallet?.address);
  const contribution = await MonsterContribution.findOneAndUpdate(
    { eventId: event._id, userId: owner._id },
    { $inc: { damageTotal: damage, damageEligible: eligible ? damage : 0, attacks: 1, shipsLost }, $set: { username: owner.username, lastAt: now } },
    { upsert: true, returnDocument: 'after' }
  );
  await MonsterBattleLog.updateOne({ eventId: event._id, movementId: movement._id }, { $set: { damage } });
  await Debris.add(movement.destination, field);

  const total = await MonsterContribution.aggregate([{ $match: { eventId: event._id } }, { $group: { _id: null, sum: { $sum: '$damageTotal' } } }]);
  const share = total[0]?.sum ? contribution.damageTotal / total[0].sum : 1;
  const report = new BattleReport({
    movementId: movement._id,
    attacker: { userId: owner._id, username: owner.username, coordinates: movement.origin },
    defender: { username: event.name, coordinates: movement.destination },
    attackerInitial: { fleet: plain(movement.initialFleet) },
    defenderInitial: { fleet: {}, defense: {} },
    rounds: result.rounds.map((r, i) => ({ round: i + 1, attackerShips: Combat.countUnits(r.attackerForces), defenderShips: Combat.countUnits(r.defenderForces), attackerDamage: r.mainCombat?.attackerDamage || 0, defenderDamage: r.mainCombat?.defenderDamage || 0 })),
    result: { winner: defeated ? 'attacker' : 'defender', attackerLosses: result.attackerLosses, defenderLosses: rules.destroyedWreck(snapshot, before, after).destroyed, debrisField: field, loot: { metal: 0, crystal: 0, deuterium: 0 } },
    monster: { eventId: event._id, name: event.name, damage, remainingPercent: rules.hpPercent(snapshot, after), defeated, share }
  });
  await report.save();

  movement.fleet = survivors;
  movement.battleReport = report._id;
  sendHome(movement, now, defeated ? `${event.name}을(를) 처치했습니다! 기여도 ${(share * 100).toFixed(1)}%` : `${event.name}에게 ${damage.toLocaleString('ko-KR')} 피해를 입혔습니다.`);
  await movement.save();
  await owner.save();

  if (defeated) {
    await settleDefeat(event, now);
    notify('defeated', event);
  }
  return [String(owner._id)];
}

// ───────────────────────────── payout ─────────────────────────────

/** Turn damage into payouts. Runs in the battle transaction that killed the monster. */
async function settleDefeat(event, now = new Date()) {
  const pool = BigInt(event.poolMicro || '0');
  const contributions = await MonsterContribution.find({ eventId: event._id, damageEligible: { $gt: 0 } });
  const shares = pool > 0n && metanomic.isEnabled()
    ? rules.computeShares(pool, contributions.map((c) => ({ userId: String(c.userId), damage: c.damageEligible })))
    : [];
  let queued = 0;
  for (const share of shares) {
    const user = await User.findById(share.userId).select('wallet').lean();
    if (!user?.wallet?.address) continue; // wallet removed by an administrator since the fight
    await rewards.enqueue({ kind: 'monster', refId: event._id, userId: share.userId, wallet: user.wallet.address, amountMicro: share.rewardMicro, rewardRef: `monster:${event._id}:${share.userId}` });
    await MonsterContribution.updateOne({ eventId: event._id, userId: share.userId }, { $set: { rewardMicro: share.rewardMicro.toString() } });
    queued++;
  }
  await MonsterEvent.updateOne({ _id: event._id }, { $set: queued ? { status: 'SETTLING' } : { status: 'SETTLED', settledAt: now } });
  return queued;
}

/** After each payout result: the event is settled once every payout completed. */
async function afterPayout(row) {
  const open = await CgcReward.countDocuments({ kind: 'monster', refId: row.refId, status: { $ne: 'COMPLETED' } });
  if (open === 0) await MonsterEvent.updateOne({ _id: row.refId, status: 'SETTLING' }, { $set: { status: 'SETTLED', settledAt: new Date() } });
}
rewards.registerHandlers('monster', { onCompleted: afterPayout, onFailed: async () => {} });

// ───────────────────────────── views ─────────────────────────────

const publicView = (event, mine = null) => ({
  eventId: String(event._id), name: event.name, typeId: event.typeId, description: event.typeSnapshot?.description || '',
  model: event.typeSnapshot?.model || {}, status: event.status, location: event.location ? coordsOf(event.location) : null,
  hpPercent: event.state && event.typeSnapshot ? rules.hpPercent(event.typeSnapshot, event.state) : 100,
  startsAt: event.startsAt, endsAt: event.endsAt, nextMoveAt: event.nextMoveAt,
  poolMicro: event.poolMicro, pool: formatCgc(event.poolMicro || '0'),
  ...(mine ? { mine: { damage: mine.damageTotal, eligibleDamage: mine.damageEligible, attacks: mine.attacks, rewardMicro: mine.rewardMicro } } : {})
});

async function listVisible(userId) {
  const events = await MonsterEvent.find({ status: { $in: ['SCHEDULED', 'ACTIVE', 'DEFEATED', 'SETTLING'] } }).sort({ startsAt: 1 }).limit(20);
  const mine = userId ? await MonsterContribution.find({ userId, eventId: { $in: events.map((e) => e._id) } }).lean() : [];
  return events.map((event) => publicView(event, mine.find((c) => String(c.eventId) === String(event._id))));
}

async function detail(eventId, userId) {
  const event = await settleEvent(eventId);
  if (!event || event.status === 'CANCELLED') fail(404, 'EVENT_NOT_FOUND', '이벤트를 찾을 수 없습니다.');
  const rows = await MonsterContribution.find({ eventId: event._id }).sort({ damageTotal: -1 }).limit(10).lean();
  const total = (await MonsterContribution.aggregate([{ $match: { eventId: event._id } }, { $group: { _id: null, sum: { $sum: '$damageTotal' }, n: { $sum: 1 } } }]))[0] || { sum: 0, n: 0 };
  const mine = userId ? await MonsterContribution.findOne({ eventId: event._id, userId }).lean() : null;
  return {
    event: publicView(event, mine),
    participants: total.n,
    ranking: rows.map((row, index) => ({ rank: index + 1, username: row.username, damage: row.damageTotal, share: total.sum ? row.damageTotal / total.sum : 0, isMe: userId ? String(row.userId) === String(userId) : false }))
  };
}

/** Per-system view data for the galaxy map. */
async function inSystem(galaxy, system, userId = null) {
  const events = await MonsterEvent.find({ status: 'ACTIVE', 'location.galaxy': galaxy, 'location.system': system });
  const mine = userId ? await MonsterContribution.find({ userId, eventId: { $in: events.map((e) => e._id) } }).lean() : [];
  return events.map((event) => ({ planet: event.location.planet, ...publicView(event, mine.find((c) => String(c.eventId) === String(event._id))) }));
}

async function adminOverview() {
  const events = await MonsterEvent.find().sort({ createdAt: -1 }).limit(50);
  const out = [];
  for (const event of events) {
    const pay = await CgcReward.aggregate([{ $match: { kind: 'monster', refId: String(event._id) } }, { $group: { _id: '$status', n: { $sum: 1 }, last: { $last: '$lastError' } } }]);
    const top = await MonsterContribution.find({ eventId: event._id }).sort({ damageTotal: -1 }).limit(5).lean();
    out.push({ ...publicView(event), createdAt: event.createdAt, moveEveryHours: event.moveEveryHours, maxDistance: event.maxDistance, payouts: Object.fromEntries(pay.map((p) => [p._id, p.n])), waitingForBudget: pay.some((p) => p._id === 'PENDING' && p.last === 'BUDGET_EXCEEDED'), top: top.map((c) => ({ username: c.username, damage: c.damageTotal })) });
  }
  return out;
}

/** Fight a made-up fleet against a type without saving anything (administrator tool). */
async function simulate(input) {
  const normalized = rules.validateMonsterType({ typeId: 'preview', ...input?.type });
  const snapshot = { ...normalized };
  const fleet = {};
  for (const [id, count] of Object.entries(input?.fleet || {})) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) fail(400, 'INVALID_FLEET', '함대 수량이 올바르지 않습니다.');
    if (count > 0) fleet[id] = count;
  }
  if (!Object.keys(fleet).length) fail(400, 'INVALID_FLEET', '함대를 입력하십시오.');
  const techs = {};
  for (const key of ['weapons', 'shield', 'armor']) techs[key] = Math.min(100, Math.max(0, Math.floor(Number(input?.attackerTechs?.[key]) || 0)));
  const state = rules.initialState(snapshot);
  const { waves, inlineUnits } = rules.buildDefense(snapshot, state);
  const result = await Combat.simulateBattle8Wave(attackWaves(fleet, []), waves, { attacker: techs, defender: snapshot.techs }, null, `preview:${Date.now()}`, { inlineUnits });
  const after = rules.stateAfter(snapshot, state, result.defenderRemaining || {}, new Date());
  const lossValue = Combat.calculateResourceValue(result.attackerLosses || {});
  return {
    damage: Math.floor(result.defenderHullDamage || 0), remainingPercent: rules.hpPercent(snapshot, after), defeated: rules.remainingCount(after) === 0,
    attackerLosses: result.attackerLosses, attackerLossValue: lossValue, maxHull: rules.maxHull(snapshot),
    // Expected monster shots per volley (rapid fire counted) and the damage they carry before shields.
    monsterShots: snapshot.units.reduce((sum, unit) => sum + unit.count * (1 + Object.values(unit.stats.rapidFire).reduce((a, b) => a + b, 0)), 0),
    monsterVolleyPower: snapshot.units.reduce((sum, unit) => sum + unit.count * (1 + Object.values(unit.stats.rapidFire).reduce((a, b) => a + b, 0)) * unit.stats.attack, 0)
  };
}

module.exports = {
  setNotifier, saveType, deleteType, listTypes, createEvent, cancelEvent, relocateNow, occupiedKeys, isOccupied, settleEvent, sweep,
  assertTargetable, resolveAttack, settleDefeat, publicView, listVisible, detail, inSystem, adminOverview, simulate, sameCoords
};
