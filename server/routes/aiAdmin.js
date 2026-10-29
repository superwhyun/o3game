const express = require("express");
const { apiContext, errorHandler, apiError } = require("../utils/apiErrors");
const {
  adminMiddleware,
  superAdminMiddleware,
} = require("../middleware/admin");
const Model = require("../models/AiModel");
const Player = require("../models/AiPlayer");
const models = require("../services/AiModelService");
const players = require("../services/AiPlayerService");
const router = express.Router();
router.use(
  apiContext,
  require("../middleware/apiValidation").apiValidation("/api/admin"),
);
router.get("/ai-models", adminMiddleware, async (req, res) =>
  res.json({
    models: (
      await Model.find().select("+apiKeyCipher").sort({ createdAt: -1 })
    ).map(models.publicModel),
  }),
);
router.post("/ai-models", superAdminMiddleware, async (req, res) =>
  res
    .status(201)
    .json({ model: await models.save(null, req.body, req.user._id) }),
);
router.put("/ai-models/:id", superAdminMiddleware, async (req, res) =>
  res.json({ model: await models.save(req.params.id, req.body, req.user._id) }),
);
router.delete("/ai-models/:id", superAdminMiddleware, async (req, res) => {
  await require("../services/transactions").requireTransactions();
  await require("../services/transactions").atomic(async () => {
    const model = await Model.findByIdAndDelete(req.params.id);
    if (!model) throw apiError(404, "NOT_FOUND", "AI 모델을 찾을 수 없습니다.");
    if (await Player.exists({ modelId: req.params.id }))
      throw apiError(
        409,
        "AI_MODEL_IN_USE",
        "플레이어가 사용 중인 모델은 삭제할 수 없습니다.",
      );
  });
  res.json({ deleted: true });
});
router.post("/ai-models/:id/test", superAdminMiddleware, async (req, res) => {
  const result = await models.completion(
    req.params.id,
    [{ role: "user", content: "Reply with OK only." }],
    { maxTokens: 128 },
  );
  res.json({
    connected: true,
    model: result.model,
    reply: result.content.slice(0, 200),
  });
});
router.get("/ai-players", adminMiddleware, async (req, res) =>
  res.json(await players.list()),
);
router.post("/ai-players", superAdminMiddleware, async (req, res) =>
  res
    .status(201)
    .json(
      await (req.body.count !== undefined
        ? players.createBatch(req.body, req.user._id)
        : players.create(req.body, req.user._id)),
    ),
);
router.patch("/ai-players/:id", superAdminMiddleware, async (req, res) =>
  res.json(await players.update(req.params.id, req.body)),
);
router.use(errorHandler);
module.exports = router;
