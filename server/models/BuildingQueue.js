const mongoose = require('mongoose');

/**
 * BuildingQueue Model
 * Server-side construction queue for buildings, research, and ships
 * Prevents client-side cheating by managing all build states server-side
 */
const BuildingQueueSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  planetId: {
    type: String,
    default: '0' // For multi-planet support in future
  },
  type: {
    type: String,
    enum: ['building', 'research', 'ship', 'defense'],
    required: true
  },
  action: { type: String, enum: ['upgrade', 'demolish'], default: 'upgrade' },
  itemId: {
    type: String,
    required: true // e.g., 'metalMine', 'lightFighter', etc.
  },
  name: {
    type: String,
    required: true // Display name
  },
  level: {
    type: Number,
    default: 1 // For buildings and research
  },
  count: {
    type: Number,
    default: 1 // For ships
  },
  icon: {
    type: String,
    default: '🏗️'
  },
  duration: {
    type: Number,
    required: true // Total duration in seconds
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date,
    required: true // Calculated completion time
  },
  status: {
    type: String,
    enum: ['pending', 'building', 'completed', 'cancelled'],
    default: 'building'
  },
  costSnapshot: {
    metal: Number,
    crystal: Number,
    deuterium: Number
  },
  applied: {
    type: Boolean,
    default: false // Whether the build has been applied to user's planet
  }
}, {
  timestamps: true
});

// Index for querying active builds
BuildingQueueSchema.index({ userId: 1, status: 1, endTime: 1 });

// Static method to get user's current queue - SEPARATE by type
// Building, Research, Ship can all progress simultaneously
BuildingQueueSchema.statics.getUserQueue = async function(userId) {
  const now = new Date();
  
  // Get current building (type = 'building')
  const buildingCurrent = await this.findOne({
    userId,
    type: 'building',
    status: { $in: ['building', 'pending'] },
    endTime: { $gt: now }
  }).sort({ startTime: 1 });
  
  // Get current research (type = 'research')
  const researchCurrent = await this.findOne({
    userId,
    type: 'research',
    status: { $in: ['building', 'pending'] },
    endTime: { $gt: now }
  }).sort({ startTime: 1 });
  
  // Get current ship (type = 'ship')
  const shipCurrent = await this.findOne({
    userId,
    type: 'ship',
    status: { $in: ['building', 'pending'] },
    endTime: { $gt: now }
  }).sort({ startTime: 1 });
  
  // Get all queued items that are waiting (not currently building)
  const queue = await this.find({
    userId,
    status: 'pending'
  }).sort({ startTime: 1 });
  
  // Check for completed items by type
  const completed = await this.find({
    userId,
    status: 'building',
    endTime: { $lte: now },
    applied: false
  });
  
  // Return separate currents for each type
  return {
    building: buildingCurrent || completed.find(c => c.type === 'building') || null,
    research: researchCurrent || completed.find(c => c.type === 'research') || null,
    ship: shipCurrent || completed.find(c => c.type === 'ship') || null,
    queue: queue,
    completed: completed
  };
};

// Delegate legacy callers to the single settlement path (no alternate upgrades).
BuildingQueueSchema.statics.completeBuild = async function(queueId) {
  const item = await this.findById(queueId);
  if (!item || item.applied || item.status === 'cancelled' || !item.isCompleted()) return null;
  const settled = await require('../services/GameStateService').settleUserState(item.userId);
  const queueItem = await this.findById(queueId);
  if (!queueItem?.applied) return null;
  return { queueItem, user: settled.user, planet: settled.user.planets[queueItem.planetId] };
};

// Instance method to check if completed
BuildingQueueSchema.methods.isCompleted = function() {
  return new Date() >= this.endTime;
};

// Instance method to get remaining seconds
BuildingQueueSchema.methods.getRemainingSeconds = function() {
  const remaining = Math.ceil((this.endTime - new Date()) / 1000);
  return Math.max(0, remaining);
};

module.exports = mongoose.model('BuildingQueue', BuildingQueueSchema);
