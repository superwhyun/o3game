const User = require("../models/User");
const { verifyUserToken } = require("../utils/authToken");
const { apiError, sendError } = require("../utils/apiErrors");
async function authenticateUser(req) {
  const header = req.headers.authorization;
  if (!header) throw apiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
  if (typeof header !== "string" || !/^Bearer [^\s]+$/i.test(header))
    throw apiError(
      401,
      "AUTH_INVALID_TOKEN",
      "Bearer 토큰 형식이 올바르지 않습니다.",
    );
  const decoded = verifyUserToken(header.split(" ")[1]);
  if (
    typeof decoded?.userId !== "string" ||
    !/^[a-fA-F0-9]{24}$/.test(decoded.userId)
  )
    throw apiError(
      401,
      "AUTH_INVALID_TOKEN",
      "유효하지 않은 로그인 토큰입니다.",
    );
  const user = await User.findById(decoded.userId);
  if (!user || user.isPirate)
    throw apiError(
      401,
      "AUTH_INVALID_TOKEN",
      "유효하지 않은 로그인 토큰입니다.",
    );
  if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) throw apiError(401, 'AUTH_INVALID_TOKEN', '계정 보안 정보가 변경되었습니다. 다시 로그인해 주세요.');
  req.aiScoped = !!decoded.aiPlayerId || !!decoded.aiRunId;
  if (user.isBanned)
    throw apiError(403, "ACCOUNT_BANNED", "정지된 계정입니다.");
  if (user.isAiPlayer || req.aiScoped) {
    if (
      !require("mongoose").isValidObjectId(decoded.aiPlayerId) ||
      typeof decoded.aiRunId !== "string" ||
      !(await require("../models/AiPlayer").exists({
        _id: decoded.aiPlayerId,
        userId: user._id,
        enabled: true,
        "lease.runId": decoded.aiRunId,
        "lease.until": { $gt: new Date() },
      }))
    )
      throw apiError(
        403,
        "AI_PLAYER_INACTIVE",
        "AI 플레이어 실행이 중지되었거나 만료되었습니다.",
      );
  }
  if (req.aiScoped && req.method) {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const read = req.method === 'GET' && ['/api/auth/me', '/api/game/catalog', '/api/game/galaxy', '/api/game/scout-reports'].includes(path);
    const mutation = ['POST', 'PATCH'].includes(req.method) && (/^\/api\/queue\/(planet|build|research|ship)$/.test(path) || /^\/api\/game\/(scouts|fleets|fleet-formations(?:\/[a-f0-9]{24})?)$/i.test(path) || path === '/api/game/improvement-requests');
    const botCancellation = user.isAiPlayer && req.method === 'DELETE' && /^\/api\/queue\/[a-f0-9]{24}$/i.test(path);
    if (!read && !mutation && !botCancellation) throw apiError(403, 'FORBIDDEN', 'AI 대리에게 허용되지 않은 기능입니다.');
    if (path === '/api/game/fleets' && req.body?.mission === 'attack') {
      const profile = await require('../models/AiPlayer').findById(decoded.aiPlayerId).select('allowAttacks');
      if (!profile?.allowAttacks) throw apiError(403, 'FORBIDDEN', 'AI 공격이 허용되지 않았습니다.');
    }
  }
  return user;
}
function authorize(role) {
  return async (req, res, next) => {
    try {
      req.user = await authenticateUser(req);
      if (
        role &&
        (req.aiScoped || req.user.isAiPlayer ||
          !req.user.isAdmin ||
          (role === "superadmin" && req.user.adminRole !== "superadmin"))
      )
        throw apiError(403, "FORBIDDEN", "이 작업을 실행할 권한이 없습니다.");
      next();
    } catch (error) {
      sendError(req, res, error);
    }
  };
}
module.exports = {
  authMiddleware: authorize(),
  adminMiddleware: authorize("admin"),
  superAdminMiddleware: authorize("superadmin"),
  authenticateUser,
};
