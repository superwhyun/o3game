const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertFleetAvailable,
  assertCargoAvailable,
  assertNonEmptyFleet,
  calculateFleetProfile,
  calculateTravelSeconds,
  normalizeCargo,
  normalizeFleet,
  validateCoordinate
} = require('../utils/fleetRules');

test('validateCoordinate accepts finite non-negative integers', () => {
  assert.equal(validateCoordinate(0, 'galaxy'), 0);
  assert.equal(validateCoordinate(17, 'position'), 17);
});

test('validateCoordinate rejects invalid coordinate values', () => {
  for (const value of [-1, 1.5, NaN, Infinity, '4']) {
    assert.throws(() => validateCoordinate(value, 'system'), /system/);
  }
});

test('normalizeFleet accepts positive selected amounts for known ship types', () => {
  assert.deepEqual(
    normalizeFleet({ lightFighter: 3, cruiser: 1 }, ['lightFighter', 'cruiser']),
    { lightFighter: 3, cruiser: 1 }
  );
});

test('normalizeFleet rejects unknown ship types and invalid selected amounts', () => {
  assert.throws(
    () => normalizeFleet({ deathstar: 1 }, ['lightFighter']),
    /Unknown fleet type: deathstar/
  );

  for (const value of [0, -1, 1.5, NaN, Infinity, '1']) {
    assert.throws(
      () => normalizeFleet({ lightFighter: value }, ['lightFighter']),
      /lightFighter/
    );
  }
});

test('normalizeCargo fills missing resource amounts and rejects invalid or unknown input', () => {
  assert.deepEqual(normalizeCargo({ metal: 7 }), {
    metal: 7,
    crystal: 0,
    deuterium: 0
  });

  assert.throws(() => normalizeCargo({ energy: 1 }), /Unknown cargo resource: energy/);
  assert.throws(() => normalizeCargo({ crystal: -1 }), /crystal/);
  assert.throws(() => normalizeCargo({ deuterium: 1.5 }), /deuterium/);
});

test('assertFleetAvailable prevents launching more ships than the origin has', () => {
  assert.doesNotThrow(() => assertFleetAvailable(
    { lightFighter: 3 },
    { lightFighter: 3, cruiser: 1 }
  ));

  assert.throws(
    () => assertFleetAvailable({ lightFighter: 4 }, { lightFighter: 3 }),
    /lightFighter/
  );
});

test('assertCargoAvailable prevents sending more resources than the origin has', () => {
  assert.doesNotThrow(() => assertCargoAvailable(
    { metal: 7, crystal: 0, deuterium: 2 },
    { metal: 7, crystal: 4, deuterium: 2 }
 ));

  assert.throws(
    () => assertCargoAvailable({ metal: 8 }, { metal: 7 }),
    /metal/
  );
});

test('assertNonEmptyFleet requires at least one selected ship', () => {
  assert.doesNotThrow(() => assertNonEmptyFleet({ lightFighter: 1 }));
  assert.throws(() => assertNonEmptyFleet({}), /at least one ship/);
});

test('calculateFleetProfile derives cargo capacity and the slowest valid ship speed', () => {
  assert.deepEqual(
    calculateFleetProfile(
      { smallCargo: 2, lightFighter: 1 },
      {
        smallCargo: { cargo: 5000, speed: 5000 },
        lightFighter: { cargo: 50, speed: 12500 }
      }
    ),
    { cargoCapacity: 10050, slowestSpeed: 5000 }
  );

  assert.throws(
    () => calculateFleetProfile({ probe: 1 }, { probe: { cargo: 0, speed: 0 } }),
    /speed/
  );
});

test('calculateTravelSeconds returns a finite positive time for valid mission inputs', () => {
  assert.equal(
    calculateTravelSeconds({ galaxy: 1, system: 1, planet: 1 }, { galaxy: 1, system: 1, planet: 2 }, 5000, 100),
    70
  );
  assert.throws(
    () => calculateTravelSeconds({ galaxy: 1, system: 1, planet: 1 }, { galaxy: 1, system: 1, planet: 2 }, 0, 100),
    /slowestSpeed/
  );
});
