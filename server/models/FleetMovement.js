const mongoose = require('mongoose');

const fleetMovementSchema = new mongoose.Schema({
  // Owner
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  
  // Mission Type
  mission: { 
    type: String, 
    enum: ['attack', 'transport', 'deploy', 'spy', 'colonize', 'recycle', 'expedition'],
    required: true 
  },
  
  // Fleet Composition
  fleet: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  initialFleet: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  formationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  formationNameAtLaunch: { type: String, default: '' },
  formationRevisionAtLaunch: Number,
  originPlanetId: mongoose.Schema.Types.ObjectId,
  targetPlanetId: mongoose.Schema.Types.ObjectId,
  requestId: String,
  requestHash: String,
  deckVersion: { type: Number, default: 1 },
  combatWaves: { type: mongoose.Schema.Types.Mixed, default: null },
  notice: { type: String, default: '' },
  spyContext: { attackerEspionageLevel: Number, rulesVersion: Number },
  scoutReportId: mongoose.Schema.Types.ObjectId,
  // Tactical 8-Wave Deck configuration for Combat Phase 1-8
  fleetDeck: {
    type: [{
      type: { type: String, default: null },
      count: { type: Number, default: 0 }
    }],
    default: () => Array(8).fill({ type: null, count: 0 })
  },
  
  // Resources being transported
  cargo: {
    metal: { type: Number, default: 0 },
    crystal: { type: Number, default: 0 },
    deuterium: { type: Number, default: 0 }
  },
  
  // Coordinates
  origin: {
    galaxy: { type: Number, required: true },
    system: { type: Number, required: true },
    planet: { type: Number, required: true }
  },
  
  destination: {
    galaxy: { type: Number, required: true },
    system: { type: Number, required: true },
    planet: { type: Number, required: true }
  },
  
  // Timing
  startTime: { type: Date, required: true },
  arrivalTime: { type: Date, required: true },
  returnTime: { type: Date, default: null },
  
  // Status
  status: {
    type: String,
    enum: ['flying', 'returning', 'completed', 'cancelled'],
    default: 'flying'
  },
  
  // For attacks/spying - target user
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  // Battle report (if attack)
  battleReport: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BattleReport',
    default: null
  },
  
  // Speed percentage (10-100%)
  speed: { type: Number, default: 100 }
});

// Index for quick lookups
fleetMovementSchema.index({ arrivalTime: 1, status: 1 });
fleetMovementSchema.index({ userId: 1 });
fleetMovementSchema.index({ userId: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } });

module.exports = mongoose.model('FleetMovement', fleetMovementSchema);
