const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { selectResearchLabs } = require('../utils/researchNetwork');
const infrastructure = (originPlanetId, networkLevel) => ({ originPlanetId, networkLevel, labs: [{ planetId: 'a', name: 'A', level: 10 }, { planetId: 'b', name: 'B', level: 12 }, { planetId: 'c', name: 'C', level: 8 }, { planetId: 'd', name: 'D', level: 3 }] });
test('origin is mandatory, IRN adds highest eligible labs and minimum is checked individually', () => {
  assert.deepEqual(selectResearchLabs(infrastructure('a', 0), 1).labs.map(lab => lab.planetId), ['a']);
  assert.equal(selectResearchLabs(infrastructure('a', 1), 1).effectiveLevel, 22);
  assert.equal(selectResearchLabs(infrastructure('c', 1), 1).effectiveLevel, 20);
  assert.deepEqual(selectResearchLabs(infrastructure('c', 2), 8).labs.map(lab => lab.planetId), ['c', 'b', 'a']);
  assert.equal(selectResearchLabs(infrastructure('c', 10), 8).effectiveLevel, 30); // D fails minimum.
  assert.equal(selectResearchLabs(infrastructure('c', 10), 10).eligible, false);
  assert.equal(selectResearchLabs({ ...infrastructure('a', 10), originPlanetId: 'absent' }, 1).eligible, false);
});
test('client research network selection matches authoritative server', async () => {
  const client = await import(pathToFileURL(path.join(__dirname, '../../ogame-3d/src/data/researchNetwork.js')).href);
  for (const origin of ['a', 'b', 'c', 'd']) for (const level of [0, 1, 2, 10]) for (const minimum of [1, 4, 8, 10, 12]) {
    const data = infrastructure(origin, level);
    assert.deepEqual(client.selectResearchLabs(data, minimum), selectResearchLabs(data, minimum));
  }
});
