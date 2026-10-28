const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const base = process.env.FLEET_TEST_MONGODB_URI;
const uri = base?.replace(/\/[^/?]+(?=\?|$)/, "/cosmic_api_error_audit_test");

// Verifies the public error contract and guards against the previously reproduced defects.
// Uses a separate database and actual server/index.js middleware, never the live server.
test(
  "API error audit: stable codes, safe errors and malformed input",
  { skip: !uri, timeout: 60000 },
  async () => {
    const secret = "api-audit-test-only-secret-at-least-32-characters";
    process.env.JWT_SECRET = secret;
    await mongoose.connect(uri);
    let child;
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User");
      const user = await User.createWithHomePlanet({
        username: "api_audit",
        email: "audit@example.test",
        password: "test-password",
      });
      const admin = await User.createWithHomePlanet({
        username: "api_admin",
        email: "admin@example.test",
        password: "test-password",
        isAdmin: true,
      });
      const banned = await User.createWithHomePlanet({
        username: "api_banned",
        email: "banned@example.test",
        password: "test-password",
        isBanned: true,
      });
      const jwt = require("jsonwebtoken");
      const token = jwt.sign({ userId: user._id }, secret);
      const fixture = path.join(__dirname, "fixtures/apiErrorAuditServer.cjs");
      child = fork(fixture, [], {
        env: {
          ...process.env,
          MONGODB_URI: uri,
          JWT_SECRET: secret,
          PORT: "0",
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const ready = await Promise.race([
        once(child, "message"),
        once(child, "exit").then(([code]) => {
          throw Error("Audit server exited: " + code);
        }),
      ]);
      const url = `http://127.0.0.1:${ready[0].port}`;
      const call = async (
        route,
        { auth = token, method = "GET", body, raw } = {},
      ) => {
        const response = await fetch(url + route, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          },
          ...(body !== undefined || raw !== undefined
            ? { body: raw ?? JSON.stringify(body) }
            : {}),
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        return {
          status: response.status,
          data,
          contentType: response.headers.get("content-type"),
        };
      };
      const cases = [
        [
          "missing token",
          "/api/game/catalog",
          { auth: null },
          401,
          "AUTH_REQUIRED",
        ],
        [
          "invalid token",
          "/api/game/catalog",
          { auth: "invalid" },
          401,
          "AUTH_INVALID_TOKEN",
        ],
        ["insufficient privilege", "/api/admin/config", {}, 403, "FORBIDDEN"],
        [
          "bad scout order",
          "/api/game/scouts",
          { method: "POST", body: {} },
          400,
          "INVALID_SCOUT_ORDER",
        ],
        [
          "unsupported mission",
          "/api/game/fleets",
          { method: "POST", body: { mission: "wrong" } },
          400,
          "INVALID_MISSION",
        ],
        [
          "invalid entity",
          "/api/queue/build",
          { method: "POST", body: { buildingId: "wrong", planetId: "0" } },
          400,
          "INVALID_ENTITY",
        ],
        [
          "queue ObjectId unsupported",
          "/api/queue/build",
          {
            method: "POST",
            body: {
              buildingId: "metalMine",
              planetId: String(user.planets[0]._id),
            },
          },
          400,
          "INVALID_PLANET",
        ],
        [
          "malformed queue ID",
          "/api/queue/check/invalid",
          { method: "POST" },
          400,
          "INVALID_ID",
        ],
        [
          "bad recall ID",
          "/api/game/fleets/invalid/recall",
          { method: "POST" },
          400,
          "INVALID_ID",
        ],
        [
          "missing recall target",
          "/api/game/fleets/000000000000000000000000/recall",
          { method: "POST" },
          404,
          "NOT_FOUND",
        ],
        [
          "bad report cursor",
          "/api/game/reports?before=invalid",
          {},
          400,
          "INVALID_REQUEST",
        ],
        [
          "missing scout report",
          "/api/game/scout-reports/000000000000000000000000",
          {},
          404,
          "NOT_FOUND",
        ],
        [
          "bad galaxy input",
          "/api/game/galaxy?galaxy=x&system=1",
          {},
          400,
          "INVALID_REQUEST",
        ],
        [
          "malformed JSON",
          "/api/auth/login",
          { method: "POST", raw: "{" },
          400,
          "INVALID_JSON",
        ],
        [
          "wrong password type",
          "/api/auth/login",
          { method: "POST", body: { username: user.username, password: {} } },
          400,
          "INVALID_REQUEST",
        ],
      ];
      for (const [label, route, options, status, code] of cases) {
        const result = await call(route, options);
        assert.equal(result.status, status, label);
        assert.equal(result.data.code, code, label);
        assert.equal(typeof result.data.error, "string", label);
        assert.match(result.data.requestId, /^[a-f0-9-]{36}$/);
        console.log(
          JSON.stringify({ check: label, status, code: code ?? null }),
        );
      }
      const expired = await call("/api/game/catalog", {
        auth: jwt.sign({ userId: user._id }, secret, { expiresIn: -1 }),
      });
      assert.equal(expired.status, 401);
      assert.equal(expired.data.code, "AUTH_TOKEN_EXPIRED");
      for (const amount of [-10, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const invalidAmount = await call(
          `/api/admin/users/${user._id}/resources`,
          {
            auth: jwt.sign({ userId: admin._id }, secret),
            method: "POST",
            body: { resourceType: "metal", amount },
          },
        );
        assert.equal(invalidAmount.status, 400);
        assert.equal(invalidAmount.data.code, "INVALID_REQUEST");
      }
      const injection = await call("/api/auth/login", {
        method: "POST",
        body: { username: { $ne: null }, password: "test-password" },
      });
      assert.equal(injection.status, 400);
      const media = await fetch(url + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      });
      assert.equal(media.status, 415);
      assert.equal((await media.json()).code, "UNSUPPORTED_MEDIA_TYPE");
      const large = await call("/api/auth/login", {
        method: "POST",
        raw: JSON.stringify({ padding: "x".repeat(10 * 1024 * 1024) }),
      });
      assert.equal(large.status, 413);
      assert.equal(large.data.code, "PAYLOAD_TOO_LARGE");
      const unauthenticated = await call("/api/auth/login", {
        method: "POST",
        body: { username: user.username, password: "wrong-password" },
      });
      assert.equal(unauthenticated.status, 401);
      assert.equal(unauthenticated.data.code, "AUTH_INVALID_CREDENTIALS");
      const Config = require("../models/GameConfig");
      await Config.updateOne({}, { $set: { maintenanceMode: true } });
      const maintenance = await call("/api/queue/build", {
        method: "POST",
        body: { buildingId: "metalMine", planetId: "0" },
      });
      assert.equal(maintenance.status, 503);
      assert.equal(maintenance.data.code, "MAINTENANCE_MODE");
      assert.equal((await call("/api/game/catalog")).status, 200);
      await Config.updateOne({}, { $set: { maintenanceMode: false } });
      const readyResponse = await call("/ready", { auth: null });
      assert.equal(readyResponse.status, 200);
      const wrongMethod = await call("/api/auth/login");
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.data.code, "METHOD_NOT_ALLOWED");
      const unknown = await call("/api/does-not-exist");
      assert.equal(unknown.status, 404);
      assert.match(unknown.contentType, /application\/json/);
      assert.equal(unknown.data.code, "ROUTE_NOT_FOUND");
      const bannedAccess = await call("/api/game/catalog", {
        auth: jwt.sign({ userId: banned._id }, secret),
      });
      assert.equal(bannedAccess.status, 403);
      assert.equal(bannedAccess.data.code, "ACCOUNT_BANNED");
      const beforeMetal = (await User.findById(user._id)).planets[0].resources
        .metal;
      const stringAmount = await call(
        `/api/admin/users/${user._id}/resources`,
        {
          auth: jwt.sign({ userId: admin._id }, secret),
          method: "POST",
          body: { resourceType: "metal", amount: "10", planetIndex: 0 },
        },
      );
      assert.equal(stringAmount.status, 400);
      assert.equal(stringAmount.data.code, "INVALID_REQUEST");
      assert.equal(
        (await User.findById(user._id)).planets[0].resources.metal,
        beforeMetal,
      );

      const fault = async (mode) => {
        child.send({ fault: mode });
        await once(child, "message");
      };
      await fault("snapshot");
      const stateFailure = await call("/api/auth/me");
      assert.equal(stateFailure.status, 500);
      assert.equal(stateFailure.data.code, "INTERNAL_ERROR");
      await fault("catalog");
      const catalogFailure = await call("/api/game/catalog");
      assert.equal(catalogFailure.status, 500);
      assert.equal(catalogFailure.data.code, "INTERNAL_ERROR");
      assert.ok(
        !JSON.stringify(catalogFailure.data).includes("audit internal detail"),
      );
      await fault("none");
      const { io } = require("socket.io-client");
      const socket = io(url, {
        transports: ["websocket"],
        autoConnect: false,
        reconnection: false,
      });
      try {
        socket.connect();
        await once(socket, "connect");
        const emit = (event, data) =>
          socket.timeout(3000).emitWithAck(event, data);
        const expiredAuth = await emit(
          "authenticate",
          jwt.sign({ userId: user._id }, secret, { expiresIn: -1 }),
        );
        assert.equal(expiredAuth.ok, false);
        assert.equal(expiredAuth.error.code, "AUTH_TOKEN_EXPIRED");
        const authenticated = await emit("authenticate", token);
        assert.equal(authenticated.ok, true);
        await User.updateOne({ _id: user._id }, { $set: { isBanned: true } });
        const stoppedSession = await emit("getPlanetData");
        assert.equal(stoppedSession.error.code, "ACCOUNT_BANNED");
        await User.updateOne({ _id: user._id }, { $set: { isBanned: false } });
        assert.equal((await emit("authenticate", token)).ok, true);
        const invalidGalaxy = await emit("getGalaxy", {
          galaxy: "1",
          system: 1,
        });
        assert.equal(invalidGalaxy.ok, false);
        assert.equal(invalidGalaxy.error.code, "INVALID_REQUEST");
        for (let i = 0; i < 119; i++)
          await emit("getGalaxy", { galaxy: 0, system: 0 });
        const limitedSocket = await emit("getPlanetData");
        assert.equal(limitedSocket.error.code, "RATE_LIMITED");
        const bannedAuth = await emit(
          "authenticate",
          jwt.sign({ userId: banned._id }, secret),
        );
        assert.equal(bannedAuth.error.code, "ACCOUNT_BANNED");
      } finally {
        socket.disconnect();
      }
      const governors = await Promise.all(
        ["a", "b"].map((name) =>
          User.createWithHomePlanet({
            username: "governor_" + name,
            email: name + "@governor.test",
            password: "test-password",
            isAdmin: true,
            adminRole: "superadmin",
          }),
        ),
      );
      const governanceToken = jwt.sign({ userId: governors[0]._id }, secret);
      const demotions = await Promise.all(
        governors.map((g) =>
          call(`/api/admin/users/${g._id}`, {
            auth: governanceToken,
            method: "PUT",
            body: { isAdmin: false },
          }),
        ),
      );
      assert.equal(demotions.filter((r) => r.status === 200).length, 1);
      assert.ok(demotions.every((r) => [200, 403, 409].includes(r.status)));
      assert.equal(
        demotions.find((r) => r.status === 200).data.user.password,
        undefined,
      );
      const survivor = await User.findOne({
        isAdmin: true,
        adminRole: "superadmin",
        isBanned: false,
      });
      assert.equal(
        await User.countDocuments({
          isAdmin: true,
          adminRole: "superadmin",
          isBanned: false,
        }),
        1,
      );
      const survivorToken = jwt.sign({ userId: survivor._id }, secret);
      const protectedBan = await call(`/api/admin/users/${survivor._id}`, {
        auth: survivorToken,
        method: "PUT",
        body: { isBanned: true },
      });
      assert.equal(protectedBan.status, 409);
      assert.equal(protectedBan.data.code, "LAST_SUPERADMIN");
      await User.deleteMany({});
      const bootstrap = await Promise.all(
        ["alpha", "beta"].map((name) =>
          call("/api/auth/setup-admin", {
            auth: null,
            method: "POST",
            body: {
              username: "bootstrap_" + name,
              email: name + "@example.test",
              password: "test-password",
            },
          }),
        ),
      );
      assert.deepEqual(bootstrap.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await User.countDocuments({ isAdmin: true }), 1);
      assert.ok(
        ["ADMIN_ALREADY_EXISTS", "RESOURCE_CONFLICT"].includes(
          bootstrap.find((r) => r.status === 409).data.code,
        ),
      );
    } finally {
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);

test("API limiter returns JSON 429 with retry headers at production limit", async () => {
  const oldEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const express = require("express");
  const app = express();
  const limiter = require("../middleware/rateLimits").createApiLimiter();
  app.use(limiter);
  app.get("/", (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (let i = 0; i < 120; i++) {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    const limited = await fetch(url);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.ok(limited.headers.get("ratelimit-limit"));
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    await new Promise((resolve) => server.close(resolve));
  }
});
