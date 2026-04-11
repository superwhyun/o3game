const mongoose = require('mongoose');

const gameConfigSchema = new mongoose.Schema({
  // Server Settings
  serverName: { type: String, default: 'Cosmic Empire' },
  serverSpeed: { type: Number, default: 1 }, // 1 = normal, 2 = 2x, 5 = 5x, etc.
  
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
    flightSpeedMultiplier: { type: Number, default: 1 },
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
