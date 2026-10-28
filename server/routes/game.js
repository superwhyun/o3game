const { transactionalRoute, afterCommit } = require('../services/transactions');
const formations = require('../services/FleetFormationService');
const fleetService = require('../services/FleetService');
const { formatFleetMovement } = require('../services/GameStateService');
const express = require('express');

const { authMiddleware } = require('../middleware/admin');
const BattleReport = require('../models/BattleReport');
const GameConfig = require('../models/GameConfig');
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
const { GALAXY_COUNT, POSITION_COUNT, SYSTEM_COUNT } = require('../utils/universe');

const router = express.Router();
const { apiContext, errorHandler } = require('../utils/apiErrors');
router.use(apiContext, require('../middleware/apiValidation').apiValidation('/api/game'));

function readCoordinate(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', `${label} must be a positive integer`);
  }

  return Number(value);
}

function assertDestination(destination) {
  if (!destination || typeof destination !== 'object') {
    throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', 'destination is required');
  }

  const galaxy = Number(destination.galaxy);
  const system = Number(destination.system);
  const planet = Number(destination.planet);

  if (!Number.isSafeInteger(galaxy) || galaxy < 1 || galaxy > GALAXY_COUNT) throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', 'destination galaxy is invalid');
  if (!Number.isSafeInteger(system) || system < 1 || system > SYSTEM_COUNT) throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', 'destination system is invalid');
  if (!Number.isSafeInteger(planet) || planet < 1 || planet > POSITION_COUNT) throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', 'destination planet is invalid');

  return { galaxy, system, planet };
}

// Entity catalog for the client: display info, costs, requirements, stats and
// 3D model specs. The client renders every list from this, so new entities
// added to server/data/catalog appear in the UI without client changes.
router.get('/catalog', authMiddleware, async (req, res) => {
  try {
    const config = await GameConfig.getConfig();
    res.json({
      ...entityConfigService.toPublicCatalog(),
      timeMultipliers: {
        building: config.buildingSettings?.buildTimeMultiplier || 1,
        research: config.researchSettings?.researchTimeMultiplier || 1,
        ship: 1,
        defense: 1
      }
    });
  } catch (error) {
    throw error;
  }
});

router.patch('/planets/:planetId/name', authMiddleware, transactionalRoute(async (req, res) => {
  const { planetId } = req.params;
  const rawName = req.body?.name;
  if (!/^[a-fA-F0-9]{24}$/.test(planetId)) {
    return res.status(400).json({ error: '유효하지 않은 콜로니입니다.' });
  }
  if (typeof rawName !== 'string' || /[\u0000-\u001f\u007f]/u.test(rawName)) {
    return res.status(400).json({ error: '콜로니 이름은 한 줄의 문자로 입력해 주세요.' });
  }
  const name = rawName.trim();
  if (!name || [...name].length > 30) {
    return res.status(400).json({ error: '콜로니 이름은 1~30자로 입력해 주세요.' });
  }
  const updated = await User.findOneAndUpdate(
    { _id: req.user._id, 'planets._id': planetId },
    { $set: { 'planets.$.name': name }, $inc: { stateRevision: 1, __v: 1 } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!updated) return res.status(404).json({ error: '소유한 콜로니를 찾을 수 없습니다.' });
  const { snapshot } = await settleUserState(req.user._id);
  res.json({ name, planetId, snapshot });
}));

router.delete('/planets/:planetId', authMiddleware, async (req, res) => {
  const result = await require('../services/PlanetService').abandon(req.user._id, req.params.planetId, req.body?.confirmationName);
  afterCommit(() => req.app.get('io')?.to(`user:${req.user._id}`).emit('fleetStateChanged'));
  res.json(result);
});

router.post('/trade', authMiddleware, transactionalRoute(async (req, res) => {
  const { planetId, from, to, amount } = req.body || {};
  if (typeof planetId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(planetId)) {
    return res.status(400).json({ error: '유효하지 않은 행성입니다.' });
  }
  require('../utils/resourceExchange').exchangeQuote({ from, to, amount });
  const settled = await settleUserState(req.user._id);
  const planet = settled.user.planets.id(planetId);
  if (!planet) return res.status(404).json({ error: '소유한 행성을 찾을 수 없습니다.' });
  const storage = require('../utils/planetEconomy').calculateStorage(planet, settled.config);
  const quote = require('../utils/resourceExchange').applyExchange(planet, storage, { from, to, amount });
  settled.user.markModified('planets');
  await settled.user.save();
  const { snapshot } = await settleUserState(req.user._id);
  res.json({ quote, snapshot });
}));

router.get('/galaxy/traffic', authMiddleware, async (req, res) => {
  try { res.json(await require('../services/FleetTrafficService').list(req.user._id, req.query)); }
  catch (error) { throw error; }
});

router.get('/galaxy', authMiddleware, async (req, res) => {
  try {
    const galaxy = readCoordinate(req.query.galaxy, 'galaxy');
    const system = readCoordinate(req.query.system, 'system');
    const users = await User.find({
      'planets.galaxy': galaxy,
      'planets.system': system
    }).select('_id username isOnline isPirate pirate planets').lean();

    // Exploration belongs to the requesting commander, independent of report pagination.
    const scoutReports = await require('../models/ScoutReport').aggregate([
      { $match: { ownerUserId: req.user._id, 'destination.galaxy': galaxy, 'destination.system': system, outcome: { $in: ['empty', 'occupied', 'friendly'] } } },
      { $sort: { observedAt: -1, _id: -1 } },
      { $group: { _id: '$destination.planet', destination: { $first: '$destination' }, observedAt: { $first: '$observedAt' }, targetPlanetId: { $first: '$targetPlanetId' }, targetUserId: { $first: '$targetUserId' }, targetName: { $first: '$targetName' }, outcome: { $first: '$outcome' }, sections: { $first: '$sections' } } }
    ]);
    const { conflicts, ...view } = buildGalaxySystem({
      galaxy,
      system,
      requestingUserId: req.user._id,
      scoutReports,
      users
    });
    if (conflicts.length > 0) {
      console.warn(`[galaxy] ${conflicts.length} duplicate planet slot(s) in [${galaxy}:${system}] — run "npm run migrate:planets"`, conflicts);
    }
    res.json(view);
  } catch (error) {
    throw error;
  }
});

router.get('/fleets', authMiddleware, async (req, res) => {
  try {
    const settled = await settleUserState(req.user._id, new Date());
    res.json({ fleets: settled.fleetMovements, serverTime: settled.now });
  } catch (error) {
    throw error;
  }
});

function notify(req) {
  afterCommit(() => req.app.get('io')?.to(`user:${req.user._id}`).emit('fleetStateChanged'));
}
router.get('/fleet-formations', authMiddleware, async (req,res) => {
  try { const state=await settleUserState(req.user._id);res.json({snapshot:state.snapshot}); }
  catch(error) {throw error;}
});
for (const [method, path, action] of [['post','/fleet-formations','create'],['patch','/fleet-formations/:id','update'],['delete','/fleet-formations/:id','delete']]) {
  router[method](path, authMiddleware, transactionalRoute(async (req,res) => {
    const result=await formations.change(req.user._id,action,req.params.id,req.body);
    const state=await settleUserState(req.user._id);notify(req);
    res.status(action==='create'?201:200).json({...result,snapshot:state.snapshot});
  }));
}
router.get('/fleet-requests/:requestId',authMiddleware,async(req,res)=>{
  const movement=await FleetMovement.findOne({userId:req.user._id,requestId:req.params.requestId});
  if(!movement)return res.status(404).json({error:'아직 처리되지 않은 요청입니다.'});
  res.json({fleet:formatFleetMovement(movement)});
});
router.post('/fleets',authMiddleware,async(req,res)=>{
  try {
    await settleUserState(req.user._id);
    const movement=await fleetService.launch(req.user._id,req.body);
    notify(req);
    let snapshot;
    try {snapshot=(await settleUserState(req.user._id)).snapshot;} catch(error) {console.error('Fleet committed; snapshot pending:',error.message);}
    res.status(201).json({fleet:formatFleetMovement(movement),snapshot,snapshotPending:!snapshot});
  } catch(error) {
    throw error;
  }
});

router.post('/fleets/:id/recall', authMiddleware, async (req, res) => {
  try {
    const movement = await fleetService.recall(req.user._id, req.params.id);
    notify(req);
    const { snapshot } = await settleUserState(req.user._id);
    res.json({ fleet: formatFleetMovement(movement), snapshot });
  } catch (error) {
    throw error;
  }
});

router.use(require('./battleReports'));

router.use('/improvement-requests', require('./improvementRequests'));
router.use(require('./scouts'));

router.use(errorHandler);
module.exports = router;
