const express = require("express");
const mongoose = require("mongoose");
const BattleReport = require("../models/BattleReport");
const Movement = require("../models/FleetMovement");
const { authMiddleware } = require("../middleware/admin");
const router = express.Router();
const { apiContext, errorHandler } = require("../utils/apiErrors");
router.use(
  apiContext,
  require("../middleware/apiValidation").apiValidation("/api/game"),
);
const validId = (value) =>
  typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
const participant = (userId) => ({
  $or: [
    { "attacker.userId": userId, attackerDeleted: { $ne: true } },
    { "defender.userId": userId, defenderDeleted: { $ne: true } },
  ],
});

router.get("/reports", authMiddleware, async (req, res) => {
  if (req.query.before !== undefined && !validId(req.query.before))
    return res.status(400).json({ error: "목록 위치가 올바르지 않습니다." });
  try {
    const filter = participant(req.user._id);
    if (req.query.before)
      filter._id = { $lt: new mongoose.Types.ObjectId(req.query.before) };
    const pagination = require("../utils/reportHistory").pagination(
      req.query,
      50,
    );
    const [reports, unreadCount, total] = await Promise.all([
      BattleReport.find(filter)
        .sort({ _id: -1 })
        .skip(pagination.offset)
        .limit(pagination.limit + 1)
        .lean(),
      BattleReport.countDocuments({
        $or: [
          {
            "attacker.userId": req.user._id,
            attackerRead: false,
            attackerDeleted: { $ne: true },
          },
          {
            "defender.userId": req.user._id,
            defenderRead: false,
            defenderDeleted: { $ne: true },
          },
        ],
      }),
      pagination.numbered ? BattleReport.countDocuments(filter) : null,
    ]);
    const more = reports.length > pagination.limit;
    if (more) reports.pop();
    const movements = await Movement.find({
      _id: { $in: reports.map((report) => report.movementId).filter(Boolean) },
    })
      .select("status returnTime")
      .lean();
    const byId = new Map(
      movements.map((movement) => [String(movement._id), movement]),
    );
    for (const report of reports) {
      const movement = byId.get(String(report.movementId));
      report.returnStatus = movement?.status || null;
      report.returnTime = movement?.returnTime || null;
    }
    res.json({
      reports,
      unreadCount,
      pagination: pagination.numbered
        ? require("../utils/reportHistory").metadata(pagination, total)
        : undefined,
      nextCursor: more ? String(reports.at(-1)._id) : null,
    });
  } catch (error) {
    throw error;
  }
});
router.patch("/reports/:id/read", authMiddleware, async (req, res) => {
  if (!validId(req.params.id))
    return res
      .status(400)
      .json({ error: "전투 기록 번호가 올바르지 않습니다." });
  try {
    const report = await BattleReport.findOne({
      _id: req.params.id,
      ...participant(req.user._id),
    }).select("attacker.userId");
    if (!report)
      return res.status(404).json({ error: "전투 기록을 찾을 수 없습니다." });
    const field =
      String(report.attacker.userId) === String(req.user._id)
        ? "attackerRead"
        : "defenderRead";
    await BattleReport.updateOne(
      { _id: report._id },
      { $set: { [field]: true } },
    );
    res.json({ read: true });
  } catch (error) {
    throw error;
  }
});
router.delete("/reports", authMiddleware, async (req, res) => {
  const ids = require("../utils/reportHistory").deleteIds(req.body);
  // Keep the shared battle audit and the other participant's copy.
  const owned = await BattleReport.find({
    _id: { $in: ids },
    $or: [
      { "attacker.userId": req.user._id },
      { "defender.userId": req.user._id },
    ],
  })
    .select("_id")
    .lean();
  if (owned.length !== ids.length)
    return res.status(404).json({ error: "전투 기록을 찾을 수 없습니다." });
  await Promise.all([
    BattleReport.updateMany(
      { _id: { $in: ids }, "attacker.userId": req.user._id },
      { $set: { attackerDeleted: true } },
    ),
    BattleReport.updateMany(
      { _id: { $in: ids }, "defender.userId": req.user._id },
      { $set: { defenderDeleted: true } },
    ),
  ]);
  res.json({ deletedCount: ids.length });
});
router.use(errorHandler);
module.exports = router;
