/**
 * Entity catalog schema.
 *
 * Every game entity (building / research / ship / defense) is authored as ONE
 * self-contained "spec" object inside ./buildings.js, ./research.js, ./ships.js
 * or ./defense.js. This module converts specs into the normalized definition
 * shape consumed by EntityConfigService (and back, for syncToFile).
 *
 * Spec fields:
 *   id            (required) camelCase unique id within its type
 *   name, icon, category, description   display info
 *   cost          { metal, crystal, deuterium } base cost (level 1 / per unit)
 *   costMultiplier  per-level cost growth (building/research only)
 *   timeMultiplier  per-level time growth, defaults to costMultiplier
 *   buildTime     base seconds
 *   requires      { buildings: { id: level }, research: { id: level } }
 *   effects       building effects (production, storage, constructionModifiers…)
 *   stats         combat/fleet stats (ship/defense)
 *   model         3D model spec — see ogame-3d/src/three/entities and ships
 *   status        'active' | 'draft' | 'disabled' (default 'active')
 */

const ENTITY_TYPES = ['building', 'research', 'ship', 'defense'];
const LEVELED_TYPES = ['building', 'research'];
const RESOURCE_KEYS = ['metal', 'crystal', 'deuterium'];
const ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

function normalizeCost(cost = {}) {
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, Number(cost[key]) || 0]));
}

function compactRequirements(requires = {}) {
  const result = {};
  for (const group of ['buildings', 'research']) {
    const entries = Object.entries(requires[group] || {});
    if (entries.length > 0) result[group] = Object.fromEntries(entries);
  }
  return result;
}

/**
 * Convert an authored spec into the normalized definition shape.
 * @param {string} entityType
 * @param {object} spec
 * @returns {object}
 */
function specToDefinition(entityType, spec) {
  const isLeveled = LEVELED_TYPES.includes(entityType);
  const costMultiplier = isLeveled ? (spec.costMultiplier ?? 1.5) : null;
  const display = {
    name: spec.name || spec.id,
    icon: spec.icon || '',
    category: spec.category || '',
    description: spec.description || ''
  };
  if (spec.model) display.model = spec.model;

  return {
    entityType,
    entityId: spec.id,
    status: spec.status || 'active',
    schemaVersion: 2,
    revision: 1,
    display,
    requirements: compactRequirements(spec.requires),
    costModel: {
      baseCost: normalizeCost(spec.cost),
      costMultiplier,
      scalingMode: 'exponential'
    },
    timeModel: {
      baseTime: spec.buildTime ?? null,
      timeMultiplier: isLeveled ? (spec.timeMultiplier ?? costMultiplier) : null,
      scalingMode: 'exponential'
    },
    effects: spec.effects || {},
    stats: spec.stats || {},
    metadata: { seeded: true }
  };
}

function omitEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
      return true;
    })
  );
}

/**
 * Convert a normalized definition back to an authored spec (used by syncToFile).
 * @param {object} definition
 * @returns {object}
 */
function definitionToSpec(definition) {
  const isLeveled = LEVELED_TYPES.includes(definition.entityType);
  const costMultiplier = definition.costModel?.costMultiplier ?? null;
  const timeMultiplier = definition.timeModel?.timeMultiplier ?? null;
  const cost = omitEmpty(normalizeCost(definition.costModel?.baseCost));

  return omitEmpty({
    id: definition.entityId,
    name: definition.display?.name,
    icon: definition.display?.icon,
    category: definition.display?.category,
    description: definition.display?.description,
    status: definition.status && definition.status !== 'active' ? definition.status : undefined,
    cost: Object.keys(cost).length > 0 ? cost : { metal: 0 },
    costMultiplier: isLeveled ? costMultiplier : undefined,
    timeMultiplier: isLeveled && timeMultiplier !== costMultiplier ? timeMultiplier : undefined,
    buildTime: definition.timeModel?.baseTime,
    requires: compactRequirements(definition.requirements),
    effects: definition.effects,
    stats: definition.stats,
    model: definition.display?.model
  });
}

/**
 * Validate the full catalog. Throws with every problem listed so a bad edit
 * fails fast at server boot instead of silently breaking gameplay.
 * @param {Record<string, object[]>} specsByType
 */
function validateCatalog(specsByType) {
  const errors = [];
  const idsByType = {};

  for (const entityType of ENTITY_TYPES) {
    const specs = specsByType[entityType] || [];
    const seen = new Set();
    for (const spec of specs) {
      const label = `${entityType}:${spec?.id ?? '?'}`;
      if (!spec || typeof spec.id !== 'string' || !ID_PATTERN.test(spec.id)) {
        errors.push(`${label} has an invalid id (expected camelCase)`);
        continue;
      }
      if (seen.has(spec.id)) errors.push(`${label} is defined twice`);
      seen.add(spec.id);
      if (spec.model && ['building', 'research'].includes(entityType)) {
        if (spec.model.kind !== entityType || !ID_PATTERN.test(spec.model.archetype || '') || !Number.isInteger(spec.model.styleVersion) || spec.model.styleVersion < 1) errors.push(`${label} has an invalid visual model`);
      }
      if (!spec.name) errors.push(`${label} is missing a name`);
      if (!(Number(spec.buildTime) > 0)) errors.push(`${label} needs a positive buildTime`);
      for (const [key, value] of Object.entries(spec.cost || {})) {
        if (!RESOURCE_KEYS.includes(key)) errors.push(`${label} has unknown cost resource "${key}"`);
        else if (!(Number(value) >= 0)) errors.push(`${label} has an invalid ${key} cost`);
      }
    }
    idsByType[entityType] = seen;
  }

  const groupToType = { buildings: 'building', research: 'research' };
  for (const entityType of ENTITY_TYPES) {
    for (const spec of specsByType[entityType] || []) {
      for (const [group, targetType] of Object.entries(groupToType)) {
        for (const [requiredId, level] of Object.entries(spec.requires?.[group] || {})) {
          if (!idsByType[targetType].has(requiredId)) {
            errors.push(`${entityType}:${spec.id} requires unknown ${targetType} "${requiredId}"`);
          }
          if (!Number.isInteger(level) || level < 1) {
            errors.push(`${entityType}:${spec.id} requires ${requiredId} with invalid level ${level}`);
          }
        }
      }
      for (const targetId of Object.keys(spec.stats?.rapidFire || {})) {
        if (!idsByType.ship.has(targetId) && !idsByType.defense.has(targetId)) {
          errors.push(`${entityType}:${spec.id} has rapidFire against unknown unit "${targetId}"`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Entity catalog is invalid:\n  - ${errors.join('\n  - ')}`);
  }
}

module.exports = {
  ENTITY_TYPES,
  LEVELED_TYPES,
  RESOURCE_KEYS,
  specToDefinition,
  definitionToSpec,
  validateCatalog
};
