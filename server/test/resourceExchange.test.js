const test = require('node:test');
const assert = require('node:assert/strict');
const { EXCHANGE, exchangeQuote, applyExchange } = require('../utils/resourceExchange');
const { inferEnvironment, initializeEnvironment, planetEnvironment } = require('../utils/planetEnvironment');
test('exchange rates charge 5%, round down and cannot create profit on a round trip', () => {
  assert.equal(exchangeQuote({ from: 'metal', to: 'crystal', amount: 300 }).received, 190);
  for (const from of Object.keys(EXCHANGE.rates)) for (const to of Object.keys(EXCHANGE.rates)) {
    if (from === to) continue;
    const received = exchangeQuote({ from, to, amount: 300 }).received;
    assert.ok(exchangeQuote({ from: to, to: from, amount: received }).received < 300);
  }
});
test('invalid trades, shortages and full stores leave all resources unchanged', () => {
  const p = { resources: { metal: 500, crystal: 900, deuterium: 0, food: 0 } };
  const before = structuredClone(p);
  const storage = { metal: 1000, crystal: 1000, deuterium: 1000, food: 1000 };
  for (const input of [
    { from: 'metal', to: 'crystal', amount: 300 },
    { from: 'metal', to: 'food', amount: 501 },
    { from: 'metal', to: 'metal', amount: 30 },
    { from: 'energy', to: 'food', amount: 30 },
    ...[0, -1, 1.5, NaN, Infinity, '30', Number.MAX_SAFE_INTEGER + 1].map(amount => ({ from: 'metal', to: 'food', amount }))
  ]) { assert.throws(() => applyExchange(p, storage, input)); assert.deepEqual(p, before); }
  applyExchange(p, storage, { from: 'metal', to: 'food', amount: 300 });
  assert.equal(p.resources.metal, 200);
  assert.equal(p.resources.food, 190);
});
test('climates classify all four surfaces, persist once and preserve production traits', () => {
  for (const [minTemp, type] of [[-80, 'ice'], [-10, 'tropical'], [20, 'desert'], [50, 'volcanic']]) {
    const p = { minTemp, maxTemp: minTemp + 40, traits: { metal: 1.1, crystal: .9 } };
    assert.equal(inferEnvironment(p), type);
    assert.equal(initializeEnvironment(p), true);
    assert.equal(planetEnvironment(p).type, type);
    p.minTemp = 0;
    assert.equal(initializeEnvironment(p), false);
    assert.equal(planetEnvironment(p).type, type);
    assert.deepEqual(p.traits, { metal: 1.1, crystal: .9 });
  }
});
