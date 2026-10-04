const AREA_SCALE_KM = 800; // 12,800km home: 256 total, 102 initially usable.
const TERRAFORMING_PERCENT_PER_LEVEL = 2;
const TERRAFORMING_MAX_LEVEL = 30;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const object = value => value?.toObject ? value.toObject() : (value || {});
function totalArea(planet) {
  return Math.floor(Math.pow(Math.max(0, planet.diameter ?? 12800) / AREA_SCALE_KM, 2));
}
function usedArea(planet) {
  return Object.values(object(planet.buildings)).reduce((sum, level) => sum + Math.max(0, Number(level) || 0), 0);
}
function calculateArea(planet, terraformLevel = 0, queues = [], planetId = '0') {
  const total = totalArea(planet);
  const baseUsablePercent = clamp(planet.baseUsablePercent ?? 40, 0, 100);
  const usablePercent = Math.min(100, baseUsablePercent + Math.max(0, terraformLevel) * TERRAFORMING_PERCENT_PER_LEVEL);
  const usable = Math.floor(total * usablePercent / 100 + 1e-9);
  const used = usedArea(planet);
  const reserved = queues.filter(q => q.type === 'building' && q.action !== 'demolish'
    && String(q.planetId ?? '0') === String(planetId) && !q.applied
    && ['building', 'pending'].includes(q.status)).length;
  return { total, baseUsablePercent, usablePercent, usable, used, reserved,
    available: Math.max(0, usable - used - reserved), overCapacity: used + reserved > usable };
}
function productionModifiers(planet) {
  const temperature = ((planet.minTemp ?? -20) + (planet.maxTemp ?? 40)) / 2;
  const solar = clamp(1 + (temperature - 10) * 0.002, 0.8, 1.2);
  return { metal: clamp(planet.traits?.metal ?? 1, 0.8, 1.2),
    crystal: clamp(planet.traits?.crystal ?? 1, 0.8, 1.2),
    deuterium: clamp(1 - (temperature - 10) * 0.002, 0.8, 1.2), solar };
}
function createPlanetTraits(random = Math.random) {
  return { baseUsablePercent: 40 + Math.floor(random() * 6) * 2,
    traits: { metal: Math.round((0.8 + random() * 0.4) * 100) / 100,
      crystal: Math.round((0.8 + random() * 0.4) * 100) / 100 } };
}
function createPlanetEnvironment(random = Math.random) {
  const minerals = createPlanetTraits(random).traits;
  const minTemp = -100 + Math.floor(random() * 161);
  const maxTemp = minTemp + 40;
  const average = (minTemp + maxTemp) / 2;
  const baseUsablePercent = average < -30 ? 40 : average > 50 ? 44 : 50;
  return { minTemp, maxTemp, baseUsablePercent, traits: minerals };
}
function normalizeLegacyArea(planet, queues = [], planetId = '0') {
  if (planet.areaVersion === 1) return false;
  const area = calculateArea(planet, 0, queues, planetId);
  // Preserve existing buildings/reservations, but never enlarge the planet.
  const required = area.used + area.reserved;
  planet.baseUsablePercent = area.total > 0
    ? Math.min(100, Math.max(planet.baseUsablePercent ?? 40, Math.ceil(required / area.total * 100))) : 40;
  planet.traits = { metal: planet.traits?.metal ?? 1, crystal: planet.traits?.crystal ?? 1 };
  planet.areaVersion = 1;
  return true;
}
function planetIndex(user, value = user.currentPlanet ?? 0) {
  const str = String(value);
  const index = /^\d+$/.test(str) ? Number(str) : -1;
  if (!Number.isSafeInteger(index) || !user.planets[index]) {
    throw Object.assign(new Error('소유한 행성을 선택해 주세요.'), { code: 'INVALID_PLANET', statusCode: 400 });
  }
  return index;
}
module.exports = { AREA_SCALE_KM, TERRAFORMING_PERCENT_PER_LEVEL, TERRAFORMING_MAX_LEVEL,
  totalArea, usedArea, calculateArea, productionModifiers, createPlanetTraits, createPlanetEnvironment, normalizeLegacyArea, planetIndex };
