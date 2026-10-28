const mongoose = require('mongoose');

/** One row per applied battle: a fleet movement can hit a monster only once. */
const monsterBattleLogSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, required: true },
  movementId: { type: mongoose.Schema.Types.ObjectId, required: true },
  damage: { type: Number, default: 0 },
  at: { type: Date, default: Date.now }
});
monsterBattleLogSchema.index({ eventId: 1, movementId: 1 }, { unique: true });

module.exports = mongoose.model('MonsterBattleLog', monsterBattleLogSchema);
