const mongoose = require('mongoose');

const battleReportSchema = new mongoose.Schema({
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
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    coordinates: {
      galaxy: Number,
      system: Number,
      planet: Number
    }
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
  attackerRead: { type: Boolean, default: false },
  defenderRead: { type: Boolean, default: false }
});

module.exports = mongoose.model('BattleReport', battleReportSchema);
