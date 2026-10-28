const mongoose = require('mongoose');

/**
 * A CGC purchase. The Metanomic request body is stored before any network call so
 * retries after an unknown outcome send exactly the same content.
 *
 * status: CREATED (waiting for the player's signature) -> PROCESSING (signature relayed)
 *   -> PAID -> CLAIMED (Metanomic allows delivery) -> DELIVERED (rights granted)
 *   -> COMPLETED (Metanomic settled the sale). Terminal alternatives: EXPIRED,
 *   REFUNDED, FAILED.
 */
const cgcOrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestId: { type: String, required: true },
  payerWallet: { type: String, required: true, lowercase: true },
  sku: { type: String, required: true },
  kind: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPriceMicro: { type: String, required: true },
  totalMicro: { type: String, required: true },
  grants: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  paymentRequest: { type: mongoose.Schema.Types.Mixed, required: true },
  paymentId: { type: String, default: null },
  status: { type: String, enum: ['CREATED', 'PROCESSING', 'PAID', 'CLAIMED', 'DELIVERED', 'COMPLETED', 'EXPIRED', 'REFUNDED', 'FAILED'], default: 'CREATED' },
  paymentStatus: { type: String, default: '' },
  expiresAt: { type: Date, default: null },
  claimRequested: { type: Boolean, default: false },
  refundRequested: { type: Boolean, default: false },
  fulfillRequested: { type: Boolean, default: false },
  deliveredAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
cgcOrderSchema.index({ userId: 1, requestId: 1 }, { unique: true });
cgcOrderSchema.index({ paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } });
cgcOrderSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('CgcOrder', cgcOrderSchema);
