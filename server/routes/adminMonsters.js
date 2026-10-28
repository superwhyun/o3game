const express = require('express');
const mongoose = require('mongoose');
const { adminMiddleware, superAdminMiddleware } = require('../middleware/admin');
const monsters = require('../services/MonsterService');
const rewards = require('../services/CgcRewardService');
const CgcReward = require('../models/CgcReward');

const router = express.Router();

function route(handler) {
  return async (req, res) => {
    try { res.json(await handler(req)); }
    catch (error) {
      const status = error.statusCode || (error.code === 11000 ? 409 : 500);
      res.status(status).json({ error: error.statusCode || error.code === 11000 ? error.message : '요청을 처리하지 못했습니다.', code: error.code || 'REQUEST_FAILED' });
    }
  };
}
const objectId = (value) => {
  if (!mongoose.isValidObjectId(value)) throw Object.assign(new Error('잘못된 ID입니다.'), { statusCode: 400, code: 'INVALID_ID' });
  return value;
};

router.get('/types', adminMiddleware, route(async () => ({ types: await monsters.listTypes() })));
router.put('/types', superAdminMiddleware, route(async (req) => ({ type: await monsters.saveType(req.user._id, req.body) })));
router.delete('/types/:typeId', superAdminMiddleware, route((req) => monsters.deleteType(req.user._id, req.params.typeId)));
router.post('/simulate', adminMiddleware, route((req) => monsters.simulate(req.body)));

router.get('/events', adminMiddleware, route(async () => ({ events: await monsters.adminOverview() })));
router.post('/events', superAdminMiddleware, route(async (req) => ({ event: monsters.publicView(await monsters.createEvent(req.user._id, req.body)) })));
router.post('/events/:eventId/cancel', superAdminMiddleware, route(async (req) => ({ event: monsters.publicView(await monsters.cancelEvent(req.user._id, objectId(req.params.eventId))) })));
router.post('/events/:eventId/relocate', superAdminMiddleware, route(async (req) => ({ event: monsters.publicView(await monsters.relocateNow(req.user._id, objectId(req.params.eventId))) })));
router.post('/payouts/:rewardRef/retry', superAdminMiddleware, route(async (req) => {
  const row = await rewards.retryFailed(req.params.rewardRef);
  if (!row) throw Object.assign(new Error('재시도할 수 있는 지급이 없습니다.'), { statusCode: 404, code: 'NOT_RETRYABLE' });
  return { rewardRef: row.rewardRef, status: row.status };
}));
router.get('/events/:eventId/payouts', adminMiddleware, route(async (req) => ({
  payouts: (await CgcReward.find({ kind: 'monster', refId: objectId(req.params.eventId) }).sort({ createdAt: 1 }).limit(500).lean())
    .map((r) => ({ rewardRef: r.rewardRef, userId: r.userId, amountMicro: r.amountMicro, status: r.status, lastError: r.lastError, attempts: r.attempts }))
})));

module.exports = router;
