/**
 * Repairs duplicate planet coordinates and backfills planets.coordinateKey,
 * then builds the unique coordinate index.
 *
 *   npm run migrate:planets            # dry run: prints the plan only
 *   npm run migrate:planets -- --apply # writes changes
 *
 * Idempotent: a second run reports nothing to do.
 */
require('dotenv').config();
const mongoose = require('mongoose');
require('../models/GameConfig');
const User = require('../models/User');
const FleetMovement = require('../models/FleetMovement');
const { planCoordinateMigration } = require('../utils/planetCoordinateMigration');
const { coordinateKey } = require('../utils/universe');

const ACTIVE_FLEET_STATUSES = ['flying', 'returning'];

function describe(coordinate) {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.planet}]`;
}

async function findFleetsTouching(moves) {
  if (moves.length === 0) return [];
  const movedKeys = new Set(moves.map((move) => coordinateKey(move.from)));
  const fleets = await FleetMovement.find({ status: { $in: ACTIVE_FLEET_STATUSES } }).lean();
  return fleets.filter((fleet) => [fleet.origin, fleet.destination].some((point) => point && movedKeys.has(coordinateKey(point))));
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({}, { username: 1, createdAt: 1, planets: 1 }).lean();
  const { moves, updates } = planCoordinateMigration(users);

  console.log(`Users: ${users.length}, planets to relocate: ${moves.length}, planet records to update: ${updates.length}`);
  for (const move of moves) {
    console.log(`  move ${move.username} planet #${move.planetIndex}: ${describe(move.from)} -> ${describe(move.to)}`);
  }

  const blockingFleets = await findFleetsTouching(moves);
  if (blockingFleets.length > 0) {
    throw new Error(`${blockingFleets.length} active fleet(s) target coordinates that would move; wait for them to land and re-run`);
  }

  if (!apply) {
    console.log('Dry run — re-run with --apply to write these changes.');
    return;
  }

  for (const { userId, planetIndex, set } of updates) {
    const fields = Object.fromEntries(Object.entries(set).map(([field, value]) => [`planets.${planetIndex}.${field}`, value]));
    await User.updateOne({ _id: userId }, { $set: fields });
  }
  await User.createIndexes();
  console.log(`Applied ${updates.length} update(s); unique coordinate index is in place.`);
}

main()
  .catch((error) => {
    console.error('[migrate:planets] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
