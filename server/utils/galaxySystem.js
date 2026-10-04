const { GALAXY_COUNT, POSITION_COUNT, SYSTEM_COUNT } = require('./universe');

function assertCoordinate(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer between 1 and ${maximum}`);
  }
}

function idToString(value) {
  return value?.toString?.() ?? String(value);
}

function buildGalaxySystem({ galaxy, system, requestingUserId, users }) {
  assertCoordinate(galaxy, 'galaxy', GALAXY_COUNT);
  assertCoordinate(system, 'system', SYSTEM_COUNT);

  if (!Array.isArray(users)) {
    throw new TypeError('users must be an array');
  }

  // Slots claimed twice (corrupt data). The first claimant is shown; the rest are
  // reported to the caller instead of failing the whole system view.
  const conflicts = [];
  const positions = Array.from({ length: POSITION_COUNT }, (_, index) => ({
    position: index + 1,
    occupied: false
  }));

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
      target.planet = {
        id: idToString(planet._id),
        name: planet.name || `Planet ${planet.planet}`,
        username: user.username,
        isOnline: Boolean(user.isOnline)
      };
    }
  }

  return { galaxy, system, positions, conflicts };
}

module.exports = { buildGalaxySystem };
