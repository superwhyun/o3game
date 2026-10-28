const { afterCommit, transactionalRoute } = require('../services/transactions');
const express = require('express');
const router = express.Router();
const { adminMiddleware, superAdminMiddleware } = require('../middleware/admin');
const GameConfig = require('../models/GameConfig');
const User = require('../models/User');
const FleetMovement = require('../models/FleetMovement');
const BattleReport = require('../models/BattleReport');
const entityConfigService = require('../services/EntityConfigService');
const { settleUserState } = require('../services/GameStateService');
const { normalizeAdminUserUpdate } = require('../utils/adminUserUpdate');

// Get game configuration
router.get('/config', adminMiddleware, async (req, res) => {
  try {
    const config = await GameConfig.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update game configuration
router.put('/config', superAdminMiddleware, async (req, res) => {
  try {
    const config = await GameConfig.getConfig();
    
    // Update allowed fields
    const allowedFields = [
      'serverName', 'serverSpeed', 'resourceSettings', 'buildingSettings',
      'researchSettings', 'fleetSettings', 'combatSettings', 'newPlayerSettings',
      'features', 'maintenanceMode', 'maintenanceMessage'
    ];
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        config[field] = req.body[field];
      }
    });
    
    config.updatedAt = new Date();
    config.updatedBy = req.user._id;
    await config.save();
    
    // Broadcast config change to all connected clients
    const io = req.app.get('io');
    io.emit('gameConfigUpdated', config);
    
    res.json({ message: 'Configuration updated', config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set server speed
router.post('/speed', superAdminMiddleware, async (req, res) => {
  try {
    const { speed } = req.body;
    
    if (!speed || speed < 0.5 || speed > 100) {
      return res.status(400).json({ error: 'Speed must be between 0.5 and 100' });
    }
    
    const config = await GameConfig.getConfig();
    config.serverSpeed = speed;
    config.updatedAt = new Date();
    config.updatedBy = req.user._id;
    await config.save();
    
    // Broadcast to all clients
    const io = req.app.get('io');
    io.emit('serverSpeedChanged', { speed });
    
    res.json({ message: `Server speed set to ${speed}x`, speed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get server statistics
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const stats = {
      users: {
        total: await User.countDocuments(),
        online: await User.countDocuments({ isOnline: true }),
        today: await User.countDocuments({
          lastLogin: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
      },
      fleets: {
        active: await FleetMovement.countDocuments({ status: 'flying' }),
        returning: await FleetMovement.countDocuments({ status: 'returning' }),
        totalToday: await FleetMovement.countDocuments({
          startTime: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
      },
      battles: {
        total: await BattleReport.countDocuments(),
        today: await BattleReport.countDocuments({
          battleTime: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
      },
      serverSpeed: (await GameConfig.getConfig()).serverSpeed || 1
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users (paginated)
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    
    const query = search ? {
      $or: [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    } : {};
    
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    
    const total = await User.countDocuments(query);
    
    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single user details
router.get('/users/:userId', adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user (ban, resources, etc)
router.put('/users/:userId', superAdminMiddleware, transactionalRoute(async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const update = normalizeAdminUserUpdate(req.body, user.planets.length);
    const willRemainSuperAdmin = (update.isAdmin ?? user.isAdmin) &&
      (update.adminRole === undefined ? user.adminRole : update.adminRole) === 'superadmin';
    if (user.isAdmin && user.adminRole === 'superadmin' && !willRemainSuperAdmin) {
      const anotherSuperAdmin = await User.exists({
        _id: { $ne: user._id },
        isAdmin: true,
        adminRole: 'superadmin'
      });
      if (!anotherSuperAdmin) {
        return res.status(400).json({ error: 'At least one superadmin must remain' });
      }
    }
    ['isBanned', 'banReason', 'isAdmin', 'adminRole'].forEach((field) => {
      if (update[field] !== undefined) user[field] = update[field];
    });
    
    // Resource modification
    if (update.resources) {
      const planet = user.planets[update.planetIndex];
      planet.resources = { ...planet.resources.toObject(), ...update.resources };
      user.markModified('planets');
    }
    
    await user.save();
    
    // Sync to user UI via socket if online
    const io = req.app.get('io');
    if (user.socketId) {
      try {
        const settled = await settleUserState(user._id, new Date());
        afterCommit(() => io.to(`user:${user._id}`).emit('planetData', settled.snapshot));
      } catch (err) {
        console.error('[Admin] Failed to sync user data via socket:', err);
      }
    }
    
    res.json({ message: 'User updated', user });
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    res.status(error.statusCode || 500).json({ error: error.message });
  }
}));

// Delete user
router.delete('/users/:userId', superAdminMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.userId);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove a mistakenly linked wallet (players cannot unlink on their own)
router.delete('/users/:userId/wallet', superAdminMiddleware, async (req, res) => {
  try {
    res.json(await require('../services/WalletService').adminUnlink(req.user._id, req.params.userId));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, code: error.code });
  }
});

// Shop: switch products on/off and review orders
router.put('/shop/disabled', superAdminMiddleware, async (req, res) => {
  try {
    res.json(await require('../services/ShopService').setDisabled(req.user._id, req.body?.disabled));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, code: error.code });
  }
});
router.put('/shop/prices', superAdminMiddleware, async (req, res) => {
  try { res.json(await require('../services/ShopService').setPrices(req.user._id, req.body?.prices)); }
  catch (error) { res.status(error.statusCode || 500).json({ error: error.message, code: error.code }); }
});
router.get('/shop', adminMiddleware, async (req, res) => {
  try { res.json(await require('../services/ShopService').adminOverview()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});
router.put('/shop/speedup', superAdminMiddleware, async (req, res) => {
  try { res.json(await require('../services/ShopService').setSpeedupTypes(req.user._id, req.body?.allowedTypes)); }
  catch (error) { res.status(error.statusCode || 500).json({ error: error.message, code: error.code }); }
});
router.get('/shop/orders', adminMiddleware, async (req, res) => {
  try {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    const orders = await require('../models/CgcOrder').find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ orders: orders.map((o) => ({ orderId: o.orderId, userId: o.userId, sku: o.sku, quantity: o.quantity, totalMicro: o.totalMicro, status: o.status, paymentStatus: o.paymentStatus, paymentId: o.paymentId, lastError: o.lastError, createdAt: o.createdAt })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Maintenance mode toggle
router.post('/maintenance', superAdminMiddleware, async (req, res) => {
  try {
    const { enabled, message } = req.body;
    const config = await GameConfig.getConfig();
    
    config.maintenanceMode = enabled;
    if (message) config.maintenanceMessage = message;
    config.updatedAt = new Date();
    config.updatedBy = req.user._id;
    await config.save();
    
    const io = req.app.get('io');
    if (enabled) {
      io.emit('maintenanceMode', { enabled: true, message: config.maintenanceMessage });
    } else {
      io.emit('maintenanceMode', { enabled: false });
    }
    
    res.json({ message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send global announcement
router.post('/announcement', adminMiddleware, async (req, res) => {
  try {
    const { message, type = 'info' } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const io = req.app.get('io');
    io.emit('adminAnnouncement', { message, type, from: req.user.username });
    
    res.json({ message: 'Announcement sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get activity logs (simplified)
router.get('/logs', adminMiddleware, async (req, res) => {
  try {
    // In production, this would query a logs collection
    res.json({ logs: [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add resources to user
router.post('/users/:userId/resources', adminMiddleware, transactionalRoute(async (req, res) => {
  try {
    const { resourceType, amount, planetIndex = 0 } = req.body;
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const validResources = ['metal', 'crystal', 'deuterium', 'energy'];
    if (!validResources.includes(resourceType)) {
      return res.status(400).json({ error: 'Invalid resource type' });
    }
    
    const planet = user.planets[planetIndex];
    if (!planet) {
      return res.status(404).json({ error: 'Planet not found' });
    }
    
    // Add resources
    planet.resources[resourceType] = (planet.resources[resourceType] || 0) + amount;
    
    // Mark planets array as modified to ensure Mongoose saves it
    user.markModified('planets');
    await user.save();
    
    res.json({ 
      message: `Added ${amount} ${resourceType} to ${user.username}`,
      resources: planet.resources
    });
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
    res.status(500).json({ error: error.message });
  }
}));

// ─── Entity Base Config ───────────────────────────────────────────────────────

// Get entity configs for a given type (building / ship / research)
// Falls back to hardcoded defaults when no DB override exists
router.get('/entity-config', adminMiddleware, async (req, res) => {
  try {
    const { type } = req.query;
    const validTypes = ['building', 'ship', 'research', 'defense'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'type query param must be building, ship, research, or defense' });
    }

    const result = entityConfigService.listByType(type).map((definition) => entityConfigService.toAdminRow(definition));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a single entity config
router.put('/entity-config/:type/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { type, id } = req.params;
    const validTypes = ['building', 'ship', 'research', 'defense'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid entity type' });
    }

    const patch = {};
    if (req.body.baseCost !== undefined || req.body.costMultiplier !== undefined || req.body.tierMultipliers !== undefined) {
      patch.costModel = {};
      if (req.body.baseCost !== undefined) patch.costModel.baseCost = req.body.baseCost;
      if (req.body.costMultiplier !== undefined) patch.costModel.costMultiplier = req.body.costMultiplier;
      if (req.body.tierMultipliers !== undefined) patch.costModel.tierMultipliers = req.body.tierMultipliers;
    }
    if (req.body.buildTime !== undefined || req.body.timeMultiplier !== undefined || req.body.tierMultipliers !== undefined) {
      patch.timeModel = {};
      if (req.body.buildTime !== undefined) patch.timeModel.baseTime = req.body.buildTime;
      if (req.body.timeMultiplier !== undefined) patch.timeModel.timeMultiplier = req.body.timeMultiplier;
      if (req.body.tierMultipliers !== undefined) patch.timeModel.tierMultipliers = req.body.tierMultipliers;
    }
    ['display', 'requirements', 'effects', 'stats', 'metadata', 'status'].forEach((field) => {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    });

    const definition = await entityConfigService.updateEntity(type, id, patch, req.user._id);
    req.app.get('io').emit('entityConfigUpdated', {
      entityType: type,
      entityId: id,
      revision: entityConfigService.getRevision()
    });
    res.json({ message: 'Entity config updated', config: entityConfigService.toAdminRow(definition) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk update entity configs (MUST be above /:type to avoid being caught as a parameter)
router.post('/entity-config/bulk', superAdminMiddleware, async (req, res) => {
  try {
    const { updates } = req.body; 
    console.log(`[AdminAPI] Bulk update request received. Updates count: ${updates ? (Array.isArray(updates) ? updates.length : 'not an array') : 'missing'}`);
    
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates array is required and must not be empty' });
    }

    const validTypes = ['building', 'ship', 'research', 'defense'];
    
    await entityConfigService.bulkUpdate(
      updates.map((update) => {
        if (!update.entityType || !validTypes.includes(update.entityType)) {
          throw new Error(`Invalid entity type "${update.entityType}" for entity "${update.entityId}"`);
        }
        
        // Construct a normalized update object that the service understands
        const normalizedUpdate = { ...update };
        
        // Handle legacy top-level cost/time fields if they're not already in models
        if (update.baseCost && !update.costModel) {
          normalizedUpdate.costModel = { baseCost: update.baseCost };
        }
        if (update.buildTime && !update.timeModel) {
          normalizedUpdate.timeModel = { baseTime: update.buildTime };
        }
        
        return normalizedUpdate;
      }),
      req.user._id
    );

    req.app.get('io').emit('entityConfigUpdated', {
      entityType: 'bulk',
      revision: entityConfigService.getRevision()
    });

    console.log(`[AdminAPI] Bulk update successful. Updated ${updates.length} configs.`);
    res.json({ message: `Updated ${updates.length} entity configs`, revision: entityConfigService.getRevision() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/entity-config/:type', superAdminMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ['building', 'ship', 'research', 'defense'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid entity type' });
    }

    const { entityId } = req.body;
    if (!entityId) {
      return res.status(400).json({ error: 'entityId is required' });
    }

    const patch = {
      status: req.body.status || 'draft'
    };
    if (req.body.baseCost !== undefined || req.body.costMultiplier !== undefined || req.body.tierMultipliers !== undefined) {
      patch.costModel = {};
      if (req.body.baseCost !== undefined) patch.costModel.baseCost = req.body.baseCost;
      if (req.body.costMultiplier !== undefined) patch.costModel.costMultiplier = req.body.costMultiplier;
      if (req.body.tierMultipliers !== undefined) patch.costModel.tierMultipliers = req.body.tierMultipliers;
    }
    if (req.body.buildTime !== undefined || req.body.timeMultiplier !== undefined || req.body.tierMultipliers !== undefined) {
      patch.timeModel = {};
      if (req.body.buildTime !== undefined) patch.timeModel.baseTime = req.body.buildTime;
      if (req.body.timeMultiplier !== undefined) patch.timeModel.timeMultiplier = req.body.timeMultiplier;
      if (req.body.tierMultipliers !== undefined) patch.timeModel.tierMultipliers = req.body.tierMultipliers;
    }
    ['display', 'requirements', 'effects', 'stats', 'metadata'].forEach((field) => {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    });

    const definition = await entityConfigService.updateEntity(type, entityId, patch, req.user._id);
    req.app.get('io').emit('entityConfigUpdated', {
      entityType: type,
      entityId,
      revision: entityConfigService.getRevision()
    });

    res.status(201).json({
      message: 'Entity created',
      config: entityConfigService.toAdminRow(definition),
      revision: entityConfigService.getRevision()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Reset entity configs for a type back to hardcoded defaults (deletes DB overrides)
router.post('/entity-config/reset/:type', superAdminMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ['building', 'ship', 'research', 'defense'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid entity type' });
    }

    await entityConfigService.resetType(type);
    req.app.get('io').emit('entityConfigUpdated', {
      entityType: type,
      revision: entityConfigService.getRevision()
    });
    res.json({ message: `Reset all ${type} configs to defaults`, revision: entityConfigService.getRevision() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
