const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG_SPECS } = require('../data/catalog');
test('all 64 facility/experiment variants have valid bounds, distinct structural tiers and bounded complexity', async () => {
  const { createEntityModel, disposeEntityModel, BUILDERS, EXPERIMENTS } =
    await import('../../ogame-3d/src/three/entities/EntityModels.js');
  for (const type of ['building', 'research'])
    for (const entity of CATALOG_SPECS[type]) {
      assert.ok(
        (type === 'building' ? BUILDERS : EXPERIMENTS)[entity.model.archetype],
      );
      const vertexCounts = [];
      for (let tier = 0; tier < (type === 'building' ? 4 : 1); tier++) {
        const root = createEntityModel({ ...entity.model, tier });
        assert.ok(
          Number.isFinite(root.userData.radius) && root.userData.radius > 0,
          entity.id,
        );
        let triangles = 0,
          draws = 0;
        root.traverse((o) => {
          if (o.isMesh) {
            draws++;
            triangles +=
              (o.geometry.index?.count ||
                o.geometry.attributes.position.count) / 3;
            for (const n of o.geometry.attributes.position.array)
              assert.ok(Number.isFinite(n), entity.id);
          }
        });
        assert.ok(
          triangles < 50000 && draws < 120,
          `${entity.id}: ${triangles}/${draws}`,
        );
        vertexCounts.push(triangles);
        root.userData.update(100);
        disposeEntityModel(root);
      }
      if (type === 'building')
        assert.equal(
          new Set(vertexCounts).size,
          4,
          `${entity.id} has unchanged tier geometry`,
        );
    }
  const fallback = createEntityModel({
    kind: 'building',
    archetype: 'futureFacility',
    tier: 0,
    unbuilt: true,
  });
  assert.ok(fallback.userData.radius > 0);
  disposeEntityModel(fallback);
});
