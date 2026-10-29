const test = require('node:test');
const assert = require('node:assert/strict');
const entities = require('../services/EntityConfigService');
for (const def of require('../data/catalog').ENTITY_CATALOG_DEFAULTS) entities.cache.get(def.entityType).set(def.entityId, def);
const { calculateEnergyState, calculateProduction } = require('../utils/planetEconomy');
const { buildGalaxySystem } = require('../utils/galaxySystem');

test('energy exposes real production and consumption and preserves net output', () => {
  for (const buildings of [{}, { metalMine: 1 }, { solarPlant: 2 }, { solarPlant: 10, metalMine: 8, crystalMine: 6, fusionReactor: 2 }]) {
    const p = { buildings, minTemp: 10, maxTemp: 10 };
    const energy = calculateEnergyState(p);
    assert.equal(energy.balance, calculateProduction(p).energy);
    assert.ok(energy.production >= 0 && energy.consumption >= 0);
  }
  assert.equal(calculateEnergyState({ buildings: { metalMine: 1 } }).consumption, 11);
  assert.equal(calculateEnergyState({ buildings: { metalMine: 1 } }).production, 0);
});

test('galaxy survey uses latest observation and exposes no other report sections', () => {
  const report = { destination: { galaxy: 1, system: 1, planet: 3 }, outcome: 'empty', observedAt: '2026-10-01', sections: { environment: { total: 200, usable: 120 }, resources: { metal: 999 }, buildings: { metalMine: 10 } } };
  const view = buildGalaxySystem({ galaxy: 1, system: 1, requestingUserId: 'u', users: [], scoutReports: [report] });
  assert.deepEqual(view.positions[2].survey, { total: 200, usable: 120, observedAt: '2026-10-01' });
  assert.equal(view.positions[0].survey, undefined);
  assert.equal(view.positions[2].resources, undefined);
});

test('cargo recommendation accounts for people, storage and integer capacity', async () => {
  const { recommendedCargo, surveyArea } = await import('../../ogame-3d/src/data/colonyPreparation.js');
  for (const capacity of [0, 7, 500, 7500, 20000]) for (const people of [1, 10, 30]) {
    const cargo = recommendedCargo({ metal: 10000, crystal: 10000, deuterium: 10000 }, capacity, people);
    assert.ok(Object.values(cargo).every(Number.isSafeInteger));
    assert.ok(Object.values(cargo).reduce((a, b) => a + b, 0) <= Math.max(0, capacity - people));
  }
  assert.deepEqual(recommendedCargo({ metal: 10, crystal: 0, deuterium: 3 }, 100, 10), { metal: 10, crystal: 0, deuterium: 3 });
  assert.equal(surveyArea({ total: 256, baseUsablePercent: 40 }, 5, 80), 208);
  assert.equal(surveyArea({ total: 256, baseUsablePercent: 40 }, 30, 80), 256);
});
