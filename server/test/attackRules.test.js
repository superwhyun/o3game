const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateRaidLoot,
  calculateSurvivors,
  mergeCargo,
  normalizeResources
} = require('../utils/attackRules');

test('normalizeResources fills missing resources without mutating the input', () => {
  const resources = { metal: 12, crystal: 4 };

  assert.deepEqual(normalizeResources(resources), {
    metal: 12,
    crystal: 4,
    deuterium: 0
  });
  assert.deepEqual(resources, { metal: 12, crystal: 4 });
});

test('normalizeResources rejects unknown and non-finite non-negative integer values', () => {
  assert.throws(() => normalizeResources({ energy: 1 }), /Unknown resource/);

  for (const value of [-1, 1.5, NaN, Infinity, '1']) {
    assert.throws(() => normalizeResources({ metal: value }), /metal/);
  }
});

test('calculateRaidLoot enforces the half-resource raid cap and cargo capacity', () => {
  const defenderResources = { metal: 101, crystal: 40, deuterium: 30 };

  assert.deepEqual(calculateRaidLoot(defenderResources, 60), {
    metal: 50,
    crystal: 10,
    deuterium: 0
  });
  assert.deepEqual(defenderResources, { metal: 101, crystal: 40, deuterium: 30 });
});

test('calculateRaidLoot cannot loot more than the defender stores or accepts invalid capacity', () => {
  assert.deepEqual(calculateRaidLoot({ metal: 1, crystal: 0, deuterium: 0 }, 10), {
    metal: 0,
    crystal: 0,
    deuterium: 0
  });

  for (const capacity of [-1, 1.5, NaN, Infinity]) {
    assert.throws(() => calculateRaidLoot({}, capacity), /cargoCapacity/);
  }
});

test('calculateSurvivors subtracts losses without mutating either unit map', () => {
  const initialUnits = { lightFighter: 7, cruiser: 2 };
  const losses = { lightFighter: 3 };

  assert.deepEqual(calculateSurvivors(initialUnits, losses), {
    lightFighter: 4,
    cruiser: 2
  });
  assert.deepEqual(initialUnits, { lightFighter: 7, cruiser: 2 });
  assert.deepEqual(losses, { lightFighter: 3 });
});

test('calculateSurvivors rejects invalid and impossible losses', () => {
  assert.throws(
    () => calculateSurvivors({ lightFighter: 1 }, { lightFighter: 2 }),
    /cannot exceed/
  );
  assert.throws(
    () => calculateSurvivors({ lightFighter: 1 }, { cruiser: 1 }),
    /Unknown unit/
  );
  assert.throws(
    () => calculateSurvivors({ lightFighter: 1 }, { lightFighter: -1 }),
    /lightFighter/
  );
});

test('mergeCargo adds normalized resource maps without mutating inputs', () => {
  const existingCargo = { metal: 3, deuterium: 1 };
  const loot = { metal: 4, crystal: 2 };

  assert.deepEqual(mergeCargo(existingCargo, loot), {
    metal: 7,
    crystal: 2,
    deuterium: 1
  });
  assert.deepEqual(existingCargo, { metal: 3, deuterium: 1 });
  assert.deepEqual(loot, { metal: 4, crystal: 2 });
});
