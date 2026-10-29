const mongoose = require('mongoose');

const coordinate = { galaxy: Number, system: Number, planet: Number };

/**
 * One scheduled monster appearance. SCHEDULED -> ACTIVE (standing on a free planet
 * slot, moving every `moveEveryHours`) -> DEFEATED/SETTLING/SETTLED, or EXPIRED /
 * CANCELLED with no reward. `version` serializes concurrent battles and moves.
 */
const monsterEventSchema = new mongoose.Schema({
  name: { type: String, required: true },
  typeId: { type: String, required: true },
  typeSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  status: { type: String, enum: ['SCHEDULED', 'ACTIVE', 'DEFEATED', 'SETTLING', 'SETTLED', 'EXPIRED', 'CANCELLED'], default: 'SCHEDULED' },
  poolMicro: { type: String, default: '0' },
  moveEveryHours: { type: Number, default: 72, min: 1 },
  maxDistance: { type: Number, default: 20, min: 1 },
  location: { type: coordinate, default: null },
  locationKey: { type: String, default: null },
  moveCount: { type: Number, default: 0 },
  nextMoveAt: { type: Date, default: null },
  retryAt: { type: Date, default: null },
  locationHistory: { type: [{ ...coordinate, at: Date }], default: () => [] },
  state: { type: mongoose.Schema.Types.Mixed, default: null },
  maxHull: { type: Number, default: 0 },
  version: { type: Number, default: 0 },
  defeatedAt: { type: Date, default: null },
  settledAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { minimize: false });
monsterEventSchema.index({ status: 1, startsAt: 1 });
// Two active monsters never share a slot.
monsterEventSchema.index({ locationKey: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE', locationKey: { $type: 'string' } } });

module.exports = mongoose.model('MonsterEvent', monsterEventSchema);
