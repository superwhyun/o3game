const { normalizeUserResearch, researchInfrastructure } = require('../utils/userResearch');
const { initializePopulation, calculatePopulation } = require('../utils/populationEconomy');
const { calculateArea, productionModifiers, normalizeLegacyArea } = require('../utils/planetArea');
const { atomic } = require('./transactions');
const BuildingQueue = require('../models/BuildingQueue');
const FleetMovement = require('../models/FleetMovement');
const GameConfig = require('../models/GameConfig');
const User = require('../models/User');
const entityConfigService = require('./EntityConfigService');
const {
  applyOfflineProduction,
  calculateProduction,
  calculateStorage
} = require('../utils/planetEconomy');

const ACTIVE_QUEUE_STATUSES = ['building', 'pending'];

function getPlanetForQueue(user, queueItem) {
  return user.planets[queueItem.planetId];
}

function getResearchState(user, planet) {
  return { ...(user.research?.toObject ? user.research.toObject() : user.research || {}), terraforming: user.terraformingLevel || 0 };
}

function formatQueueItem(item, now = new Date()) {
  if (!item) return null;

  const remaining = Math.max(0, Math.ceil((new Date(item.endTime) - now) / 1000));

  return {
    id: item._id,
    type: item.type,
    planetId: item.planetId,
    action: item.action || 'upgrade',
    itemId: item.itemId,
    name: item.name,
    level: item.level,
    count: item.count,
    icon: item.icon,
    duration: item.duration,
    remaining,
    status: item.status,
    startTime: item.startTime,
    endTime: item.endTime
  };
}

function formatFleetMovement(movement, now = new Date()) {
  const targetTime = movement.status === 'returning' && movement.returnTime
    ? new Date(movement.returnTime)
    : new Date(movement.arrivalTime);
  const remaining = Math.max(0, Math.ceil((targetTime - now) / 1000));

  return {
    id: movement._id,
    formationId: movement.formationId,
    requestId: movement.requestId,
    scoutReportId: movement.scoutReportId,
    battleReportId: movement.battleReport,
    recalledAt: movement.recalledAt,
    returnStartTime: movement.returnStartTime,
    formationName: movement.formationNameAtLaunch || '기존 임무',
    formationEmblem: movement.formationEmblemAtLaunch || '',
    initialFleet: movement.initialFleet,
    notice: movement.notice,
    mission: movement.mission,
    status: movement.status,
    fleet: movement.fleet,
    cargo: movement.cargo,
    colonists: movement.colonists || 0,
    colonistsAtLaunch: movement.colonistsAtLaunch,
    origin: movement.origin,
    destination: movement.destination,
    speed: movement.speed,
    startTime: movement.startTime,
    arrivalTime: movement.arrivalTime,
    returnTime: movement.returnTime,
    remaining
  };
}

async function activateNextQueues(userId, now = new Date()) {
  const items = await BuildingQueue.find({ userId, applied: false, status: { $in: ACTIVE_QUEUE_STATUSES }, endTime: { $gt: now } }).sort({ startTime: 1, endTime: 1 });
  const groups = new Map();
  for (const item of items) {
    const key = item.type === 'research' ? 'research' : `${item.type}:${item.planetId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  let mutated = false;
  for (const group of groups.values()) {
    let cursor = +now;
    for (let index = 0; index < group.length; index++) {
      const item = group[index];
      // Preserve elapsed work. A cancelled predecessor must not leave a
      // future start-time hole, including legacy queues already in that state.
      if (index === 0 && +item.startTime <= +now) {
        cursor = +item.endTime;
      } else {
        const start = cursor;
        const end = start + item.duration * 1000;
        if (+item.startTime !== start || +item.endTime !== end) {
          item.startTime = new Date(start); item.endTime = new Date(end);
        }
        cursor = end;
      }
      item.status = index === 0 ? 'building' : 'pending';
      if (item.isModified()) { await item.save(); mutated = true; }
    }
  }
  return mutated;
}

function applyQueueCompletion(user, queueItem) {
  const planet = getPlanetForQueue(user, queueItem);
  if (!planet) return null;

  if (queueItem.type === 'building') {
    if (!planet.buildings) planet.buildings = {};
    planet.buildings[queueItem.itemId] = queueItem.action === 'demolish' ? queueItem.level : (queueItem.level ?? ((planet.buildings[queueItem.itemId] || 0) + 1));
  } else if (queueItem.type === 'research') {
    if (queueItem.itemId === 'terraforming') {
      user.terraformingLevel = Math.max(user.terraformingLevel || 0, queueItem.level);
      normalizeUserResearch(user);
      return planet;
    }
    user.research[queueItem.itemId] = Math.max(user.research[queueItem.itemId] || 0, queueItem.level || ((user.research[queueItem.itemId] || 0) + 1));
    normalizeUserResearch(user);
  } else if (queueItem.type === 'ship') {
    if (!planet.fleet) planet.fleet = {};
    planet.fleet[queueItem.itemId] = (planet.fleet[queueItem.itemId] || 0) + (queueItem.count || 1);
  } else if (queueItem.type === 'defense') {
    if (!planet.defense) planet.defense = {};
    planet.defense[queueItem.itemId] = (planet.defense[queueItem.itemId] || 0) + (queueItem.count || 1);
  }

  return planet;
}

async function settleQueuesForUser(user, config, now = new Date()) {
  const dueItems = await BuildingQueue.find({
    userId: user._id,
    status: { $in: ACTIVE_QUEUE_STATUSES },
    applied: false,
    endTime: { $lte: now }
  }).sort({ endTime: 1, startTime: 1, createdAt: 1 });

  if (dueItems.length === 0) {
    await activateNextQueues(user._id, now);
    return [];
  }

  const completed = [];

  for (const queueItem of dueItems) {
    const claimedItem = await BuildingQueue.findOneAndUpdate(
      {
        _id: queueItem._id,
        applied: false,
        status: queueItem.status
      },
      {
        $set: {
          applied: true,
          status: 'completed'
        }
      },
      { new: true }
    );

    if (!claimedItem) continue;

    const planet = getPlanetForQueue(user, claimedItem);
    if (!planet) throw new Error('Queue references a missing planet');

    applyOfflineProduction(planet, config, new Date(claimedItem.endTime));
    // A global research completion is an economy boundary for every planet.
    if (claimedItem.type === 'research') {
      for (const other of user.planets) {
        if (other !== planet) applyOfflineProduction(other, config, new Date(claimedItem.endTime));
      }
    }
    applyQueueCompletion(user, claimedItem);

    completed.push({
      type: claimedItem.type,
      itemId: claimedItem.itemId,
      name: claimedItem.name,
      level: claimedItem.level,
      count: claimedItem.count
    });
  }

  await activateNextQueues(user._id, now);
  return completed;
}

async function buildQueueState(userId, now = new Date(), planetId = null) {
  const items = await BuildingQueue.find({
    userId,
    status: { $in: ACTIVE_QUEUE_STATUSES },
    applied: false
  }).sort({ type: 1, startTime: 1, endTime: 1 });

  const queueState = {
    building: null,
    research: null,
    ship: null,
    queue: [],
    completed: [],
    all: items.map(item => formatQueueItem(item, now))
  };

  for (const type of ['building', 'research', 'ship', 'defense']) {
    const typedItems = items.filter((item) => item.type === type && (planetId === null || String(item.planetId) === String(planetId) || type === 'research'));
    if (typedItems.length === 0) continue;

    queueState[type] = formatQueueItem(typedItems[0], now);
    queueState.queue.push(...typedItems.slice(1).map((item) => formatQueueItem(item, now)));
  }

  return queueState;
}

async function buildFleetState(userId, now = new Date()) {
  const movements = await FleetMovement.find({
    userId,
    status: { $in: ['flying', 'returning'] }
  }).sort({ arrivalTime: 1, returnTime: 1 });

  return movements.map((movement) => formatFleetMovement(movement, now));
}

function buildPlanetSnapshot(planet, config, terraformLevel, queues, planetId) {
  const storage = calculateStorage(planet, config);
  const production = calculateProduction(planet, config.serverSpeed || 1, config.resourceSettings || {}, config);
  const snapshot = planet.toObject ? planet.toObject() : { ...planet };

  return {
    ...snapshot,
    storage,
    energyState: require('../utils/planetEconomy').calculateEnergyState(planet),
    area: calculateArea(planet, terraformLevel, queues, planetId, config),
    populationState: calculatePopulation(planet, config),
    fleetSupport: {
      ...(planet.$locals?.fleetSupport || { crew: 0, hourly: { food: 0, metal: 0, deuterium: 0 } }),
      shortages: ['food', 'metal', 'deuterium'].filter(key => (planet.$locals?.fleetSupport?.hourly?.[key] || 0) > 0 && (planet.resources[key] || 0) <= 1e-9 && (production[key] || 0) <= 0),
    },
    environment: require('../utils/planetEnvironment').planetEnvironment(planet),
    productionModifiers: productionModifiers(planet),
    production
  };
}

function buildGameSnapshot(user, { config, now, queueState, fleetMovements, completedQueues = [] }) {
  normalizeUserResearch(user);
  const currentPlanetIndex = user.currentPlanet || 0;
  const currentPlanet = user.planets[currentPlanetIndex] || user.planets[0];
  const research = getResearchState(user, currentPlanet);
  const queues = queueState?.all || [queueState?.building, queueState?.research, queueState?.ship, queueState?.defense, ...(queueState?.queue || [])].filter(Boolean);

  return {
    id: user._id,
    preferences: { uiMode: user.preferences?.uiMode || "detailed" },
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
    adminRole: user.adminRole,
    currentPlanet: currentPlanetIndex,
    stateRevision: user.stateRevision || 0,
    wallet: user.wallet?.address ? { address: user.wallet.address, linkedAt: user.wallet.linkedAt } : null,
    entitlements: { emblems: [...(user.entitlements?.emblems || [])], speedupSeconds: user.entitlements?.speedupSeconds || 0 },
    fleetFormations: (user.fleetFormations || []).map(f => ({ ...f.toObject(), id: f._id, requiredCrew: require('../utils/fleetCrew').requiredCrew(f.ships), upkeep: require('../utils/fleetCrew').upkeep(f.ships, f.crew || 0, config) })),
    unassignedShips: require('../utils/formationRules').availableShips(user, currentPlanet._id),
    planets: user.planets.map((planet, index) => buildPlanetSnapshot(planet, config, user.terraformingLevel || 0, queues, String(index))),
    research,
    researchInfrastructure: researchInfrastructure(user, queues),
    areaSettings: { bonusUsableFields: config.areaSettings?.bonusUsableFields ?? 40 },
    queueState,
    fleetMovements,
    completedQueues,
    exchange: require('../utils/resourceExchange').EXCHANGE,
    serverSpeed: config.serverSpeed || 1,
    flightSpeedMultiplier: config.fleetSettings?.flightSpeedMultiplier ?? 1,
    serverTime: now,
    defaultStorage: config.resourceSettings?.defaultStorage || { metal: 10000, crystal: 10000, deuterium: 10000 },
    entityConfigRevision: entityConfigService.getRevision()
  };
}

async function settleUserStateInternal(userOrId, now = new Date()) {
  try {
    const user = await User.findById(userOrId?._id || userOrId);

    if (!user) return null;

    const config = await GameConfig.getConfig();
    if (user.isPirate) {
      await require('./PirateService').settle(user, config, now);
      return {user,config,now,queueState:{all:[]},fleetMovements:[],snapshot:buildGameSnapshot(user,{config,now,queueState:{all:[]},fleetMovements:[]})};
    }
    normalizeUserResearch(user);
    const activeQueues = await BuildingQueue.find({ userId: user._id, status: { $in: ACTIVE_QUEUE_STATUSES }, applied: false }).lean();
    user.planets.forEach((planet, index) => normalizeLegacyArea(planet, activeQueues, String(index)));
    require('../utils/fleetCrew').prepareSupport(user, config);
    const completedQueues = await settleQueuesForUser(user, config, now);

    for (const planet of user.planets) {
      applyOfflineProduction(planet, config, now);
      initializePopulation(planet, config);
      require('../utils/planetEnvironment').initializeEnvironment(planet);
    }

    require('../utils/fleetCrew').initializeCrews(user);
    require('../utils/fleetCrew').prepareSupport(user, config);
    user.markModified('planets');
    await user.save();

    const queueState = await buildQueueState(user._id, now, user.currentPlanet);
    const fleetMovements = await buildFleetState(user._id, now);

    return {
      user,
      config,
      now,
      queueState,
      fleetMovements,
      completedQueues,
      snapshot: buildGameSnapshot(user, { config, now, queueState, fleetMovements, completedQueues })
    };
  } catch (error) {
    if (!error.hasErrorLabel?.('TransientTransactionError')) console.error(`[GameStateService.settleUserState] Error for user ${userOrId}:`, error.message);
    throw error;
  }
}

async function settleUserState(userOrId, now = new Date()) {
  return atomic(() => settleUserStateInternal(userOrId, now));
}

async function settleUsersWithDueQueues(now = new Date()) {
  const userIds = await BuildingQueue.distinct('userId', {
    status: { $in: ACTIVE_QUEUE_STATUSES },
    applied: false,
    endTime: { $lte: now }
  });

  for (const userId of userIds) {
    try { await settleUserState(userId, now); }
    catch (error) { console.error('Queue settlement failed:', userId, error.message); }
  }
}

module.exports = {
  buildGameSnapshot,
  buildQueueState,
  formatQueueItem,
  formatFleetMovement,
  settleUserState,
  settleUsersWithDueQueues,
  activateNextQueues
};
