const mongoose = require('mongoose');

/** One use of stored speed-up time. {userId, requestId} makes repeated requests idempotent. */
const speedupUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestId: { type: String, required: true },
  queueId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, required: true },
  itemId: { type: String, required: true },
  requestedSeconds: { type: Number, required: true },
  usedSeconds: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
speedupUsageSchema.index({ userId: 1, requestId: 1 }, { unique: true });
speedupUsageSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SpeedupUsage', speedupUsageSchema);
