/**
 * Plans the repair of planet coordinates: every slot keeps its earliest owner
 * (by account creation), later claimants are relocated, and every planet gets
 * its coordinateKey / position synced. Pure — the script applies the result.
 */
const { coordinateKey, isValidCoordinate, pickHomeCoordinate } = require('./universe');

function byCreation(a, b) {
  const timeA = new Date(a.createdAt || 0).getTime();
  const timeB = new Date(b.createdAt || 0).getTime();
  return timeA - timeB || String(a._id).localeCompare(String(b._id));
}

/**
 * @param {{ _id: any, username: string, createdAt?: Date, planets: object[] }[]} users
 * @param {{ rng?: () => number }} [options]
 * @returns {{ moves: object[], updates: { userId: string, planetIndex: number, set: object }[] }}
 */
function planCoordinateMigration(users, { rng = Math.random } = {}) {
  const ordered = [...users].sort(byCreation);
  const occupied = new Set();
  const losers = [];

  // Pass 1: first valid claimant of each slot keeps it.
  for (const user of ordered) {
    (user.planets || []).forEach((planet, planetIndex) => {
      const key = coordinateKey(planet);
      if (isValidCoordinate(planet) && !occupied.has(key)) {
        occupied.add(key);
      } else {
        losers.push({ user, planet, planetIndex });
      }
    });
  }

  // Pass 2: relocate the rest, preferring the orbit the player was shown
  // (`position`) in the same system before searching elsewhere.
  const relocated = new Map();
  const moves = losers.map(({ user, planet, planetIndex }) => {
    const sameSystem = { galaxy: planet.galaxy, system: planet.system, planet: planet.position };
    const target = isValidCoordinate(sameSystem) && !occupied.has(coordinateKey(sameSystem))
      ? sameSystem
      : pickHomeCoordinate(occupied, { rng });
    occupied.add(coordinateKey(target));
    relocated.set(`${user._id}#${planetIndex}`, target);
    return {
      userId: String(user._id),
      username: user.username,
      planetIndex,
      from: { galaxy: planet.galaxy, system: planet.system, planet: planet.planet },
      to: target
    };
  });

  const updates = [];
  for (const user of ordered) {
    (user.planets || []).forEach((planet, planetIndex) => {
      const target = relocated.get(`${user._id}#${planetIndex}`) || {
        galaxy: planet.galaxy,
        system: planet.system,
        planet: planet.planet
      };
      const set = { ...target, position: target.planet, coordinateKey: coordinateKey(target) };
      const unchanged = Object.entries(set).every(([field, value]) => planet[field] === value);
      if (!unchanged) updates.push({ userId: String(user._id), planetIndex, set });
    });
  }

  return { moves, updates };
}

module.exports = { planCoordinateMigration };
