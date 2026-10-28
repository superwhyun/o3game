const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const uri = process.env.FLEET_TEST_MONGODB_URI;
test(
  "transactional fleet lifecycle, concurrency, restart-safe return and legacy fleets",
  { skip: !uri ? "FLEET_TEST_MONGODB_URI not set" : false },
  async (t) => {
    if (!/\/[^/?]*_test[^/?]*(\?|$)/.test(uri))
      throw new Error("Use a dedicated _test database");
    await mongoose.connect(uri);
    const User = require("../models/User");
    const Config = require("../models/GameConfig");
    const Movement = require("../models/FleetMovement");
    const Report = require("../models/BattleReport");
    const forms = require("../services/FleetFormationService");
    const fleets = require("../services/FleetService");
    const { atomic } = require("../services/transactions");
    let httpServer;
    const entities = require("../services/EntityConfigService");
    const { settleUserState } = require("../services/GameStateService");
    try {
      await mongoose.connection.dropDatabase();
      await Config.getConfig();
      await entities.initialize();
      await User.init();
      await Movement.init();
      await Report.init();
      const { ENTITY_IDS } = require("../data/catalog");
      const { attackWaves, defenseWaves } = require("../utils/combatWaves");
      const Combat = require("../services/CombatService");
      const fullFleet = Object.fromEntries(
        ENTITY_IDS.ship
          .filter((id) => entities.getEntity("ship", id)?.stats?.speed > 0)
          .map((id) => [id, 1]),
      );
      const fullResult = await Combat.simulateBattle8Wave(
        attackWaves(fullFleet),
        defenseWaves({ fleet: {}, defense: {} }),
        { attacker: {}, defender: {} },
        null,
        "all-types",
      );
      assert.deepEqual(fullResult.attackerForces, fullFleet);
      const oldAttack = [{ type: "lightFighter", count: 10 }];
      const oldDefense = [
        { defenseType: "rocketLauncher", defenseCount: 2 },
        { shipType: "lightFighter", shipCount: 2 },
      ];
      const legacyResult = await Combat.simulateBattle8Wave(
        oldAttack,
        oldDefense,
        { attacker: {}, defender: {} },
        null,
        "same-seed",
      );
      const adaptedResult = await Combat.simulateBattle8Wave(
        attackWaves({ lightFighter: 10 }, oldAttack),
        defenseWaves({
          fleet: { lightFighter: 2 },
          defense: { rocketLauncher: 2 },
        }),
        { attacker: {}, defender: {} },
        null,
        "same-seed",
      );
      assert.deepEqual(adaptedResult, legacyResult);
      const user = await User.create({
        username: "fleet_test",
        email: "fleet_test@example.test",
        password: randomUUID(),
        planets: [
          {
            name: "Home",
            galaxy: 1,
            system: 1,
            planet: 4,
            fleet: { lightFighter: 100, cruiser: 12 },
            resources: { metal: 1000, crystal: 1000, deuterium: 1000 },
          },
        ],
      });
      const target = await User.create({
        username: "target_test",
        email: "target_test@example.test",
        password: randomUUID(),
        planets: [
          {
            name: "Target",
            galaxy: 1,
            system: 1,
            planet: 8,
            resources: { metal: 100, crystal: 100, deuterium: 100 },
          },
        ],
      });
      const planetId = String(user.planets[0]._id);
      const created = await Promise.all([
        forms.change(user._id, "create", null, { originPlanetId: planetId }),
        forms.change(user._id, "create", null, { originPlanetId: planetId }),
      ]);
      let latest = await User.findById(user._id);
      assert.deepEqual(
        latest.fleetFormations.map((f) => f.number).sort(),
        [1, 2],
      );
      const a = latest.fleetFormations.find((f) => f.number === 1)._id,
        b = latest.fleetFormations.find((f) => f.number === 2)._id;
      await forms.change(user._id, "update", a, {
        expectedRevision: 1,
        name: "1함대",
        ships: { lightFighter: 40, cruiser: 3 },
      });
      await forms.change(user._id, "update", b, {
        expectedRevision: 1,
        name: "2함대",
        ships: { lightFighter: 20 },
      });
      await assert.rejects(
        forms.change(user._id, "update", b, {
          expectedRevision: 2,
          name: "2함대",
          ships: { lightFighter: 80 },
        }),
        /부족/,
      );
      const order = {
        formationId: String(a),
        originPlanetId: planetId,
        expectedTargetPlanetId: String(target.planets[0]._id),
        expectedRevision: 2,
        requestId: randomUUID(),
        mission: "attack",
        destination: { galaxy: 1, system: 1, planet: 8 },
      };
      const results = await Promise.all([
        fleets.launch(user._id, order),
        fleets.launch(user._id, order),
      ]);
      assert.equal(String(results[0]._id), String(results[1]._id));
      assert.equal(await Movement.countDocuments(), 1);
      // Exercise the authenticated HTTP path, not only the service methods.
      process.env.JWT_SECRET =
        "isolated-fleet-integration-secret-for-tests-2026";
      const express = require("express");
      const app = express();
      app.use(express.json());
      app.set("io", {
        to() {
          return { emit() {} };
        },
      });
      app.use("/api/game", require("../routes/game"));
      app.use("/api/queue", require("../routes/buildingQueue"));
      httpServer = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => httpServer.once("listening", resolve));
      const token = require("jsonwebtoken").sign(
        { userId: String(user._id) },
        process.env.JWT_SECRET,
      );
      const base = `http://127.0.0.1:${httpServer.address().port}/api/game`;
      const request = async (path, body, method = "POST") =>
        fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const duplicate = await request("/fleets", order);
      assert.equal(duplicate.status, 201);
      assert.equal((await duplicate.json()).fleet.id, String(results[0]._id));
      const differentPayload = await request("/fleets", {
        ...order,
        cargo: { metal: 1 },
      });
      assert.equal(differentPayload.status, 409);
      const invalidCount = await request(
        "/fleet-formations/" + String(b),
        { expectedRevision: 2, name: "2함대", ships: { lightFighter: 0.5 } },
        "PATCH",
      );
      assert.equal(invalidCount.status, 400);
      const ownAttack = await request("/fleets", {
        ...order,
        formationId: String(b),
        requestId: randomUUID(),
        expectedTargetPlanetId: planetId,
        destination: { galaxy: 1, system: 1, planet: 4 },
      });
      assert.equal(ownAttack.status, 400);
      const changedTarget = await request("/fleets", {
        ...order,
        formationId: String(b),
        requestId: randomUUID(),
        expectedTargetPlanetId: String(new mongoose.Types.ObjectId()),
      });
      assert.equal(changedTarget.status, 409);
      assert.equal(await Movement.countDocuments(), 1);
      const raw = await request("/fleets", {
        mission: "attack",
        fleet: { lightFighter: 1 },
        destination: order.destination,
      });
      assert.equal(raw.status, 400);
      const ownership = await request(
        "/fleet-formations/" + String(new mongoose.Types.ObjectId()),
        { expectedRevision: 1, name: "stolen", ships: {} },
        "PATCH",
      );
      assert.equal(ownership.status, 404);
      const lookup = await request(
        "/fleet-requests/" + order.requestId,
        null,
        "GET",
      );
      assert.equal(lookup.status, 200);

      latest = await User.findById(user._id);
      assert.equal(latest.planets[0].fleet.lightFighter, 60);
      assert.equal(latest.fleetFormations.id(a).status, "onMission");
      assert.equal(latest.fleetFormations.id(b).status, "ready");
      await assert.rejects(
        fleets.launch(user._id, { ...order, requestId: randomUUID() }),
        /변경/,
      );
      await assert.rejects(
        forms.change(user._id, "delete", a, { expectedRevision: 3 }),
        /임무/,
      );
      const snapshot = (await settleUserState(user._id)).snapshot;
      assert.equal(snapshot.fleetMovements.length, 1);
      assert.equal(snapshot.unassignedShips.lightFighter, 40);
      const arrived = new Date(+results[0].arrivalTime + 1);
      await Promise.all([
        fleets.processMovement(results[0]._id, arrived),
        fleets.processMovement(results[0]._id, arrived),
      ]);
      assert.equal(await Report.countDocuments(), 1);
      let move = await Movement.findById(results[0]._id);
      assert.equal(move.status, "returning");
      await Promise.all([
        fleets.processMovement(move._id, new Date(+move.returnTime + 1)),
        fleets.processMovement(move._id, new Date(+move.returnTime + 1)),
      ]);
      latest = await User.findById(user._id);
      assert.equal(latest.fleetFormations.id(a).status, "ready");
      assert.equal(latest.planets[0].fleet.lightFighter, 100);
      // Every write rolls back together; a simulated crash leaves no phantom mission.
      await assert.rejects(
        atomic(async () => {
          const u = await User.findById(user._id);
          u.planets[0].fleet.lightFighter = 0;
          await u.save();
          throw new Error("injected failure");
        }),
        /injected/,
      );
      assert.equal(
        (await User.findById(user._id)).planets[0].fleet.lightFighter,
        100,
      );
      // Two distinct fleets cannot consume the same reserved ships during parallel launches.
      latest = await User.findById(user._id);
      const orders = [a, b].map((id) => ({
        ...order,
        formationId: String(id),
        expectedRevision: latest.fleetFormations.id(id).revision,
        requestId: randomUUID(),
      }));
      const parallel = await Promise.all(
        orders.map((o) => fleets.launch(user._id, o)),
      );
      assert.equal(parallel.length, 2);
      latest = await User.findById(user._id);
      assert.equal(latest.planets[0].fleet.lightFighter, 40);
      // Simulate total losses on one returning movement; no automatic replacement.
      await Movement.updateOne(
        { _id: parallel[0]._id },
        { $set: { fleet: {}, status: "returning", returnTime: new Date(0) } },
      );
      await fleets.processMovement(parallel[0]._id);
      latest = await User.findById(user._id);
      assert.deepEqual(latest.fleetFormations.id(a).ships, {});
      assert.equal(latest.planets[0].fleet.lightFighter, 40);
      // Legacy movements have no formation; returning them does not create a new formation.
      const legacy = await Movement.create({
        userId: user._id,
        username: user.username,
        mission: "transport",
        fleet: { lightFighter: 2 },
        origin: { galaxy: 1, system: 1, planet: 4 },
        destination: { galaxy: 1, system: 1, planet: 8 },
        status: "returning",
        startTime: new Date(0),
        arrivalTime: new Date(1),
        returnTime: new Date(2),
      });
      await fleets.processMovement(legacy._id);
      latest = await User.findById(user._id);
      assert.equal(latest.planets[0].fleet.lightFighter, 42);
      assert.equal(latest.fleetFormations.length, 2);
      // Resource spending by an actual queued build and fleet cargo cannot overwrite each other.
      const builder = await User.create({
        username: "builder_test",
        email: "builder_test@example.test",
        password: "not-real",
        planets: [
          {
            name: "Builder",
            galaxy: 1,
            system: 1,
            planet: 2,
            buildings: { shipyard: 1 },
            research: { combustionDrive: 1 },
            fleet: { lightFighter: 20 },
            resources: { metal: 9000, crystal: 9000, deuterium: 9000 },
          },
        ],
      });
      const builderFormation = await forms.change(builder._id, "create", null, {
        originPlanetId: String(builder.planets[0]._id),
      });
      await forms.change(builder._id, "update", builderFormation.formationId, {
        expectedRevision: 1,
        name: "1함대",
        ships: { lightFighter: 10 },
      });
      const builderToken = require("jsonwebtoken").sign(
        { userId: String(builder._id) },
        process.env.JWT_SECRET,
      );
      const builderRequest = (url, body) =>
        fetch(`http://127.0.0.1:${httpServer.address().port}` + url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${builderToken}`,
          },
          body: JSON.stringify(body),
        });
      const costs =
        await require("../utils/gameCalculations").calculateUnitCost(
          "ship",
          "lightFighter",
          1,
        );
      const [queued, dispatched] = await Promise.all([
        builderRequest("/api/queue/ship", { shipId: "lightFighter", count: 1 }),
        builderRequest("/api/game/fleets", {
          ...order,
          formationId: String(builderFormation.formationId),
          originPlanetId: String(builder.planets[0]._id),
          requestId: randomUUID(),
          cargo: { metal: 100 },
        }),
      ]);
      assert.equal(queued.status, 200, JSON.stringify(await queued.json()));
      assert.equal(
        dispatched.status,
        201,
        JSON.stringify(await dispatched.json()),
      );
      const builderAfter = await User.findById(builder._id);
      assert.ok(
        Math.abs(
          builderAfter.planets[0].resources.metal - (9000 - costs.metal - 100),
        ) < 1,
      );
      assert.equal(builderAfter.planets[0].fleet.lightFighter, 10);
      assert.equal(
        await require("../models/BuildingQueue").countDocuments({
          userId: builder._id,
        }),
        1,
      );
      // A disappeared target returns the existing fleet; it does not destroy it.
      await User.deleteOne({ _id: target._id });
      await fleets.processMovement(
        parallel[1]._id,
        new Date(+parallel[1].arrivalTime + 1),
      );
      const cancelledTarget = await Movement.findById(parallel[1]._id);
      assert.equal(cancelledTarget.status, "returning");
      assert.match(cancelledTarget.notice, /목표 행성/);
      await fleets.processMovement(
        cancelledTarget._id,
        new Date(+cancelledTarget.returnTime + 1),
      );
      latest = await User.findById(user._id);
      assert.equal(latest.planets[0].fleet.lightFighter, 62);
      // A user-chosen name cannot collide with the next generated default name.
      await forms.change(user._id, "update", a, {
        expectedRevision: latest.fleetFormations.id(a).revision,
        name: "3함대",
        ships: {},
      });
      const collisionSafe = await forms.change(user._id, "create", null, {
        originPlanetId: planetId,
      });
      latest = await User.findById(user._id);
      assert.equal(
        latest.fleetFormations.id(collisionSafe.formationId).name,
        "4함대",
      );
    } finally {
      if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);

test('a formation emblem must be free or owned, is kept on updates and recorded at launch', { timeout: 60000 }, async () => {
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const mongoose = require('mongoose');
  const { randomUUID } = require('node:crypto');
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('emblem_test'));
  try {
    const User = require('../models/User');
    const forms = require('../services/FleetFormationService');
    const entities = require('../services/EntityConfigService');
    const Config = require('../models/GameConfig');
    await Config.getConfig(); await entities.initialize(); await User.init();
    const user = await User.create({ username: 'emblemer', email: 'emblem@test.invalid', password: randomUUID(), planets: [{ galaxy: 1, system: 1, planet: 4, fleet: { lightFighter: 3 } }] });
    const made = await forms.change(user._id, 'create', null, { originPlanetId: user.planets[0]._id });
    const update = (input) => forms.change(user._id, 'update', made.formationId, input);
    let revision = 1;
    const base = () => ({ expectedRevision: revision, name: '문장 함대', ships: { lightFighter: 2 } });

    await update({ ...base(), emblem: 'star' }); revision++;
    assert.equal((await User.findById(user._id)).fleetFormations[0].emblem, 'star');
    await update(base()); revision++; // omitted emblem keeps the current one
    assert.equal((await User.findById(user._id)).fleetFormations[0].emblem, 'star');
    await assert.rejects(update({ ...base(), emblem: 'dragon' }), (error) => error.code === 'EMBLEM_NOT_OWNED');
    await assert.rejects(update({ ...base(), emblem: 'made-up' }), (error) => error.code === 'EMBLEM_NOT_OWNED');
    await assert.rejects(update({ ...base(), emblem: 7 }), (error) => error.code === 'EMBLEM_NOT_OWNED');
    assert.equal((await User.findById(user._id)).fleetFormations[0].revision, revision);

    await User.updateOne({ _id: user._id }, { $addToSet: { 'entitlements.emblems': 'dragon' } });
    await update({ ...base(), emblem: 'dragon' }); revision++;
    assert.equal((await User.findById(user._id)).fleetFormations[0].emblem, 'dragon');
    await update({ ...base(), emblem: '' }); revision++;
    assert.equal((await User.findById(user._id)).fleetFormations[0].emblem, '');

    await update({ ...base(), emblem: 'dragon' }); revision++;
    const fleets = require('../services/FleetService');
    const target = await User.create({ username: 'target', email: 'target@test.invalid', password: randomUUID(), planets: [{ galaxy: 1, system: 1, planet: 9 }] });
    const movement = await fleets.launch(user._id, { requestId: randomUUID(), mission: 'attack', formationId: String(made.formationId), originPlanetId: String(user.planets[0]._id), expectedRevision: revision, expectedTargetPlanetId: String(target.planets[0]._id), destination: { galaxy: 1, system: 1, planet: 9 }, cargo: { metal: 0, crystal: 0, deuterium: 0 } });
    assert.equal(movement.formationEmblemAtLaunch, 'dragon');
    // Changing the emblem later does not rewrite history.
    const { formatFleetMovement } = require('../services/GameStateService');
    assert.equal(formatFleetMovement(movement).formationEmblem, 'dragon');
  } finally {
    await mongoose.disconnect(); await db.stop();
  }
});
