const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(
  /\/[^/?]+(?=\?|$)/,
  "/cosmic_planet_abandon_test",
);
test(
  "planet abandonment ownership, confirmation, busy guards, index remapping, research and slot reuse",
  { skip: !uri },
  async () => {
    process.env.JWT_SECRET =
      "planet-abandon-test-only-secret-at-least-32-characters";
    await mongoose.connect(uri);
    let server;
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User"),
        Queue = require("../models/BuildingQueue"),
        Movement = require("../models/FleetMovement");
      const service = require("../services/PlanetService");
      await require("../models/GameConfig").create({
        populationSettings: { initialPopulation: 30, growthHours: 1e9 },
      });
      await require("../services/EntityConfigService").initialize();
      await User.init();
      await Movement.init();
      const user = await User.create({
        username: "abandon-owner",
        email: "abandon-owner@example.test",
        password: "test-password",
        currentPlanet: 2,
        research: { astrophysics: 3 },
        researchScopeVersion: 1,
        planets: [
          {
            name: "본성",
            galaxy: 1,
            system: 430,
            planet: 1,
            fleet: { colonyShip: 1 },
            resources: { metal: 2000, crystal: 1000, deuterium: 500 },
          },
          {
            name: "포기 대상",
            galaxy: 1,
            system: 430,
            planet: 2,
            buildings: { metalMine: 2, researchLab: 1 },
            fleet: { lightFighter: 5 },
            defense: { rocketLauncher: 2 },
            resources: { metal: 50000, crystal: 30000, deuterium: 10000 },
          },
          {
            name: "유지 행성",
            galaxy: 1,
            system: 430,
            planet: 3,
            fleet: { smallCargo: 2 },
          },
        ],
      });
      const outsider = await User.create({
        username: "abandon-outsider",
        email: "abandon-outsider@example.test",
        password: "test-password",
      });
      const lost = user.planets[1]._id,
        kept = user.planets[2]._id;
      user.fleetFormations.push(
        {
          number: 1,
          name: "버릴 함대",
          originPlanetId: lost,
          ships: { lightFighter: 5 },
        },
        {
          number: 2,
          name: "유지 함대",
          originPlanetId: kept,
          ships: { smallCargo: 2 },
        },
      );
      await user.save();
      const express = require("express");
      const app = express();
      app.use(express.json());
      app.use("/api/game", require("../routes/game"));
      server = app.listen(0);
      await new Promise((resolve) => server.on("listening", resolve));
      const request = async (actor, id, name) => {
        const res = await fetch(
          `http://127.0.0.1:${server.address().port}/api/game/planets/${id}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...(actor
                ? {
                    Authorization:
                      "Bearer " +
                      require("jsonwebtoken").sign(
                        { userId: actor._id },
                        process.env.JWT_SECRET,
                      ),
                  }
                : {}),
            },
            body: JSON.stringify({ confirmationName: name }),
          },
        );
        return { status: res.status, data: await res.json() };
      };
      assert.equal((await request(null, lost, "포기 대상")).status, 401);
      assert.equal((await request(outsider, lost, "포기 대상")).status, 404);
      assert.equal((await request(user, "invalid", "포기 대상")).status, 400);
      assert.equal((await request(user, lost, {})).status, 400);
      assert.equal(
        (await request(user, lost, "다른 이름")).data.code,
        "PLANET_NAME_MISMATCH",
      );
      assert.equal(
        (
          await request(
            outsider,
            outsider.planets[0]._id,
            outsider.planets[0].name,
          )
        ).data.code,
        "LAST_PLANET",
      );
      const future = new Date(Date.now() + 3600000);
      const queue = await Queue.create({
        userId: user._id,
        planetId: "1",
        type: "building",
        itemId: "metalMine",
        name: "금속",
        duration: 3600,
        endTime: future,
      });
      assert.equal(
        (await request(user, lost, "포기 대상")).data.code,
        "PLANET_BUSY",
      );
      queue.status = "cancelled";
      await queue.save();
      const research = await Queue.create({
        userId: user._id,
        planetId: "0",
        type: "research",
        itemId: "energyTechnology",
        name: "에너지",
        duration: 3600,
        endTime: future,
      });
      assert.equal(
        (await request(user, lost, "포기 대상")).data.code,
        "PLANET_BUSY",
      );
      research.status = "cancelled";
      await research.save();
      const movement = await Movement.create({
        userId: user._id,
        username: user.username,
        mission: "spy",
        fleet: { espionageProbe: 1 },
        originPlanetId: lost,
        origin: { galaxy: 1, system: 430, planet: 2 },
        destination: { galaxy: 1, system: 431, planet: 3 },
        startTime: new Date(),
        arrivalTime: future,
      });
      assert.equal(
        (await request(user, lost, "포기 대상")).data.code,
        "PLANET_BUSY",
      );
      movement.status = "returning";
      movement.returnTime = future;
      await movement.save();
      assert.equal(
        (await request(user, lost, "포기 대상")).data.code,
        "PLANET_BUSY",
      );
      movement.status = "completed";
      await movement.save();
      const incoming = await Movement.create({
        userId: outsider._id,
        username: outsider.username,
        mission: "attack",
        origin: {
          galaxy: outsider.planets[0].galaxy,
          system: outsider.planets[0].system,
          planet: outsider.planets[0].planet,
        },
        destination: { galaxy: 1, system: 430, planet: 2 },
        startTime: new Date(),
        arrivalTime: future,
      });
      assert.equal(
        (await request(user, lost, "포기 대상")).data.code,
        "PLANET_BUSY",
      );
      incoming.status = "returning";
      incoming.returnTime = future;
      await incoming.save();
      const survivingQueue = await Queue.create({
        userId: user._id,
        planetId: "2",
        type: "building",
        itemId: "metalMine",
        name: "유지 행성 금속",
        level: 1,
        duration: 3600,
        endTime: future,
      });
      const result = await request(user, lost, "포기 대상");
      assert.equal(result.status, 200);
      assert.equal(result.data.snapshot.planets.length, 2);
      assert.equal(result.data.snapshot.currentPlanet, 1);
      assert.equal(result.data.snapshot.planets[1]._id, String(kept));
      assert.equal(result.data.snapshot.research.astrophysics, 3);
      assert.deepEqual(
        result.data.snapshot.fleetFormations.map((f) => f.name),
        ["유지 함대"],
      );
      assert.equal((await Queue.findById(survivingQueue._id)).planetId, "1");
      assert.equal(
        (await Queue.findById(queue._id)).planetId,
        `abandoned:${lost}`,
      );
      assert.equal(await User.exists({ "planets._id": lost }), null);
      assert.equal((await request(user, lost, "포기 대상")).status, 404); // Retry never removes another planet.
      const state = (
        await require("../services/GameStateService").settleUserState(
          user._id,
          new Date(+future + 1000),
        )
      ).snapshot;
      assert.equal(state.planets[1].buildings.metalMine, 1);
      assert.equal(state.planets[0].buildings.metalMine, 0);
      // Abandonment leaves a pirate NPC, not transferable owner assets.
      const pirate = await User.findOne({
        isPirate: true,
        "planets.coordinateKey": "1:430:2",
      });
      assert.ok(pirate);
      assert.equal(
        pirate.pirate.level,
        result.data.abandonedPlanet.pirateLevel,
      );
      assert.equal(pirate.planets[0].resources.metal, 0);
      assert.equal(pirate.planets[0].fleet.lightFighter, 4);
      assert.equal(pirate.research.astrophysics, 0);
      await User.updateOne({ _id: user._id }, { $set: { currentPlanet: 0 } });
      await assert.rejects(
        require("../services/FleetService").launch(user._id, {
          requestId: require("node:crypto").randomUUID(),
          originPlanetId: String(user.planets[0]._id),
          mission: "colonize",
          destination: { galaxy: 1, system: 430, planet: 2 },
          colonists: 1,
          cargo: {},
          speed: 100,
        }),
        (error) => error.code === "TARGET_CHANGED",
      );
      // Clear the NPC fixture; the combat lifecycle is checked independently.
      await User.deleteOne({ _id: pirate._id });
      // Reoccupying a cleared slot starts fresh.
      const current = await User.findById(user._id);
      current.currentPlanet = 0;
      await current.save();
      const fleets = require("../services/FleetService");
      const colonize = await fleets.launch(user._id, {
        requestId: require("node:crypto").randomUUID(),
        originPlanetId: String(user.planets[0]._id),
        mission: "colonize",
        destination: { galaxy: 1, system: 430, planet: 2 },
        colonists: 1,
        cargo: { metal: 5 },
        speed: 100,
      });
      await fleets.processMovement(
        colonize._id,
        new Date(+colonize.arrivalTime + 1),
      );
      const reclaimed = await User.findById(user._id);
      const fresh = reclaimed.planets.find(
        (p) => p.planet === 2 && p.system === 430,
      );
      assert.ok(fresh);
      assert.notEqual(String(fresh._id), String(lost));
      assert.equal(fresh.buildings.metalMine, 0);
      assert.equal(fresh.fleet.lightFighter, 0);
      assert.equal(fresh.resources.metal, 5);
      // Even the original planet can be abandoned after settling elsewhere.
      await service.abandon(user._id, String(user.planets[0]._id), "본성");
      const remaining = (await User.findById(user._id)).planets;
      const race = await Promise.allSettled(
        remaining.map((p) => service.abandon(user._id, String(p._id), p.name)),
      );
      assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await User.findById(user._id)).planets.length, 1);
      assert.equal(
        race.find((r) => r.status === "rejected").reason.code,
        "LAST_PLANET",
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
