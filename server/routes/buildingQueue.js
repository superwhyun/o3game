const express = require('express');
const { authMiddleware } = require('../middleware/admin');
const { settleUserState } = require('../services/GameStateService');
const construction = require('../services/ConstructionService');
const Queue = require('../models/BuildingQueue');
const router = express.Router();
const { apiContext, errorHandler } = require('../utils/apiErrors');
router.use(apiContext, require('../middleware/apiValidation').apiValidation('/api/queue'));
function route(handler) {
  return async (req, res) => {
    try { res.json(await handler(req)); }
    catch (error) { throw error; }
  };
}
router.use(authMiddleware);
router.get('/', route(async req => (await settleUserState(req.user._id)).queueState));
router.post('/build', route(req => construction.enqueue(req.user._id, { type: 'building', itemId: req.body.buildingId, planetId: req.body.planetId })));
router.post('/demolish', route(req => construction.enqueue(req.user._id, { type: 'building', action: 'demolish', itemId: req.body.buildingId, planetId: req.body.planetId })));
router.post('/research', route(req => construction.enqueue(req.user._id, { type: 'research', itemId: req.body.researchId, planetId: req.body.planetId })));
router.post('/ship', route(req => construction.enqueue(req.user._id, { type: req.body.entityType ?? 'ship', itemId: req.body.shipId, count: req.body.count ?? 1, planetId: req.body.planetId })));
router.post('/planet', route(req => construction.selectPlanet(req.user._id, req.body.planetId)));
router.post('/check/:id', route(async req => {
  const settled = await settleUserState(req.user._id);
  const item = await Queue.findOne({ _id: req.params.id, userId: req.user._id });
  if (!item) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  return { completed: item.applied, type: item.type, action: item.action, planetId: item.planetId,
    itemId: item.itemId, name: item.name, level: item.level, count: item.count,
    remaining: item.getRemainingSeconds(), endTime: item.endTime, snapshot: settled.snapshot };
}));
router.delete('/:id', route(req => construction.cancel(req.user._id, req.params.id)));
router.use(errorHandler);
module.exports = router;
