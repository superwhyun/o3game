const mongoose = require("mongoose");
const coordinates = { galaxy: Number, system: Number, planet: Number };
const schema = new mongoose.Schema({
  movementId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
  },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
  attackerName: String,
  originPlanetId: mongoose.Schema.Types.ObjectId,
  origin: coordinates,
  destination: coordinates,
  observedAt: { type: Date, required: true },
  targetPlanetId: mongoose.Schema.Types.ObjectId,
  targetUserId: mongoose.Schema.Types.ObjectId,
  targetName: String,
  targetCommander: String,
  outcome: {
    type: String,
    enum: ["empty", "occupied", "friendly", "unavailable"],
    required: true,
  },
  informationTier: { type: Number, default: 0 },
  sections: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  detected: { type: Boolean, default: false },
  intercepted: { type: Boolean, default: false },
  initialProbeCount: Number,
  survivorCount: Number,
  rulesVersion: { type: Number, default: 1 },
});
schema.index({ ownerUserId: 1, observedAt: -1, _id: -1 });
schema.index({
  ownerUserId: 1,
  "destination.galaxy": 1,
  "destination.system": 1,
  "destination.planet": 1,
  observedAt: -1,
  _id: -1,
});
schema.index({ targetUserId: 1, detected: 1, observedAt: -1, _id: -1 });
module.exports = mongoose.model("ScoutReport", schema);
