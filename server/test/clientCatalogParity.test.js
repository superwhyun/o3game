const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const entityConfigService = require('../services/EntityConfigService');
const { ENTITY_CATALOG_DEFAULTS } = require('../data/catalog');
const {
  calculateBuildingCost,
  calculateResearchCost,
  calculateUnitCost,
  calculateQueueDuration
} = require('../utils/gameCalculations');

const CLIENT_CATALOG = pathToFileURL(path.join(__dirname, '../../ogame-3d/src/data/catalog.js')).href;

function primeServerCache() {
  for (const definition of ENTITY_CATALOG_DEFAULTS) {
    entityConfigService.cache.get(definition.entityType)
      .set(definition.entityId, entityConfigService._normalizeMergedDocument(definition, definition));
  }
  entityConfigService.revision = 42;
}

async function loadClientCatalog() {
  const { catalog } = await import(CLIENT_CATALOG);
  catalog.hydrate(entityConfigService.toPublicCatalog());
  return catalog;
}

const BUILDING_STATES = [
  {},
  { robotFactory: 3, shipyard: 5, researchLab: 4 },
  { robotFactory: 10, naniteFactory: 2, shipyard: 12, researchLab: 10 }
];

test('client catalog costs match the server for every entity', async () => {
  primeServerCache();
  const catalog = await loadClientCatalog();

  for (const definition of ENTITY_CATALOG_DEFAULTS) {
    const entity = catalog.get(definition.entityType, definition.entityId);
    assert.ok(entity, `${definition.entityId} missing on client`);

    for (const n of [1, 2, 5, 12]) {
      let expected;
      let actual;
      if (definition.entityType === 'building') {
        expected = await calculateBuildingCost(definition.entityId, n);
        actual = catalog.cost(entity, n);
      } else if (definition.entityType === 'research') {
        expected = await calculateResearchCost(definition.entityId, n);
        actual = catalog.cost(entity, n + 1);
      } else {
        expected = await calculateUnitCost(definition.entityType, definition.entityId, n);
        actual = catalog.cost(entity, n);
      }
      assert.deepEqual(actual, expected, `${definition.entityType}:${definition.entityId} @${n}`);
    }
  }
});

test('client catalog durations match the server for every entity', async () => {
  primeServerCache();
  const catalog = await loadClientCatalog();

  for (const definition of ENTITY_CATALOG_DEFAULTS) {
    const entity = catalog.get(definition.entityType, definition.entityId);
    for (const buildings of BUILDING_STATES) {
      for (const n of [1, 3, 8]) {
        const isUnit = ['ship', 'defense'].includes(definition.entityType);
        const expected = calculateQueueDuration(definition.entityType, definition.entityId, isUnit ? 1 : n, buildings, isUnit ? n : 1, { serverSpeed: 2 });
        const actual = catalog.duration(entity, { level: n, count: n, buildings, serverSpeed: 2 });
        assert.equal(actual, expected, `${definition.entityType}:${definition.entityId} n=${n} ${JSON.stringify(buildings)}`);
      }
    }
  }
});

test('public catalog hides non-active entities', () => {
  primeServerCache();
  const draft = { ...ENTITY_CATALOG_DEFAULTS[0], entityId: 'draftDock', status: 'draft' };
  entityConfigService.cache.get('building').set('draftDock', draft);
  const ids = entityConfigService.toPublicCatalog().entities.map((entity) => entity.entityId);
  assert.ok(!ids.includes('draftDock'));
  assert.ok(ids.includes('metalMine'));
  entityConfigService.cache.get('building').delete('draftDock');
});
