const EntityBaseConfig = require('../models/EntityBaseConfig');
const { ENTITY_CATALOG_DEFAULTS } = require('../data/entityCatalogDefaults');

class EntityConfigService {
  constructor() {
    this.cache = new Map([
      ['building', new Map()],
      ['research', new Map()],
      ['ship', new Map()],
      ['defense', new Map()]
    ]);
    this.initialized = false;
    this.revision = 0;
    this.degraded = null;
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _normalizeMergedDocument(seed = {}, doc = {}) {
    const display = Object.fromEntries(
      Object.entries({ ...(seed.display || {}), ...(doc.display || {}) }).filter(([, value]) => value !== undefined)
    );
    const costModel = {
      ...(seed.costModel || {}),
      ...(doc.costModel || {})
    };
    const timeModel = {
      ...(seed.timeModel || {}),
      ...(doc.timeModel || {})
    };

    if (!doc.costModel && doc.baseCost) {
      costModel.baseCost = { ...(costModel.baseCost || {}), ...doc.baseCost };
    }
    if (!doc.costModel && doc.costMultiplier != null) {
      costModel.costMultiplier = doc.costMultiplier;
    }
    if (!doc.timeModel && doc.buildTime != null) {
      timeModel.baseTime = doc.buildTime;
    }

    const normalized = {
      entityType: doc.entityType || seed.entityType,
      entityId: doc.entityId || seed.entityId,
      status: doc.status || seed.status || 'active',
      schemaVersion: doc.schemaVersion || seed.schemaVersion || 2,
      revision: doc.revision || seed.revision || 1,
      display,
      requirements: { ...(seed.requirements || {}), ...(doc.requirements || {}) },
      costModel: {
        baseCost: {
          metal: costModel.baseCost?.metal ?? seed.costModel?.baseCost?.metal ?? 0,
          crystal: costModel.baseCost?.crystal ?? seed.costModel?.baseCost?.crystal ?? 0,
          deuterium: costModel.baseCost?.deuterium ?? seed.costModel?.baseCost?.deuterium ?? 0
        },
        costMultiplier: costModel.costMultiplier ?? seed.costModel?.costMultiplier ?? null,
        scalingMode: costModel.scalingMode || 'exponential',
        tierMultipliers: this._clone((costModel.tierMultipliers || []).map((tier, index) => ({
          ...(seed.costModel?.tierMultipliers?.[index] || {}),
          ...tier
        })))
      },
      timeModel: {
        baseTime: timeModel.baseTime ?? seed.timeModel?.baseTime ?? null,
        timeMultiplier: timeModel.timeMultiplier ?? seed.timeModel?.timeMultiplier ?? null,
        scalingMode: timeModel.scalingMode || 'exponential',
        tierMultipliers: this._clone((timeModel.tierMultipliers || []).map((tier, index) => ({
          ...(seed.timeModel?.tierMultipliers?.[index] || {}),
          ...tier
        })))
      },
      effects: this._clone({ ...(seed.effects || {}), ...(doc.effects || {}) }),
      stats: this._clone({ ...(seed.stats || {}), ...(doc.stats || {}) }),
      metadata: this._clone({ ...(seed.metadata || {}), ...(doc.metadata || {}) }),
      updatedAt: doc.updatedAt || seed.updatedAt || new Date(),
      updatedBy: doc.updatedBy || seed.updatedBy || null
    };

    return normalized;
  }

  _seedMap() {
    return ENTITY_CATALOG_DEFAULTS.reduce((acc, definition) => {
      if (!acc[definition.entityType]) {
        acc[definition.entityType] = {};
      }
      acc[definition.entityType][definition.entityId] = definition;
      return acc;
    }, {});
  }

  async ensureSeedData() {
    const ops = ENTITY_CATALOG_DEFAULTS.map((definition) => ({
      updateOne: {
        filter: { entityType: definition.entityType, entityId: definition.entityId },
        update: { $setOnInsert: definition },
        upsert: true
      }
    }));

    await EntityBaseConfig.bulkWrite(ops);
  }

  async initialize() {
    if (this.initialized) return;
    await this.ensureSeedData();
    await this.reload();
    this.initialized = true;
  }

  async reload() {
    const docs = await EntityBaseConfig.find({ status: { $ne: 'disabled' } }).lean();
    const seedMap = this._seedMap();
    const nextCache = new Map([
      ['building', new Map()],
      ['research', new Map()],
      ['ship', new Map()],
      ['defense', new Map()]
    ]);

    for (const definition of ENTITY_CATALOG_DEFAULTS) {
      nextCache.get(definition.entityType).set(
        definition.entityId,
        this._normalizeMergedDocument(definition, definition)
      );
    }

    for (const doc of docs) {
      const seed = seedMap[doc.entityType]?.[doc.entityId] || {};
      nextCache.get(doc.entityType)?.set(doc.entityId, this._normalizeMergedDocument(seed, doc));
    }

    this.cache = nextCache;
    this.revision = Date.now();
  }

  getRevision() {
    return this.revision;
  }

  getEntity(entityType, entityId) {
    const definition = this.cache.get(entityType)?.get(entityId);
    return definition ? this._clone(definition) : null;
  }

  listByType(entityType) {
    return Array.from(this.cache.get(entityType)?.values() || []).map((item) => this._clone(item));
  }

  toAdminRow(definition) {
    return {
      entityId: definition.entityId,
      entityType: definition.entityType,
      name: definition.display?.name || definition.entityId,
      icon: definition.display?.icon || '',
      category: definition.display?.category || '',
      description: definition.display?.description || '',
      baseCost: definition.costModel?.baseCost || { metal: 0, crystal: 0, deuterium: 0 },
      costMultiplier: definition.costModel?.costMultiplier ?? null,
      buildTime: definition.timeModel?.baseTime ?? null,
      tierMultipliers: definition.costModel?.tierMultipliers?.length
        ? definition.costModel.tierMultipliers.map((tier, index) => ({
            startLevel: tier.startLevel,
            endLevel: tier.endLevel,
            costMult: tier.costMult ?? definition.costModel.costMultiplier ?? null,
            timeMult: definition.timeModel?.tierMultipliers?.[index]?.timeMult ?? definition.timeModel?.timeMultiplier ?? null
          }))
        : [],
      requirements: definition.requirements || {},
      effects: definition.effects || {},
      stats: definition.stats || {},
      metadata: definition.metadata || {},
      revision: definition.revision,
      isOverridden: !definition.metadata?.seeded || (definition.revision || 1) > 1
    };
  }

  async updateEntity(entityType, entityId, patch, updatedBy) {
    const current = this.getEntity(entityType, entityId);
    const seed = {
      entityType,
      entityId,
      status: 'draft',
      schemaVersion: 2,
      revision: 0,
      display: { name: entityId, icon: '', category: '', description: '' },
      requirements: {},
      costModel: {
        baseCost: { metal: 0, crystal: 0, deuterium: 0 },
        costMultiplier: null,
        scalingMode: 'exponential',
        tierMultipliers: []
      },
      timeModel: {
        baseTime: null,
        timeMultiplier: null,
        scalingMode: 'exponential',
        tierMultipliers: []
      },
      effects: {},
      stats: {},
      metadata: { seeded: false }
    };

    const nextDefinition = this._normalizeMergedDocument(current || seed, {
      ...patch,
      entityType,
      entityId,
      revision: ((current || seed).revision || 0) + 1,
      updatedAt: new Date(),
      updatedBy,
      metadata: {
        ...((current || seed).metadata || {}),
        seeded: false,
        ...(patch.metadata || {})
      }
    });

    await EntityBaseConfig.findOneAndUpdate(
      { entityType, entityId },
      { $set: nextDefinition },
      { upsert: true, new: true }
    );

    try {
      await this.reload();
    } catch (error) {
      this.degraded = {
        failedAt: new Date(),
        reason: error.message
      };
      throw error;
    }

    this.degraded = null;
    return this.getEntity(entityType, entityId);
  }

  async bulkUpdate(updates, updatedBy) {
    const ops = updates.map((update) => {
      const current = this.getEntity(update.entityType, update.entityId);
      const seed = current || {
        entityType: update.entityType,
        entityId: update.entityId,
        status: 'draft',
        schemaVersion: 2,
        revision: 0,
        display: { name: update.entityId, icon: '', category: '', description: '' },
        requirements: {},
        costModel: {
          baseCost: { metal: 0, crystal: 0, deuterium: 0 },
          costMultiplier: null,
          scalingMode: 'exponential',
          tierMultipliers: []
        },
        timeModel: {
          baseTime: null,
          timeMultiplier: null,
          scalingMode: 'exponential',
          tierMultipliers: []
        },
        effects: {},
        stats: {},
        metadata: { seeded: false }
      };

      const nextDefinition = this._normalizeMergedDocument(seed, {
        ...update,
        revision: (seed.revision || 0) + 1,
        updatedAt: new Date(),
        updatedBy,
        metadata: {
          ...(seed.metadata || {}),
          seeded: false,
          ...(update.metadata || {})
        }
      });

      return {
        updateOne: {
          filter: { entityType: update.entityType, entityId: update.entityId },
          update: { $set: nextDefinition },
          upsert: true
        }
      };
    });

    if (ops.length > 0) {
      await EntityBaseConfig.bulkWrite(ops);
      try {
        await this.reload();
      } catch (error) {
        this.degraded = {
          failedAt: new Date(),
          reason: error.message
        };
        throw error;
      }
      this.degraded = null;
    }
  }

  async resetType(entityType) {
    const defaults = ENTITY_CATALOG_DEFAULTS.filter((definition) => definition.entityType === entityType);
    const ops = defaults.map((definition) => ({
      updateOne: {
        filter: { entityType, entityId: definition.entityId },
        update: { $set: definition },
        upsert: true
      }
    }));

    if (ops.length > 0) {
      await EntityBaseConfig.bulkWrite(ops);
      await this.reload();
    }
  }
}

module.exports = new EntityConfigService();
