const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG_SPECS } = require('../data/catalog');
const {
  specToDefinition,
  definitionToSpec,
  validateCatalog,
} = require('../data/catalog/schema');
test('visual tier boundaries and complete catalog mappings preserve real levels', async () => {
  const { buildingTier, visualSpec, RESEARCH_EXHIBITS } = await import(
    '../../ogame-3d/src/three/entities/visualRules.js'
  );
  assert.deepEqual(
    [0, 1, 9, 10, 19, 20, 29, 30, 100].map(buildingTier),
    [0, 0, 0, 1, 1, 2, 2, 3, 3],
  );
  for (const type of ['building', 'research'])
    for (const entity of CATALOG_SPECS[type]) {
      assert.equal(entity.model.kind, type);
      assert.equal(entity.model.archetype, entity.id);
      assert.deepEqual(
        definitionToSpec(specToDefinition(type, entity)).model,
        entity.model,
      );
      if (type === 'research') assert.ok(RESEARCH_EXHIBITS[entity.id]);
    }
  const entity = { ...CATALOG_SPECS.building[0], type: 'building' };
  assert.equal(visualSpec(entity, 0).unbuilt, true);
  assert.equal(visualSpec(entity, 9, 1).tier, 1);
  assert.equal(visualSpec(entity, 9).tier, 0);
  assert.equal(entity.level, undefined);
  assert.throws(
    () =>
      validateCatalog({
        ...CATALOG_SPECS,
        building: [
          {
            ...entity,
            model: { kind: 'ship', archetype: 'metalMine', styleVersion: 1 },
          },
        ],
      }),
    /invalid visual model/,
  );
});
test('old DB display without a model inherits visual seeds without losing overrides', () => {
  const service = require('../services/EntityConfigService');
  const seed = specToDefinition('building', CATALOG_SPECS.building[0]);
  const merged = service._normalizeMergedDocument(seed, {
    display: { name: '사용자 지정 광산', model: undefined },
    costModel: { baseCost: { metal: 123 } },
  });
  assert.deepEqual(merged.display.model, seed.display.model);
  assert.equal(merged.display.name, '사용자 지정 광산');
  assert.equal(merged.costModel.baseCost.metal, 123);
});
