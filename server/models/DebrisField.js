const mongoose = require('mongoose');

/** Wreckage left at a coordinate after battles. Anyone with recyclers can collect it. */
const debrisFieldSchema = new mongoose.Schema({
  coordinateKey: { type: String, required: true, unique: true },
  galaxy: { type: Number, required: true },
  system: { type: Number, required: true },
  planet: { type: Number, required: true },
  metal: { type: Number, default: 0, min: 0 },
  crystal: { type: Number, default: 0, min: 0 },
  updatedAt: { type: Date, default: Date.now }
});
debrisFieldSchema.index({ galaxy: 1, system: 1 });

module.exports = mongoose.model('DebrisField', debrisFieldSchema);
