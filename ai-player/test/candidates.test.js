import test from "node:test";
import assert from "node:assert/strict";
import {
  candidatesFor,
  colonyShipBudget,
  observationFor,
} from "../candidates.js";
test("candidate costs, prerequisites, queues and attack opt-in", () => {
  const p = {
    _id: "p",
    galaxy: 1,
    system: 1,
    planet: 7,
    buildings: { mine: 2 },
    resources: { metal: 200, crystal: 0, deuterium: 0 },
    area: { available: 1 },
  };
  const s = {
    planets: [p],
    research: {},
    currentPlanet: 0,
    queueState: { all: [] },
    fleetFormations: [],
  };
  const e = {
    entityType: "building",
    entityId: "mine",
    display: { name: "Mine" },
    costModel: { baseCost: { metal: 60 }, costMultiplier: 2 },
  };
  assert.equal(candidatesFor(s, { entities: [e] }, null, {}).length, 1);
  p.resources.metal = 240;
  assert.equal(
    candidatesFor(s, { entities: [e] }, null, {})[1].details.cost.metal,
    240,
  );
  s.queueState.all = [{ type: "building", planetId: "0", itemId: "mine" }];
  assert.equal(candidatesFor(s, { entities: [e] }, null, {}).length, 1);
  s.queueState.all = [];
  e.requirements = { research: { energy: 1 } };
  assert.equal(candidatesFor(s, { entities: [e] }, null, {}).length, 1);
});
test("fleet candidates respect attack opt-in and pending colony limit", () => {
  const snapshot = {
    currentPlanet: 0,
    planets: [
      {
        _id: "origin",
        galaxy: 1,
        system: 1,
        planet: 7,
        resources: {},
        buildings: {},
        populationState: { count: 50 },
      },
    ],
    research: {},
    queueState: { all: [] },
    fleetFormations: [
      {
        id: "fleet",
        name: "1함대",
        status: "ready",
        revision: 3,
        originPlanetId: "origin",
        ships: { colonyShip: 1, lightFighter: 5 },
      },
    ],
    fleetMovements: [],
    unassignedShips: { espionageProbe: 1 },
  };
  const catalog = {
    entities: [
      {
        entityType: "ship",
        entityId: "lightFighter",
        display: { category: "military" },
        requirements: { buildings: { shipyard: 99 } },
        costModel: { baseCost: { metal: 999999 } },
      },
    ],
  };
  const galaxy = {
    positions: [
      { position: 8, occupied: false, scouted: true },
      {
        position: 9,
        occupied: true,
        owner: "other",
        scouted: true,
        planet: { id: "target", name: "Enemy" },
      },
      { position: 10, scouted: false, occupied: false },
    ],
  };
  let candidates = candidatesFor(snapshot, catalog, galaxy, {
    maxColonies: 2,
    allowAttacks: false,
  });
  assert.ok(candidates.some((c) => c.command?.body?.mission === "colonize"));
  assert.ok(!candidates.some((c) => c.command?.body?.mission === "attack"));
  const colony = candidates.find((c) => c.command?.body?.mission === "colonize")
    .command.body;
  assert.equal(colony.colonists, 10);
  assert.equal(colony.expectedRevision, 3);
  assert.equal(colony.originPlanetId, "origin");
  assert.equal(
    candidates.find((c) => c.command?.path === "/api/game/scouts").command.body
      .destination.planet,
    10,
  );
  snapshot.fleetMovements = [
    {
      mission: "colonize",
      status: "flying",
      destination: { galaxy: 1, system: 1, planet: 8 },
    },
    {
      mission: "spy",
      status: "flying",
      destination: { galaxy: 1, system: 1, planet: 10 },
    },
  ];
  candidates = candidatesFor(snapshot, catalog, galaxy, {
    maxColonies: 2,
    allowAttacks: true,
  });
  assert.ok(!candidates.some((c) => c.command?.body?.mission === "colonize"));
  assert.ok(!candidates.some((c) => c.command?.path === "/api/game/scouts"));
  assert.equal(
    candidates.find((c) => c.command?.body?.mission === "attack").command.body
      .expectedTargetPlanetId,
    "target",
  );
});

test("all colonies expose direct actions without changing the selected planet, with fair ordering", () => {
  const planets = [0, 1, 2].map((index) => ({
    _id: `p${index}`,
    name: `Colony${index}`,
    galaxy: 1,
    system: 1,
    planet: index + 1,
    resources: { metal: 100 },
    buildings: {},
    area: { available: index === 0 ? 0 : 10 },
  }));
  const snapshot = {
    planets,
    currentPlanet: 0,
    research: {},
    queueState: { all: [] },
    fleetFormations: [],
  };
  const catalog = {
    entities: [
      {
        entityType: "building",
        entityId: "mine",
        display: { name: "Mine" },
        costModel: { baseCost: { metal: 60 } },
      },
    ],
  };
  const actions = candidatesFor(snapshot, catalog, [], {}).filter(
    (c) => c.command,
  );
  assert.deepEqual(
    actions.map((c) => c.command.body.planetId),
    ["1", "2"],
  );
  assert.ok(actions.every((c) => c.command.path === "/api/queue/build"));
  assert.deepEqual(
    actions.map((c) => c.details.originPlanetId),
    ["p1", "p2"],
  );
  snapshot.currentPlanet = 2;
  assert.deepEqual(
    candidatesFor(snapshot, catalog, [], {})
      .filter((c) => c.command)
      .map((c) => c.command.body.planetId),
    ["1", "2"],
  );
  snapshot.queueState.all = [
    { type: "building", planetId: "1", itemId: "mine" },
  ];
  assert.deepEqual(
    candidatesFor(snapshot, catalog, [], {})
      .filter((c) => c.command)
      .map((c) => c.command.body.planetId),
    ["2"],
  );
});

test("a full local system does not hide remote scouting and direct colonization", () => {
  const p = {
    _id: "p",
    galaxy: 1,
    system: 1,
    planet: 7,
    fleet: { espionageProbe: 2, colonyShip: 1 },
    population: { count: 20 },
    area: { available: 0 },
    resources: {},
    buildings: {},
  };
  const snapshot = {
    planets: [p],
    currentPlanet: 0,
    unassignedShips: p.fleet,
    research: {},
    fleetFormations: [],
    fleetMovements: [],
    queueState: { all: [] },
  };
  const galaxy = [
    {
      galaxy: 1,
      system: 1,
      positions: [
        { position: 7, owner: "self", occupied: true, scouted: true },
      ],
    },
    {
      galaxy: 2,
      system: 20,
      positions: [
        { position: 3, occupied: false, scouted: true },
        { position: 4, occupied: false, scouted: false },
      ],
    },
  ];
  const actions = candidatesFor(snapshot, { entities: [] }, galaxy, {
    maxColonies: 9,
  });
  const colony = actions.find((c) => c.command?.body?.mission === "colonize");
  assert.deepEqual(colony.command.body.destination, {
    galaxy: 2,
    system: 20,
    planet: 3,
  });
  assert.equal(colony.command.body.formationId, undefined);
  const scout = actions.find((c) => c.command?.path === "/api/game/scouts");
  assert.deepEqual(scout.command.body.destination, {
    galaxy: 2,
    system: 20,
    planet: 4,
  });
});

test("obsolete free research can be cancelled without land, but human delegation keeps user orders", () => {
  const snapshot = {
    currentPlanet: 0,
    planets: [
      {
        _id: "p",
        galaxy: 1,
        system: 1,
        planet: 12,
        buildings: { researchLab: 5, shipyard: 6 },
        resources: { metal: 500000, crystal: 280000, deuterium: 280000 },
        area: { available: 0 },
      },
    ],
    research: { gravitonTechnology: 7, impulseDrive: 1 },
    queueState: {
      all: [
        {
          id: "aaa",
          planetId: "0",
          type: "research",
          itemId: "gravitonTechnology",
          level: 8,
          status: "building",
        },
        {
          id: "bbb",
          planetId: "0",
          type: "research",
          itemId: "gravitonTechnology",
          level: 9,
          status: "pending",
        },
      ],
    },
  };
  const catalog = {
    entities: [
      {
        entityId: "gravitonTechnology",
        entityType: "research",
        costModel: { baseCost: {} },
      },
      {
        entityId: "impulseDrive",
        entityType: "research",
        costModel: { baseCost: { metal: 100 } },
      },
    ],
  };
  let candidates = candidatesFor(snapshot, catalog, null, {
    kind: "bot",
    allowAttacks: false,
  });
  assert.ok(
    !candidates.some(
      (c) => c.command?.body?.researchId === "gravitonTechnology",
    ),
  );
  const recovery = candidates.find((c) => c.command?.method === "DELETE");
  assert.equal(recovery.command.path, "/api/queue/bbb");
  assert.equal(recovery.details.focus, "expansion");
  candidates = candidatesFor(snapshot, catalog, null, {
    kind: "delegate",
    allowAttacks: false,
  });
  assert.ok(!candidates.some((c) => c.command?.method === "DELETE"));
  snapshot.queueState.all = [];
  assert.ok(
    candidatesFor(snapshot, catalog, null, { kind: "bot" }).some(
      (c) => c.command?.body?.researchId === "impulseDrive",
    ),
  );
});

test("AI colony preparation respects cap and counts ships across colonies, queues and missions", () => {
  const catalog = {
    entities: [
      {
        entityType: "ship",
        entityId: "colonyShip",
        costModel: { baseCost: { metal: 1 } },
      },
    ],
  };
  const make = (owned = 1) => ({
    planets: Array.from({ length: owned }, (_, i) => ({
      _id: `p${i}`,
      galaxy: 1,
      system: 1,
      planet: i + 1,
      resources: { metal: 100 },
      buildings: {},
      fleet: { colonyShip: 0 },
      area: { available: 0 },
    })),
    queueState: { all: [] },
    fleetMovements: [],
  });
  const builds = (s) =>
    candidatesFor(s, catalog, null, { maxColonies: 9 }).filter(
      (c) => c.command?.body?.shipId === "colonyShip",
    );
  let s = make(9);
  assert.equal(builds(s).length, 0);
  assert.equal(
    observationFor(s, catalog, { maxColonies: 9 }).expansionPlan.atLimit,
    true,
  );
  s = make(8);
  assert.equal(builds(s).length, 8);
  s.planets[7].fleet.colonyShip = 1;
  assert.equal(builds(s).length, 0);
  s.planets[7].fleet.colonyShip = 0;
  s.queueState.all = [
    {
      type: "ship",
      itemId: "colonyShip",
      planetId: "7",
      count: 1,
      status: "pending",
    },
  ];
  assert.equal(builds(s).length, 0);
  s.queueState.all = [];
  s.fleetMovements = [
    { status: "flying", mission: "colonize", fleet: { colonyShip: 1 } },
  ];
  assert.equal(builds(s).length, 0);
  s.fleetMovements[0].status = "returning";
  assert.equal(builds(s).length, 0);
  s.fleetMovements[0].status = "completed";
  assert.equal(builds(s).length, 8);
  assert.equal(colonyShipBudget(s, { maxColonies: 5 }).needed, 0);
  s = make(3);
  s.planets[0].fleet.colonyShip = 2;
  s.queueState.all = [{ type: "ship", itemId: "colonyShip", count: 3 }];
  s.fleetMovements = [
    { status: "flying", mission: "attack", fleet: { colonyShip: 1 } },
  ];
  assert.equal(builds(s).length, 0);
});
