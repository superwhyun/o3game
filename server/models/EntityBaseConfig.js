const mongoose = require('mongoose');

const resourceCostSchema = new mongoose.Schema({
  metal: { type: Number, default: 0 },
  crystal: { type: Number, default: 0 },
  deuterium: { type: Number, default: 0 }
}, { _id: false });

const tierMultiplierSchema = new mongoose.Schema({
  startLevel: { type: Number, required: true },
  endLevel: { type: Number, required: true },
  costMult: { type: Number, default: null },
  timeMult: { type: Number, default: null }
}, { _id: false });

const entityBaseConfigSchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['building', 'ship', 'research'],
    required: true
  },
  entityId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'disabled', 'draft'],
    default: 'active'
  },
  schemaVersion: {
    type: Number,
    default: 2
  },
  revision: {
    type: Number,
    default: 1
  },
  display: {
    name: { type: String, default: '' },
    icon: { type: String, default: '' },
    category: { type: String, default: '' },
    description: { type: String, default: '' }
  },
  requirements: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  costModel: {
    baseCost: { type: resourceCostSchema, default: () => ({}) },
    costMultiplier: { type: Number, default: null },
    scalingMode: { type: String, default: 'exponential' },
    tierMultipliers: { type: [tierMultiplierSchema], default: [] }
  },
  timeModel: {
    baseTime: { type: Number, default: null },
    timeMultiplier: { type: Number, default: null },
    scalingMode: { type: String, default: 'exponential' },
    tierMultipliers: { type: [tierMultiplierSchema], default: [] }
  },
  effects: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  stats: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, {
  minimize: false
});

entityBaseConfigSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
entityBaseConfigSchema.index({ status: 1, entityType: 1 });

module.exports = mongoose.model('EntityBaseConfig', entityBaseConfigSchema);
