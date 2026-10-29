const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  levelFor,
  profile,
  regenerate,
  cleared,
} = require("../utils/pirateRules");
test("pirate levels depend only on local development and standardize combat strength", () => {
  assert.equal(levelFor({ buildings: { mine: 10 } }).level, 1);
  assert.equal(
    levelFor({
      buildings: { mine: 20 },
      research: { anything: 999 },
      fleet: { deathstar: 100 },
    }).level,
    2,
  );
  assert.equal(levelFor({ buildings: { mine: 9999 } }).level, 10);
  assert.deepEqual(
    profile(2),
    profile(levelFor({ buildings: { lab: 20 } }).level),
  );
});
test("pirates spend produced resources to rebuild, never exceed caps, and split settlement agrees", () => {
  const initial = () => ({
    fleet: {},
    defense: {},
    resources: { metal: 0, crystal: 0, deuterium: 0 },
    lastUpdate: new Date(0),
  });
  const cost = () => ({
    costModel: { baseCost: { metal: 100, crystal: 60, deuterium: 20 } },
  });
  const p = initial(),
    s = { level: 1, lastUpdate: new Date(0) };
  regenerate(p, s, { serverSpeed: 1 }, new Date(300000), cost);
  assert.equal(p.fleet.lightFighter || 0, 0);
  const q = initial(),
    t = { level: 1, lastUpdate: new Date(0) };
  for (let i = 1; i <= 48; i++)
    regenerate(q, t, { serverSpeed: 1 }, new Date(i * 3600000), cost);
  regenerate(p, s, { serverSpeed: 1 }, new Date(48 * 3600000), cost);
  assert.deepEqual(p.fleet, q.fleet);
  assert.deepEqual(p.defense, q.defense);
  for (const r of ["metal", "crystal", "deuterium"])
    assert.ok(Math.abs(p.resources[r] - q.resources[r]) < 1e-6);
  for (const [type, units] of Object.entries(profile(1).maximum))
    for (const [id, max] of Object.entries(units))
      assert.equal(p[type][id] || 0, max);
  regenerate(p, s, { serverSpeed: 100 }, new Date(10 * 365 * 86400000), cost);
  for (const value of Object.values(p.resources))
    assert.ok(value <= profile(1).storage);
  assert.equal(cleared(p), false);
  assert.equal(cleared(initial()), true);
});
