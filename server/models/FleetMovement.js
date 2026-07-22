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
  fleet: {
    smallCargo: { type: Number, default: 0 },
    largeCargo: { type: Number, default: 0 },
    lightFighter: { type: Number, default: 0 },
    heavyFighter: { type: Number, default: 0 },
    cruiser: { type: Number, default: 0 },
    battleship: { type: Number, default: 0 },
    battlecruiser: { type: Number, default: 0 },
    bomber: { type: Number, default: 0 },
    destroyer: { type: Number, default: 0 },
    deathstar: { type: Number, default: 0 },
    recycler: { type: Number, default: 0 },
    espionageProbe: { type: Number, default: 0 },
    colonyShip: { type: Number, default: 0 }
  },
  
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

module.exports = mongoose.model('FleetMovement', fleetMovementSchema);
