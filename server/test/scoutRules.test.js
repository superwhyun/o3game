const test = require("node:test");
const assert = require("node:assert/strict");
const r = require("../utils/scoutRules");
test("scouting information follows tech difference and omits hidden fields", () => {
  assert.deepEqual(
    [-3, 0, 1, 2, 3].map((diff) => r.tierOf(5 + diff, 5)),
    [1, 1, 2, 3, 4],
  );
  const p = {
    resources: { metal: 1.9, crystal: 2, deuterium: 3, energy: 999 },
    fleet: { cruiser: 2 },
    defense: { rocketLauncher: 3 },
    buildings: { metalMine: 5 },
    research: { espionageTechnology: 5 },
  };
  assert.deepEqual(r.sectionsOf(p, 1), {
    resources: { metal: 1, crystal: 2, deuterium: 3 },
  });
  assert.equal("defense" in r.sectionsOf(p, 2), false);
  assert.equal("research" in r.sectionsOf(p, 3), false);
  assert.deepEqual(r.sectionsOf(p, 4).research, p.research);
});
test("stable scout rolls, bounded detection and armed interception", () => {
  assert.equal(r.detectionChance(0, 20), 95);
  assert.equal(r.detectionChance(20, 0), 5);
  assert.equal(r.detectionChance(4, 4), 50);
  assert.equal(
    r.detectionRoll("move", "secret"),
    r.detectionRoll("move", "secret"),
  );
  assert.notEqual(
    r.detectionRoll("move", "secret"),
    r.detectionRoll("move", "other"),
  );
  const stats = (type, id) => ({
    attack:
      id === "smallCargo"
        ? 5
        : ["cruiser", "rocketLauncher"].includes(id)
          ? 50
          : 0,
    category: id === "cruiser" ? "military" : "civil",
  });
  for (const fleet of [
    {},
    { smallCargo: 10 },
    { espionageProbe: 100, solarSatellite: 10 },
  ])
    assert.equal(r.canIntercept({ fleet, defense: {} }, stats), false);
  assert.equal(
    r.canIntercept({ fleet: { cruiser: 1 }, defense: {} }, stats),
    true,
  );
  assert.equal(
    r.canIntercept({ fleet: {}, defense: { rocketLauncher: 1 } }, stats),
    true,
  );
  assert.equal(
    r.levelOf(
      { research: { espionageTechnology: 7 } },
      { research: { espionageTechnology: 0 } },
    ),
    7,
  );
});
