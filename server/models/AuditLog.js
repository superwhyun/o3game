const mongoose = require('mongoose');

/** Append-only record of privileged or money-relevant changes. */
const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
