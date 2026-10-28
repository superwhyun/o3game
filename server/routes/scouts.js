const express = require("express");
const mongoose = require("mongoose");
const { authMiddleware } = require("../middleware/admin");
const { afterCommit } = require("../services/transactions");
const scouts = require("../services/ScoutService");
const Report = require("../models/ScoutReport");
const {
  settleUserState,
  formatFleetMovement,
} = require("../services/GameStateService");
const {
  GALAXY_COUNT,
  SYSTEM_COUNT,
  POSITION_COUNT,
} = require("../utils/universe");
const router = express.Router();
const { apiContext, errorHandler } = require('../utils/apiErrors');
router.use(apiContext, require('../middleware/apiValidation').apiValidation('/api/game'));
router.post("/scouts", authMiddleware, async (req, res) => {
  try {
    const movement = await scouts.launch(req.user._id, req.body);
    afterCommit(() =>
      req.app.get("io")?.to(`user:${req.user._id}`).emit("fleetStateChanged"),
    );
    let snapshot;
    try {
      snapshot = (await settleUserState(req.user._id)).snapshot;
    } catch (error) {
      console.error("Scout committed; snapshot pending:", error.message);
    }
    res
      .status(201)
      .json({
        fleet: formatFleetMovement(movement),
        snapshot,
        snapshotPending: !snapshot,
      });
  } catch (error) {
    throw error;
  }
});
const publicReport = (r) => ({
  id: r._id,
  movementId: r.movementId,
  ownerRead: !!r.ownerRead,
  origin: r.origin,
  destination: r.destination,
  observedAt: r.observedAt,
  targetPlanetId: r.targetPlanetId,
  targetUserId: r.targetUserId,
  targetName: r.targetName,
  targetCommander: r.targetCommander,
  ...(r.pirateLevel ? {pirateLevel:r.pirateLevel} : {}),
  outcome: r.outcome,
  informationTier: r.informationTier,
  sections: r.sections?.environment ? { ...r.sections, environment: { ...r.sections.environment, maxTotal: require("../utils/colonizationRules").MAX_PLANET_AREA } } : r.sections,
  detected: r.detected,
  intercepted: r.intercepted,
  initialProbeCount: r.initialProbeCount,
  survivorCount: r.survivorCount,
});
function page(query, filter) {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', "목록 크기가 올바르지 않습니다.");
  if (query.cursor) {
    let cursor;
    try {
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
    } catch {
      throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', "페이지 위치가 올바르지 않습니다.");
    }
    const date = new Date(cursor.time);
    if (!mongoose.isValidObjectId(cursor.id) || !Number.isFinite(+date))
      throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', "페이지 위치가 올바르지 않습니다.");
    filter.$or = [
      { observedAt: { $lt: date } },
      {
        observedAt: date,
        _id: { $lt: new mongoose.Types.ObjectId(cursor.id) },
      },
    ];
  }
  return limit;
}
const cursorOf = (r) =>
  Buffer.from(JSON.stringify({ time: r.observedAt, id: r._id })).toString(
    "base64url",
  );
router.get("/scout-reports", authMiddleware, async (req, res) => {
  try {
    const filter = { ownerUserId: req.user._id };
    const fields = ["galaxy", "system", "planet"];
    if (fields.some((k) => req.query[k] !== undefined)) {
      for (const [key, max] of [
        ["galaxy", GALAXY_COUNT],
        ["system", SYSTEM_COUNT],
        ["planet", POSITION_COUNT],
      ]) {
        const n = Number(req.query[key]);
        if (!Number.isSafeInteger(n) || n < 1 || n > max)
          throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', "목표 좌표가 올바르지 않습니다.");
        filter[`destination.${key}`] = n;
      }
    }
    // Targeted observations remain available as scouting knowledge after history deletion.
    if (!fields.some(k => req.query[k] !== undefined)) filter.ownerDeleted = { $ne: true };
    const pagination = require('../utils/reportHistory').pagination(req.query, 20);
    const limit = page(req.query, filter);
    const total = pagination.numbered ? await Report.countDocuments(filter) : null;
    const rows = await Report.find(filter)
      .sort({ observedAt: -1, _id: -1 })
      .skip(pagination.offset)
      .limit(limit + 1)
      .lean();
    res.json({
      reports: rows.slice(0, limit).map(publicReport),
      pagination: pagination.numbered ? require('../utils/reportHistory').metadata(pagination, total) : undefined,
      nextCursor: rows.length > limit ? cursorOf(rows[limit - 1]) : null,
    });
  } catch (error) {
    throw error;
  }
});
router.get("/scout-reports/:id", authMiddleware, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(404).json({ error: "보고서를 찾을 수 없습니다." });
  const r = await Report.findOne({
    _id: req.params.id,
    ownerDeleted: { $ne: true },
    ownerUserId: req.user._id,
  }).lean();
  if (!r) return res.status(404).json({ error: "보고서를 찾을 수 없습니다." });
  res.json({ report: publicReport(r) });
});
router.patch("/scout-reports/:id/read", authMiddleware, async (req, res) => {
  const report = await Report.findOneAndUpdate({
    _id: req.params.id, ownerUserId: req.user._id, ownerDeleted: { $ne: true },
  }, { $set: { ownerRead: true } }, { returnDocument: 'after' }).select('_id');
  if (!report) throw require('../utils/apiErrors').apiError(404, 'NOT_FOUND', '정찰 기록을 찾을 수 없습니다.');
  res.json({ read: true });
});
router.get("/scout-alerts", authMiddleware, async (req, res) => {
  try {
    const filter = { targetUserId: req.user._id, detected: true };
    const limit = page(req.query, filter);
    const rows = await Report.find(filter)
      .select("_id attackerName destination observedAt intercepted")
      .sort({ observedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    res.json({
      alerts: rows
        .slice(0, limit)
        .map((r) => ({
          id: r._id,
          attackerName: r.attackerName,
          destination: r.destination,
          observedAt: r.observedAt,
          intercepted: r.intercepted,
        })),
      nextCursor: rows.length > limit ? cursorOf(rows[limit - 1]) : null,
    });
  } catch (error) {
    throw error;
  }
});
router.delete('/scout-reports', authMiddleware, async (req, res) => {
  const ids = require('../utils/reportHistory').deleteIds(req.body);
  const filter = { _id: { $in: ids }, ownerUserId: req.user._id };
  if (await Report.countDocuments(filter) !== ids.length) return res.status(404).json({ error: '정찰 기록을 찾을 수 없습니다.' });
  await Report.updateMany(filter, { $set: { ownerDeleted: true } });
  res.json({ deletedCount: ids.length });
});
router.use(errorHandler);
module.exports = router;
