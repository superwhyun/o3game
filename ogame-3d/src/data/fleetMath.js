/**
 * Fleet travel / profile math for previews. Mirrors server/utils/fleetRules.js
 * (calculateFleetProfile, calculateTravelSeconds); kept in sync by
 * server/test/fleetMathParity.test.js.
 */

const DISTANCE_UNIT = 350 * 1000 * 100;

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
export function travelSeconds(origin, destination, slowestSpeed, speedPercent = 100) {
  const distance = Math.max(1, ['galaxy', 'system', 'planet']
    .reduce((total, key) => total + Math.abs(destination[key] - origin[key]), 0));
  return Math.ceil((distance * DISTANCE_UNIT) / (slowestSpeed * speedPercent));
}
