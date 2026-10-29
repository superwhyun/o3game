const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PREFERRED_HOME_POSITIONS,
  POSITION_COUNT,
  coordinateKey,
  isValidCoordinate,
  pickHomeCoordinate
} = require('../utils/universe');
const { planCoordinateMigration } = require('../utils/planetCoordinateMigration');
const User = require('../models/User');

const firstSlot = () => 0;

test('pickHomeCoordinate places the first player on a preferred orbit of system 1', () => {
  const home = pickHomeCoordinate(new Set(), { rng: firstSlot });
  assert.deepEqual(home, { galaxy: 1, system: 1, planet: PREFERRED_HOME_POSITIONS[0] });
});

test('pickHomeCoordinate never returns an occupied slot', () => {
  const occupied = new Set(PREFERRED_HOME_POSITIONS.slice(0, -1).map((planet) => coordinateKey({ galaxy: 1, system: 1, planet })));
  for (let i = 0; i < 20; i++) {
    const home = pickHomeCoordinate(occupied, { rng: Math.random });
    assert.ok(!occupied.has(coordinateKey(home)));
    assert.deepEqual([home.galaxy, home.system], [1, 1]);
  }
});

test('pickHomeCoordinate moves to the next system once preferred orbits are full', () => {
  const occupied = new Set(PREFERRED_HOME_POSITIONS.map((planet) => coordinateKey({ galaxy: 1, system: 1, planet })));
  const home = pickHomeCoordinate(occupied, { rng: firstSlot });
  assert.deepEqual(home, { galaxy: 1, system: 2, planet: PREFERRED_HOME_POSITIONS[0] });
});

test('isValidCoordinate enforces universe bounds', () => {
  assert.equal(isValidCoordinate({ galaxy: 1, system: 1, planet: POSITION_COUNT }), true);
  assert.equal(isValidCoordinate({ galaxy: 1, system: 1, planet: POSITION_COUNT + 1 }), false);
  assert.equal(isValidCoordinate({ galaxy: 0, system: 1, planet: 1 }), false);
});

test('migration keeps the oldest owner and relocates later claimants to their shown orbit', () => {
  const users = [
    { _id: 'b', username: 'late', createdAt: new Date('2026-02-01'), planets: [{ galaxy: 1, system: 1, planet: 1, position: 15 }] },
    { _id: 'a', username: 'early', createdAt: new Date('2026-01-01'), planets: [{ galaxy: 1, system: 1, planet: 1, position: 9 }] }
  ];
  const { moves, updates } = planCoordinateMigration(users, { rng: firstSlot });

  assert.deepEqual(moves, [{
    userId: 'b',
    username: 'late',
    planetIndex: 0,
    from: { galaxy: 1, system: 1, planet: 1 },
    to: { galaxy: 1, system: 1, planet: 15 }
  }]);
  assert.deepEqual(updates.find((update) => update.userId === 'a').set, {
    galaxy: 1, system: 1, planet: 1, position: 1, coordinateKey: '1:1:1'
  });
  assert.deepEqual(updates.find((update) => update.userId === 'b').set, {
    galaxy: 1, system: 1, planet: 15, position: 15, coordinateKey: '1:1:15'
  });
});

test('migration never relocates onto a slot that a later account legitimately owns', () => {
  const users = [
    { _id: 'a', username: 'a', createdAt: new Date('2026-01-01'), planets: [{ galaxy: 1, system: 1, planet: 1, position: 1 }] },
    { _id: 'b', username: 'b', createdAt: new Date('2026-01-02'), planets: [{ galaxy: 1, system: 1, planet: 1, position: 7 }] },
    { _id: 'c', username: 'c', createdAt: new Date('2026-01-03'), planets: [{ galaxy: 1, system: 1, planet: 7, position: 7 }] }
  ];
  const { moves } = planCoordinateMigration(users, { rng: firstSlot });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].userId, 'b');
  assert.notEqual(coordinateKey(moves[0].to), '1:1:7');
  assert.notEqual(coordinateKey(moves[0].to), '1:1:1');
});

test('migration is idempotent once data is clean', () => {
  const users = [
    { _id: 'a', username: 'a', planets: [{ galaxy: 1, system: 1, planet: 4, position: 4, coordinateKey: '1:1:4' }] }
  ];
  assert.deepEqual(planCoordinateMigration(users), { moves: [], updates: [] });
});

test('syncPlanetCoordinate mirrors planet into position and coordinateKey', () => {
  const planet = { galaxy: 2, system: 30, planet: 6, position: 11 };
  User.syncPlanetCoordinate(planet);
  assert.equal(planet.position, 6);
  assert.equal(planet.coordinateKey, '2:30:6');
});

test('isCoordinateConflict only matches the coordinate unique index', () => {
  assert.equal(User.isCoordinateConflict({ code: 11000, keyPattern: { 'planets.coordinateKey': 1 } }), true);
  assert.equal(User.isCoordinateConflict({ code: 11000, keyPattern: { username: 1 } }), false);
  assert.equal(User.isCoordinateConflict(new Error('boom')), false);
});

test('User schema declares a unique coordinate index', () => {
  const index = User.schema.indexes().find(([fields]) => fields['planets.coordinateKey']);
  assert.ok(index, 'missing planets.coordinateKey index');
  assert.equal(index[1].unique, true);
});

test('selected galaxy allocation stays within that galaxy and rejects a full galaxy', () => {
  assert.deepEqual(pickHomeCoordinate(new Set(['7:1:4']), { galaxy: 7, rng: firstSlot }), { galaxy: 7, system: 1, planet: 5 });
  const occupied = new Set();
  for (let system = 1; system <= 499; system++)
    for (let planet = 1; planet <= POSITION_COUNT; planet++) occupied.add(`7:${system}:${planet}`);
  assert.throws(() => pickHomeCoordinate(occupied, { galaxy: 7 }), { code: 'RESOURCE_CONFLICT', statusCode: 409 });
  assert.equal(pickHomeCoordinate(occupied, { rng: firstSlot }).galaxy, 1);
});
