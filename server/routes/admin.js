const { afterCommit, transactionalRoute } = require('../services/transactions');
const express = require('express');
const router = express.Router();
const { apiContext, errorHandler } = require('../utils/apiErrors');
router.use(apiContext, require('../middleware/apiValidation').apiValidation('/api/admin'));
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
    throw error;
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
      'populationSettings', 'areaSettings', 'features', 'maintenanceMode', 'maintenanceMessage'
    ];
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        config[field] = field === 'fleetSettings' ? { ...config.fleetSettings.toObject(), ...req.body[field] } : req.body[field];
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
    throw error;
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
    throw error;
  }
});

// Get server statistics
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const stats = {
      users: {
        total: await User.countDocuments({isPirate:{$ne:true}}),
        online: await User.countDocuments({ isPirate:{$ne:true}, isOnline: true }),
        today: await User.countDocuments({
          isPirate:{$ne:true},
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
    throw error;
  }
});

// Get all users (paginated)
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = (req.query.search || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const query = search ? {
      $or: [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    } : {};
    
    if (req.query.kind !== undefined && !['human','bot','all'].includes(req.query.kind)) throw require('../utils/apiErrors').apiError(400,'INVALID_REQUEST','사용자 유형 필터가 올바르지 않습니다.');
    query.isPirate = {$ne:true};
    if (req.query.kind === 'human') query.isAiPlayer = {$ne:true};
    if (req.query.kind === 'bot') query.isAiPlayer = true;
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
    throw error;
  }
});

// Get single user details
router.get('/users/:userId', adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const settled = await settleUserState(user._id);
    if (!settled) return res.status(404).json({ error: 'User not found' });
    const detail = settled.user.toObject();
    delete detail.password;
    settled.snapshot.planets.forEach(planet => { planet.unassignedShips = require('../utils/formationRules').availableShips(settled.user, planet._id); });
    res.json({ ...detail, gameSnapshot: settled.snapshot, gameCatalog: entityConfigService.toPublicCatalog() });
  } catch (error) {
    throw error;
  }
});

// Update user (ban, resources, etc)
router.put('/users/:userId', superAdminMiddleware, transactionalRoute(async (req, res) => {
  try {
    await require('../services/transactions').requireTransactions();
    await require('../models/SystemLock').findOneAndUpdate({ _id: 'admin-governance' }, { $inc: { revision: 1 } }, { upsert: true });
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const update = normalizeAdminUserUpdate(req.body, user.planets.length);
    const willRemainSuperAdmin = !(update.isBanned ?? user.isBanned) && (update.isAdmin ?? user.isAdmin) &&
      (update.adminRole === undefined ? user.adminRole : update.adminRole) === 'superadmin';
    if (user.isAdmin && user.adminRole === 'superadmin' && !willRemainSuperAdmin) {
      const anotherSuperAdmin = await User.exists({
        _id: { $ne: user._id },
        isAdmin: true, isBanned: false,
        adminRole: 'superadmin'
      });
      if (!anotherSuperAdmin) {
        return res.status(409).json({ error: 'At least one superadmin must remain', code: 'LAST_SUPERADMIN' });
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
    if (user.isBanned) afterCommit(() => io?.in?.(`user:${user._id}`)?.disconnectSockets?.(true));
    if (user.socketId) {
      try {
        const settled = await settleUserState(user._id, new Date());
        afterCommit(() => io.to(`user:${user._id}`).emit('planetData', settled.snapshot));
      } catch (err) {
        console.error('[Admin] Failed to sync user data via socket:', err);
      }
    }
    
    const publicUser = user.toObject(); delete publicUser.password;
    res.json({ message: 'User updated', user: publicUser });
  } catch (error) {
    throw error;
  }
}));

// Delete user
router.delete('/users/:userId', superAdminMiddleware, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.isAdmin && target.adminRole === 'superadmin') return res.status(409).json({ error: '최고 관리자 계정은 권한을 변경한 뒤 삭제해 주세요.', code: 'LAST_SUPERADMIN' });
    await User.findByIdAndDelete(req.params.userId);
    await require('../models/AiPlayer').deleteOne({ userId: req.params.userId });
    req.app.get('io')?.in?.(`user:${req.params.userId}`)?.disconnectSockets?.(true);
    res.json({ message: 'User deleted' });
  } catch (error) {
    throw error;
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
    throw error;
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
    throw error;
  }
});

// Get activity logs (simplified)
router.get('/logs', adminMiddleware, async (req, res) => {
  try {
    // In production, this would query a logs collection
    res.json({ logs: [] });
  } catch (error) {
    throw error;
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
    
    const validResources = ['metal', 'crystal', 'deuterium', 'food'];
    if (!validResources.includes(resourceType)) {
      return res.status(400).json({ error: 'Invalid resource type' });
    }
    
    const planet = user.planets[planetIndex];
    if (!planet) {
      return res.status(404).json({ error: 'Planet not found' });
    }
    
    if (!Number.isSafeInteger(Math.ceil(planet.resources[resourceType] || 0) + amount)) throw require('../utils/apiErrors').apiError(400, 'INVALID_REQUEST', '자원 수량이 허용 범위를 초과합니다.');
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
    throw error;
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
    throw error;
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
    throw error;
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
          throw require('../utils/apiErrors').apiError(400, 'INVALID_ENTITY', `Invalid entity type "${update.entityType}" for entity "${update.entityId}"`);
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
    throw error;
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
    throw error;
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
    throw error;
  }
});

router.use(require('./aiAdmin'));
router.use(errorHandler);
module.exports = router;
