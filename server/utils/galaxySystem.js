const POSITION_COUNT = 15;

function assertCoordinate(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer between 1 and ${maximum}`);
  }
}

function idToString(value) {
  return value?.toString?.() ?? String(value);
}

function buildGalaxySystem({ galaxy, system, requestingUserId, users }) {
  assertCoordinate(galaxy, 'galaxy', 9);
  assertCoordinate(system, 'system', 499);

  if (!Array.isArray(users)) {
    throw new TypeError('users must be an array');
  }

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
        throw new Error(`duplicate planet position ${planet.planet}`);
      }

      target.occupied = true;
      target.owner = idToString(user._id) === idToString(requestingUserId) ? 'self' : 'other';
      target.planet = {
        name: planet.name || `Planet ${planet.planet}`,
        username: user.username,
        isOnline: Boolean(user.isOnline)
      };
    }
  }

  return { galaxy, system, positions };
}

module.exports = { buildGalaxySystem };
