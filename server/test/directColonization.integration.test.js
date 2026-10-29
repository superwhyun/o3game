const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(
  /\/[^/?]+(?=\?|$)/,
  "/cosmic_direct_colonization_test",
);
test(
  "direct colonies consume only unassigned ships and settle or recall exactly once",
  { skip: !uri, timeout: 30000 },
  async () => {
    const secret = "direct-colony-test-only-secret-at-least-32-characters";
    process.env.JWT_SECRET = secret;
    let child;
    await mongoose.connect(uri);
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User"),
        Config = require("../models/GameConfig"),
        Movement = require("../models/FleetMovement");
      const forms = require("../services/FleetFormationService"),
        fleets = require("../services/FleetService");
      await Config.create({
        populationSettings: { initialPopulation: 30, growthHours: 1e9 },
      });
      await require("../services/EntityConfigService").initialize();
      await Promise.all([User.init(), Movement.init()]);
      const user = await User.create({
        username: "direct_colony",
        email: "direct@example.test",
        password: "test-password",
        planets: [
          { galaxy: 1, system: 430, planet: 1, fleet: { colonyShip: 2 } },
        ],
      });
      const origin = String(user.planets[0]._id);
      const f = await forms.change(user._id, "create", null, {
        originPlanetId: origin,
      });
      await forms.change(user._id, "update", f.formationId, {
        expectedRevision: 1,
        name: "보존 편성",
        ships: { colonyShip: 1 },
      });
      const order = {
        requestId: randomUUID(),
        mission: "colonize",
        originPlanetId: origin,
        destination: { galaxy: 1, system: 431, planet: 2 },
        colonists: 7,
        cargo: { metal: 100 },
      };
      const movement = await fleets.launch(user._id, order);
      assert.equal(movement.formationId, null);
      assert.equal(
        String((await fleets.launch(user._id, order))._id),
        String(movement._id),
      );
      await assert.rejects(
        fleets.launch(user._id, {
          ...order,
          requestId: randomUUID(),
          destination: { galaxy: 1, system: 432, planet: 2 },
        }),
        (e) => e.code === "INSUFFICIENT_SHIPS",
      );
      let owner = await User.findById(user._id);
      assert.equal(owner.fleetFormations.length, 1);
      assert.equal(owner.fleetFormations[0].status, "ready");
      assert.equal(owner.planets[0].population.count, 23);
      const back = await fleets.recall(
        user._id,
        movement._id,
        new Date(+movement.startTime + 1000),
      );
      await Promise.all([
        fleets.processMovement(back._id, new Date(+back.returnTime + 1)),
        fleets.processMovement(back._id, new Date(+back.returnTime + 1)),
      ]);
      owner = await User.findById(user._id);
      assert.equal(owner.planets[0].population.count, 30);
      assert.equal(owner.planets[0].fleet.colonyShip, 2);
      const launched = await fleets.launch(user._id, {
        ...order,
        requestId: randomUUID(),
      });
      await Promise.all([
        fleets.processMovement(
          launched._id,
          new Date(+launched.arrivalTime + 1),
        ),
        fleets.processMovement(
          launched._id,
          new Date(+launched.arrivalTime + 1),
        ),
      ]);
      owner = await User.findById(user._id);
      assert.equal(owner.planets.length, 2);
      assert.equal(owner.planets[1].population.count, 7);
      assert.equal(owner.planets[1].resources.metal, 100);
      assert.equal(owner.planets[1].fleet.colonyShip, 0);
      assert.equal(owner.fleetFormations.length, 1);
      assert.equal(owner.fleetFormations[0].ships.colonyShip, 1);
      await assert.rejects(
        fleets.launch(user._id, {
          ...order,
          requestId: randomUUID(),
          mission: "attack",
        }),
      );
      // A single unassigned ship cannot be reserved by two concurrent orders.
      const racer = await User.create({
        username: "direct_race",
        email: "race@example.test",
        password: "test-password",
        planets: [
          { galaxy: 1, system: 433, planet: 1, fleet: { colonyShip: 1 } },
        ],
      });
      const attempts = await Promise.allSettled(
        [2, 3].map((planet) =>
          fleets.launch(racer._id, {
            ...order,
            requestId: randomUUID(),
            originPlanetId: String(racer.planets[0]._id),
            destination: { galaxy: 1, system: 434, planet },
            cargo: {},
            colonists: 5,
          }),
        ),
      );
      assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (await User.findById(racer._id)).planets[0].fleet.colonyShip,
        0,
      );

      const apiUser = await User.create({
        username: "direct_api",
        email: "api@example.test",
        password: "test-password",
        planets: [
          { galaxy: 1, system: 435, planet: 1, fleet: { colonyShip: 1 } },
        ],
      });
      child = fork(
        path.join(__dirname, "fixtures/apiErrorAuditServer.cjs"),
        [],
        {
          env: {
            ...process.env,
            MONGODB_URI: uri,
            JWT_SECRET: secret,
            PORT: "0",
            NODE_ENV: "test",
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const [ready] = await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw Error("test server failed");
        }),
      ]);
      const token = require("jsonwebtoken").sign(
        { userId: String(apiUser._id) },
        secret,
      );
      const apiOrder = {
        ...order,
        requestId: randomUUID(),
        originPlanetId: String(apiUser.planets[0]._id),
        destination: { galaxy: 2, system: 20, planet: 5 },
      };
      const response = await fetch(
        `http://127.0.0.1:${ready.port}/api/game/fleets`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(apiOrder),
        },
      );
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.fleet.formationId, null);
      assert.equal(result.snapshot.fleetFormations.length, 0);
      assert.equal(result.snapshot.planets[0].fleet.colonyShip, 0);
      const repeat = await fetch(
        `http://127.0.0.1:${ready.port}/api/game/fleets`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(apiOrder),
        },
      );
      assert.equal(repeat.status, 201);
      assert.equal((await repeat.json()).fleet.id, result.fleet.id);
    } finally {
      if (child && child.exitCode === null) {
        const ended = once(child, "exit");
        child.kill();
        await ended;
      }
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
