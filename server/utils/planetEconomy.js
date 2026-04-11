const GameConfig = require('../models/GameConfig');
const entityConfigService = require('../services/EntityConfigService');

function evaluateScaledFormula(definition, level = 0) {
  if (!definition) return 0;

  let result = 0;
  if (definition.kind === 'scaled') {
    if (level === 0) result = 0;
    else result = definition.coefficient * level * Math.pow(definition.growth || 1, level);
  } else if (definition.kind === 'storage') {
    const denom = definition.exponentDenominator || 1;
    result = (definition.base || 10000) * Math.floor(
      (definition.multiplier || 1) *
      Math.exp((definition.exponentNumerator || 0) * level / denom)
    );
  }

  return isNaN(result) ? 0 : result;
}

function calculateStorage(planet, config = null) {
  const defaultStorage = config?.resourceSettings?.defaultStorage || {
    metal: 10000,
    crystal: 10000,
    deuterium: 10000
  };

  const storage = {
    metal: defaultStorage.metal ?? 10000,
    crystal: defaultStorage.crystal ?? 10000,
    deuterium: defaultStorage.deuterium ?? 10000
  };

  const definitions = entityConfigService.listByType('building');
  for (const definition of definitions) {
    const level = planet.buildings?.[definition.entityId] || 0;
    if (!definition.effects?.storage) continue;

    for (const [resource, rule] of Object.entries(definition.effects.storage)) {
      storage[resource] = Math.max(storage[resource] || 0, evaluateScaledFormula(rule, level));
    }
  }

  return storage;
}

function calculateProduction(planet, speed = 1, resourceSettings = {}) {
  const baseProd = resourceSettings.baseProduction || {};
  const production = {
    metal: (baseProd.metal ?? 30) * speed,
    crystal: (baseProd.crystal ?? 15) * speed,
    deuterium: (baseProd.deuterium ?? 0) * speed,
    energy: 0
  };
  const multiplier = resourceSettings.productionMultiplier || 1;

  let energyProduction = 0;
  let energyConsumption = 0;
  const definitions = entityConfigService.listByType('building');

  for (const definition of definitions) {
    const level = planet.buildings?.[definition.entityId] || 0;
    if (!level) continue;

    if (definition.effects?.production) {
      for (const [resource, rule] of Object.entries(definition.effects.production)) {
        production[resource] += evaluateScaledFormula(rule, level) * multiplier * speed;
      }
    }

    if (definition.effects?.energyProduction?.amount) {
      energyProduction += evaluateScaledFormula(definition.effects.energyProduction.amount, level);
    }

    if (definition.effects?.energyConsumption?.amount) {
      energyConsumption += evaluateScaledFormula(definition.effects.energyConsumption.amount, level);
    }
  }

  production.energy = energyProduction - energyConsumption;
  return production;
}

function clampResourcesToStorage(resources, storage) {
  resources.metal = Math.min(isNaN(resources.metal) ? 0 : (resources.metal || 0), storage.metal);
  resources.crystal = Math.min(isNaN(resources.crystal) ? 0 : (resources.crystal || 0), storage.crystal);
  resources.deuterium = Math.min(isNaN(resources.deuterium) ? 0 : (resources.deuterium || 0), storage.deuterium);
  resources.energy = isNaN(resources.energy) ? 0 : (resources.energy || 0);
}

function applyOfflineProduction(planet, config, now = new Date()) {
  const speed = config.serverSpeed || 1;
  const storage = calculateStorage(planet, config);
  const production = calculateProduction(planet, speed, config.resourceSettings || {});
  
  const lastUpdateRaw = planet.lastUpdate || now;
  const lastUpdate = new Date(lastUpdateRaw);
  
  // Ensure lastUpdate is a valid date
  let hoursOffline = 0;
  if (!isNaN(lastUpdate.getTime())) {
    hoursOffline = Math.max(0, (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60));
  }
  
  // Final safeguard for hoursOffline
  if (isNaN(hoursOffline)) hoursOffline = 0;

  if (hoursOffline > 0 && hoursOffline < 168) {
    planet.resources.metal = (planet.resources.metal || 0) + (production.metal * hoursOffline);
    planet.resources.crystal = (planet.resources.crystal || 0) + (production.crystal * hoursOffline);
    planet.resources.deuterium = (planet.resources.deuterium || 0) + (production.deuterium * hoursOffline);
  }

  clampResourcesToStorage(planet.resources, storage);
  planet.resources.energy = production.energy;
  planet.lastUpdate = now;

  return {
    storage,
    production
  };
}

async function applyPlanetEconomyState(planet, config = null) {
  const resolvedConfig = config || await GameConfig.getConfig();
  return applyOfflineProduction(planet, resolvedConfig, new Date());
}

module.exports = {
  calculateProduction,
  calculateStorage,
  clampResourcesToStorage,
  applyOfflineProduction,
  applyPlanetEconomyState
};
