const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const { CATALOG_SPECS, CATALOG_FILES, ENTITY_CATALOG_DEFAULTS, ENTITY_IDS } = require('../data/catalog');
const { specToDefinition, definitionToSpec, validateCatalog } = require('../data/catalog/schema');
const { serializeCatalogModule } = require('../data/catalog/serialize');

function loadFromSource(source) {
  const mod = new Module('virtual-catalog.js');
  mod._compile(source, path.join(__dirname, 'virtual-catalog.js'));
  return mod.exports;
}

test('catalog loads every entity type with unique ids', () => {
  for (const [type, ids] of Object.entries(ENTITY_IDS)) {
    assert.ok(ids.length > 0, `${type} catalog is empty`);
    assert.equal(new Set(ids).size, ids.length, `${type} has duplicate ids`);
  }
  assert.equal(
    ENTITY_CATALOG_DEFAULTS.length,
    Object.values(ENTITY_IDS).reduce((sum, ids) => sum + ids.length, 0)
  );
});

test('every ship has a 3D model spec', () => {
  for (const ship of CATALOG_SPECS.ship) {
    assert.ok(ship.model?.hull, `${ship.id} is missing model.hull`);
  }
});

test('spec -> definition -> spec round-trips without loss', () => {
  for (const [type, specs] of Object.entries(CATALOG_SPECS)) {
    for (const spec of specs) {
      const roundTripped = definitionToSpec(specToDefinition(type, spec));
      assert.deepEqual(specToDefinition(type, roundTripped), specToDefinition(type, spec), `${type}:${spec.id}`);
    }
  }
});

test('serialized catalog modules evaluate back to the same specs', () => {
  for (const [type, specs] of Object.entries(CATALOG_SPECS)) {
    const source = serializeCatalogModule(CATALOG_FILES[type].header, specs);
    assert.deepEqual(loadFromSource(source), specs, type);
  }
});

test('leveled types default timeMultiplier to costMultiplier', () => {
  const definition = specToDefinition('building', { id: 'testDock', name: 'Dock', cost: { metal: 10 }, costMultiplier: 1.7, buildTime: 30 });
  assert.equal(definition.timeModel.timeMultiplier, 1.7);
  assert.deepEqual(definition.costModel.baseCost, { metal: 10, crystal: 0, deuterium: 0 });
});

test('units carry their model in display', () => {
  const definition = specToDefinition('ship', { id: 'scout', name: 'Scout', buildTime: 10, model: { hull: 'probe' } });
  assert.equal(definition.costModel.costMultiplier, null);
  assert.deepEqual(definition.display.model, { hull: 'probe' });
});

test('validation rejects unknown requirements and duplicate ids', () => {
  const base = { building: [], research: [], ship: [], defense: [] };
  assert.throws(
    () => validateCatalog({ ...base, ship: [{ id: 'scout', name: 'Scout', buildTime: 10, requires: { buildings: { dock: 1 } } }] }),
    /requires unknown building "dock"/
  );
  assert.throws(
    () => validateCatalog({ ...base, research: [
      { id: 'optics', name: 'Optics', buildTime: 10 },
      { id: 'optics', name: 'Optics', buildTime: 10 }
    ] }),
    /defined twice/
  );
  assert.throws(
    () => validateCatalog({ ...base, defense: [{ id: 'Bad-Id', name: 'x', buildTime: 1 }] }),
    /invalid id/
  );
});

test('User planet schema exposes a field for every catalog entity', () => {
  const User = require('../models/User');
  const planet = new User({ username: 'u', email: 'e', password: 'p', planets: [{}] }).planets[0];
  const groups = { building: 'buildings', research: 'research', ship: 'fleet', defense: 'defense' };
  for (const [type, field] of Object.entries(groups)) {
    for (const id of ENTITY_IDS[type]) {
      assert.equal(planet[field][id], 0, `${field}.${id}`);
    }
  }
});
