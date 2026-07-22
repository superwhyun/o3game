const express = require('express');

const { authMiddleware } = require('../middleware/admin');
const BattleReport = require('../models/BattleReport');
const FleetMovement = require('../models/FleetMovement');
const User = require('../models/User');
const entityConfigService = require('../services/EntityConfigService');
const { settleUserState } = require('../services/GameStateService');
const {
  assertCargoAvailable,
  assertFleetAvailable,
  assertNonEmptyFleet,
  calculateFleetProfile,
  calculateTravelSeconds,
  normalizeCargo
} = require('../utils/fleetRules');
const { buildGalaxySystem } = require('../utils/galaxySystem');

const router = express.Router();

function readCoordinate(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new RangeError(`${label} must be a positive integer`);
  }

  return Number(value);
}

function assertDestination(destination) {
  if (!destination || typeof destination !== 'object') {
    throw new RangeError('destination is required');
  }

  const galaxy = Number(destination.galaxy);
  const system = Number(destination.system);
  const planet = Number(destination.planet);

  if (!Number.isSafeInteger(galaxy) || galaxy < 1 || galaxy > 9) throw new RangeError('destination galaxy is invalid');
  if (!Number.isSafeInteger(system) || system < 1 || system > 499) throw new RangeError('destination system is invalid');
  if (!Number.isSafeInteger(planet) || planet < 1 || planet > 15) throw new RangeError('destination planet is invalid');

  return { galaxy, system, planet };
}

router.get('/galaxy', authMiddleware, async (req, res) => {
  try {
    const galaxy = readCoordinate(req.query.galaxy, 'galaxy');
    const system = readCoordinate(req.query.system, 'system');
    const users = await User.find({
      'planets.galaxy': galaxy,
      'planets.system': system
    }).select('_id username isOnline planets').lean();

    res.json(buildGalaxySystem({
      galaxy,
      system,
      requestingUserId: req.user._id,
      users
    }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/fleets', authMiddleware, async (req, res) => {
  try {
    const settled = await settleUserState(req.user._id, new Date());
    res.json({ fleets: settled.fleetMovements, serverTime: settled.now });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load fleet movements' });
  }
});

router.post('/fleets', authMiddleware, async (req, res) => {
  try {
    const { mission, fleet, cargo, destination, speed = 100 } = req.body;
    if (!['transport', 'attack'].includes(mission)) {
      return res.status(400).json({ error: 'Only transport and attack missions are currently available' });
    }

    const normalizedDestination = assertDestination(destination);
    const normalizedSpeed = Number(speed);
    const settled = await settleUserState(req.user._id, new Date());
    const originPlanet = settled.user.planets[settled.user.currentPlanet] || settled.user.planets[0];
    const selectedFleet = assertNonEmptyFleet(assertFleetAvailable(fleet, originPlanet.fleet || {}));
    const selectedCargo = assertCargoAvailable(normalizeCargo(cargo), originPlanet.resources || {});
    const shipStats = Object.fromEntries(Object.keys(selectedFleet).map((shipType) => [
      shipType,
      entityConfigService.getEntity('ship', shipType)?.stats
    ]));
    const { cargoCapacity, slowestSpeed } = calculateFleetProfile(selectedFleet, shipStats);
    const cargoTotal = Object.values(selectedCargo).reduce((total, amount) => total + amount, 0);
    if (cargoTotal > cargoCapacity) {
      return res.status(400).json({ error: 'Cargo exceeds the selected fleet capacity' });
    }

    const targetUser = await User.findOne({
      'planets.galaxy': normalizedDestination.galaxy,
      'planets.system': normalizedDestination.system,
      'planets.planet': normalizedDestination.planet
    });
    const targetPlanet = targetUser?.planets.find((planet) => (
      planet.galaxy === normalizedDestination.galaxy
      && planet.system === normalizedDestination.system
      && planet.planet === normalizedDestination.planet
    ));
    if (!targetUser || !targetPlanet) {
      return res.status(400).json({ error: 'The mission destination must contain a planet' });
    }

    const origin = {
      galaxy: originPlanet.galaxy,
      system: originPlanet.system,
      planet: originPlanet.planet
    };
    if (origin.galaxy === normalizedDestination.galaxy
      && origin.system === normalizedDestination.system
      && origin.planet === normalizedDestination.planet) {
      return res.status(400).json({ error: 'A transport destination must differ from the origin' });
    }

    const travelSeconds = calculateTravelSeconds(origin, normalizedDestination, slowestSpeed, normalizedSpeed);
    const startedAt = new Date();
    const arrivalTime = new Date(startedAt.getTime() + travelSeconds * 1000);
    const fleetDeck = mission === 'attack'
      ? [...Object.entries(selectedFleet).slice(0, 8).map(([type, count]) => ({ type, count })), ...Array(8).fill(null)].slice(0, 8)
      : undefined;

    for (const [shipType, amount] of Object.entries(selectedFleet)) {
      originPlanet.fleet[shipType] -= amount;
    }
    for (const [resource, amount] of Object.entries(selectedCargo)) {
      originPlanet.resources[resource] -= amount;
    }
    settled.user.markModified('planets');

    const movement = await FleetMovement.create({
      userId: settled.user._id,
      username: settled.user.username,
      targetUserId: targetUser._id,
      mission,
      fleet: selectedFleet,
      ...(fleetDeck ? { fleetDeck } : {}),
      cargo: selectedCargo,
      origin,
      destination: normalizedDestination,
      startTime: startedAt,
      arrivalTime,
      speed: normalizedSpeed
    });
    await settled.user.save();

    res.status(201).json({
      fleet: {
        id: movement._id,
        mission: movement.mission,
        status: movement.status,
        arrivalTime: movement.arrivalTime,
        returnTime: movement.returnTime,
        origin: movement.origin,
        destination: movement.destination,
        fleet: movement.fleet,
        cargo: movement.cargo
      },
      snapshot: (await settleUserState(settled.user, new Date())).snapshot
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/reports', authMiddleware, async (req, res) => {
  try {
    const reports = await BattleReport.find({
      $or: [
        { 'attacker.userId': req.user._id },
        { 'defender.userId': req.user._id }
      ]
    }).sort({ battleTime: -1 }).limit(50).lean();

    res.json({ reports });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load battle reports' });
  }
});

module.exports = router;
