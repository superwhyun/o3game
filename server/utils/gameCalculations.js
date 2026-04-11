const entityConfigService = require('../services/EntityConfigService');

function scaleByTier(baseValue, level, tierMultipliers = [], fallbackMultiplier = null, field = 'costMult') {
  if (baseValue == null || isNaN(baseValue)) return 0;
  
  // Ensure level is a valid number
  const safeLevel = isNaN(level) ? 0 : Math.max(0, level);
  if (safeLevel <= 1) return Math.floor(baseValue);

  if (!tierMultipliers || tierMultipliers.length === 0) {
    const mult = fallbackMultiplier == null || isNaN(fallbackMultiplier) ? 1 : fallbackMultiplier;
    return Math.floor(baseValue * Math.pow(mult, safeLevel - 1));
  }

  let totalMultiplier = 1;
  let remainingLevels = safeLevel - 1;

  for (const tier of tierMultipliers) {
    if (remainingLevels <= 0) break;
    const multiplier = tier[field] ?? fallbackMultiplier ?? 1;
    const safeMult = isNaN(multiplier) ? 1 : multiplier;
    const tierStart = tier.startLevel || 1;
    const tierEnd = tier.endLevel || tierStart;
    const levelsInTier = Math.min(remainingLevels, Math.max(0, tierEnd - tierStart + 1));
    
    totalMultiplier *= Math.pow(safeMult, levelsInTier);
    remainingLevels -= levelsInTier;
  }

  const result = Math.floor(baseValue * totalMultiplier);
  return isNaN(result) ? Math.floor(baseValue) : result;
}

function getEntityDefinition(entityType, entityId) {
  return entityConfigService.getEntity(entityType, entityId);
}

function applyConstructionModifiers(duration, entityType, buildings = {}) {
  let adjusted = duration;

  for (const [buildingId, level] of Object.entries(buildings || {})) {
    if (!level) continue;
    const definition = getEntityDefinition('building', buildingId);
    const modifiers = definition?.effects?.constructionModifiers || [];

    for (const modifier of modifiers) {
      if (!modifier.targetTypes?.includes(entityType)) continue;

      if (modifier.mode === 'powerMultiplier') {
        adjusted *= Math.pow(modifier.value || 1, level);
      } else if (modifier.mode === 'linearDivider') {
        adjusted /= (modifier.base || 1) + (level * (modifier.value || 0));
      }
    }
  }

  return adjusted;
}

async function calculateBuildingCost(buildingId, level) {
  const definition = getEntityDefinition('building', buildingId);
  if (!definition) return null;

  const cost = {};
  const baseCost = definition.costModel?.baseCost || {};
  const tierMultipliers = definition.costModel?.tierMultipliers || [];
  const fallbackMultiplier = definition.costModel?.costMultiplier ?? null;

  for (const [resource, baseAmount] of Object.entries(baseCost)) {
    if (baseAmount > 0) {
      cost[resource] = scaleByTier(baseAmount, level, tierMultipliers, fallbackMultiplier, 'costMult');
    }
  }

  return cost;
}

async function calculateResearchCost(researchId, currentLevel) {
  const definition = getEntityDefinition('research', researchId);
  if (!definition) return null;

  const targetLevel = currentLevel + 1;
  const cost = {};
  const baseCost = definition.costModel?.baseCost || {};
  const tierMultipliers = definition.costModel?.tierMultipliers || [];
  const fallbackMultiplier = definition.costModel?.costMultiplier ?? null;

  for (const [resource, baseAmount] of Object.entries(baseCost)) {
    if (baseAmount > 0) {
      cost[resource] = scaleByTier(baseAmount, targetLevel, tierMultipliers, fallbackMultiplier, 'costMult');
    }
  }

  return cost;
}

async function calculateShipCost(shipId, count = 1) {
  const definition = getEntityDefinition('ship', shipId);
  if (!definition) return null;

  const cost = {};
  const baseCost = definition.costModel?.baseCost || {};
  for (const [resource, baseAmount] of Object.entries(baseCost)) {
    if (baseAmount > 0) {
      cost[resource] = baseAmount * count;
    }
  }
  return cost;
}

function calculateQueueDuration(entityType, entityId, level, buildings = {}, count = 1, options = {}) {
  const definition = getEntityDefinition(entityType, entityId);
  if (!definition) return null;

  const serverSpeed = options.serverSpeed || 1;
  const timeMultiplier = options.timeMultiplier || 1;

  const baseTime = scaleByTier(
    definition.timeModel?.baseTime ?? 0,
    entityType === 'ship' ? 1 : level,
    definition.timeModel?.tierMultipliers || [],
    definition.timeModel?.timeMultiplier ?? definition.costModel?.costMultiplier ?? null,
    'timeMult'
  );

  let duration = baseTime;

  duration = applyConstructionModifiers(duration, entityType, buildings);

  if (entityType === 'ship') {
    duration *= count;
  }

  // Apply server-wide speed factors
  // duration = (baseTime / serverSpeed) * timeMultiplier
  // Note: timeMultiplier in config is typically used for specific categories (like buildTimeMultiplier)
  const finalDuration = (duration / serverSpeed) * timeMultiplier;

  return Math.max(1, Math.floor(finalDuration));
}

module.exports = {
  calculateBuildingCost,
  calculateResearchCost,
  calculateShipCost,
  calculateQueueDuration,
  getEntityDefinition,
  scaleByTier
};
