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
  return user.planets[queueItem.planetId] || user.planets[0];
}

function getResearchState(user, planet) {
  return planet?.research || user.research || {};
}

function formatQueueItem(item, now = new Date()) {
  if (!item) return null;

  const remaining = Math.max(0, Math.ceil((new Date(item.endTime) - now) / 1000));

  return {
    id: item._id,
    type: item.type,
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
    mission: movement.mission,
    status: movement.status,
    fleet: movement.fleet,
    cargo: movement.cargo,
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
  let mutated = false;

  for (const type of ['building', 'research', 'ship']) {
    const active = await BuildingQueue.findOne({
      userId,
      type,
      status: 'building',
      applied: false,
      endTime: { $gt: now }
    }).sort({ startTime: 1, endTime: 1 });

    if (active) continue;

    const next = await BuildingQueue.findOne({
      userId,
      type,
      status: 'pending',
      applied: false,
      endTime: { $gt: now }
    }).sort({ startTime: 1, endTime: 1 });

    if (!next) continue;

    next.status = 'building';
    await next.save();
    mutated = true;
  }

  return mutated;
}

function applyQueueCompletion(user, queueItem) {
  const planet = getPlanetForQueue(user, queueItem);
  if (!planet) return null;

  if (queueItem.type === 'building') {
    if (!planet.buildings) planet.buildings = {};
    planet.buildings[queueItem.itemId] = queueItem.level || ((planet.buildings[queueItem.itemId] || 0) + 1);
  } else if (queueItem.type === 'research') {
    if (!planet.research) planet.research = {};
    planet.research[queueItem.itemId] = queueItem.level || ((planet.research[queueItem.itemId] || 0) + 1);
  } else if (queueItem.type === 'ship') {
    if (!planet.fleet) planet.fleet = {};
    planet.fleet[queueItem.itemId] = (planet.fleet[queueItem.itemId] || 0) + (queueItem.count || 1);
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
    if (!planet) continue;

    applyOfflineProduction(planet, config, new Date(claimedItem.endTime));
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

async function buildQueueState(userId, now = new Date()) {
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
    completed: []
  };

  for (const type of ['building', 'research', 'ship']) {
    const typedItems = items.filter((item) => item.type === type);
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

function buildPlanetSnapshot(planet, config) {
  const storage = calculateStorage(planet);
  const production = calculateProduction(planet, config.serverSpeed || 1, config.resourceSettings || {});
  const snapshot = planet.toObject ? planet.toObject() : { ...planet };

  return {
    ...snapshot,
    storage,
    production
  };
}

function buildGameSnapshot(user, { config, now, queueState, fleetMovements, completedQueues = [] }) {
  const currentPlanetIndex = user.currentPlanet || 0;
  const currentPlanet = user.planets[currentPlanetIndex] || user.planets[0];
  const research = getResearchState(user, currentPlanet);

  return {
    id: user._id,
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
    currentPlanet: currentPlanetIndex,
    planets: user.planets.map((planet) => buildPlanetSnapshot(planet, config)),
    research,
    queueState,
    fleetMovements,
    completedQueues,
    serverSpeed: config.serverSpeed || 1,
    serverTime: now,
    entityConfigRevision: entityConfigService.getRevision()
  };
}

async function settleUserState(userOrId, now = new Date()) {
  try {
    const user = typeof userOrId === 'string' || userOrId.constructor?.name === 'ObjectId'
      ? await User.findById(userOrId)
      : userOrId;

    if (!user) return null;

    const config = await GameConfig.getConfig();
    const completedQueues = await settleQueuesForUser(user, config, now);

    for (const planet of user.planets) {
      applyOfflineProduction(planet, config, now);
    }

    user.markModified('planets');
    await user.save();

    const queueState = await buildQueueState(user._id, now);
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
    console.error(`[GameStateService.settleUserState] Error for user ${userOrId}:`, error);
    throw error;
  }
}

async function settleUsersWithDueQueues(now = new Date()) {
  const userIds = await BuildingQueue.distinct('userId', {
    status: { $in: ACTIVE_QUEUE_STATUSES },
    applied: false,
    endTime: { $lte: now }
  });

  for (const userId of userIds) {
    await settleUserState(userId, now);
  }
}

module.exports = {
  buildGameSnapshot,
  buildQueueState,
  formatQueueItem,
  settleUserState,
  settleUsersWithDueQueues,
  activateNextQueues
};
