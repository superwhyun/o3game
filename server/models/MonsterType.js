const mongoose = require('mongoose');

/** Administrator-authored monster definition. Events copy it when created. */
const monsterTypeSchema = new mongoose.Schema({
  typeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  units: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
  techs: { type: mongoose.Schema.Types.Mixed, default: () => ({ weapons: 0, shield: 0, armor: 0 }) },
  regenPerHour: { type: Number, default: 0 },
  defaultPoolMicro: { type: String, default: '0' },
  model: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MonsterType', monsterTypeSchema);
