const test = require("node:test");
const assert = require("node:assert/strict");
const {
  availableShips,
  validateComposition,
  reconcileFormations,
} = require("../utils/formationRules");
const { attackWaves, defenseWaves } = require("../utils/combatWaves");
const { ENTITY_IDS } = require("../data/catalog");
test("formation reservations exclude the editor and ships on a mission", () => {
  const user = {
    planets: [{ _id: "p", fleet: { lightFighter: 20, cruiser: 5 } }],
    fleetFormations: [
      {
        _id: "a",
        originPlanetId: "p",
        status: "ready",
        ships: { lightFighter: 8 },
      },
      {
        _id: "b",
        originPlanetId: "p",
        status: "ready",
        ships: { lightFighter: 7 },
      },
      {
        _id: "c",
        originPlanetId: "p",
        status: "onMission",
        ships: { lightFighter: 99 },
      },
    ],
  };
  assert.equal(availableShips(user, "p").lightFighter, 5);
  assert.equal(availableShips(user, "p", "a").lightFighter, 13);
  assert.throws(
    () =>
      validateComposition(
        { lightFighter: 6 },
        availableShips(user, "p"),
        () => ({ speed: 10 }),
      ),
    /부족/,
  );
  assert.throws(
    () =>
      validateComposition({ solarSatellite: 1 }, { solarSatellite: 1 }, () => ({
        speed: 0,
      })),
    /이동/,
  );
  assert.throws(
    () =>
      validateComposition({ lightFighter: 0.5 }, { lightFighter: 1 }, () => ({
        speed: 10,
      })),
    /integer/,
  );
});
test("defensive losses trim reservations deterministically without replacing other fleets", () => {
  const user = {
    planets: [{ _id: "p", fleet: { lightFighter: 9 } }],
    fleetFormations: [
      {
        number: 2,
        originPlanetId: "p",
        status: "ready",
        ships: { lightFighter: 7 },
        revision: 1,
      },
      {
        number: 1,
        originPlanetId: "p",
        status: "ready",
        ships: { lightFighter: 6 },
        revision: 1,
      },
    ],
  };
  reconcileFormations(user);
  assert.deepEqual(user.fleetFormations[0].ships, { lightFighter: 3 });
  assert.equal(user.fleetFormations[0].revision, 2);
  assert.equal(user.fleetFormations[1].revision, 1);
});
test("all catalog ship types and legacy omitted ships enter the eight combat waves", () => {
  const fleet = Object.fromEntries(ENTITY_IDS.ship.map((id, i) => [id, i + 1]));
  for (const deck of [undefined, [{ type: ENTITY_IDS.ship[0], count: 1 }]]) {
    const total = {};
    for (const wave of attackWaves(fleet, deck))
      for (const [id, n] of Object.entries(wave.ships))
        total[id] = (total[id] || 0) + n;
    assert.deepEqual(total, fleet);
  }
  const waves = defenseWaves({
    fleet: { lightFighter: 4, cruiser: 5 },
    defense: { rocketLauncher: 7, lightLaser: 2 },
  });
  assert.deepEqual(waves[1].ships, { lightFighter: 4, cruiser: 5 });
  assert.equal(Object.keys(waves[0].defense).length, 2);
});
