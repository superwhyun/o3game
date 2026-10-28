const assert = require("node:assert/strict");
const test = require("node:test");

const { buildGalaxySystem } = require("../utils/galaxySystem");

test("buildGalaxySystem exposes only the requested system and safe player fields", () => {
  const result = buildGalaxySystem({
    galaxy: 1,
    system: 2,
    requestingUserId: "player-1",
    users: [
      {
        _id: "player-1",
        username: "Commander",
        isOnline: true,
        socketId: "must-not-leak",
        planets: [
          { galaxy: 1, system: 2, planet: 4, name: "Home", _id: "home-id" },
          { galaxy: 1, system: 3, planet: 5, name: "Elsewhere" },
        ],
      },
      {
        _id: "player-2",
        username: "Neighbor",
        isOnline: false,
        socketId: "must-not-leak-either",
        planets: [{ galaxy: 1, system: 2, planet: 8, name: "Target" }],
      },
    ],
  });

  assert.equal(result.positions[3].owner, "self");
  assert.deepEqual(result.positions[3].planet, {
    id: "home-id",
    name: "Home",
    username: "Commander",
    isOnline: true,
  });
  assert.equal(result.positions[7].owner, "other");
  assert.equal(result.positions[7].planet.socketId, undefined);
  assert.equal(result.positions[4].occupied, false);
});

test("buildGalaxySystem rejects invalid coordinates", () => {
  assert.throws(
    () =>
      buildGalaxySystem({
        galaxy: 0,
        system: 1,
        requestingUserId: "player",
        users: [],
      }),
    /galaxy/,
  );
});

test("buildGalaxySystem keeps the first claimant of a duplicated slot and reports the rest", () => {
  const result = buildGalaxySystem({
    galaxy: 1,
    system: 1,
    requestingUserId: "player",
    users: [
      {
        _id: "one",
        username: "One",
        planets: [{ galaxy: 1, system: 1, planet: 1 }],
      },
      {
        _id: "two",
        username: "Two",
        planets: [{ galaxy: 1, system: 1, planet: 1 }],
      },
    ],
  });

  assert.equal(result.positions[0].planet.username, "One");
  assert.deepEqual(result.conflicts, [{ position: 1, userId: "two" }]);
});

test("reconnaissance reveals explored slots and only the name actually observed for the current owner", () => {
  const users = [
    {
      _id: "owner",
      username: "Neighbor",
      planets: [
        {
          _id: "target",
          galaxy: 1,
          system: 1,
          planet: 8,
          name: "Renamed today",
        },
      ],
    },
  ];
  const report = {
    destination: { galaxy: 1, system: 1, planet: 8 },
    targetPlanetId: "target",
    targetUserId: "owner",
    targetName: "Observed name",
    outcome: "occupied",
    observedAt: new Date("2026-01-01"),
  };
  const make = (reports) =>
    buildGalaxySystem({
      galaxy: 1,
      system: 1,
      requestingUserId: "me",
      users,
      scoutReports: reports,
    }).positions;
  assert.equal(make([])[7].scouted, false);
  assert.equal(make([])[7].planet.name, null);
  assert.equal(make([report])[7].scouted, true);
  assert.equal(make([report])[7].planet.name, "Observed name");
  assert.equal(
    make([{ ...report, targetUserId: "previous-owner" }])[7].planet.name,
    null,
  );
  assert.equal(
    make([{ ...report, targetPlanetId: "previous-planet" }])[7].planet.name,
    null,
  );
  const recent = {
    ...report,
    targetName: "New observation",
    observedAt: new Date("2026-01-02"),
  };
  assert.equal(make([report, recent])[7].planet.name, "New observation");
  const empty = {
    destination: { galaxy: 1, system: 1, planet: 9 },
    outcome: "empty",
    observedAt: new Date(),
  };
  assert.equal(make([empty])[8].scouted, true);
  assert.equal(make([empty])[8].occupied, false);
  assert.equal(make([{ ...empty, outcome: "unavailable" }])[8].scouted, false);
  assert.equal(
    make([{ ...empty, destination: { galaxy: 2, system: 1, planet: 9 } }])[8]
      .scouted,
    false,
  );
});

test("only owned live diameter and surveyed diameter are exposed", () => {
  const users = [
    {
      _id: "me",
      username: "Me",
      planets: [
        { _id: "home", galaxy: 1, system: 1, planet: 1, diameter: 12800 },
      ],
    },
    {
      _id: "other",
      username: "Other",
      planets: [
        { _id: "away", galaxy: 1, system: 1, planet: 2, diameter: 20000 },
      ],
    },
  ];
  const scoutReports = [
    {
      destination: { galaxy: 1, system: 1, planet: 2 },
      outcome: "occupied",
      observedAt: new Date(),
      sections: { environment: { diameter: 15000 } },
    },
  ];
  const view = buildGalaxySystem({
    galaxy: 1,
    system: 1,
    requestingUserId: "me",
    users,
    scoutReports,
  });
  assert.equal(view.positions[0].planet.diameter, 12800);
  assert.equal(view.positions[1].planet.diameter, undefined);
  assert.equal(view.positions[1].survey.diameter, 15000);
});

test("random bot allocation covers the universe while avoiding occupied coordinates", () => {
  const { pickHomeCoordinate, coordinateKey } = require("../utils/universe");
  const occupied = new Set();
  const points = [0.05, 0.25, 0.55, 0.95].map((value) => {
    const p = pickHomeCoordinate(occupied, {
      randomized: true,
      rng: () => value,
    });
    occupied.add(coordinateKey(p));
    return p;
  });
  assert.equal(new Set(points.map((p) => p.galaxy)).size, 4);
  assert.ok(points.some((p) => p.system > 1));
  const next = pickHomeCoordinate(occupied, {
    randomized: true,
    rng: () => 0.05,
  });
  assert.equal(occupied.has(coordinateKey(next)), false);
  assert.equal(
    pickHomeCoordinate(occupied, {
      randomized: true,
      galaxy: 7,
      rng: () => 0.5,
    }).galaxy,
    7,
  );
});
