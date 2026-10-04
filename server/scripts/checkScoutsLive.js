// Exercises the running local server without resetting player data or changing clocks.
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env"),
  quiet: true,
});
const mongoose = require("mongoose");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
async function main() {
  if (!process.argv.includes("--allow-live"))
    throw Error(
      "Pass --allow-live to create and clean temporary inspection accounts.",
    );
  const base = process.env.SCOUT_CHECK_BASE_URL || "http://localhost:3000";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
    throw Error("Local running server required");
  await mongoose.connect(process.env.MONGODB_URI);
  require("../models/GameConfig");
  const User = require("../models/User");
  const Report = require("../models/ScoutReport");
  const Movement = require("../models/FleetMovement");
  const Queue = require("../models/BuildingQueue");
  const ids = [];
  const before = await User.countDocuments({});
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName);
    const suffix = randomUUID().slice(0, 8);
    const password = randomUUID();
    const attacker = await User.createWithHomePlanet({
      username: "scout_check_a_" + suffix,
      email: "scout_check_a_" + suffix + "@example.test",
      password,
    });
    ids.push(attacker._id);
    const defender = await User.createWithHomePlanet({
      username: "scout_check_b_" + suffix,
      email: "scout_check_b_" + suffix + "@example.test",
      password,
    });
    ids.push(defender._id);
    await User.updateOne(
      { _id: attacker._id },
      {
        $set: {
          "planets.0.fleet.espionageProbe": 3,
          "planets.0.research.espionageTechnology": 5,
        },
      },
    );
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: attacker.username, password }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    };
    const target = defender.planets[0];
    const destination = {
      galaxy: target.galaxy,
      system: target.system,
      planet: target.planet,
    };
    const moves = [];
    for (let n = 0; n < 3; n++) {
      const response = await fetch(base + "/api/game/scouts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: randomUUID(),
          originPlanetId: String(attacker.planets[0]._id),
          destination,
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      moves.push(body.fleet.id);
    }
    assert.equal(
      (await User.findById(attacker._id)).planets[0].fleet.espionageProbe,
      0,
    );
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (
        (await Movement.countDocuments({
          _id: { $in: moves },
          status: "completed",
        })) === 3
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(
      await Movement.countDocuments({
        _id: { $in: moves },
        status: "completed",
      }),
      3,
      "Real timer did not finish scout return",
    );
    assert.equal(
      (await User.findById(attacker._id)).planets[0].fleet.espionageProbe,
      3,
    );
    const response = await fetch(base + "/api/game/scout-reports", { headers });
    const { reports } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(reports.length, 3);
    assert.ok(
      reports.every(
        (r) =>
          r.outcome === "occupied" &&
          r.informationTier === 4 &&
          r.survivorCount === 1,
      ),
    );
    const me = await fetch(base + "/api/auth/me", { headers });
    assert.equal(me.status, 200);
    console.log(
      "LIVE PASS: login, 3 launches, 3 reports, actual arrival/return timer, restored stock and reload snapshot.",
    );
  } finally {
    if (ids.length) {
      await Report.deleteMany({
        $or: [{ ownerUserId: { $in: ids } }, { targetUserId: { $in: ids } }],
      });
      await Movement.deleteMany({ userId: { $in: ids } });
      await Queue.deleteMany({ userId: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    assert.equal(
      await User.countDocuments({}),
      before,
      "Unexpected account count after cleanup",
    );
    await mongoose.disconnect();
    console.log(
      "Temporary inspection accounts and their reports/missions cleaned; original accounts retained.",
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
  void mongoose.disconnect();
});
