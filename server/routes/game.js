const { transactionalRoute, afterCommit } = require('../services/transactions');
const formations = require('../services/FleetFormationService');
const fleetService = require('../services/FleetService');
const { formatFleetMovement } = require('../services/GameStateService');
const express = require('express');
const mongoose = require('mongoose');

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

  if (!Number.isSafeInteger(galaxy) || galaxy < 1 || galaxy > GALAXY_COUNT) throw new RangeError('destination galaxy is invalid');
  if (!Number.isSafeInteger(system) || system < 1 || system > SYSTEM_COUNT) throw new RangeError('destination system is invalid');
  if (!Number.isSafeInteger(planet) || planet < 1 || planet > POSITION_COUNT) throw new RangeError('destination planet is invalid');

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
    res.status(500).json({ error: error.message });
  }
});

router.get('/galaxy/traffic', authMiddleware, async (req, res) => {
  try { res.json(await require('../services/FleetTrafficService').list(req.user._id, req.query)); }
  catch (error) { res.status(error instanceof RangeError ? 400 : 500).json({ error: error.message }); }
});

router.get('/galaxy', authMiddleware, async (req, res) => {
  try {
    const galaxy = readCoordinate(req.query.galaxy, 'galaxy');
    const system = readCoordinate(req.query.system, 'system');
    const users = await User.find({
      'planets.galaxy': galaxy,
      'planets.system': system
    }).select('_id username isOnline planets').lean();

    const debris = await require('../services/DebrisService').inSystem(galaxy, system);
    const monsters = await require('../services/MonsterService').inSystem(galaxy, system, req.user._id);
    const { conflicts, ...view } = buildGalaxySystem({
      galaxy,
      system,
      requestingUserId: req.user._id,
      users,
      debris,
      monsters
    });
    if (conflicts.length > 0) {
      console.warn(`[galaxy] ${conflicts.length} duplicate planet slot(s) in [${galaxy}:${system}] — run "npm run migrate:planets"`, conflicts);
    }
    res.json(view);
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

function notify(req) {
  afterCommit(() => req.app.get('io')?.to(`user:${req.user._id}`).emit('fleetStateChanged'));
}
router.get('/fleet-formations', authMiddleware, async (req,res) => {
  try { const state=await settleUserState(req.user._id);res.json({snapshot:state.snapshot}); }
  catch(error) {res.status(503).json({error:error.message});}
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
    const unsupported=error.code===20 || /Transaction numbers/.test(error.message);
    res.status(error.statusCode || (unsupported?503:error.name==='VersionError'?409:400)).json({error:unsupported?'DB의 트랜잭션 구성이 필요합니다.':error.message,code:error.code||'LAUNCH_FAILED'});
  }
});

router.get('/monsters', authMiddleware, async (req, res) => {
  try { res.json({ monsters: await require('../services/MonsterService').listVisible(req.user._id) }); }
  catch (error) { res.status(500).json({ error: 'Unable to load monsters' }); }
});
router.get('/monsters/:eventId', authMiddleware, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.eventId)) return res.status(400).json({ error: 'Invalid event' });
    res.json(await require('../services/MonsterService').detail(req.params.eventId, req.user._id));
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to load monster', code: error.code }); }
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

router.use(require('./scouts'));

module.exports = router;
