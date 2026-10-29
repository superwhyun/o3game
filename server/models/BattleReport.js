const mongoose = require('mongoose');

const battleReportSchema = new mongoose.Schema({
  movementId: mongoose.Schema.Types.ObjectId,
  formationName: String,
  // Historical reports have no fuel record. Current launches do not charge fuel.
  fuelConsumed: { type: mongoose.Schema.Types.Mixed, default: null },
  fuelPolicy: String,
  // Participants
  attacker: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    coordinates: {
      galaxy: Number,
      system: Number,
      planet: Number
    }
  },
  
  defender: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // absent when the defender is an event monster
    username: { type: String, required: true },
    coordinates: {
      galaxy: Number,
      system: Number,
      planet: Number
    }
  },
  
  // Set when the defender is an event monster
  monster: {
    eventId: mongoose.Schema.Types.ObjectId,
    name: String,
    damage: Number,
    remainingPercent: Number,
    defeated: Boolean,
    share: Number
  },

  // Battle Time
  battleTime: { type: Date, default: Date.now },
  
  // Rounds (detailed combat log)
  rounds: [{
    round: Number,
    attackerShips: Object,
    defenderShips: Object,
    attackerLosses: Object,
    defenderLosses: Object,
    attackerDamage: Number,
    defenderDamage: Number
  }],
  
  // Initial forces
  attackerInitial: {
    fleet: Object,
    weapons: Number,
    shield: Number,
    armor: Number
  },
  
  defenderInitial: {
    fleet: Object,
    defense: Object,
    weapons: Number,
    shield: Number,
    armor: Number
  },
  
  // Result
  result: {
    winner: { type: String, enum: ['attacker', 'defender', 'draw'] },
    attackerLosses: Object,
    defenderLosses: Object,
    pirateLevel: Number,
    pirateCleared: Boolean,
    attackerCrewLosses: Number,
    defenderCrewLosses: Number,
    debrisField: {
      metal: Number,
      crystal: Number
    },
    loot: {
      metal: Number,
      crystal: Number,
      deuterium: Number
    },
    moonChance: Number,
    moonCreated: Boolean
  },
  
  // Read status
  attackerDeleted: { type: Boolean, default: false },
  defenderDeleted: { type: Boolean, default: false },
  attackerRead: { type: Boolean, default: false },
  defenderRead: { type: Boolean, default: false }
});

battleReportSchema.index({ 'attacker.userId': 1, _id: -1 });
battleReportSchema.index({ 'defender.userId': 1, _id: -1 });
battleReportSchema.index({ movementId: 1 }, { unique: true, partialFilterExpression: { movementId: { $type: 'objectId' } } });
module.exports = mongoose.model('BattleReport', battleReportSchema);
