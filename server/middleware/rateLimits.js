const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { verifyUserToken } = require('../utils/authToken');

function apiRateLimitKey(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const { userId } = verifyUserToken(token);
      if (typeof userId === 'string' && /^[a-fA-F0-9]{24}$/.test(userId)) return `user:${userId}`;
    } catch { /* Unauthenticated requests share the IP limit. */ }
  }
  return ipKeyGenerator(req.ip);
}

function createApiLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 120,
    keyGenerator: apiRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => require('../utils/apiErrors').sendError(req, res, require('../utils/apiErrors').apiError(429, 'RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'))
  });
}

module.exports = { apiRateLimitKey, createApiLimiter };
