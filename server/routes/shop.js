const express = require('express');
const { authMiddleware } = require('../middleware/admin');
const shop = require('../services/ShopService');

const router = express.Router();

function route(handler) {
  return async (req, res) => {
    try { res.json(await handler(req)); }
    catch (error) {
      const status = error.statusCode || (error.name === 'MongoServerError' ? 503 : 500);
      res.status(status).json({ error: error.statusCode ? error.message : '요청을 처리하지 못했습니다.', code: error.code || 'REQUEST_FAILED' });
    }
  };
}

router.use(authMiddleware);
router.get('/catalog', route((req) => shop.catalog(req.user._id)));
router.get('/orders', route(async (req) => ({ orders: await shop.listOrders(req.user._id) })));
router.post('/orders', route(async (req) => ({ order: shop.orderView(await shop.createOrder(req.user._id, { sku: req.body?.sku, quantity: req.body?.quantity ?? 1, requestId: req.body?.requestId })) })));
router.get('/orders/:orderId', route((req) => shop.getOrder(req.user._id, req.params.orderId)));
router.post('/orders/:orderId/authorizations', route(async (req) => ({ order: await shop.relayAuthorization(req.user._id, req.params.orderId, req.body || {}) })));

module.exports = router;
