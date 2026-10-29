const mongoose = require('mongoose');

/**
 * Outbox row for a CGC payout. Created inside the business transaction that
 * decided the payout; the poller delivers it to Metanomic exactly once.
 */
const cgcRewardSchema = new mongoose.Schema({
  rewardRef: { type: String, required: true, unique: true },
  kind: { type: String, required: true, index: true },
  refId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  wallet: { type: String, required: true, lowercase: true },
  amountMicro: { type: String, required: true, match: /^[1-9][0-9]*$/ },
  status: { type: String, enum: ['PENDING', 'SUBMITTED', 'COMPLETED', 'FAILED'], default: 'PENDING' },
  rewardId: { type: String, default: null },
  operationId: { type: String, default: null },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: () => new Date(0) },
  lastError: { type: String, default: '' },
  completedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
cgcRewardSchema.index({ status: 1, nextAttemptAt: 1 });
cgcRewardSchema.index({ kind: 1, refId: 1 });

module.exports = mongoose.model('CgcReward', cgcRewardSchema);
