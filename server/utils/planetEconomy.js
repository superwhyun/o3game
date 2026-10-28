const { calculatePopulation } = require('./populationEconomy');
const { productionModifiers } = require('./planetArea');
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

  const population = calculatePopulation(planet, config || {});
  if (population) storage.food = population.foodCapacity;
  return storage;
}

function calculateEnergyState(planet) {
  const modifiers = productionModifiers(planet);
  let production = 0, consumption = 0;
  const sources = [];
  for (const definition of entityConfigService.listByType('building')) {
    const level = planet.buildings?.[definition.entityId] || 0;
    const amount = evaluateScaledFormula(definition.effects?.energyProduction?.amount, level) * (definition.entityId === 'solarPlant' ? modifiers.solar : 1);
    production += amount;
    if (amount > 0) sources.push({ id: definition.entityId, name: definition.display?.name || definition.entityId, amount });
    consumption += evaluateScaledFormula(definition.effects?.energyConsumption?.amount, level);
  }
  const satellites = Math.max(0, Math.floor(Number(planet.fleet?.solarSatellite) || 0));
  // Static power, unaffected by server speed. Warm planets yield more power.
  const satellitePerUnit = Math.max(0, Math.floor(((planet.maxTemp ?? 40) + 160) / 6));
  const satelliteProduction = satellites * satellitePerUnit;
  production += satelliteProduction;
  sources.push({ id: 'solarSatellite', name: '태양광 인공위성', count: satellites, perUnit: satellitePerUnit, amount: satelliteProduction });
  return { production, consumption, balance: production - consumption, sources };
}

function calculateProduction(planet, speed = 1, resourceSettings = {}, config = {}) {
  const population = calculatePopulation(planet, { populationSettings: config.populationSettings, serverSpeed: speed });
  const baseProd = resourceSettings.baseProduction || {};
  const production = {
    metal: (baseProd.metal ?? 30) * speed,
    crystal: (baseProd.crystal ?? 15) * speed,
    deuterium: (baseProd.deuterium ?? 0) * speed,
    energy: 0
  };
  const multiplier = resourceSettings.productionMultiplier ?? 1;
  const modifiers = productionModifiers(planet);

  const definitions = entityConfigService.listByType('building');

  for (const definition of definitions) {
    const level = planet.buildings?.[definition.entityId] || 0;
    if (!level) continue;

    if (definition.effects?.production) {
      for (const [resource, rule] of Object.entries(definition.effects.production)) {
        const staffing = population?.jobs[definition.entityId]?.ratio ?? 1;
        const efficiency = population && definition.effects?.population?.jobsPerLevel ? staffing * population.productionMultiplier : 1;
        production[resource] += evaluateScaledFormula(rule, level) * (modifiers[resource] ?? 1) * multiplier * speed * efficiency;
      }
    }

  }

  for (const resource of ['metal', 'deuterium']) production[resource] -= planet.$locals?.fleetSupport?.hourly?.[resource] || 0;
  if (population) production.food = population.foodNet;
  production.energy = calculateEnergyState(planet).balance;
  return production;
}

function clampResourcesToStorage(resources, storage) {
  resources.metal = Math.max(0, Math.min(isNaN(resources.metal) ? 0 : (resources.metal || 0), storage.metal));
  resources.crystal = Math.min(isNaN(resources.crystal) ? 0 : (resources.crystal || 0), storage.crystal);
  resources.deuterium = Math.max(0, Math.min(isNaN(resources.deuterium) ? 0 : (resources.deuterium || 0), storage.deuterium));
  if (storage.food !== undefined) resources.food = Math.max(0, Math.min(Number.isFinite(resources.food) ? resources.food : 0, storage.food));
  resources.energy = isNaN(resources.energy) ? 0 : (resources.energy || 0);
}

function applyOfflineProduction(planet, config, now = new Date()) {
  const speed = config.serverSpeed || 1;
  const storage = calculateStorage(planet, config);
  const rawLast = new Date(planet.lastUpdate || now).getTime();
  const requested = new Date(now).getTime();
  const last = Number.isFinite(rawLast) ? rawLast : requested;
  const end = Number.isFinite(requested) ? Math.max(requested, last) : last;
  let remaining = Math.max(0, (end - last) / 3600000);
  clampResourcesToStorage(planet.resources, storage);

  // Rates are constant between births, food exhaustion and queue completions.
  // Integrate those events rather than request-sized ticks, so repeated reads
  // and one long offline settlement produce the same state.
  while (remaining > 1e-12) {
    const population = calculatePopulation(planet, config);
    const production = calculateProduction(planet, speed, config.resourceSettings || {}, config);
    let hours = remaining;
    let birthHours = Infinity;
    let emptyHours = Infinity;
    let deathHours = Infinity;
    if (population?.starving && population.count > 0) {
      deathHours = (1 - population.starvationProgress) * population.starvationHours;
      hours = Math.min(hours, deathHours);
    } else if (population) planet.population.starvationProgress = 0;
    if (population?.growthAllowed) {
      birthHours = Math.max(0, (1 - planet.population.growthProgress) * population.growthHours);
      hours = Math.min(hours, birthHours);
    }
    if (population && production.food < -1e-9 && planet.resources.food > 1e-9) {
      emptyHours = planet.resources.food / -production.food;
      hours = Math.min(hours, emptyHours);
    }
    for (const resource of ['metal', 'crystal', 'deuterium']) {
      planet.resources[resource] = (planet.resources[resource] || 0) + production[resource] * hours;
    }
    if (population) {
      planet.resources.food += production.food * hours;
      if (population.growthAllowed) planet.population.growthProgress += hours / population.growthHours;
      if (population.starving && population.count > 0) {
        planet.population.starvationProgress = population.starvationProgress + hours / population.starvationHours;
        if (deathHours <= hours + 1e-12) {
          planet.population.count = Math.max(0, planet.population.count - 1);
          planet.population.starvationProgress = 0;
        }
      }
      if (birthHours <= hours + 1e-12) {
        planet.population.count += 1;
        planet.population.growthProgress = 0;
      }
      if (emptyHours <= hours + 1e-12) planet.resources.food = 0;
    }
    clampResourcesToStorage(planet.resources, storage);
    remaining = Math.max(0, remaining - hours);
  }
  if (!calculatePopulation(planet, config)?.starving) {
    if (planet.population) planet.population.starvationProgress = 0;
  }
  const production = calculateProduction(planet, speed, config.resourceSettings || {}, config);
  planet.resources.energy = production.energy;
  planet.lastUpdate = new Date(end);
  return { storage, production };
}

async function applyPlanetEconomyState(planet, config = null) {
  const resolvedConfig = config || await GameConfig.getConfig();
  return applyOfflineProduction(planet, resolvedConfig, new Date());
}

module.exports = {
  calculateEnergyState,
  calculateProduction,
  calculateStorage,
  clampResourcesToStorage,
  applyOfflineProduction,
  applyPlanetEconomyState
};
