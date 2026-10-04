const EntityBaseConfig = require('../models/EntityBaseConfig');
const { ENTITY_CATALOG_DEFAULTS, CATALOG_DIR, CATALOG_FILES } = require('../data/catalog');
const { ENTITY_TYPES, definitionToSpec } = require('../data/catalog/schema');
const { serializeCatalogModule } = require('../data/catalog/serialize');
const fs = require('fs').promises;
const path = require('path');

const createTypeCache = () => new Map(ENTITY_TYPES.map((entityType) => [entityType, new Map()]));

class EntityConfigService {
  constructor() {
    this.cache = createTypeCache();
    this.initialized = false;
    this.revision = 0;
    this.degraded = null;
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _normalizeMergedDocument(seed = {}, doc = {}) {
    const display = Object.fromEntries(
      Object.entries({ ...(seed.display || {}), ...Object.fromEntries(Object.entries(doc.display || {}).filter(([, value]) => value !== undefined)) }).filter(([, value]) => value !== undefined)
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
        scalingMode: costModel.scalingMode || 'exponential'
      },
      timeModel: {
        baseTime: timeModel.baseTime ?? seed.timeModel?.baseTime ?? null,
        timeMultiplier: timeModel.timeMultiplier ?? seed.timeModel?.timeMultiplier ?? null,
        scalingMode: timeModel.scalingMode || 'exponential'
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
        update: { $set: definition },
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
    const nextCache = createTypeCache();

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
      display: definition.display || { name: definition.entityId, icon: '', category: '', description: '' },
      costModel: {
        baseCost: definition.costModel?.baseCost || { metal: 0, crystal: 0, deuterium: 0 },
        costMultiplier: definition.costModel?.costMultiplier ?? 1.5,
        scalingMode: definition.costModel?.scalingMode || 'exponential'
      },
      timeModel: {
        baseTime: definition.timeModel?.baseTime ?? 0,
        timeMultiplier: definition.timeModel?.timeMultiplier ?? definition.costModel?.costMultiplier ?? 1.5,
        scalingMode: definition.timeModel?.scalingMode || 'exponential'
      },
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
        // 💾 Sync back to source file for persistence across restarts
        await this.syncToFile();
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

  /**
   * Persist the current catalog back into server/data/catalog/*.js so admin
   * edits survive restarts (ensureSeedData treats those files as the seed).
   * A timestamped backup of each rewritten file is kept next to it.
   */
  async syncToFile() {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

    for (const entityType of ENTITY_TYPES) {
      const { file, header } = CATALOG_FILES[entityType];
      const filePath = path.join(CATALOG_DIR, file);
      const specs = this.listByType(entityType).map((definition) => definitionToSpec(definition));
      const content = serializeCatalogModule(header, specs);

      try {
        const current = await fs.readFile(filePath, 'utf8').catch(() => null);
        if (current === content) continue;
        if (current !== null) {
          const backupPath = path.join(CATALOG_DIR, 'backups', `${path.basename(file, '.js')}_${timestamp}.js`);
          await fs.mkdir(path.dirname(backupPath), { recursive: true });
          await fs.writeFile(backupPath, current, 'utf8');
        }
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`[EntityConfigService] Synced ${entityType} catalog to ${filePath}`);
      } catch (err) {
        console.error(`[EntityConfigService] Failed to sync ${entityType} catalog:`, err);
      }
    }
  }

  /**
   * Player-facing view of the catalog (no admin metadata).
   * @returns {{ revision: number, entities: object[] }}
   */
  toPublicCatalog() {
    const entities = [];
    for (const entityType of ENTITY_TYPES) {
      for (const definition of this.cache.get(entityType)?.values() || []) {
        if (definition.status !== 'active') continue;
        entities.push({
          entityType,
          entityId: definition.entityId,
          display: definition.display,
          requirements: definition.requirements,
          costModel: definition.costModel,
          timeModel: definition.timeModel,
          effects: definition.effects,
          stats: definition.stats
        });
      }
    }
    return { revision: this.revision, entities: this._clone(entities) };
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
