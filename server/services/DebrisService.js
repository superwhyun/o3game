/**
 * Debris fields: wreckage from battles, collected first come, first served.
 * Callers run inside a transaction (see transactions.atomic) so a battle and its
 * debris, or a collection and the recycler's cargo, commit together.
 */
const DebrisField = require('../models/DebrisField');
const { coordinateKey } = require('../utils/universe');

const RESOURCES = ['metal', 'crystal'];
const RECYCLER = 'recycler';

const clean = (value) => Math.max(0, Math.floor(Number(value) || 0));

/** Add wreckage at a coordinate. No-op when empty. */
async function add(coords, { metal = 0, crystal = 0 }) {
  const amounts = { metal: clean(metal), crystal: clean(crystal) };
  if (amounts.metal + amounts.crystal === 0) return null;
  const key = coordinateKey(coords);
  return DebrisField.findOneAndUpdate(
    { coordinateKey: key },
    {
      $inc: amounts,
      $set: { updatedAt: new Date() },
      $setOnInsert: { galaxy: coords.galaxy, system: coords.system, planet: coords.planet }
    },
    { upsert: true, returnDocument: 'after' }
  );
}

async function get(coords) {
  return DebrisField.findOne({ coordinateKey: coordinateKey(coords) }).lean();
}

/**
 * Take up to `capacity` units, metal first, then crystal. The decrement only applies
 * while the field still holds what was read, so two collectors can never take the same
 * wreckage; inside a transaction the loser retries against the updated field.
 * @returns {Promise<{ metal: number, crystal: number }>}
 */
async function collect(coords, capacity) {
  const field = await get(coords);
  if (!field) return { metal: 0, crystal: 0 };
  let room = clean(capacity);
  const taken = {};
  for (const resource of RESOURCES) {
    taken[resource] = Math.min(field[resource] || 0, room);
    room -= taken[resource];
  }
  if (taken.metal + taken.crystal === 0) return taken;
  const result = await DebrisField.updateOne(
    { coordinateKey: coordinateKey(coords), metal: { $gte: taken.metal }, crystal: { $gte: taken.crystal } },
    { $inc: { metal: -taken.metal, crystal: -taken.crystal }, $set: { updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    throw Object.assign(new Error('Debris changed while collecting'), { errorLabels: ['TransientTransactionError'] });
  }
  return taken;
}

/** Cargo space of the recyclers in a fleet ({ shipId: count }); only they can collect. */
function recyclerCapacity(fleet, statsOf) {
  const count = Number(fleet?.[RECYCLER]) || 0;
  return count > 0 ? count * (statsOf(RECYCLER)?.cargo || 0) : 0;
}

/** Non-empty fields in one star system, for the galaxy view. */
async function inSystem(galaxy, system) {
  const rows = await DebrisField.find({ galaxy, system, $or: [{ metal: { $gt: 0 } }, { crystal: { $gt: 0 } }] }).select('planet metal crystal').lean();
  return rows.map((row) => ({ planet: row.planet, metal: row.metal, crystal: row.crystal }));
}

module.exports = { add, get, collect, recyclerCapacity, inSystem, RECYCLER };
