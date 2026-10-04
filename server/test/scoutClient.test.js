const test = require("node:test");
const assert = require("node:assert/strict");
test("each scout click keeps its order and pending stock without duplicate snapshot subtraction", async () => {
  const { ScoutController } = await import(
    "../../ogame-3d/src/ui/views/ScoutController.js"
  );
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k),
    setItem: (k, v) => store.set(k, v),
  };
  const requests = [];
  const state = {
    userId: "a",
    planet: { id: "home" },
    unassignedShips: { espionageProbe: 3 },
    fleetMovements: [],
    syncFromServer(s) {
      Object.assign(this, s);
    },
  };
  const api = {
    isAuthenticated: () => true,
    launchScout: (order) =>
      new Promise((resolve) => requests.push({ order, resolve })),
  };
  const c = new ScoutController({
    api,
    state,
    storage,
    notify: () => {},
    onChange: () => {},
  });
  c.launch({ galaxy: 1, system: 1, planet: 8 });
  c.launch({ galaxy: 1, system: 1, planet: 8 });
  c.launch({ galaxy: 1, system: 1, planet: 9 });
  c.launch({ galaxy: 1, system: 1, planet: 9 });
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map((r) => r.order.requestId)).size, 3);
  assert.equal(c.available(), 0);
  state.unassignedShips.espionageProbe = 2;
  state.fleetMovements = [{ requestId: requests[0].order.requestId }];
  assert.equal(c.available(), 0);
  requests[0].resolve({
    snapshot: {
      unassignedShips: { espionageProbe: 2 },
      fleetMovements: state.fleetMovements,
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(c.available(), 0);
  assert.equal(Object.keys(c.pending).length, 2);
  state.userId = "b";
  c.ensureAccount();
  requests[1].resolve({
    snapshot: { userId: "a", unassignedShips: { espionageProbe: 99 } },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(state.userId, "b");
  assert.equal(c.reports.length, 0);
});
test("uncertain scout response retries with same request identity", async () => {
  const { ScoutController } = await import(
    "../../ogame-3d/src/ui/views/ScoutController.js"
  );
  const storage = { getItem: () => null, setItem: () => {} };
  const state = {
    userId: "a",
    planet: { id: "home" },
    unassignedShips: { espionageProbe: 1 },
    fleetMovements: [],
    syncFromServer() {},
  };
  const orders = [];
  const api = {
    launchScout: async (o) => {
      orders.push(o);
      if (orders.length === 1) throw Error("lost");
      return {};
    },
    getFleetRequest: async () => {
      throw Object.assign(Error("not committed"), { status: 404 });
    },
  };
  const c = new ScoutController({
    api,
    state,
    storage,
    notify: () => {},
    onChange: () => {},
  });
  c.launch({ galaxy: 1, system: 1, planet: 8 });
  await new Promise((r) => setImmediate(r));
  assert.equal(Object.keys(c.pending).length, 1);
  await c.dispatch(Object.values(c.pending)[0], true);
  assert.equal(orders[0].requestId, orders[1].requestId);
  assert.equal(Object.keys(c.pending).length, 0);
});
