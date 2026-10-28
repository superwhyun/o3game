const crypto = require("node:crypto");
const Player = require("../models/AiPlayer");
const Request = require("../models/ImprovementRequest");
const { apiError } = require("../utils/apiErrors");
const { atomic, requireTransactions } = require("./transactions");
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
function nextAllowedAt(player) {
  return player.lastSuggestionAt
    ? new Date(+player.lastSuggestionAt + COOLDOWN_MS)
    : null;
}
async function context(player) {
  const nextAt = nextAllowedAt(player);
  return {
    enabled: player.proposeImprovements !== false,
    allowed:
      player.proposeImprovements !== false &&
      (!nextAt || +nextAt <= Date.now()),
    nextAllowedAt: nextAt,
    recentRequests: await Request.find({
      createdAt: { $gte: new Date(Date.now() - HISTORY_MS) },
    })
      .sort({ _id: -1 })
      .limit(30)
      .select("title reviewStatus decision")
      .lean(),
    previousRun: {
      action: player.lastAction,
      reason: player.lastReason,
      errorCode: player.lastErrorCode,
      suggestionErrorCode: player.lastSuggestionErrorCode,
    },
  };
}
async function create(req, title, description) {
  await requireTransactions();
  return atomic(async () => {
    // Recheck the scoped game token after taking the transaction snapshot.
    await require("../middleware/admin").authenticateUser(req);
    await require("../models/SystemLock").findOneAndUpdate(
      { _id: "ai-suggestions" },
      { $inc: { revision: 1 } },
      { upsert: true },
    );
    const player = await Player.findOne({
      userId: req.user._id,
      enabled: true,
    });
    if (!player || player.proposeImprovements === false)
      throw apiError(
        403,
        "AI_SUGGESTIONS_DISABLED",
        "AI 개선 제안이 중지되어 있습니다.",
      );
    const nextAt = nextAllowedAt(player);
    if (nextAt && +nextAt > Date.now())
      throw apiError(
        429,
        "AI_SUGGESTION_COOLDOWN",
        "AI 개선 제안은 봇마다 6시간에 한 번 등록할 수 있습니다.",
        {
          retryAfterSeconds: Math.ceil((+nextAt - Date.now()) / 1000),
          nextAllowedAt: nextAt.toISOString(),
        },
      );
    const normalized = title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (!normalized)
      throw apiError(
        400,
        "INVALID_REQUEST",
        "개선 제안 제목에 내용을 입력해 주세요.",
      );
    const suggestionKey = crypto
      .createHash("sha256")
      .update(normalized)
      .digest("hex");
    if (
      await Request.exists({
        authorType: "ai",
        suggestionKey,
        createdAt: { $gte: new Date(Date.now() - HISTORY_MS) },
      })
    )
      throw apiError(
        409,
        "AI_SUGGESTION_DUPLICATE",
        "최근 30일 안에 같은 AI 개선 제안이 등록되었습니다.",
      );
    const request = await Request.create({
      authorUserId: req.user._id,
      authorName: req.user.username,
      authorType: "ai",
      title,
      description,
      suggestionKey,
    });
    await Player.updateOne(
      { _id: player._id },
      {
        $set: { lastSuggestionAt: new Date(), lastSuggestionErrorCode: "" },
        $inc: { suggestions: 1 },
      },
    );
    return request;
  });
}
module.exports = { context, create, COOLDOWN_MS };
