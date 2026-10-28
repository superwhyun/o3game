const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const http = require("node:http");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(
  /\/[^/?]+(?=\?|$)/,
  "/cosmic_ai_players_test",
);
test(
  "AI models, API-only external decisions, leases, permissions and safe failures",
  { skip: !uri, timeout: 60000 },
  async () => {
    const secret = "ai-test-jwt-secret-with-at-least-32-characters",
      workerKey = "ai-test-worker-key-with-at-least-32-characters";
    process.env.JWT_SECRET = secret;
    let mode = "build",
      calls = 0,
      child;
    const provider = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, "Bearer provider-secret");
      const data = JSON.parse(raw);
      assert.equal(data.model, "mock-model");
      calls++;
      if (mode === "401") {
        res.writeHead(401);
        return res.end("secret provider error");
      }
      if (mode === "429") {
        res.writeHead(429);
        return res.end("rate limit");
      }
      if (mode === "invalid") {
        res.writeHead(200);
        return res.end("not json");
      }
      if (mode === "null") {
        res.writeHead(200);
        return res.end("null");
      }
      if (mode === "large") {
        res.writeHead(200);
        return res.end("x".repeat(1024 * 1024 + 1));
      }
      if (mode === "timeout") {
        setTimeout(() => {
          if (!res.destroyed) res.end("{}");
        }, 6000);
        return;
      }
      if (mode === "unavailable") {
        res.writeHead(503);
        return res.end("secret unavailable");
      }

      let content = "OK";
      if (data.messages[0].role === "system") {
        const input = JSON.parse(data.messages[1].content);
        const action = input.candidates.find(
          (c) => c.details?.type === "building",
        );
        content = JSON.stringify({
          actionId: action?.id || "c0",
          reason: "생산 시설 확장",
          improvement: input.feedback.allowed
            ? {
                title: "API 정찰 출항 사전 검증",
                description:
                  "관측: 출항 가능한 행동은 현재 상태로 판단하며 최종 API에서 검증된다. 영향: 출항 거부 후 원인을 파악해야 한다. 제안: 출항 가능 여부 사전 검증 API를 제공한다.",
              }
            : null,
        });
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    await mongoose.connect(uri);
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User"),
        Model = require("../models/AiModel"),
        Player = require("../models/AiPlayer");
      const admin = await User.createWithHomePlanet({
        username: "ai-admin",
        email: "admin@ai.test",
        password: "test-password",
        isAdmin: true,
        adminRole: "superadmin",
      });
      const human = await User.createWithHomePlanet({
        username: "human",
        email: "human@ai.test",
        password: "test-password",
      });
      const jwt = require("jsonwebtoken");
      const adminToken = jwt.sign({ userId: String(admin._id) }, secret),
        humanToken = jwt.sign({ userId: String(human._id) }, secret);
      child = fork(
        path.join(__dirname, "fixtures/apiErrorAuditServer.cjs"),
        [],
        {
          env: {
            ...process.env,
            MONGODB_URI: uri,
            JWT_SECRET: secret,
            AI_WORKER_SECRET: workerKey,
            PORT: "0",
            NODE_ENV: "test",
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const [ready] = await Promise.race([
        once(child, "message"),
        once(child, "exit").then(([code]) => {
          throw Error("server exit " + code);
        }),
      ]);
      const baseUrl = `http://127.0.0.1:${ready.port}`;
      const { ApiClient } = await import("../../ai-player/apiClient.js");
      const control = new ApiClient(baseUrl, workerKey),
        api = new ApiClient(baseUrl, adminToken),
        ordinary = new ApiClient(baseUrl, humanToken);
      await assert.rejects(ordinary.request("/api/admin/ai-models"), {
        code: "FORBIDDEN",
      });
      await assert.rejects(
        new ApiClient(baseUrl, "wrong").request("/api/ai-worker/claim", {
          workerId: "test",
        }),
        { code: "AI_WORKER_UNAUTHORIZED" },
      );
      await assert.rejects(api.request("/api/admin/ai-models", {}, "POST"), {
        code: "INVALID_REQUEST",
      });
      await assert.rejects(
        api.request("/api/admin/ai-models", {
          name: "bad",
          provider: "openrouter",
          model: "x",
        }),
        { code: "AI_KEY_REQUIRED" },
      );
      const { model } = await api.request("/api/admin/ai-models", {
        name: "Mock compatible",
        isDefault: true,
        provider: "compatible",
        model: "mock-model",
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        apiKey: "provider-secret",
      });
      assert.equal(model.apiKeyConfigured, true);
      assert.ok(!JSON.stringify(model).includes("provider-secret"));
      const stored = await Model.findById(model.id).select("+apiKeyCipher");
      assert.ok(!stored.apiKeyCipher.includes("provider-secret"));
      await api.request(
        `/api/admin/ai-models/${model.id}`,
        { name: "Renamed" },
        "PUT",
      );
      assert.equal(
        (await api.request(`/api/admin/ai-models/${model.id}/test`, {}))
          .connected,
        true,
      );
      for (const [state, code, status] of [
        ["401", "AI_MODEL_AUTH_FAILED", 502],
        ["429", "AI_MODEL_RATE_LIMITED", 429],
        ["invalid", "AI_MODEL_INVALID_RESPONSE", 502],
        ["null", "AI_MODEL_INVALID_RESPONSE", 502],
        ["large", "AI_MODEL_INVALID_RESPONSE", 502],
        ["unavailable", "AI_MODEL_UNAVAILABLE", 502],
      ]) {
        mode = state;
        await assert.rejects(
          api.request(`/api/admin/ai-models/${model.id}/test`, {}),
          (e) => e.code === code && e.status === status,
        );
      }
      await api.request(
        `/api/admin/ai-models/${model.id}`,
        { timeoutSeconds: 5 },
        "PUT",
      );
      mode = "timeout";
      await assert.rejects(
        api.request(`/api/admin/ai-models/${model.id}/test`, {}),
        { code: "AI_MODEL_TIMEOUT", status: 504 },
      );
      mode = "build";
      const settings = require("../services/AiModelService");
      for (const [provider, url] of Object.entries(settings.DEFAULT_URLS)) {
        const clean = settings.clean({
          name: "Provider",
          provider,
          model: "test/model",
          apiKey: "example",
          baseUrl: "http://ignored.test",
        });
        assert.equal(clean.baseUrl, url);
        assert.ok(!clean.apiKeyCipher.includes("example"));
      }
      assert.throws(
        () =>
          settings.clean(
            { provider: "vercel" },
            {
              name: "x",
              provider: "openrouter",
              model: "x",
              apiKeyCipher: "old-key",
            },
          ),
        { code: "AI_KEY_REQUIRED" },
      );
      const { player } = await api.request("/api/admin/ai-players", {
        username: "AI builder",
        galaxy: 7,
        intervalSeconds: 15,
      });
      assert.equal(player.modelId, model.id);
      const bot = await User.findById(player.userId);
      assert.equal(bot.isAdmin, false);
      assert.equal(bot.isAiPlayer, true);
      assert.equal(bot.planets.length, 1);
      assert.equal(bot.planets[0].galaxy, 7);
      assert.equal(player.planets[0].galaxy, 7);
      for (const galaxy of [0, 10, 1.5, "7", null]) {
        await assert.rejects(
          api.request("/api/admin/ai-players", {
            username: "invalid galaxy",
            galaxy,
          }),
          { code: "INVALID_REQUEST" },
        );
      }
      assert.equal(
        bot.planets[0].resources.metal,
        human.planets[0].resources.metal,
      );
      await assert.rejects(
        api.request(`/api/admin/ai-models/${model.id}`, undefined, "DELETE"),
        { code: "AI_MODEL_IN_USE" },
      );
      for (const behaviorScores of [
        { development: 40, expansion: 40, attack: 40 },
        { development: -1, expansion: 101, attack: 0 },
        { expansion: 50, attack: 50 },
      ])
        await assert.rejects(
          api.request("/api/admin/ai-players", {
            username: "bad scores",
            behaviorScores,
          }),
          { code: "INVALID_REQUEST" },
        );
      const batch = await api.request("/api/admin/ai-players", {
        username: "Population bot",
        count: 4,
        enabled: false,
        behaviorScores: { development: 20, expansion: 70, attack: 10 },
      });
      assert.equal(batch.created, 4);
      assert.equal(new Set(batch.players.map((p) => p.username)).size, 4);
      assert.ok(
        batch.players.every(
          (p) => p.maxColonies === 9 && p.behaviorScores.expansion === 70,
        ),
      );
      assert.equal(
        new Set(
          batch.players.map(
            (p) =>
              `${p.planets[0].galaxy}:${p.planets[0].system}:${p.planets[0].planet}`,
          ),
        ).size,
        4,
      );
      const humanList = await api.request("/api/admin/users?kind=human");
      const botList = await api.request("/api/admin/users?kind=bot");
      assert.ok(humanList.users.every((u) => !u.isAiPlayer));
      assert.ok(botList.users.every((u) => u.isAiPlayer));
      for (const count of [0, 51, 1.5])
        await assert.rejects(
          api.request("/api/admin/ai-players", {
            username: "bad count",
            count,
          }),
          { code: "INVALID_REQUEST" },
        );
      for (const p of batch.players)
        await api.request(`/api/admin/users/${p.userId}`, undefined, "DELETE");
      const claims = await Promise.all([
        control.request("/api/ai-worker/claim", { workerId: "test-a" }),
        control.request("/api/ai-worker/claim", { workerId: "test-b" }),
      ]);
      assert.equal(claims.filter((c) => c.job).length, 1);
      const job = claims.find((c) => c.job).job;
      const botApi = new ApiClient(baseUrl, job.token);
      await assert.rejects(botApi.request("/api/admin/ai-models"), {
        code: "FORBIDDEN",
      });
      await assert.rejects(
        botApi.request(
          "/api/queue/aaaaaaaaaaaaaaaaaaaaaaaa",
          undefined,
          "DELETE",
        ),
        { code: "QUEUE_NOT_ACTIVE" },
      );
      const { runJob } = await import("../../ai-player/runner.js");
      const result = await runJob(baseUrl, control, job);
      assert.equal(result.acted, true, JSON.stringify(result));
      assert.equal(result.reason, "생산 시설 확장");
      const afterAction = await Player.findById(player.id);
      assert.ok(+afterAction.nextRunAt < Date.now() + 2000);
      assert.equal(afterAction.history.length, 1);
      assert.equal(afterAction.history[0].acted, true);
      assert.equal(afterAction.history[0].reason, result.reason);
      assert.equal(result.suggestionSubmitted, true, JSON.stringify(result));
      const Suggestion = require("../models/ImprovementRequest");
      const suggestion = await Suggestion.findOne({
        authorUserId: player.userId,
      });
      assert.equal(suggestion.authorType, "ai");
      assert.equal((await Player.findById(player.id)).suggestions, 1);
      assert.equal(
        (await ordinary.request("/api/game/improvement-requests")).requests[0]
          .authorType,
        "ai",
      );

      assert.equal((await Player.findById(player.id)).actions, 1);
      assert.equal(
        await require("../models/BuildingQueue").countDocuments({
          userId: player.userId,
        }),
        1,
      );
      await Player.updateOne(
        { _id: player.id },
        { $set: { nextRunAt: new Date() } },
      );
      const next = (
        await control.request("/api/ai-worker/claim", { workerId: "test" })
      ).job;
      const nextApi = new ApiClient(baseUrl, next.token);
      await assert.rejects(
        nextApi.request("/api/game/improvement-requests", {
          title: "다른 제안",
          description: "관측된 게임 동작 개선",
        }),
        { code: "AI_SUGGESTION_COOLDOWN" },
      );
      await control.request("/api/ai-worker/complete", {
        playerId: next.playerId,
        runId: next.runId,
        result: { acted: false, action: "wait" },
      });
      const sleeping = await Player.findById(player.id);
      assert.ok(+sleeping.nextRunAt >= Date.now() + 119000);
      assert.equal(
        (await control.request("/api/ai-worker/claim", { workerId: "test" }))
          .job,
        null,
      );
      await Player.updateOne(
        { _id: player.id },
        { $set: { nextRunAt: new Date() } },
      );
      const recheckJob = (
        await control.request("/api/ai-worker/claim", { workerId: "test" })
      ).job;
      await Player.updateOne(
        { _id: player.id },
        {
          $set: {
            history: Array.from({ length: 52 }, (_, index) => ({
              runId: `old${index}`,
              at: new Date(),
              acted: true,
              action: "old",
            })),
          },
        },
      );
      await control.request("/api/ai-worker/complete", {
        playerId: recheckJob.playerId,
        runId: recheckJob.runId,
        result: {
          acted: false,
          recheck: true,
          action: "재판단 · 작업 완료",
          reason: "다른 작업 재검토",
        },
      });
      const afterRecheck = await Player.findById(player.id);
      assert.ok(+afterRecheck.nextRunAt < Date.now() + 2000);
      assert.equal(afterRecheck.history.at(-1).recheck, true);
      assert.equal(afterRecheck.history.length, 50);
      const profile = (await api.request("/api/admin/ai-players")).players.find(
        (p) => p.id === player.id,
      );
      assert.equal(profile.history[0].runId, recheckJob.runId);
      assert.equal(profile.history.length, 50);
      await assert.rejects(
        control.request("/api/ai-worker/complete", {
          playerId: recheckJob.playerId,
          runId: recheckJob.runId,
          result: { acted: false, recheck: true },
        }),
        { code: "AI_RUN_EXPIRED" },
      );
      assert.equal((await Player.findById(player.id)).history.length, 50);
      await Player.updateOne(
        { _id: player.id },
        { $set: { nextRunAt: new Date() } },
      );
      const awake = (
        await control.request("/api/ai-worker/claim", { workerId: "test" })
      ).job;
      const nextRun = await runJob(baseUrl, control, awake);
      assert.equal(nextRun.suggestionSubmitted, undefined);
      assert.equal(
        await Suggestion.countDocuments({ authorUserId: player.userId }),
        1,
      );
      await Player.updateOne(
        { _id: player.id },
        {
          $set: {
            lastSuggestionAt: new Date(Date.now() - 7 * 3600000),
            nextRunAt: new Date(),
          },
        },
      );
      const third = (
        await control.request("/api/ai-worker/claim", { workerId: "test" })
      ).job;
      const thirdApi = new ApiClient(baseUrl, third.token);
      await assert.rejects(
        thirdApi.request("/api/game/improvement-requests", {
          title: "API  정찰 출항 사전 검증!",
          description: "같은 제안",
        }),
        { code: "AI_SUGGESTION_DUPLICATE" },
      );
      const submissions = await Promise.allSettled([
        thirdApi.request("/api/game/improvement-requests", {
          title: "행동 실패 원인 안내",
          description: "API 실패 시 필요한 선행조건 안내를 추가",
        }),
        thirdApi.request("/api/game/improvement-requests", {
          title: "다른 API 개선",
          description: "테스트 제안",
        }),
      ]);
      assert.equal(
        submissions.filter((s) => s.status === "fulfilled").length,
        1,
      );
      assert.equal(
        submissions.find((s) => s.status === "rejected").reason.code,
        "AI_SUGGESTION_COOLDOWN",
      );
      await api.request(
        `/api/admin/ai-players/${player.id}`,
        { proposeImprovements: false },
        "PATCH",
      );
      const fourth = (
        await control.request("/api/ai-worker/claim", { workerId: "test" })
      ).job;
      await assert.rejects(
        new ApiClient(baseUrl, fourth.token).request(
          "/api/game/improvement-requests",
          { title: "중지된 제안", description: "등록 금지" },
        ),
        { code: "AI_SUGGESTIONS_DISABLED" },
      );
      await api.request(
        `/api/admin/ai-players/${player.id}`,
        { enabled: false },
        "PATCH",
      );
      await assert.rejects(
        new ApiClient(baseUrl, fourth.token).request("/api/auth/me"),
        { code: "AI_PLAYER_INACTIVE" },
      );
      await assert.rejects(
        control.request("/api/ai-worker/complete", {
          playerId: next.playerId,
          runId: next.runId,
          result: { acted: false },
        }),
        { code: "AI_RUN_EXPIRED" },
      );
      assert.equal(
        (await control.request("/api/ai-worker/claim", { workerId: "test" }))
          .job,
        null,
      );
      const list = await api.request("/api/admin/ai-players");
      assert.equal(list.worker.connected, true);
      assert.equal(list.players[0].enabled, false);
      assert.ok(calls >= 5);
      await api.request(
        `/api/admin/users/${player.userId}`,
        undefined,
        "DELETE",
      );
      assert.equal(await Player.countDocuments({ _id: player.id }), 0);
      assert.equal(
        (
          await api.request(
            `/api/admin/ai-models/${model.id}`,
            undefined,
            "DELETE",
          )
        ).deleted,
        true,
      );
    } finally {
      if (child) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      provider.close();
      provider.closeAllConnections();
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
