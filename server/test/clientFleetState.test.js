const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
test("client rejects delayed snapshots, replaces ship counts, and resets ordering for another user", async () => {
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  try {
    const { GameState } = await import(
      pathToFileURL(
        path.join(__dirname, "../../ogame-3d/src/core/GameState.js"),
      ).href
    );
    const state = new GameState();
    const snapshot = (revision, fleet, id = "owner") => ({
      id,
      stateRevision: revision,
      serverTime: "2026-10-04T00:00:00Z",
      planets: [
        {
          _id: "planet",
          name: "Home",
          fleet,
          resources: { metal: 100, crystal: 100, deuterium: 100 },
          galaxy: 1,
          system: 1,
          planet: 4,
        },
      ],
      fleetFormations: [],
      fleetMovements: [],
    });
    state.syncFromServer(snapshot(2, { lightFighter: 10 }));
    state.syncFromServer(snapshot(1, { lightFighter: 99 }));
    assert.equal(state.fleet.lightFighter, 10);
    state.syncFromServer(snapshot(3, { cruiser: 2 }));
    assert.equal(state.fleet.lightFighter, undefined);
    assert.equal(state.planet.id, "planet");
    state.syncFromServer(snapshot(1, { lightFighter: 1 }, "another-owner"));
    assert.equal(state.fleet.lightFighter, 1);
    assert.equal(state.stateRevision, 1);
  } finally {
    global.setInterval = originalSetInterval;
  }
});
