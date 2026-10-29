const GameConfig = require("../models/GameConfig");
const { apiError } = require("../utils/apiErrors");
// Reads remain available; maintenance pauses user mutations, not admin recovery.
module.exports = async (req, res, next) => {
  try {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (await GameConfig.getConfig()).maintenanceMode
    )
      throw apiError(
        503,
        "MAINTENANCE_MODE",
        "서버 점검 중에는 게임 명령을 실행할 수 없습니다.",
      );
    next();
  } catch (error) {
    next(error);
  }
};
