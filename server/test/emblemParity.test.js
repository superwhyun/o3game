const test = require('node:test');
const assert = require('node:assert/strict');
const server = require('../data/shop/emblems');
const { products } = require('../data/shop');

test('every emblem the server accepts can be drawn, and nothing else is offered', async () => {
  const { EMBLEMS, FREE_EMBLEMS, usableEmblems, emblemSvg } = await import('../../ogame-3d/src/data/emblems.js');
  assert.deepEqual(Object.keys(EMBLEMS).sort(), [...server.ALL_EMBLEMS].sort());
  assert.deepEqual([...FREE_EMBLEMS].sort(), [...server.FREE_EMBLEMS].sort());
  for (const product of products.filter((p) => p.kind === 'emblem')) assert.ok(EMBLEMS[product.emblem], `${product.id} has no drawing`);
  assert.deepEqual(usableEmblems([]).sort(), [...server.FREE_EMBLEMS].sort());
  assert.deepEqual(usableEmblems(['dragon', 'bogus']).sort(), [...server.FREE_EMBLEMS, 'dragon'].sort());
  for (const id of Object.keys(EMBLEMS)) {
    const svg = emblemSvg(id);
    assert.match(svg, /^<svg class="fleet-emblem emblem-/);
    assert.ok(!/<script|onload|javascript:/i.test(svg));
    assert.ok(svg.includes(EMBLEMS[id].name));
  }
  assert.equal(emblemSvg('nope'), '');
  assert.equal(emblemSvg(''), '');
  assert.equal(emblemSvg('star', { label: false }).includes('<title>'), false);
});
