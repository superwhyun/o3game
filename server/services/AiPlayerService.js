const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Player = require("../models/AiPlayer");
const Model = require("../models/AiModel");
const Worker = require("../models/AiWorkerStatus");
const { atomic, requireTransactions } = require("./transactions");
const { getJwtSecret } = require("../utils/authToken");
const { apiError } = require("../utils/apiErrors");
const strategyScores = (strategy) =>
  ({
    economy: { development: 70, expansion: 20, attack: 10 },
    expansion: { development: 20, expansion: 70, attack: 10 },
    military: { development: 20, expansion: 20, attack: 60 },
  })[strategy] || { development: 40, expansion: 40, attack: 20 };
function clean(input = {}, old = {}) {
  const row = {
    modelId: input.modelId ?? old.modelId,
    strategy: input.strategy ?? old.strategy ?? "balanced",
    enabled: input.enabled ?? old.enabled ?? true,
    allowAttacks: input.allowAttacks ?? old.allowAttacks ?? false,
    proposeImprovements:
      input.proposeImprovements ?? old.proposeImprovements ?? true,
    maxColonies: input.maxColonies ?? old.maxColonies ?? 3,
    intervalSeconds: input.intervalSeconds ?? old.intervalSeconds ?? 180,
  };
  if (
    input.behaviorScores !== undefined &&
    (!input.behaviorScores ||
      typeof input.behaviorScores !== "object" ||
      input.behaviorScores.development == null)
  )
    throw apiError(
      400,
      "INVALID_REQUEST",
      "개발·확장·공격 점수를 모두 입력해 주세요.",
    );
  const suppliedScores = input.behaviorScores ?? old.behaviorScores;
  row.behaviorScores =
    suppliedScores?.development != null
      ? {
          development: suppliedScores.development,
          expansion: suppliedScores.expansion,
          attack: suppliedScores.attack,
        }
      : strategyScores(row.strategy);
  if (
    !Object.values(row.behaviorScores).every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 100,
    ) ||
    Object.values(row.behaviorScores).reduce((sum, n) => sum + n, 0) !== 100
  )
    throw apiError(
      400,
      "INVALID_REQUEST",
      "개발·확장·공격 점수는 0~100 정수이며 합계가 100이어야 합니다.",
    );
  if (typeof row.modelId !== "string" && !row.modelId?.toHexString)
    throw apiError(400, "INVALID_ID", "사용할 AI 모델을 선택해 주세요.");
  if (
    !require("mongoose").isValidObjectId(row.modelId) ||
    !["balanced", "economy", "expansion", "military"].includes(row.strategy) ||
    typeof row.enabled !== "boolean" ||
    typeof row.allowAttacks !== "boolean" ||
    typeof row.proposeImprovements !== "boolean" ||
    !Number.isInteger(row.maxColonies) ||
    row.maxColonies < 1 ||
    row.maxColonies > 9 ||
    !Number.isInteger(row.intervalSeconds) ||
    row.intervalSeconds < 15 ||
    row.intervalSeconds > 3600
  )
    throw apiError(400, "INVALID_REQUEST", "AI 플레이어 설정을 확인해 주세요.");
  return row;
}
async function assertModel(row, lock = false) {
  const model = await Model.findById(row.modelId);
  if (!model) throw apiError(404, "NOT_FOUND", "AI 모델을 찾을 수 없습니다.");
  if (row.enabled && !model.enabled)
    throw apiError(409, "AI_MODEL_DISABLED", "활성 모델을 선택해 주세요.");
  if (lock) await Model.updateOne({ _id: model._id }, { $inc: { __v: 1 } });
}
function validateCreationInput(input) {
  if (
    typeof input.username !== "string" ||
    !input.username.trim() ||
    input.username.length > 60 ||
    /[\u0000-\u001f\u007f]/.test(input.username)
  )
    throw apiError(
      400,
      "INVALID_REQUEST",
      "AI 플레이어 이름은 1~60자로 입력해 주세요.",
    );
  if (
    input.randomPlacement !== undefined &&
    typeof input.randomPlacement !== "boolean"
  )
    throw apiError(400, "INVALID_REQUEST", "무작위 배치 설정을 확인해 주세요.");
}
async function create(input = {}, actor) {
  if (
    input.galaxy !== undefined &&
    (!Number.isSafeInteger(input.galaxy) ||
      input.galaxy < 1 ||
      input.galaxy > require("../utils/universe").GALAXY_COUNT)
  )
    throw apiError(
      400,
      "INVALID_REQUEST",
      "배치 은하는 1~9 사이의 정수로 선택해 주세요.",
    );
  validateCreationInput(input);
  const defaultModel =
    input.modelId === undefined
      ? await Model.findOne({ isDefault: true, enabled: true })
      : null;
  const config = clean({
    ...input,
    ...(defaultModel ? { modelId: String(defaultModel._id) } : {}),
  });
  await assertModel(config);
  await requireTransactions();
  return atomic(async () => {
    await assertModel(config, true);
    const user = await User.createWithHomePlanet(
      {
        username: input.username.trim(),
        email: `ai-${crypto.randomUUID()}@players.invalid`,
        password: crypto.randomBytes(32).toString("hex"),
        isAiPlayer: true,
      },
      { galaxy: input.galaxy, randomized: input.randomPlacement !== false },
    );
    const player = await Player.create({
      userId: user._id,
      ...config,
      createdBy: actor,
    });
    return { player: await publicPlayer(player) };
  });
}
async function createBatch(input, actor) {
  validateCreationInput(input);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 50)
    throw apiError(
      400,
      "INVALID_REQUEST",
      "추가 봇 수는 1~50으로 입력해 주세요.",
    );
  await requireTransactions();
  return atomic(async () => {
    const players = [];
    for (let index = 0; index < input.count; index++) {
      const username =
        input.count === 1
          ? input.username
          : `${input.username.trim().slice(0, 42)}-${index + 1}-${crypto.randomBytes(3).toString("hex")}`;
      const result = await create(
        { ...input, username, maxColonies: input.maxColonies ?? 9 },
        actor,
      );
      players.push(result.player);
    }
    return {
      players,
      created: players.length,
      ...(players.length === 1 ? { player: players[0] } : {}),
    };
  });
}
async function publicPlayer(player) {
  const user = await User.findById(player.userId).select(
    "username isBanned planets._id planets.name planets.galaxy planets.system planets.planet",
  );
  return {
    id: String(player._id),
    kind: player.kind || "bot",
    userId: String(player.userId),
    username: user?.username || "삭제된 계정",
    isBanned: !!user?.isBanned,
    modelId: String(player.modelId),
    strategy: player.strategy,
    behaviorScores:
      player.behaviorScores?.development != null
        ? player.behaviorScores
        : strategyScores(player.strategy),
    enabled: player.enabled,
    allowAttacks: player.allowAttacks,
    proposeImprovements: player.proposeImprovements !== false,
    suggestions: player.suggestions || 0,
    lastSuggestionAt: player.lastSuggestionAt,
    lastSuggestionErrorCode: player.lastSuggestionErrorCode,
    maxColonies: player.maxColonies,
    intervalSeconds: player.intervalSeconds,
    planets: user?.planets || [],
    lastRunAt: player.lastRunAt,
    nextRunAt: player.nextRunAt,
    lastAction: player.lastAction,
    lastReason: player.lastReason,
    lastErrorCode: player.lastErrorCode,
    history: [...(player.history || [])].reverse(),
    runs: player.runs,
    actions: player.actions,
    running: !!player.lease?.runId && +player.lease.until > Date.now(),
  };
}
async function update(id, input) {
  await requireTransactions();
  return atomic(async () => {
    const player = await Player.findById(id);
    if (!player)
      throw apiError(404, "NOT_FOUND", "AI 플레이어를 찾을 수 없습니다.");
    const row = clean(input, player);
    await assertModel(row, true);
    const updated = await Player.findByIdAndUpdate(
      id,
      { $set: { ...row, nextRunAt: new Date(), lease: {}, lastErrorCode: "" } },
      { new: true },
    );
    return { player: await publicPlayer(updated) };
  });
}
async function list() {
  const rows = await Player.find().sort({ createdAt: -1 });
  const worker = await Worker.findById("worker");
  return {
    players: await Promise.all(rows.map(publicPlayer)),
    worker: {
      configured: (process.env.AI_WORKER_SECRET?.length || 0) >= 32,
      lastSeenAt: worker?.lastSeenAt,
      connected: !!worker && Date.now() - worker.lastSeenAt < 30000,
    },
  };
}
async function claim(workerId) {
  await Worker.findOneAndUpdate(
    { _id: "worker" },
    { $set: { workerId, lastSeenAt: new Date() } },
    { upsert: true },
  );
  const now = new Date(),
    runId = crypto.randomUUID();
  const player = await Player.findOneAndUpdate(
    {
      enabled: true,
      nextRunAt: { $lte: now },
      $or: [
        { "lease.until": { $lte: now } },
        { "lease.until": { $exists: false } },
      ],
    },
    { $set: { lease: { workerId, runId, until: new Date(+now + 120000) } } },
    { sort: { nextRunAt: 1 }, new: true },
  );
  if (!player) return { job: null };
  const user = await User.findById(player.userId).select(
    "username isBanned isAiPlayer tokenVersion",
  );
  if (
    !user ||
    user.isBanned ||
    (!user.isAiPlayer && player.kind !== "delegate")
  ) {
    await Player.updateOne(
      { _id: player._id, "lease.runId": runId },
      { $set: { enabled: false, lease: {}, lastErrorCode: "ACCOUNT_BANNED" } },
    );
    return { job: null };
  }
  return {
    job: {
      kind: player.kind || "bot",
      playerId: String(player._id),
      userId: String(user._id),
      username: user.username,
      runId,
      modelId: String(player.modelId),
      strategy: player.strategy,
      behaviorScores:
        player.behaviorScores?.development != null
          ? player.behaviorScores
          : strategyScores(player.strategy),
      runs: player.runs || 0,
      allowAttacks: player.allowAttacks,
      proposeImprovements: player.proposeImprovements !== false,
      suggestions: player.suggestions || 0,
      lastSuggestionAt: player.lastSuggestionAt,
      lastSuggestionErrorCode: player.lastSuggestionErrorCode,
      maxColonies: player.maxColonies,
      intervalSeconds: player.intervalSeconds,
      token: jwt.sign(
        {
          userId: String(user._id),
          tokenVersion: user.tokenVersion || 0,
          aiPlayerId: String(player._id),
          aiRunId: runId,
        },
        getJwtSecret(),
        { expiresIn: "2m" },
      ),
    },
  };
}
async function activeRun(id, runId) {
  const player = await Player.findOne({
    _id: id,
    enabled: true,
    "lease.runId": runId,
    "lease.until": { $gt: new Date() },
  });
  if (!player)
    throw apiError(
      409,
      "AI_RUN_EXPIRED",
      "AI 실행이 중지되었거나 실행 시간이 만료되었습니다.",
    );
  return player;
}
async function complete(id, runId, result) {
  const player = await activeRun(id, runId);
  const row = await Player.findOneAndUpdate(
    { _id: id, "lease.runId": runId },
    {
      $set: {
        lease: {},
        lastRunAt: new Date(),
        nextRunAt: new Date(
          Date.now() +
            ((result.acted || result.recheck) && !result.errorCode
              ? 250
              : Math.max(120, player.intervalSeconds) * 1000),
        ),
        lastAction: result.action || "wait",
        lastReason: result.reason || "",
        lastErrorCode: result.errorCode || "",
        lastSuggestionErrorCode: result.suggestionErrorCode || "",
      },
      $inc: { runs: 1, actions: result.acted ? 1 : 0 },
      $push: {
        history: {
          $each: [
            {
              runId,
              at: new Date(),
              acted: result.acted,
              recheck: !!result.recheck,
              action: result.action || "wait",
              reason: result.reason || "",
              errorCode: result.errorCode || "",
              suggestionSubmitted: !!result.suggestionSubmitted,
              suggestionErrorCode: result.suggestionErrorCode || "",
            },
          ],
          $slice: -50,
        },
      },
    },
    { new: true },
  );
  if (!row)
    throw apiError(409, "AI_RUN_EXPIRED", "실행 상태가 변경되었습니다.");
  return { completed: true };
}
module.exports = {
  create,
  createBatch,
  update,
  list,
  claim,
  activeRun,
  complete,
  clean,
  publicPlayer,
};
