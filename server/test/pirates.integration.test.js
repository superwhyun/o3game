const test = require("node:test"),
  assert = require("node:assert/strict"),
  mongoose = require("mongoose");
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(
  /\/[^/?]+(?=\?|$)/,
  "/cosmic_pirate_lifecycle_test",
);
test(
  "pirate creation, regeneration, scouting, no transport, combat clearance and coordinate reuse",
  { skip: !uri },
  async () => {
    process.env.JWT_SECRET = "pirate-lifecycle-test-secret-with-32-characters";
    await mongoose.connect(uri);
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User"),
        Movement = require("../models/FleetMovement"),
        Report = require("../models/BattleReport");
      const entities = require("../services/EntityConfigService"),
        pirates = require("../services/PirateService"),
        fleets = require("../services/FleetService"),
        state = require("../services/GameStateService");
      await require("../models/GameConfig").create({ serverSpeed: 1 });
      await entities.initialize();
      await User.init();
      await Movement.init();
      const attacker = await User.create({
        username: "pirate-hunter",
        email: "hunter@example.test",
        password: "test-password",
        planets: [
          {
            galaxy: 1,
            system: 444,
            planet: 1,
            fleet: { colonyShip: 1, smallCargo: 1, espionageProbe: 1 },
            resources: {
              metal: 10000,
              crystal: 10000,
              deuterium: 10000,
              food: 1000,
            },
            population: {
              version: 1,
              count: 100,
              baseHousing: 100,
              baseFood: 100,
              baseCulture: 100,
              growthProgress: 0,
              starvationProgress: 0,
              foodCapacity: 1000,
            },
          },
        ],
      });
      const now = new Date();
      const pirate = await pirates.createFrom(
        {
          galaxy: 1,
          system: 444,
          planet: 2,
          diameter: 12800,
          buildings: { metalMine: 10 },
          resources: { metal: 99999999 },
          fleet: { deathstar: 999 },
          research: { weaponsTechnology: 999 },
        },
        now,
      );
      const p = pirate.planets[0];
      assert.equal(p.resources.metal, 0);
      assert.equal(p.fleet.deathstar, 0);
      assert.equal(pirate.research.weaponsTechnology, 0);
      const reg = await state.settleUserState(
        pirate._id,
        new Date(+now + 86400000),
      );
      assert.ok(reg.user.planets[0].fleet.lightFighter >= p.fleet.lightFighter);
      assert.ok(reg.user.planets[0].resources.metal <= 10000);
      const { buildGalaxySystem } = require("../utils/galaxySystem");
      const args = {
        galaxy: 1,
        system: 444,
        requestingUserId: attacker._id,
        users: [reg.user],
      };
      assert.equal(
        buildGalaxySystem(args).positions[1].planet.isPirate,
        undefined,
      );
      const revealed = buildGalaxySystem({
        ...args,
        scoutReports: [
          {
            destination: { galaxy: 1, system: 444, planet: 2 },
            targetPlanetId: p._id,
            targetUserId: pirate._id,
            targetName: p.name,
            observedAt: now,
            outcome: "occupied",
          },
        ],
      }).positions[1];
      assert.equal(revealed.planet.pirateLevel, 1);
      assert.equal(revealed.planet.username, "해적");
      const spy = await require('../services/ScoutService').launch(attacker._id,{requestId:require('crypto').randomUUID(),originPlanetId:String(attacker.planets[0]._id),destination:{galaxy:1,system:444,planet:2}});
    await fleets.processMovement(spy._id,new Date(+spy.arrivalTime+1));
    const observation=await require('../models/ScoutReport').findOne({movementId:spy._id});
    assert.equal(observation.pirateLevel,1);
    assert.equal(observation.targetCommander,'해적');
    const formations = require("../services/FleetFormationService");
      const formation = await formations.change(attacker._id, "create", null, {
        originPlanetId: String(attacker.planets[0]._id),
      });
      await formations.change(attacker._id, "update", formation.formationId, {
        name: "운송",
        expectedRevision: 1,
        ships: { smallCargo: 1 },
      });
      const prepared = { id: String(formation.formationId), revision: 2 };
      await assert.rejects(
        fleets.launch(attacker._id, {
          requestId: require("crypto").randomUUID(),
          originPlanetId: String(attacker.planets[0]._id),
          formationId: prepared.id,
          expectedRevision: prepared.revision,
          mission: "transport",
          expectedTargetPlanetId: String(p._id),
          destination: { galaxy: 1, system: 444, planet: 2 },
          cargo: { metal: 1 },
          speed: 100,
        }),
        (e) => e.code === "PIRATE_TRANSPORT_FORBIDDEN",
      );
      await assert.rejects(
        fleets.launch(attacker._id, {
          requestId: require("crypto").randomUUID(),
          originPlanetId: String(attacker.planets[0]._id),
          mission: "colonize",
          destination: { galaxy: 1, system: 444, planet: 2 },
          cargo: {},
          colonists: 1,
          speed: 100,
        }),
        (e) => e.code === "TARGET_CHANGED",
      );
      const attack = await Movement.create({
        userId: attacker._id,
        username: attacker.username,
        originPlanetId: attacker.planets[0]._id,
        targetUserId: pirate._id,
        targetPlanetId: p._id,
        mission: "attack",
        status: "flying",
        fleet: { battleship: 100 },
        initialFleet: { battleship: 100 },
        cargo: {},
        origin: { galaxy: 1, system: 444, planet: 1 },
        destination: { galaxy: 1, system: 444, planet: 2 },
        startTime: new Date(+now - 10000),
        arrivalTime: now,
      });
      await fleets.processMovement(attack._id, now);
      const report = await Report.findOne({ movementId: attack._id });
      assert.equal(report.result.winner, "attacker");
      assert.equal(report.result.pirateCleared, true);
      assert.equal(report.result.pirateLevel, 1);
      assert.equal(await User.exists({ _id: pirate._id }), null);
      await fleets.processMovement(attack._id, now);
      assert.equal(await Report.countDocuments({ movementId: attack._id }), 1);
      const colony = await fleets.launch(attacker._id, {
        requestId: require("crypto").randomUUID(),
        originPlanetId: String(attacker.planets[0]._id),
        mission: "colonize",
        destination: { galaxy: 1, system: 444, planet: 2 },
        cargo: {},
        colonists: 1,
        speed: 100,
      });
      await fleets.processMovement(
        colony._id,
        new Date(+colony.arrivalTime + 1),
      );
      assert.equal((await User.findById(attacker._id)).planets.length, 2);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
