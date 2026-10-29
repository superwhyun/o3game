const mongoose = require('mongoose');

const gameConfigSchema = new mongoose.Schema({
  // Server Settings
  serverName: { type: String, default: 'Cosmic Empire' },
  serverSpeed: { type: Number, default: 1 }, // 1 = normal, 2 = 2x, 5 = 5x, etc.
  areaSettings: {
    bonusUsableFields: { type: Number, default: 40, required: true, min: 0,
      validate: { validator: Number.isSafeInteger, message: '추가 가용면적은 0 이상의 정수여야 합니다.' } }
  },
  
  // Resource Settings
  resourceSettings: {
    baseProduction: {
      metal: { type: Number, default: 30 },
      crystal: { type: Number, default: 15 },
      deuterium: { type: Number, default: 0 }
    },
    defaultStorage: {
      metal: { type: Number, default: 10000 },
      crystal: { type: Number, default: 10000 },
      deuterium: { type: Number, default: 10000 }
    },
    cancellationRefundRate: { type: Number, default: 0.8 },
    productionMultiplier: { type: Number, default: 1 },
    storageMultiplier: { type: Number, default: 1 }
  },
  
  // Population economy coefficients; defaults are shared with the calculator.
  populationSettings: Object.fromEntries(Object.entries(require('../utils/populationEconomy').DEFAULTS)
    .map(([key, value]) => [key, { type: Number, default: value, min: ['growthHours', 'foodConsumptionPerPopulation'].includes(key) ? 0.01 : 0 }])),

  // Building Settings
  buildingSettings: {
    buildTimeMultiplier: { type: Number, default: 1 }, // Lower = faster
    costMultiplier: { type: Number, default: 1 },
    energyConsumptionMultiplier: { type: Number, default: 1 }
  },
  
  // Research Settings
  researchSettings: {
    researchTimeMultiplier: { type: Number, default: 1 },
    costMultiplier: { type: Number, default: 1 }
  },
  
  // Fleet Settings
  fleetSettings: {
    flightSpeedMultiplier: { type: Number, default: 1, min: 0.1, max: 100 },
    fuelConsumptionMultiplier: { type: Number, default: 1 },
    cargoCapacityMultiplier: { type: Number, default: 1 }
  },
  
  // Combat Settings
  combatSettings: {
    debrisFieldPercentage: { type: Number, default: 30 }, // % of losses to debris
    defenseToDebris: { type: Boolean, default: false },
    rapidFireEnabled: { type: Boolean, default: true },
    maxRounds: { type: Number, default: 6 }
  },
  
  // New Player Settings
  newPlayerSettings: {
    startingMetal: { type: Number, default: 500 },
    startingCrystal: { type: Number, default: 300 },
    startingDeuterium: { type: Number, default: 100 },
    beginnerProtectionDays: { type: Number, default: 7 }
  },
  
  // Feature Toggles
  features: {
    trading: { type: Boolean, default: true },
    alliance: { type: Boolean, default: true },
    expedition: { type: Boolean, default: true },
    merchant: { type: Boolean, default: true },
    resourceExchange: { type: Boolean, default: true }
  },
  
  // CGC shop and speed-up rules (admin controlled)
  shop: {
    disabled: { type: [String], default: () => [] },
    // sku -> unit price in micro CGC (integer string); no entry = not for sale
    prices: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
  },
  speedupSettings: {
    allowedTypes: { type: [String], default: () => ['building', 'research', 'ship'] }
  },

  // Maintenance
  maintenanceMode: { type: Boolean, default: false },
  maintenanceMessage: { type: String, default: 'Server is under maintenance' },
  
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});

// Singleton - only one config document
gameConfigSchema.statics.getConfig = async function() {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({});
  }
  return config;
};

module.exports = mongoose.model('GameConfig', gameConfigSchema);
