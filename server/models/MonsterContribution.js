const mongoose = require('mongoose');

/** What one commander dealt to a monster. Only damage dealt with a linked wallet counts for CGC. */
const monsterContributionSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'MonsterEvent', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  damageTotal: { type: Number, default: 0 },
  damageEligible: { type: Number, default: 0 },
  attacks: { type: Number, default: 0 },
  shipsLost: { type: Number, default: 0 },
  rewardMicro: { type: String, default: '0' },
  lastAt: { type: Date, default: Date.now }
});
monsterContributionSchema.index({ eventId: 1, userId: 1 }, { unique: true });
monsterContributionSchema.index({ eventId: 1, damageTotal: -1 });

module.exports = mongoose.model('MonsterContribution', monsterContributionSchema);
