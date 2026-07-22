const entityConfigService = require('../services/EntityConfigService');

function scaleExponentially(baseValue, level, multiplier = null) {
  if (baseValue == null || isNaN(baseValue)) return 0;
  
  // Ensure level is a valid number
  const safeLevel = isNaN(level) ? 0 : Math.max(0, level);
  if (safeLevel <= 1) return Math.floor(baseValue);

  const mult = (multiplier == null || isNaN(multiplier) || multiplier < 1) ? 1.5 : multiplier;
  const result = Math.floor(baseValue * Math.pow(mult, safeLevel - 1));
  
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
  const baseCost = (definition.costModel && definition.costModel.baseCost) ? definition.costModel.baseCost : {};
  const costMultiplier = (definition.costModel && definition.costModel.costMultiplier !== undefined && definition.costModel.costMultiplier !== null) 
    ? definition.costModel.costMultiplier 
    : 1.5;

  for (const [resource, baseAmount] of Object.entries(baseCost)) {
    if (baseAmount > 0) {
      cost[resource] = scaleExponentially(baseAmount, level, costMultiplier);
    }
  }

  return cost;
}

async function calculateResearchCost(researchId, currentLevel) {
  const definition = getEntityDefinition('research', researchId);
  if (!definition) return null;

  const targetLevelForCost = currentLevel + 1;
  const cost = {};
  const baseCost = (definition.costModel && definition.costModel.baseCost) ? definition.costModel.baseCost : {};
  const costMultiplier = (definition.costModel && definition.costModel.costMultiplier !== undefined && definition.costModel.costMultiplier !== null) 
    ? definition.costModel.costMultiplier 
    : 1.5;

  for (const [resource, baseAmount] of Object.entries(baseCost)) {
    if (baseAmount > 0) {
      cost[resource] = scaleExponentially(baseAmount, targetLevelForCost, costMultiplier);
    }
  }

  return cost;
}

async function calculateShipCost(shipId, count = 1) {
  return calculateUnitCost('ship', shipId, count);
}

async function calculateUnitCost(entityType, entityId, count = 1) {
  const definition = getEntityDefinition(entityType, entityId);
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

  const baseTime = scaleExponentially(
    definition.timeModel?.baseTime ?? 0,
    ['ship', 'defense'].includes(entityType) ? 1 : level,
    definition.timeModel?.timeMultiplier ?? definition.costModel?.costMultiplier ?? 1.5
  );

  let duration = baseTime;

  duration = applyConstructionModifiers(duration, entityType, buildings);

  if (['ship', 'defense'].includes(entityType)) {
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
  calculateUnitCost,
  calculateQueueDuration,
  getEntityDefinition,
  scaleExponentially
};
