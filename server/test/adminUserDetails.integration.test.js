const test = require("node:test"),
  assert = require("node:assert/strict"),
  mongoose = require("mongoose");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(
  /\/[^/?]+(?=\?|$)/,
  "/cosmic_admin_details_test",
);
test(
  "admin details provide fresh multi-planet economy, global research, fleets and queues without password",
  { skip: !uri, timeout: 30000 },
  async () => {
    const secret = "admin-detail-test-only-secret-at-least-32-characters";
    process.env.JWT_SECRET = secret;
    await mongoose.connect(uri);
    let child;
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User"),
        Queue = require("../models/BuildingQueue");
      const admin = await User.createWithHomePlanet({
        username: "detail-admin",
        email: "admin@details.test",
        password: "test-password",
        isAdmin: true,
        adminRole: "moderator",
      });
      const user = await User.createWithHomePlanet({
        username: "detail-player",
        email: "player@details.test",
        password: "test-password",
      });
      user.research.energyTechnology = 3;
      user.planets[0].buildings.metalMine = 2;
      user.planets[0].fleet.lightFighter = 5;
      user.planets[0].defense.rocketLauncher = 2;
      user.planets[0].lastUpdate = new Date(Date.now() - 60000);
      user.planets.push({
        name: "Second Colony",
        galaxy: 2,
        system: 1,
        planet: 15,
        ...require("../utils/planetArea").createPlanetEnvironment(),
        resources: { metal: 500, crystal: 300, deuterium: 100 },
        buildings: { housing: 2 },
        fleet: { smallCargo: 3 },
      });
      require("../utils/populationEconomy").initializePopulation(
        user.planets[1],
        await require("../models/GameConfig").getConfig(),
      );
      user.fleetFormations.push({
        number: 1,
        name: "Patrol",
        originPlanetId: user.planets[0]._id,
        ships: { lightFighter: 2 },
        status: "ready",
      });
      user.markModified("planets");
      await user.save();
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            "planets.0.buildings.metalMine": 2,
            "planets.0.fleet.lightFighter": 5,
            "planets.0.defense.rocketLauncher": 2,
            "planets.0.lastUpdate": new Date(Date.now() - 60000),
          },
        },
      );
      assert.equal(
        (await User.findById(user._id)).planets[0].buildings.metalMine,
        2,
      );
      const endTime = new Date(Date.now() + 3600000);
      await Queue.create({
        userId: user._id,
        planetId: "1",
        type: "building",
        itemId: "housing",
        name: "주거시설",
        level: 3,
        status: "building",
        startTime: new Date(),
        endTime,
        duration: 3600,
      });
      await Queue.create({
        userId: user._id,
        planetId: "0",
        type: "research",
        itemId: "energyTechnology",
        name: "에너지 기술",
        level: 4,
        status: "building",
        startTime: new Date(),
        endTime,
        duration: 3600,
      });
      const superadmin = await User.createWithHomePlanet({
        username: "energy-editor",
        email: "energy-editor@details.test",
        password: "test-password",
        isAdmin: true,
        adminRole: "superadmin",
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
          throw Error("server failed");
        }),
      ]);
      const base = `http://127.0.0.1:${ready.port}`;
      const jwt = require("jsonwebtoken");
      const call = async (actor, id) => {
        const r = await fetch(base + "/api/admin/users/" + id, {
          headers: {
            Authorization:
              "Bearer " + jwt.sign({ userId: String(actor._id) }, secret),
          },
        });
        return { status: r.status, data: await r.json() };
      };
      assert.equal((await call(user, user._id)).status, 403);
      assert.equal((await call(admin, "invalid")).status, 400);
      assert.equal((await call(admin, "000000000000000000000000")).status, 404);
      const response = await call(admin, user._id);
      assert.equal(response.status, 200);
      const detail = response.data;
      assert.equal(detail.password, undefined);
      assert.ok(!JSON.stringify(detail).includes(user.password));
      const beforeEnergy = (await User.findById(user._id)).planets[0].resources
        .energy;
      for (const [method, path, body] of [
        [
          "PUT",
          `/api/admin/users/${user._id}`,
          { planetIndex: 0, resources: { energy: 100000, metal: 999999 } },
        ],
        [
          "POST",
          `/api/admin/users/${user._id}/resources`,
          { planetIndex: 0, resourceType: "energy", amount: 1000 },
        ],
      ]) {
        const denied = await fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization:
              "Bearer " + jwt.sign({ userId: String(superadmin._id) }, secret),
          },
          body: JSON.stringify(body),
        });
        assert.equal(denied.status, 400);
        assert.equal((await denied.json()).code, "INVALID_REQUEST");
        assert.equal(
          (await User.findById(user._id)).planets[0].resources.energy,
          beforeEnergy,
        );
      }
      const s = detail.gameSnapshot;
      assert.equal(s.planets.length, 2);
      assert.equal(s.research.energyTechnology, 3);
      assert.equal(s.planets[0].buildings.metalMine, 2);
      assert.ok(s.planets[0].resources.metal > 500);
      assert.ok(s.planets[0].production.metal > 0);
      assert.ok(Number.isFinite(s.planets[0].energyState.balance));
      assert.ok(s.planets[1].area.usable > 0);
      assert.ok(s.planets[1].populationState.count > 0);
      assert.equal(s.planets[0].fleet.lightFighter, 5);
      assert.equal(s.planets[0].unassignedShips.lightFighter, 3);
      assert.equal(s.planets[1].unassignedShips.smallCargo, 3);
      assert.equal(s.planets[0].defense.rocketLauncher, 2);
      assert.equal(s.fleetFormations[0].name, "Patrol");
      assert.ok(
        s.queueState.all.some(
          (q) => q.planetId === "1" && q.itemId === "housing",
        ),
      );
      assert.ok(s.queueState.all.some((q) => q.type === "research"));
      assert.ok(
        detail.gameCatalog.entities.some(
          (e) => e.entityId === "housing" && e.display.name === "주거시설",
        ),
      );
    } finally {
      if (child) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
