const express = require("express");
const mongoose = require("mongoose");
const Request = require("../models/ImprovementRequest");
const { authMiddleware, adminMiddleware } = require("../middleware/admin");
const router = express.Router();
const { apiContext, errorHandler } = require("../utils/apiErrors");
router.use(
  apiContext,
  require("../middleware/apiValidation").apiValidation(
    "/api/game/improvement-requests",
  ),
);
const validId = (value) =>
  typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

router.get("/", authMiddleware, async (req, res) => {
  if (req.query.before !== undefined && !validId(req.query.before)) {
    return res.status(400).json({ error: "목록 위치가 올바르지 않습니다." });
  }
  const status = req.query.status;
  if (status !== undefined && !["all", "pending", "reviewed", "implemented", "partial", "rejected"].includes(status)) {
    return res.status(400).json({ error: "처리 상태 필터가 올바르지 않습니다." });
  }
  try {
    const filter = req.query.before
      ? { _id: { $lt: new mongoose.Types.ObjectId(req.query.before) } }
      : {};
    if (["implemented", "partial", "rejected"].includes(status)) filter.decision = status;
    if (["pending", "reviewed"].includes(status)) filter.reviewStatus = status;
    const requests = await Request.find(filter)
      .select(
        "authorName authorType title description createdAt reviewStatus decision reviewNote reviewedAt reviewerName",
      )
      .sort({ _id: -1 })
      .limit(51)
      .lean();
    const hasMore = requests.length > 50;
    if (hasMore) requests.pop();
    res.json({
      requests,
      nextCursor: hasMore ? String(requests.at(-1)._id) : null,
    });
  } catch (error) {
    console.error("Improvement list failed:", error.message);
    throw error;
  }
});

router.post("/", authMiddleware, async (req, res) => {
  const { title, description } = req.body || {};
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 100 ||
    typeof description !== "string" ||
    !description.trim() ||
    description.trim().length > 2000
  ) {
    return res
      .status(400)
      .json({ error: "제목은 1~100자, 내용은 1~2,000자로 입력해 주세요." });
  }
  try {
    const request = (req.user.isAiPlayer || req.aiScoped)
      ? await require("../services/AiSuggestionService").create(
          req,
          title.trim(),
          description.trim(),
        )
      : await Request.create({
          authorUserId: req.user._id,
          authorName: req.user.username,
          authorType: "human",
          title: title.trim(),
          description: description.trim(),
        });
    res
      .status(201)
      .json({
        request: {
          _id: request._id,
          authorName: request.authorName,
          authorType: request.authorType,
          title: request.title,
          description: request.description,
          createdAt: request.createdAt,
        },
      });
  } catch (error) {
    if (error.code === "AI_SUGGESTION_COOLDOWN")
      res.setHeader("Retry-After", error.details.retryAfterSeconds);
    console.error("Improvement create failed:", error.code || error.name);
    throw error;
  }
});

router.patch("/:id/review", adminMiddleware, async (req, res) => {
  if (!validId(req.params.id))
    return res.status(400).json({ error: "요청 번호가 올바르지 않습니다." });
  const { decision, reviewNote } = req.body || {};
  if (
    !["implemented", "partial", "rejected"].includes(decision) ||
    typeof reviewNote !== "string" ||
    !reviewNote.trim() ||
    reviewNote.trim().length > 2000
  )
    return res
      .status(400)
      .json({ error: "처리 결과와 1~2,000자의 처리 설명을 입력해 주세요." });
  try {
    const request = await Request.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          reviewStatus: "reviewed",
          decision,
          reviewNote: reviewNote.trim(),
          reviewedAt: new Date(),
          reviewedBy: req.user._id,
          reviewerName: req.user.username,
        },
      },
      { returnDocument: "after", runValidators: true },
    ).select(
      "authorName authorType title description createdAt reviewStatus decision reviewNote reviewedAt reviewerName",
    );
    if (!request)
      return res.status(404).json({ error: "존재하지 않는 요청입니다." });
    res.json({ request });
  } catch (error) {
    throw error;
  }
});

router.delete("/:id", adminMiddleware, async (req, res) => {
  if (!validId(req.params.id))
    return res.status(400).json({ error: "요청 번호가 올바르지 않습니다." });
  try {
    const deleted = await Request.findByIdAndDelete(req.params.id);
    if (!deleted)
      return res
        .status(404)
        .json({ error: "이미 삭제되었거나 존재하지 않는 요청입니다." });
    res.json({ deleted: true });
  } catch (error) {
    console.error("Improvement delete failed:", error.message);
    throw error;
  }
});
router.use(errorHandler);
module.exports = router;
