const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(
  /\/[^/?]+(?=\?|$)/,
  "/cosmic_report_history_test",
);
test(
  "numbered history pages, owner-only selective deletion, shared battle and scouting knowledge retention",
  { skip: !uri },
  async () => {
    process.env.JWT_SECRET =
      "report-history-test-only-secret-at-least-32-characters";
    await mongoose.connect(uri);
    let server;
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User");
      const Battle = require("../models/BattleReport");
      const Scout = require("../models/ScoutReport");
      const createUser = (username) =>
        User.create({
          username,
          email: `${username}@example.test`,
          password: "test-password",
        });
      const owner = await createUser("history-owner"),
        defender = await createUser("history-defender"),
        outsider = await createUser("history-outsider");
      const battles = await Battle.insertMany(
        Array.from({ length: 23 }, () => ({
          attacker: { userId: owner._id, username: owner.username },
          defender: { userId: defender._id, username: defender.username },
          result: { winner: "attacker" },
        })),
      );
      const scouts = await Scout.insertMany(
        Array.from({ length: 23 }, (_, i) => ({
          ownerUserId: owner._id,
          movementId: new mongoose.Types.ObjectId(),
          observedAt: new Date(10000 + i),
          outcome: "empty",
          destination: { galaxy: 1, system: 2, planet: 3 },
          targetUserId: defender._id,
          detected: true,
          sections: { environment: { total: 300 } },
        })),
      );
      const express = require("express");
      const app = express();
      app.use(express.json());
      app.use("/api/game", require("../routes/battleReports"));
      app.use("/api/game", require("../routes/scouts"));
      server = app.listen(0);
      await new Promise((resolve) => server.on("listening", resolve));
      const request = async (actor, path, method = "GET", body) => {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/api/game${path}`,
          {
            method,
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
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        return { status: response.status, data: await response.json() };
      };
      for (const path of ["/reports", "/scout-reports"]) {
        const first = (await request(owner, path + "?page=1&limit=20")).data;
        const second = (await request(owner, path + "?page=2&limit=20")).data;
        assert.equal(first.reports.length, 20);
        assert.equal(second.reports.length, 3);
        assert.deepEqual(first.pagination, {
          page: 1,
          limit: 20,
          total: 23,
          totalPages: 2,
        });
        assert.equal((await request(owner, path + "?page=0")).status, 400);
        assert.equal(
          (await request(owner, path + "?page=1&limit=51")).status,
          400,
        );
        assert.equal(
          (await request(owner, path + "?page=1&cursor=bad")).status,
          400,
        );
        assert.equal(
          (
            await request(null, path, "DELETE", {
              ids: [String(battles[0]._id)],
            })
          ).status,
          401,
        );
        for (const ids of [
          [],
          ["bad"],
          Array(51).fill(String(battles[0]._id)),
          [String(battles[0]._id), String(battles[0]._id)],
        ])
          assert.equal(
            (await request(owner, path, "DELETE", { ids })).status,
            400,
          );
      }
      const scoutReadPath = `/scout-reports/${scouts[0]._id}/read`;
      assert.equal(
        (await request(owner, `/scout-reports/${scouts[0]._id}`)).data.report
          .ownerRead,
        false,
      );
      assert.equal((await request(null, scoutReadPath, "PATCH")).status, 401);
      assert.equal(
        (await request(outsider, scoutReadPath, "PATCH")).status,
        404,
      );
      assert.equal(
        (await request(defender, scoutReadPath, "PATCH")).status,
        404,
      );
      assert.equal(
        (await request(owner, "/scout-reports/invalid/read", "PATCH")).status,
        400,
      );
      assert.equal(
        (await request(owner, scoutReadPath, "PATCH")).data.read,
        true,
      );
      assert.equal((await request(owner, scoutReadPath, "PATCH")).status, 200);
      assert.equal(
        (await request(owner, `/scout-reports/${scouts[0]._id}`)).data.report
          .ownerRead,
        true,
      );
      const scoutHistory = await request(
        owner,
        "/scout-reports?page=2&limit=20",
      );
      assert.equal(
        scoutHistory.data.reports.find((r) => r.id === String(scouts[0]._id))
          .ownerRead,
        true,
      );
      const battleIds = battles.slice(0, 4).map((r) => String(r._id));
      assert.equal(
        (await request(outsider, "/reports", "DELETE", { ids: battleIds }))
          .status,
        404,
      );
      assert.equal(
        (
          await request(owner, "/reports", "DELETE", {
            ids: [...battleIds, String(new mongoose.Types.ObjectId())],
          })
        ).status,
        404,
      );
      assert.equal((await request(owner, "/reports")).data.reports.length, 23);
      assert.equal(
        (await request(owner, "/reports", "DELETE", { ids: battleIds })).data
          .deletedCount,
        4,
      );
      assert.equal(
        (await request(owner, "/reports", "DELETE", { ids: battleIds })).status,
        200,
      ); // Safe retry.
      assert.equal((await request(owner, "/reports")).data.unreadCount, 19);
      assert.equal(
        (await request(defender, "/reports")).data.reports.length,
        23,
      );
      assert.equal(
        (await request(owner, `/reports/${battleIds[0]}/read`, "PATCH")).status,
        404,
      );
      assert.equal(await Battle.countDocuments(), 23);
      const scoutIds = scouts.slice(-4).map((r) => String(r._id));
      assert.equal(
        (await request(outsider, "/scout-reports", "DELETE", { ids: scoutIds }))
          .status,
        404,
      );
      assert.equal(
        (await request(owner, "/scout-reports", "DELETE", { ids: scoutIds }))
          .status,
        200,
      );
      const remaining = (await request(owner, "/scout-reports?page=1&limit=20"))
        .data;
      assert.equal(remaining.reports.length, 19);
      assert.equal(remaining.pagination.totalPages, 1);
      assert.equal(
        (await request(owner, `/scout-reports/${scoutIds[0]}`)).status,
        404,
      );
      assert.equal(
        (
          await request(
            owner,
            "/scout-reports?galaxy=1&system=2&planet=3&limit=50",
          )
        ).data.reports.length,
        23,
      );
      assert.equal(
        (await request(defender, "/scout-alerts?limit=50")).data.alerts.length,
        23,
      );
      assert.equal(
        (await request(owner, `/scout-reports/${scoutIds[0]}/read`, "PATCH"))
          .status,
        404,
      );
      assert.equal(await Scout.countDocuments(), 23);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
