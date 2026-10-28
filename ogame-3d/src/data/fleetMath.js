/**
 * Fleet travel / profile math for previews. Mirrors server/utils/fleetRules.js
 * (calculateFleetProfile, calculateTravelSeconds); kept in sync by
 * server/test/fleetMathParity.test.js.
 */



/** Ships that can leave orbit (the server rejects speed 0, e.g. solar satellites). */
export function isLaunchable(stats) {
  return Number.isSafeInteger(stats?.speed) && stats.speed > 0;
}

/**
 * @param {Record<string, number>} fleet  shipId -> count (counts > 0)
 * @param {(shipId: string) => object|undefined} statsOf
 * @returns {{ ships: number, attack: number, cargoCapacity: number, slowestSpeed: number }}
 */
export function fleetProfile(fleet, statsOf) {
  let ships = 0;
  let attack = 0;
  let cargoCapacity = 0;
  let slowestSpeed = Infinity;
  for (const [shipId, count] of Object.entries(fleet)) {
    if (!(count > 0)) continue;
    const stats = statsOf(shipId) || {};
    ships += count;
    attack += (stats.attack || 0) * count;
    cargoCapacity += (stats.cargo || 0) * count;
    if (isLaunchable(stats)) slowestSpeed = Math.min(slowestSpeed, stats.speed);
  }
  return { ships, attack, cargoCapacity, slowestSpeed: Number.isFinite(slowestSpeed) ? slowestSpeed : 0 };
}

/**
 * @param {{ galaxy: number, system: number, planet: number }} origin
 * @param {{ galaxy: number, system: number, planet: number }} destination
 * @param {number} slowestSpeed
 * @param {number} [speedPercent] 10..100 in steps of 10
 * @returns {number} seconds
 */
export function travelSeconds(origin, destination, slowestSpeed, speedPercent = 100, settings = {}) {
  if (!Number.isSafeInteger(slowestSpeed) || slowestSpeed <= 0
      || !Number.isSafeInteger(speedPercent) || speedPercent < 10 || speedPercent > 100 || speedPercent % 10)
    throw new RangeError('Invalid fleet speed');
  const delta = Object.fromEntries(['galaxy', 'system', 'planet'].map(key => {
    if (![origin?.[key], destination?.[key]].every(n => Number.isSafeInteger(n) && n > 0)) throw new RangeError('Invalid coordinates');
    return [key, Math.abs(destination[key] - origin[key])];
  }));
  const distance = delta.galaxy * 100000
    + (delta.system ? 2700 + 95 * delta.system : 0)
    + (delta.planet ? 1000 + 5 * delta.planet : 0) || 1;

  const flightSpeedMultiplier = settings.flightSpeedMultiplier ?? 1;
  if (!Number.isFinite(flightSpeedMultiplier) || flightSpeedMultiplier <= 0) {
    throw new RangeError('fleet speed multipliers must be finite positive numbers');
  }
  const seconds = 10 + distance / 100 + (35000 / speedPercent) * Math.sqrt(distance * 10 / slowestSpeed);
  return Math.max(1, Math.ceil(seconds / flightSpeedMultiplier));
}

/** Fleet-level command personnel; unmanned-only formations need no crew. */
export function fleetCrew(fleet, statsOf) {
  const entries = Object.entries(fleet || {}).filter(([, count]) => count > 0);
  if (!entries.some(([id]) => (statsOf(id)?.crew || 0) > 0)) return 0;
  return 10 + Math.floor(entries.reduce((sum, [, count]) => sum + count, 0) / 100);
}
