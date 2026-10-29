const entities = require('../services/EntityConfigService');

const DEFAULTS = Object.freeze({
  initialPopulation: 10, initialHousingExtra: 5, initialFoodHours: 24,
  foodStorage: 1000, foodConsumptionPerPopulation: 1, growthHours: 2,
  minimumGrowthHappiness: 40, baseHappiness: 50, cultureHappinessRange: 30,
  overcrowdingPenalty: 30, starvationPenalty: 30, stabilitySensitivity: 0.5,
  productionSensitivity: 0.01
});
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
function settings(config = {}) {
  const source = config.populationSettings?.toObject?.() || config.populationSettings || {};
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(source).filter(([, n]) => Number.isFinite(n))) };
}
function demands(planet) {
  return entities.listByType('building').map(def => {
    const level = Math.max(0, planet.buildings?.[def.entityId] || 0);
    const effect = def.effects?.population || {};
    return { id: def.entityId, name: def.display?.name || def.entityId, level,
      jobs: level * (effect.jobsPerLevel || 0),
      housing: level * (effect.housingPerLevel || 0),
      food: level * (effect.foodPerLevel || 0),
      foodStorage: level * (effect.foodStoragePerLevel || 0),
      culture: level * (effect.culturePerLevel || 0),
      knowledge: level * (effect.knowledgePerLevel || 0),
      health: level * (effect.healthPerLevel || 0) };
  });
}

// Explicit one-time transition, called only after the old economy is settled.
function initializePopulation(planet, config = {}) {
  if (planet.population?.version === 1) return false;
  const s = settings(config);
  const count = Math.ceil(Math.max(s.initialPopulation, demands(planet).reduce((n, d) => n + d.jobs, 0)));
  const startingFood = count * s.foodConsumptionPerPopulation * s.initialFoodHours;
  planet.population = {
    version: 1, count, growthProgress: 0, starvationProgress: 0,
    baseHousing: count + s.initialHousingExtra,
    baseFood: count * s.foodConsumptionPerPopulation,
    baseCulture: count, foodCapacity: Math.max(s.foodStorage, startingFood)
  };
  if (!planet.resources) planet.resources = {};
  planet.resources.food = startingFood;
  return true;
}

function calculatePopulation(planet, config = {}) {
  if (planet.population?.version !== 1) return null;
  const s = settings(config), p = planet.population;
  const speed = Math.max(0.01, config.serverSpeed || 1);
  const count = Math.max(0, p.count || 0), rows = demands(planet);
  const researchEffects = {};
  for (const def of entities.listByType('research')) {
    const level = Math.max(0, planet.research?.[def.entityId] || 0);
    for (const [key, value] of Object.entries(def.effects?.population || {})) {
      researchEffects[key] = (researchEffects[key] || 0) + level * value;
    }
  }
  const bonus = key => 1 + (researchEffects[`${key}BonusPerLevel`] || 0);
  let available = count;
  const jobs = {};
  for (const type of ['food', 'culture', 'health', 'knowledge', 'resources']) {
    const group = rows.filter(d => d.jobs > 0 && (d.food > 0 ? 'food' : d.culture > 0 ? 'culture' : d.health > 0 ? 'health' : d.knowledge > 0 ? 'knowledge' : 'resources') === type);
    const needed = group.reduce((n, d) => n + d.jobs, 0);
    const ratio = needed ? Math.min(1, available / needed) : 1;
    for (const d of group) jobs[d.id] = { name: d.name, required: d.jobs, assigned: d.jobs * ratio, ratio };
    available = Math.max(0, available - needed * ratio);
  }
  const housing = p.baseHousing + rows.reduce((n, d) => n + d.housing * bonus('housing'), 0);
  const foodProduction = (p.baseFood + rows.reduce((n, d) => n + d.food * (jobs[d.id]?.ratio ?? 1) * bonus('food'), 0)) * speed;
  const fleetFood = planet.$locals?.fleetSupport?.hourly?.food || 0;
  const foodConsumption = count * s.foodConsumptionPerPopulation * speed + fleetFood;
  const foodNet = foodProduction - foodConsumption;
  const culture = p.baseCulture + rows.reduce((n, d) => n + d.culture * (jobs[d.id]?.ratio ?? 1), 0);
  const knowledgeCapacity = rows.reduce((n, d) => n + d.knowledge * (jobs[d.id]?.ratio ?? 1) * bonus('knowledge'), 0);
  const healthCapacity = rows.reduce((n, d) => n + d.health * (jobs[d.id]?.ratio ?? 1) * bonus('health'), 0);
  const knowledge = count ? 100 * clamp(knowledgeCapacity / count, 0, 1) : 0;
  const health = count ? 100 * clamp(healthCapacity / count, 0, 1) : 0;
  const healthEffect = health * 0.1;
  const policyEffect = researchEffects.happinessPerLevel || 0;
  const knowledgeMultiplier = 1 + knowledge * 0.0025;
  const cultureEffect = s.cultureHappinessRange * clamp(count ? culture / count - 1 : 0, -1, 1);
  const housingEffect = -s.overcrowdingPenalty * clamp(count ? (count - housing) / count : 0, 0, 1);
  const starving = (planet.resources.food || 0) <= 1e-9 && foodNet < -1e-9;
  const foodEffect = starving ? -s.starvationPenalty : 0;
  const happiness = clamp(s.baseHappiness + cultureEffect + housingEffect + foodEffect + healthEffect + policyEffect, 0, 100);
  const stability = clamp(50 + (happiness - 50) * s.stabilitySensitivity, 0, 100);
  const happinessMultiplier = Math.max(0, 1 + (stability - 50) * s.productionSensitivity);
  const productionMultiplier = happinessMultiplier * knowledgeMultiplier;
  const growthBlockers = [];
  if (count + 1 > housing) growthBlockers.push('주거 부족');
  if (foodNet < -1e-9) growthBlockers.push('식량 공급 부족');
  if (happiness < s.minimumGrowthHappiness) growthBlockers.push('행복도 부족');
  const growthHours = Math.max(0.01, s.growthHours) / speed / (1 + health * 0.0025);
  const starvationHours = Math.max(0.01, s.growthHours) / speed;
  const starvationProgress = starving && count > 0 ? clamp(p.starvationProgress || 0, 0, 1) : 0;
  return {
    starvationProgress, starvationHours,
    nextStarvationSeconds: starving && count > 0 ? (1 - starvationProgress) * starvationHours * 3600 : null,
    count, housing, culture, happiness, stability, productionMultiplier,
    knowledge, knowledgeCapacity, health, healthCapacity, happinessMultiplier, knowledgeMultiplier, researchEffects,
    foodProduction, foodConsumption, foodNet, starving, fleetFoodConsumption: fleetFood,
    foodCapacity: Math.max(s.foodStorage, p.foodCapacity || 0) + rows.reduce((n, d) => n + d.foodStorage, 0),
    jobs, employed: count - available, unemployed: available,
    growthProgress: p.growthProgress || 0, growthHours,
    growthAllowed: growthBlockers.length === 0, growthBlockers,
    nextGrowthSeconds: growthBlockers.length ? null : (1 - (p.growthProgress || 0)) * growthHours * 3600,
    happinessReasons: { base: s.baseHappiness, culture: cultureEffect, housing: housingEffect, food: foodEffect, health: healthEffect, policy: policyEffect },
    support: { housing: p.baseHousing, food: p.baseFood * speed, culture: p.baseCulture }
  };
}
module.exports = { DEFAULTS, settings, initializePopulation, calculatePopulation };
