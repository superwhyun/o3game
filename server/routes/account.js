const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Player = require("../models/AiPlayer");
const Model = require("../models/AiModel");
const Worker = require("../models/AiWorkerStatus");
const players = require("../services/AiPlayerService");
const { authMiddleware } = require("../middleware/admin");
const { apiContext, apiError, errorHandler } = require("../utils/apiErrors");
const {
  atomic,
  requireTransactions,
  afterCommit,
} = require("../services/transactions");
const { getJwtSecret } = require("../utils/authToken");
const router = express.Router();
router.use(
  apiContext,
  require("../middleware/apiValidation").apiValidation("/api/account"),
  authMiddleware,
);
router.use((req, res, next) => {
  if (req.aiScoped || req.user.isAiPlayer)
    throw apiError(
      403,
      "FORBIDDEN",
      "계정 설정은 사용자가 직접 관리해야 합니다.",
    );
  next();
});
const account = (user) => ({
  id: String(user._id),
  username: user.username,
  email: user.email,
  preferences: { uiMode: user.preferences?.uiMode || "detailed" },
});
async function verifiedUser(req) {
  const user = await User.findById(req.user._id);
  if (!user) throw apiError(404, "NOT_FOUND", "사용자를 찾을 수 없습니다.");
  const password = req.body?.currentPassword;
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    !(await user.comparePassword(password))
  )
    throw apiError(
      401,
      "AUTH_INVALID_CREDENTIALS",
      "현재 비밀번호가 일치하지 않습니다.",
    );
  return user;
}
router.get("/settings", async (req, res) => {
  const profile = await Player.findOne({
    userId: req.user._id,
    kind: "delegate",
  });
  const worker = await Worker.findById("worker");
  res.json({
    account: account(req.user),
    delegation: profile ? await players.publicPlayer(profile) : null,
    worker: {
      configured: (process.env.AI_WORKER_SECRET?.length || 0) >= 32,
      connected: !!worker && Date.now() - worker.lastSeenAt < 30000,
    },
  });
});
router.patch("/settings", async (req, res) => {
  if (!["simple", "detailed", "graphics"].includes(req.body?.uiMode))
    throw apiError(400, "INVALID_REQUEST", "화면 모드를 선택해 주세요.");
  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: { "preferences.uiMode": req.body.uiMode },
      $inc: { __v: 1, stateRevision: 1 },
    },
    { returnDocument: "after" },
  );
  res.json({ account: account(user) });
});
router.patch("/email", async (req, res) => {
  const email = req.body?.email;
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw apiError(400, "INVALID_REQUEST", "올바른 이메일을 입력해 주세요.");
  await requireTransactions();
  const result = await atomic(async () => {
    const user = await verifiedUser(req);
    const normalized = email.toLowerCase();
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      await User.exists({
        _id: { $ne: user._id },
        email: new RegExp(`^${escaped}$`, "i"),
      })
    )
      throw apiError(409, "ACCOUNT_EXISTS", "이미 사용 중인 이메일입니다.");
    user.email = normalized;
    await user.save();
    return account(user);
  });
  res.json({ account: result });
});
router.post("/password", async (req, res) => {
  const password = req.body?.newPassword;
  if (
    typeof password !== "string" ||
    password.length < 6 ||
    password.length > 128 ||
    Buffer.byteLength(password, "utf8") > 72
  )
    throw apiError(
      400,
      "INVALID_REQUEST",
      "새 비밀번호는 6자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요.",
    );
  await requireTransactions();
  const result = await atomic(async () => {
    const user = await verifiedUser(req);
    user.password = password;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await Player.updateOne(
      { userId: user._id, kind: "delegate" },
      { $set: { enabled: false, lease: {} } },
    );
    afterCommit(() =>
      req.app.get("io")?.in?.(`user:${user._id}`)?.disconnectSockets?.(true),
    );
    return {
      account: account(user),
      token: jwt.sign(
        { userId: String(user._id), tokenVersion: user.tokenVersion },
        getJwtSecret(),
        { expiresIn: "7d" },
      ),
    };
  });
  res.json(result);
});
router.get("/ai-models", async (req, res) => {
  const models = await Model.find({ enabled: true })
    .select("name provider model isDefault")
    .sort({ isDefault: -1, name: 1 })
    .lean();
  res.json({
    models: models.map((m) => ({
      id: String(m._id),
      name: m.name,
      provider: m.provider,
      model: m.model,
      isDefault: !!m.isDefault,
    })),
  });
});
router.patch("/delegation", async (req, res) => {
  await requireTransactions();
  const result = await atomic(async () => {
    const old = await Player.findOne({ userId: req.user._id });
    if (old && old.kind !== "delegate")
      throw apiError(
        403,
        "FORBIDDEN",
        "봇 계정은 사용자 대리로 전환할 수 없습니다.",
      );
    if (req.body?.enabled === false && Object.keys(req.body).length === 1) {
      if (old) {
        old.enabled = false;
        old.lease = {};
        await old.save();
      }
      return old ? await players.publicPlayer(old) : null;
    }
    const defaultModel = await Model.findOne({
      enabled: true,
      isDefault: true,
    });
    const row = players.clean(
      {
        modelId: req.body?.modelId || old?.modelId || defaultModel?._id,
        enabled: req.body?.enabled ?? old?.enabled ?? false,
        strategy: req.body?.strategy,
        intervalSeconds: req.body?.intervalSeconds,
        maxColonies: req.body?.maxColonies,
        allowAttacks: req.body?.allowAttacks,
        proposeImprovements: req.body?.proposeImprovements ?? old?.proposeImprovements ?? true,
      },
      old || {},
    );
    if (row.enabled && (process.env.AI_WORKER_SECRET?.length || 0) < 32)
      throw apiError(
        503,
        "AI_WORKER_NOT_CONFIGURED",
        "관리자에게 AI 실행 프로그램 설정을 요청해 주세요.",
      );
    const model = await Model.findById(row.modelId);
    if (!model)
      throw apiError(404, "NOT_FOUND", "등록된 모델을 선택해 주세요.");
    if (!model.enabled)
      throw apiError(409, "AI_MODEL_DISABLED", "사용 중지된 모델입니다.");
    await Model.updateOne({ _id: model._id }, { $inc: { __v: 1 } });
    const profile = await Player.findOneAndUpdate(
      { userId: req.user._id },
      {
        $set: {
          ...row,
          kind: "delegate",
          createdBy: req.user._id,
          nextRunAt: new Date(),
          lease: {},
          lastErrorCode: "",
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );
    return players.publicPlayer(profile);
  });
  res.json({ delegation: result });
});
router.use(errorHandler);
module.exports = router;
