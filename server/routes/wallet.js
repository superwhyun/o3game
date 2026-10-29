const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/admin');
const wallet = require('../services/WalletService');
const metanomic = require('../services/MetanomicClient');

const router = express.Router();
const challengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' }
});

function route(handler) {
  return async (req, res) => {
    try { res.json(await handler(req)); }
    catch (error) {
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Request failed', code: error.code || 'REQUEST_FAILED' });
    }
  };
}

router.use(authMiddleware);
router.get('/', route((req) => wallet.status(req.user._id)));
router.post('/challenge', challengeLimiter, route((req) => {
  metanomic.getClient();
  return wallet.createChallenge(req.user._id, req.body?.address);
}));
router.post('/link', route((req) => wallet.link(req.user._id, req.body?.challengeId, req.body?.signature)));

module.exports = router;
