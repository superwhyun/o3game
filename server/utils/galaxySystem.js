const { GALAXY_COUNT, POSITION_COUNT, SYSTEM_COUNT } = require('./universe');

function assertCoordinate(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer between 1 and ${maximum}`);
  }
}

function idToString(value) {
  return value?.toString?.() ?? String(value);
}

function buildGalaxySystem({ galaxy, system, requestingUserId, users, scoutReports = [] }) {
  assertCoordinate(galaxy, 'galaxy', GALAXY_COUNT);
  assertCoordinate(system, 'system', SYSTEM_COUNT);

  if (!Array.isArray(users)) {
    throw new TypeError('users must be an array');
  }

  const observations = new Map();
  for (const report of scoutReports) {
    if (report.destination?.galaxy !== galaxy || report.destination?.system !== system || report.outcome === 'unavailable') continue;
    const slot = report.destination.planet;
    const previous = observations.get(slot);
    if (!previous || new Date(report.observedAt) > new Date(previous.observedAt)) observations.set(slot, report);
  }

  // Slots claimed twice (corrupt data). The first claimant is shown; the rest are
  // reported to the caller instead of failing the whole system view.
  const conflicts = [];
  const positions = Array.from({ length: POSITION_COUNT }, (_, index) => ({
    position: index + 1,
    occupied: false,
    scouted: observations.has(index + 1)
  }));
  for (const position of positions) {
    const report = observations.get(position.position);
    if (report?.sections?.environment) position.survey = { ...report.sections.environment, observedAt: report.observedAt };
  }

  for (const user of users) {
    for (const planet of user.planets || []) {
      if (planet.galaxy !== galaxy || planet.system !== system) continue;

      assertCoordinate(planet.planet, 'planet', POSITION_COUNT);
      const target = positions[planet.planet - 1];
      if (target.occupied) {
        conflicts.push({ position: planet.planet, userId: idToString(user._id) });
        continue;
      }

      target.occupied = true;
      target.owner = idToString(user._id) === idToString(requestingUserId) ? 'self' : 'other';
      const own = target.owner === 'self';
      const observation = observations.get(planet.planet);
      const sameTarget = observation && idToString(observation.targetPlanetId) === idToString(planet._id) && idToString(observation.targetUserId) === idToString(user._id);
      target.scouted = own || Boolean(observation);
      target.planet = {
        id: idToString(planet._id),
        ...(own && Number.isFinite(planet.diameter) ? { diameter: planet.diameter } : {}),
        name: own ? (planet.name || `Planet ${planet.planet}`) : sameTarget ? (observation.targetName || null) : null,
        ...(sameTarget && user.isPirate ? {isPirate:true,pirateLevel:user.pirate.level} : {}),
        username: user.isPirate ? (sameTarget ? '해적' : '미확인') : user.username,
        isOnline: Boolean(user.isOnline)
      };
    }
  }

  return { galaxy, system, positions, conflicts };
}

module.exports = { buildGalaxySystem };
