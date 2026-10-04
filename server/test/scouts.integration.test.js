const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, "/cosmic_scout_test");
test(
  "scout HTTP lifecycle, reservation, reports, interception and retries",
  { skip: !uri },
  async () => {
    process.env.JWT_SECRET = "scout-integration-test-only-secret-2026";
    await mongoose.connect(uri);
    let server;
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User");
      const Movement = require("../models/FleetMovement");
      const Report = require("../models/ScoutReport");
      const Config = require("../models/GameConfig");
      await Config.getConfig();
      await require("../services/EntityConfigService").initialize();
      await Promise.all([User.init(), Movement.init(), Report.init()]);
      const a = await User.create({
        username: "scout_a",
        email: "a@example.test",
        password: randomUUID(),
        planets: [
          {
            galaxy: 1,
            system: 1,
            planet: 4,
            fleet: { espionageProbe: 8 },
            research: { espionageTechnology: 5 },
          },
        ],
      });
      const b = await User.create({
        username: "scout_b",
        email: "b@example.test",
        password: randomUUID(),
        planets: [
          {
            galaxy: 1,
            system: 1,
            planet: 8,
            fleet: { smallCargo: 10 },
            research: { espionageTechnology: 5 },
            resources: { metal: 1000, crystal: 500, deuterium: 100 },
          },
        ],
      });
      const express = require("express");
      const app = express();
      app.use(express.json());
      app.use("/api/game", require("../routes/game"));
      server = app.listen(0);
      await new Promise((r) => server.on("listening", r));
      const root = `http://127.0.0.1:${server.address().port}`;
      const jwt = require("jsonwebtoken");
      const req = async (user, path, body) => {
        const response = await fetch(root + path, {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              "Bearer " +
              jwt.sign({ userId: user._id }, process.env.JWT_SECRET),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, data: await response.json() };
      };
      const order = (slot = 8) => ({
        requestId: randomUUID(),
        originPlanetId: String(a.planets[0]._id),
        destination: { galaxy: 1, system: 1, planet: slot },
      });
      const scouts = require("../services/ScoutService");
      const fleets = require("../services/FleetService");
      const duplicate = order();
      const both = await Promise.all([
        req(a, "/api/game/scouts", duplicate),
        req(a, "/api/game/scouts", duplicate),
      ]);
      assert.deepEqual(
        both.map((r) => r.status),
        [201, 201],
      );
      assert.equal(
        String(both[0].data.fleet.id),
        String(both[1].data.fleet.id),
      );
      assert.equal(
        await Movement.countDocuments({ requestId: duplicate.requestId }),
        1,
      );
      assert.equal(
        (await User.findById(a._id)).planets[0].fleet.espionageProbe,
        7,
      );
      assert.equal(
        (
          await req(a, "/api/game/scouts", {
            ...duplicate,
            destination: { galaxy: 1, system: 1, planet: 9 },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await req(a, "/api/game/scouts", {
            ...order(),
            fleet: { espionageProbe: 100 },
          })
        ).status,
        400,
      );
      assert.equal((await req(a, "/api/game/scouts", order(4))).status, 400);
      assert.equal(
        (await req(b, "/api/game/fleet-requests/" + duplicate.requestId))
          .status,
        404,
      );
      const id = both[0].data.fleet.id;
      const movement = await Movement.findById(id);
      await fleets.processMovement(id, new Date(+movement.arrivalTime - 1));
      assert.equal(await Report.countDocuments({}), 0);
      const when = new Date(+movement.arrivalTime + 1);
      await Promise.all([
        fleets.processMovement(id, when),
        fleets.processMovement(id, when),
      ]);
      assert.equal(await Report.countDocuments({ movementId: id }), 1);
      const report = await Report.findOne({ movementId: id });
      assert.equal(report.informationTier, 1);
      assert.equal(report.sections.fleet, undefined);
      assert.equal(report.intercepted, false);
      assert.equal((await Movement.findById(id)).status, "returning");
      assert.equal(
        (await req(b, "/api/game/scout-reports/" + report._id)).status,
        404,
      );
      const mine = await req(a, "/api/game/scout-reports/" + report._id);
      assert.equal(mine.status, 200);
      assert.equal(mine.data.report.sections.research, undefined);
      const returned = await Movement.findById(id);
      await Promise.all([
        fleets.processMovement(id, new Date(+returned.returnTime + 1)),
        fleets.processMovement(id, new Date(+returned.returnTime + 1)),
      ]);
      assert.equal(
        (await User.findById(a._id)).planets[0].fleet.espionageProbe,
        8,
      );
      const empty = await scouts.launch(a._id, order(9));
      await fleets.processMovement(empty._id, new Date(+empty.arrivalTime + 1));
      const emptyReport = await Report.findOne({ movementId: empty._id });
      assert.equal(emptyReport.outcome, "empty");
      assert.deepEqual(emptyReport.sections, {});
      // Reservation protects five probes; exactly two of three fresh clicks can use the remaining two.
      let latest = await User.findById(a._id);
      latest.fleetFormations.push({
        number: 1,
        name: "reserved",
        originPlanetId: latest.planets[0]._id,
        ships: { espionageProbe: 5 },
      });
      await latest.save();
      const three = await Promise.all([
        req(a, "/api/game/scouts", order()),
        req(a, "/api/game/scouts", order()),
        req(a, "/api/game/scouts", order()),
      ]);
      assert.equal(three.filter((r) => r.status === 201).length, 2);
      assert.equal(three.filter((r) => r.status === 409).length, 1);
      assert.equal(
        (await User.findById(a._id)).planets[0].fleet.espionageProbe,
        5,
      );
      // Arrival uses the new occupant and tech; forced detectable seed is selected without altering rules.
      await User.updateOne(
        { _id: a._id },
        { $set: { "planets.0.fleet.espionageProbe": 6 } },
      );
      await User.updateOne(
        { _id: b._id },
        {
          $set: {
            "planets.0.research.espionageTechnology": 50,
            "planets.0.fleet.cruiser": 1,
          },
        },
      );
      const rules = require("../utils/scoutRules");
      let intercepted;
      for (let i = 0; i < 10; i++) {
        const probe = await scouts.launch(a._id, order());
        if (rules.detectionRoll(probe._id, process.env.JWT_SECRET) < 95) {
          intercepted = probe;
          break;
        }
        await Movement.deleteOne({ _id: probe._id });
        await User.updateOne(
          { _id: a._id },
          { $inc: { "planets.0.fleet.espionageProbe": 1 } },
        );
      }
      assert.ok(intercepted);
      await fleets.processMovement(
        intercepted._id,
        new Date(+intercepted.arrivalTime + 1),
      );
      const down = await Report.findOne({ movementId: intercepted._id });
      assert.equal(down.intercepted, true);
      assert.equal(down.survivorCount, 0);
      assert.equal(
        (await Movement.findById(intercepted._id)).status,
        "completed",
      );
      await fleets.processMovement(
        intercepted._id,
        new Date(Date.now() + 999999),
      );
      assert.equal(
        (await User.findById(a._id)).planets[0].fleet.espionageProbe,
        5,
      );
      const alerts = await req(b, "/api/game/scout-alerts");
      assert.equal(alerts.status, 200);
      assert.ok(
        alerts.data.alerts.some((x) => String(x.id) === String(down._id)),
      );
      assert.ok(
        alerts.data.alerts.every(
          (x) => !("sections" in x) && !("informationTier" in x),
        ),
      );
      const page = await req(a, "/api/game/scout-reports?limit=1");
      assert.equal(page.data.reports.length, 1);
      assert.ok(page.data.nextCursor);
      const next = await req(
        a,
        "/api/game/scout-reports?limit=1&cursor=" + page.data.nextCursor,
      );
      assert.notEqual(
        String(page.data.reports[0].id),
        String(next.data.reports[0].id),
      );
      assert.equal(
        (await req(a, "/api/game/scout-reports?galaxy=1")).status,
        400,
      );
      const matched = await req(
        a,
        "/api/game/scout-reports?galaxy=1&system=1&planet=9",
      );
      assert.ok(matched.data.reports.every((x) => x.destination.planet === 9));
      // Inject failure after the user save: the departure cannot consume a probe without its movement.
      await User.updateOne(
        { _id: a._id },
        { $set: { "planets.0.fleet.espionageProbe": 8 } },
      );
      const originalMovementSave = Movement.prototype.save;
      Movement.prototype.save = async function () {
        if (this.isNew && this.mission === "spy")
          throw Error("injected movement failure");
        return originalMovementSave.apply(this, arguments);
      };
      try {
        await assert.rejects(scouts.launch(a._id, order(10)), /injected/);
      } finally {
        Movement.prototype.save = originalMovementSave;
      }
      assert.equal(
        (await User.findById(a._id)).planets[0].fleet.espionageProbe,
        8,
      );
      // A newly occupied empty slot is observed at arrival; launch technology is frozen.
      const newlyOccupied = await scouts.launch(a._id, order(10));
      await User.create({
        username: "scout_c",
        email: "c@example.test",
        password: randomUUID(),
        planets: [
          {
            galaxy: 1,
            system: 1,
            planet: 10,
            research: { espionageTechnology: 1 },
            fleet: { smallCargo: 2 },
          },
        ],
      });
      await User.updateOne(
        { _id: a._id },
        { $set: { "planets.0.research.espionageTechnology": 0 } },
      );
      const originalReportSave = Report.prototype.save;
      Report.prototype.save = async function () {
        throw Error("injected report failure");
      };
      try {
        await assert.rejects(
          fleets.processMovement(
            newlyOccupied._id,
            new Date(+newlyOccupied.arrivalTime + 1),
          ),
          /injected/,
        );
      } finally {
        Report.prototype.save = originalReportSave;
      }
      assert.equal(
        (await Movement.findById(newlyOccupied._id)).status,
        "flying",
      );
      assert.equal(
        await Report.countDocuments({ movementId: newlyOccupied._id }),
        0,
      );
      await fleets.processMovement(
        newlyOccupied._id,
        new Date(+newlyOccupied.arrivalTime + 1),
      );
      const changed = await Report.findOne({ movementId: newlyOccupied._id });
      assert.equal(changed.outcome, "occupied");
      assert.equal(changed.targetCommander, "scout_c");
      assert.equal(changed.informationTier, 4);
      assert.equal(changed.sections.fleet.smallCargo, 2);
      const friendly = await scouts.launch(a._id, order(11));
      latest = await User.findById(a._id);
      latest.planets.push({ galaxy: 1, system: 1, planet: 11 });
      await latest.save();
      await fleets.processMovement(
        friendly._id,
        new Date(+friendly.arrivalTime + 1),
      );
      assert.equal(
        (await Report.findOne({ movementId: friendly._id })).outcome,
        "friendly",
      );
      const noOrigin = await Movement.findById(friendly._id);
      await User.updateOne(
        { _id: a._id },
        { $pull: { planets: { _id: a.planets[0]._id } } },
      );
      await fleets.processMovement(
        noOrigin._id,
        new Date(+noOrigin.returnTime + 1),
      );
      assert.equal((await Movement.findById(noOrigin._id)).status, "returning");
      assert.match((await Movement.findById(noOrigin._id)).notice, /복구/);
    } finally {
      if (server) await new Promise((r) => server.close(r));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
