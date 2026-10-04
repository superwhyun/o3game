const { transactionalRoute } = require('../services/transactions');
const express = require('express');
const router = express.Router();
const BuildingQueue = require('../models/BuildingQueue');
const User = require('../models/User');
const GameConfig = require('../models/GameConfig');
const { authMiddleware } = require('../middleware/admin');
const { settleUserState, activateNextQueues } = require('../services/GameStateService');
const {
  calculateBuildingCost,
  calculateResearchCost,
  calculateUnitCost,
  calculateQueueDuration,
  getEntityDefinition
} = require('../utils/gameCalculations');

function checkRequirements(user, planet, requirements) {
  if (!requirements) return { met: true };

  // Check building requirements
  if (requirements.buildings) {
    for (const [id, level] of Object.entries(requirements.buildings)) {
      if ((planet.buildings?.[id] || 0) < level) {
        return { met: false, error: `Requires ${id} level ${level}` };
      }
    }
  }

  // Check research requirements
  if (requirements.research) {
    for (const [id, level] of Object.entries(requirements.research)) {
      const userResearch = user.research || {};
      const planetResearch = planet.research || {};
      if ((planetResearch[id] || userResearch[id] || 0) < level) {
        return { met: false, error: `Requires ${id} level ${level}` };
      }
    }
  }

  return { met: true };
}

// GET user's queue
router.get('/', authMiddleware, async (req, res) => {
  try {
    const settled = await settleUserState(req.user._id, new Date());
    res.json(settled.queueState);
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    res.status(500).json({ error: error.message });
  }
});

// POST start building
router.post('/build', authMiddleware, transactionalRoute(async (req, res) => {
  try {
    const { buildingId, planetId = '0' } = req.body;
    
    const definition = getEntityDefinition('building', buildingId);
    if (!definition) return res.status(400).json({ error: 'Invalid building' });
    
    const user = await User.findById(req.user._id);
    const settled = await settleUserState(user, new Date());
    const planet = settled.user.planets[planetId] || settled.user.planets[0];

    const reqCheck = checkRequirements(settled.user, planet, definition.requirements);
    if (!reqCheck.met) return res.status(400).json({ error: reqCheck.error });

    const currentLevel = (planet.buildings && planet.buildings[buildingId]) || 0;
    if (isNaN(currentLevel)) {
      console.error(`[BuildingQueue.build] Invalid currentLevel: ${currentLevel} for ${buildingId}`);
      return res.status(500).json({ error: 'Invalid building level in database' });
    }
    const nextLevel = currentLevel + 1;
    
    const cost = await calculateBuildingCost(buildingId, nextLevel);
    const isInvalid = !cost || [cost.metal, cost.crystal, cost.deuterium].some(v => v !== undefined && isNaN(v));
    if (isInvalid) {
      console.error(`[BuildingQueue.build] Invalid cost calculated:`, cost);
      return res.status(500).json({ error: 'Failed to calculate building cost' });
    }
    
    if (planet.resources.metal < (cost.metal || 0) || 
        planet.resources.crystal < (cost.crystal || 0) || 
        planet.resources.deuterium < (cost.deuterium || 0)) {
      return res.status(400).json({ error: 'Insufficient resources' });
    }
    
    planet.resources.metal -= (cost.metal || 0);
    planet.resources.crystal -= (cost.crystal || 0);
    planet.resources.deuterium -= (cost.deuterium || 0);
    
    const config = await GameConfig.getConfig();
    const duration = calculateQueueDuration('building', buildingId, nextLevel, planet.buildings || {}, 1, {
      serverSpeed: config.serverSpeed,
      timeMultiplier: config.buildingSettings?.buildTimeMultiplier
    });
    
    // Check for existing building of same type
    const existing = await BuildingQueue.findOne({
      userId: req.user._id,
      type: 'building',
      status: { $in: ['building', 'pending'] },
      applied: false
    }).sort({ endTime: -1, startTime: -1 });

    const startTime = existing && existing.endTime > new Date()
      ? new Date(existing.endTime)
      : new Date();
    const endTime = new Date(startTime.getTime() + duration * 1000);
    
    const queueItem = await BuildingQueue.create({
      userId: req.user._id,
      planetId,
      type: 'building',
      itemId: buildingId,
      name: definition.display?.name || buildingId,
      level: nextLevel,
      icon: definition.display?.icon || '🏗️',
      duration,
      startTime,
      endTime,
      status: existing ? 'pending' : 'building',
      costSnapshot: cost
    });
    
    await settled.user.save();
    const refreshed = await settleUserState(settled.user, new Date());
    
    res.json({
      message: 'Construction started',
      queueItem: {
        id: queueItem._id,
        type: queueItem.type,
        itemId: queueItem.itemId,
        name: queueItem.name,
        level: queueItem.level,
        duration: queueItem.duration,
        remaining: queueItem.getRemainingSeconds(),
        endTime: queueItem.endTime
      },
      snapshot: refreshed.snapshot
    });
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    console.error(`[BuildingQueue.build] Error:`, error);
    res.status(500).json({ error: error.message });
  }
}));

// POST start research
router.post('/research', authMiddleware, transactionalRoute(async (req, res) => {
  try {
    const { researchId } = req.body;
    
    const definition = getEntityDefinition('research', researchId);
    if (!definition) return res.status(400).json({ error: 'Invalid research' });
    
    const user = await User.findById(req.user._id);
    const settled = await settleUserState(user, new Date());
    const planet = settled.user.planets[0];
    
    const reqCheck = checkRequirements(settled.user, planet, definition.requirements);
    if (!reqCheck.met) return res.status(400).json({ error: reqCheck.error });
    
    const currentLevel = (planet.research && planet.research[researchId]) || 0;
    const nextLevel = currentLevel + 1;
    
    const cost = await calculateResearchCost(researchId, currentLevel);
    const isInvalid = !cost || [cost.metal, cost.crystal, cost.deuterium].some(v => v !== undefined && isNaN(v));
    if (isInvalid) {
      console.error(`[BuildingQueue.research] Invalid cost calculated:`, cost);
      return res.status(500).json({ error: 'Failed to calculate research cost' });
    }
    
    if (planet.resources.metal < (cost.metal || 0) || 
        planet.resources.crystal < (cost.crystal || 0) || 
        planet.resources.deuterium < (cost.deuterium || 0)) {
      return res.status(400).json({ error: 'Insufficient resources' });
    }
    
    planet.resources.metal -= (cost.metal || 0);
    planet.resources.crystal -= (cost.crystal || 0);
    planet.resources.deuterium -= (cost.deuterium || 0);
    
    const config = await GameConfig.getConfig();
    const duration = calculateQueueDuration('research', researchId, nextLevel, planet.buildings || {}, 1, {
      serverSpeed: config.serverSpeed,
      timeMultiplier: config.researchSettings?.researchTimeMultiplier
    });
    
    // Check for existing research
    const existing = await BuildingQueue.findOne({
      userId: req.user._id,
      type: 'research',
      status: { $in: ['building', 'pending'] },
      applied: false
    }).sort({ endTime: -1, startTime: -1 });

    const startTime = existing && existing.endTime > new Date()
      ? new Date(existing.endTime)
      : new Date();
    const endTime = new Date(startTime.getTime() + duration * 1000);
    
    const queueItem = await BuildingQueue.create({
      userId: req.user._id,
      type: 'research',
      itemId: researchId,
      name: definition.display?.name || researchId,
      level: nextLevel,
      icon: definition.display?.icon || '🔬',
      duration,
      startTime,
      endTime,
      status: existing ? 'pending' : 'building',
      costSnapshot: cost
    });
    
    await settled.user.save();
    const refreshed = await settleUserState(settled.user, new Date());
    
    res.json({
      message: 'Research started',
      queueItem: {
        id: queueItem._id,
        type: queueItem.type,
        itemId: queueItem.itemId,
        name: queueItem.name,
        level: queueItem.level,
        duration: queueItem.duration,
        remaining: queueItem.getRemainingSeconds(),
        endTime: queueItem.endTime
      },
      snapshot: refreshed.snapshot
    });
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    res.status(500).json({ error: error.message });
  }
}));

// POST build ship
router.post('/ship', authMiddleware, transactionalRoute(async (req, res) => {
  try {
    const { shipId, count = 1, planetId = '0', entityType = 'ship' } = req.body;
    if (!['ship', 'defense'].includes(entityType)) {
      return res.status(400).json({ error: 'Invalid unit type' });
    }
    
    const definition = getEntityDefinition(entityType, shipId);
    if (!definition) return res.status(400).json({ error: 'Invalid unit' });
    
    const user = await User.findById(req.user._id);
    const settled = await settleUserState(user, new Date());
    const planet = settled.user.planets[planetId] || settled.user.planets[0];
    
    const reqCheck = checkRequirements(settled.user, planet, definition.requirements);
    if (!reqCheck.met) return res.status(400).json({ error: reqCheck.error });
    
    const totalCost = await calculateUnitCost(entityType, shipId, count);
    const isInvalid = !totalCost || [totalCost.metal, totalCost.crystal, totalCost.deuterium].some(v => v !== undefined && isNaN(v));
    if (isInvalid) {
      console.error(`[BuildingQueue.ship] Invalid cost calculated:`, totalCost);
      return res.status(500).json({ error: 'Failed to calculate ship cost' });
    }
    
    if (planet.resources.metal < (totalCost.metal || 0) || 
        planet.resources.crystal < (totalCost.crystal || 0) || 
        planet.resources.deuterium < (totalCost.deuterium || 0)) {
      return res.status(400).json({ error: 'Insufficient resources' });
    }
    
    planet.resources.metal -= (totalCost.metal || 0);
    planet.resources.crystal -= (totalCost.crystal || 0);
    planet.resources.deuterium -= (totalCost.deuterium || 0);
    
    const config = await GameConfig.getConfig();
    const duration = calculateQueueDuration(entityType, shipId, 1, planet.buildings || {}, count, {
      serverSpeed: config.serverSpeed,
      timeMultiplier: 1 // Ships don't have a specific multiplier in config yet
    });
    
    // Check for existing ship build
    const existing = await BuildingQueue.findOne({
      userId: req.user._id,
      type: entityType,
      status: { $in: ['building', 'pending'] },
      applied: false
    }).sort({ endTime: -1, startTime: -1 });

    const startTime = existing && existing.endTime > new Date()
      ? new Date(existing.endTime)
      : new Date();
    const endTime = new Date(startTime.getTime() + duration * 1000);
    
    const queueItem = await BuildingQueue.create({
      userId: req.user._id,
      planetId,
      type: entityType,
      itemId: shipId,
      name: definition.display?.name || shipId,
      count,
      icon: definition.display?.icon || (entityType === 'defense' ? '🛡️' : '🚀'),
      duration,
      startTime,
      endTime,
      status: existing ? 'pending' : 'building',
      costSnapshot: totalCost
    });
    
    await settled.user.save();
    const refreshed = await settleUserState(settled.user, new Date());
    
    res.json({
      message: `${entityType === 'defense' ? 'Defense' : 'Ship'} construction started`,
      queueItem: {
        id: queueItem._id,
        type: queueItem.type,
        itemId: queueItem.itemId,
        name: queueItem.name,
        count: queueItem.count,
        duration: queueItem.duration,
        remaining: queueItem.getRemainingSeconds(),
        endTime: queueItem.endTime
      },
      snapshot: refreshed.snapshot
    });
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    res.status(500).json({ error: error.message });
  }
}));

// POST check completion
router.post('/check/:id', authMiddleware, transactionalRoute(async (req, res) => {
  try {
    const queueItem = await BuildingQueue.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!queueItem) return res.status(404).json({ error: 'Not found' });
    
    const settled = await settleUserState(req.user._id, new Date());
    const settledQueue = await BuildingQueue.findById(req.params.id);

    if (settledQueue?.applied || settledQueue?.status === 'completed') {
      return res.json({
        completed: true,
        type: queueItem.type,
        itemId: queueItem.itemId,
        name: queueItem.name,
        level: queueItem.level,
        count: queueItem.count,
        snapshot: settled.snapshot
      });
    }
    
    res.json({
      completed: false,
      remaining: settledQueue ? settledQueue.getRemainingSeconds() : 0,
      endTime: settledQueue?.endTime || queueItem.endTime
    });
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    res.status(500).json({ error: error.message });
  }
}));

// DELETE cancel
router.delete('/:id', authMiddleware, transactionalRoute(async (req, res) => {
  try {
    const queueItem = await BuildingQueue.findOne({
      _id: req.params.id,
      userId: req.user._id,
      status: { $in: ['pending', 'building'] }
    });
    
    if (!queueItem) return res.status(404).json({ error: 'Not found' });
    
    // Perform refund if cost snapshot exists
    if (queueItem.costSnapshot) {
      const settled = await settleUserState(req.user._id, new Date());
      const planet = settled.user.planets[queueItem.planetId] || settled.user.planets[0];
      const config = await GameConfig.getConfig();
      
      // Determine refund rate: 100% if not started (pending), otherwise use global penalty (usually 80%)
      const isPending = queueItem.status === 'pending';
      const refundRate = isPending ? 1.0 : (config.resourceSettings?.cancellationRefundRate || 0.8);
      
      planet.resources.metal += Math.floor((queueItem.costSnapshot.metal || 0) * refundRate);
      planet.resources.crystal += Math.floor((queueItem.costSnapshot.crystal || 0) * refundRate);
      planet.resources.deuterium += Math.floor((queueItem.costSnapshot.deuterium || 0) * refundRate);
      
      settled.user.markModified('planets');
      await settled.user.save();
    }
    
    queueItem.status = 'cancelled';
    await queueItem.save();
    
    // Immediately attempt to start the next item in the queue for this user
    await activateNextQueues(req.user._id, new Date());
    
    res.json({ message: 'Cancelled', refundApplied: !!queueItem.costSnapshot });
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    console.error(`[BuildingQueue.cancel] Error:`, error);
    res.status(500).json({ error: error.message });
  }
}));

module.exports = router;
