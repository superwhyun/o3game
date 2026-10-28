const entities = require("../services/EntityConfigService");
const { apiError } = require("./apiErrors");
const CREW = Object.freeze({
  smallCargo: 1,
  largeCargo: 2,
  lightFighter: 1,
  heavyFighter: 2,
  cruiser: 4,
  battleship: 8,
  bomber: 6,
  destroyer: 10,
  battlecruiser: 8,
  deathstar: 50,
  recycler: 2,
});
const safeRate = (rate, fallback) =>
  Number.isFinite(rate) && rate >= 0 ? rate : fallback;
const plain = (value) => (value?.toObject ? value.toObject() : value || {});
function crewPerShip(id) {
  const configured = entities.getEntity("ship", id)?.stats?.crew;
  return Number.isSafeInteger(configured) && configured >= 0
    ? configured
    : CREW[id] || 0;
}
function requiredCrew(ships) {
  const entries = Object.entries(plain(ships)).filter(([, count]) => count > 0);
  if (!entries.some(([id]) => crewPerShip(id) > 0)) return 0;
  return 10 + Math.floor(entries.reduce((n, [, count]) => n + count, 0) / 100);
}
function upkeep(ships, crew, config = {}) {
  const speed = config.serverSpeed || 1;
  const rates = {
    food: crew * (config.populationSettings?.foodConsumptionPerPopulation ?? 1),
    metal: 0,
    deuterium: 0,
  };
  for (const [id, count] of Object.entries(plain(ships))) {
    const stats = entities.getEntity("ship", id)?.stats || {};
    rates.metal += count * safeRate(stats.upkeep?.metal, crewPerShip(id) * 0.1);
    rates.deuterium +=
      count * safeRate(stats.upkeep?.deuterium, crewPerShip(id) * 0.05);
  }
  for (const key of Object.keys(rates)) rates[key] *= speed;
  return rates;
}
function fleetSupport(user, planet, config = {}) {
  const rates = { food: 0, metal: 0, deuterium: 0 };
  let crew = 0;
  for (const f of user.fleetFormations || []) {
    if (String(f.originPlanetId) !== String(planet._id) || ![1, 2].includes(f.crewVersion))
      continue;
    crew += f.crew || 0;
    const costs = upkeep(f.ships, f.crew || 0, config);
    for (const key of Object.keys(rates)) rates[key] += costs[key];
  }
  return { crew, hourly: rates };
}
function prepareSupport(user, config) {
  for (const p of user.planets)
    p.$locals.fleetSupport = fleetSupport(user, p, config);
}
function initializeCrews(user) {
  for (const f of user.fleetFormations || []) {
    if (f.crewVersion === 2) continue;
    const p = user.planets.find(p => String(p._id) === String(f.originPlanetId));
    // Version 1 crews were already removed from residents. Reconcile only the difference.
    const previous = f.crewVersion === 1 ? f.crew || 0 : 0;
    const required = requiredCrew(f.ships);
    const extra = Math.min(Math.max(0, required - previous), Math.floor(p?.population?.count || 0));
    f.crew = required <= previous ? required : previous + extra;
    if (p) p.population.count += previous - f.crew;
    f.crewVersion = 2;
    if (f.crew < required) f.notice = "승무원이 부족합니다. 인구를 확보한 뒤 편성을 저장해 충원하십시오.";
    else if (previous !== f.crew) f.notice = "함대 단위 승무원 기준을 적용했습니다.";
  }
}
function assignCrew(formation, planet, ships) {
  const required = requiredCrew(ships);
  const delta = required - (formation.crew || 0);
  if (delta > Math.floor(planet.population?.count || 0))
    throw apiError(
      409,
      "INSUFFICIENT_POPULATION",
      `승무원 ${delta}명을 추가로 배치할 행성 인구가 부족합니다.`,
    );
  planet.population.count -= delta;
  formation.crew = required;
  formation.crewVersion = 2;
}
function applyCrewLoss(formation, survivors) {
  const previous = formation.crew || 0;
  const count = ships => Object.entries(plain(ships)).reduce((n, [id, value]) => n + (crewPerShip(id) > 0 ? Math.max(0, value) : 0), 0);
  const original = count(formation.ships);
  formation.crew = original ? Math.min(requiredCrew(survivors), Math.floor(previous * count(survivors) / original)) : 0;
  formation.ships = survivors;
  return previous - formation.crew;
}
module.exports = {
  CREW,
  crewPerShip,
  requiredCrew,
  upkeep,
  fleetSupport,
  prepareSupport,
  initializeCrews,
  assignCrew,
  applyCrewLoss,
};
