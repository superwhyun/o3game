const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const http = require("node:http");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(
  /\/[^/?]+(?=\?|$)/,
  "/cosmic_account_settings_test",
);
test(
  "account settings, credential verification, UI persistence and real delegated worker game action with scoped revocation",
  { skip: !uri, timeout: 45000 },
  async () => {
    const secret = "account-settings-jwt-secret-at-least-32-characters";
    const key = "account-settings-worker-secret-at-least-32-characters";
    process.env.JWT_SECRET = secret;
    let child,
      calls = 0;
    const provider = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const parsed = JSON.parse(raw);
      const payload = JSON.parse(parsed.messages[1].content);
      assert.ok(!raw.includes("account-password"));
      assert.ok(
        !JSON.stringify(payload.observation).includes("owner@settings.test"),
      );
      const candidate =
        payload.candidates.find(
          (c) => c.id !== "c0" && c.label.includes("금속"),
        ) || payload.candidates.find((c) => c.id !== "c0");
      calls++;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actionId: candidate?.id || "c0",
                  reason: "현재 자원과 선행 조건을 확인해 건설합니다.",
                  improvement: payload.feedback.allowed ? {title:"함대 공급 부족 사전 안내",description:"관측된 API 공급 부족 상태를 행동 전 자세히 알려 주세요."} : null,
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
    await mongoose.connect(uri);
    try {
      await mongoose.connection.dropDatabase();
      const User = require("../models/User"),
        Model = require("../models/AiModel"),
        Player = require("../models/AiPlayer");
      await require("../models/GameConfig").getConfig();
      await require("../services/EntityConfigService").initialize();
      const user = await User.createWithHomePlanet({
        username: "settings-owner",
        email: "owner@settings.test",
        password: "account-password",
        isAdmin: true,
        adminRole: "superadmin",
      });
      const other = await User.createWithHomePlanet({
        username: "settings-other",
        email: "other@settings.test",
        password: "account-password",
      });
      const model = await Model.create({
        name: "등록 테스트 모델",
        provider: "compatible",
        model: "test-model",
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        enabled: true,
        isDefault: true,
        apiKeyCipher: "never-expose-this-key",
      });
      const disabled = await Model.create({
        name: "중지 모델",
        provider: "compatible",
        model: "off",
        enabled: false,
      });
      // Provider requires no API key; keep a separate disabled secret-bearing model for projection checks.
      model.apiKeyCipher = undefined;
      await model.save();
      disabled.apiKeyCipher = "secret-cipher";
      await disabled.save();
      child = fork(
        path.join(__dirname, "fixtures/apiErrorAuditServer.cjs"),
        [],
        {
          env: {
            ...process.env,
            MONGODB_URI: uri,
            JWT_SECRET: secret,
            AI_WORKER_SECRET: key,
            NODE_ENV: "test",
            PORT: "0",
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const [ready] = await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw Error("test server exited");
        }),
      ]);
      const baseUrl = `http://127.0.0.1:${ready.port}`;
      const jwt = require("jsonwebtoken");
      const token = (actor) => jwt.sign({ userId: String(actor._id) }, secret);
      const { ApiClient } = await import("../../ai-player/apiClient.js");
      const api = new ApiClient(baseUrl, token(user)),
        ordinary = new ApiClient(baseUrl, token(other)),
        control = new ApiClient(baseUrl, key);
      const data = await api.request("/api/account/settings");
      assert.equal(data.account.preferences.uiMode, "detailed");
      assert.equal(data.delegation, null);
      assert.ok(!JSON.stringify(data).includes("password"));
      for (const mode of ["simple", "detailed", "graphics"]) {
        await api.request("/api/account/settings", { uiMode: mode }, "PATCH");
        assert.equal(
          (await api.request("/api/auth/me")).preferences.uiMode,
          mode,
        );
        assert.equal(
          (await api.request("/api/account/settings")).account.preferences
            .uiMode,
          mode,
        );
      }
      assert.equal(
        (await ordinary.request("/api/account/settings")).account.preferences
          .uiMode,
        "detailed",
      );
      await assert.rejects(
        api.request("/api/account/settings", { uiMode: "invalid" }, "PATCH"),
        { code: "INVALID_REQUEST" },
      );
      await assert.rejects(
        api.request(
          "/api/account/email",
          { email: "new@settings.test", currentPassword: "wrong" },
          "PATCH",
        ),
        { code: "AUTH_INVALID_CREDENTIALS" },
      );
      await assert.rejects(
        api.request(
          "/api/account/email",
          { email: "OTHER@settings.test", currentPassword: "account-password" },
          "PATCH",
        ),
        { code: "ACCOUNT_EXISTS" },
      );
      await api.request(
        "/api/account/email",
        { email: "NEW@settings.test", currentPassword: "account-password" },
        "PATCH",
      );
      assert.equal((await User.findById(user._id)).email, "new@settings.test");
      const list = await api.request("/api/account/ai-models");
      assert.equal(list.models.length, 1);
      assert.equal(list.models[0].id, String(model._id));
      assert.equal(list.models[0].baseUrl, undefined);
      assert.equal(list.models[0].apiKeyCipher, undefined);
      await assert.rejects(
        api.request(
          "/api/account/delegation",
          { enabled: true, modelId: String(disabled._id) },
          "PATCH",
        ),
        { code: "AI_MODEL_DISABLED" },
      );
      await assert.rejects(
        api.request(
          "/api/account/delegation",
          { enabled: true, modelId: String(model._id), intervalSeconds: 1 },
          "PATCH",
        ),
        { code: "INVALID_REQUEST" },
      );
      const configured = await api.request(
        "/api/account/delegation",
        {
          enabled: true,
          modelId: String(model._id),
          strategy: "economy",
          allowAttacks: false,
          intervalSeconds: 60,
          userId: String(other._id),
        },
        "PATCH",
      );
      assert.equal(configured.delegation.kind, "delegate");
      assert.equal(configured.delegation.userId, String(user._id));
      assert.equal(await Player.countDocuments({ userId: other._id }), 0);
      const { job } = await control.request("/api/ai-worker/claim", {
        workerId: "settings-test",
      });
      assert.equal(job.userId, String(user._id));
      const scoped = new ApiClient(baseUrl, job.token);
      await assert.rejects(scoped.request('/api/queue/aaaaaaaaaaaaaaaaaaaaaaaa', undefined, 'DELETE'), {code:'FORBIDDEN'});
      assert.equal((await scoped.request("/api/auth/me")).id, String(user._id));
      await assert.rejects(scoped.request("/api/admin/users"), {
        code: "FORBIDDEN",
      });
      await assert.rejects(
        scoped.request("/api/account/password", {
          currentPassword: "account-password",
          newPassword: "another-password",
        }),
        { code: "FORBIDDEN" },
      );
      await assert.rejects(
        scoped.request("/api/game/fleets", { mission: "attack" }),
        { code: "FORBIDDEN" },
      );
      await assert.rejects(
        scoped.request(
          `/api/game/planets/${user.planets[0]._id}`,
          { confirmationName: user.planets[0].name },
          "DELETE",
        ),
        { code: "FORBIDDEN" },
      );
      const { runJob } = await import("../../ai-player/runner.js");
      const result = await runJob(baseUrl, control, job);
      assert.equal(result.errorCode, undefined);
      assert.equal(result.acted, true);
      assert.equal(result.suggestionSubmitted,true);
      const Suggestion = require('../models/ImprovementRequest');
      const suggestion = await Suggestion.findOne({authorUserId:user._id});
      assert.equal(suggestion.authorType,'ai');
      assert.equal(calls, 1);
      const history = (await api.request("/api/account/settings")).delegation;
      assert.equal(history.runs, 1);
      assert.equal(history.actions, 1);
      assert.equal(history.suggestions,1);
      assert.equal(history.history[0].suggestionSubmitted,true);
      assert.ok(history.lastReason.includes("조건"));
      assert.equal((await User.findById(user._id)).isAiPlayer, false);
      await Player.updateOne(
        { _id: history.id },
        { $set: { nextRunAt: new Date(0) } },
      );
      const second = (
        await control.request("/api/ai-worker/claim", {
          workerId: "settings-test",
        })
      ).job;
      const secondApi = new ApiClient(baseUrl,second.token);
      await assert.rejects(secondApi.request('/api/game/improvement-requests',{title:'또 다른 제안',description:'새로운 제안'}),{code:'AI_SUGGESTION_COOLDOWN'});
      await api.request("/api/account/delegation", { enabled: true, proposeImprovements:false }, "PATCH");
      const third = (await control.request('/api/ai-worker/claim',{workerId:'settings-test'})).job;
      await assert.rejects(new ApiClient(baseUrl,third.token).request('/api/game/improvement-requests',{title:'중지 제안',description:'등록 금지'}),{code:'AI_SUGGESTIONS_DISABLED'});
      await api.request("/api/account/delegation", { enabled: false }, "PATCH");
      await assert.rejects(
        new ApiClient(baseUrl, second.token).request("/api/auth/me"),
        { code: "AI_PLAYER_INACTIVE" },
      );
      assert.equal(
        (
          await control.request("/api/ai-worker/claim", {
            workerId: "settings-test",
          })
        ).job,
        null,
      );
      await assert.rejects(
        api.request("/api/account/password", {
          currentPassword: "wrong",
          newPassword: "new-account-password",
        }),
        { code: "AUTH_INVALID_CREDENTIALS" },
      );
      await assert.rejects(
        api.request("/api/account/password", {
          currentPassword: "account-password",
          newPassword: "한".repeat(25),
        }),
        { code: "INVALID_REQUEST" },
      );
      const changed = await api.request("/api/account/password", {
        currentPassword: "account-password",
        newPassword: "new-account-password",
      });
      await assert.rejects(api.request("/api/auth/me"), {
        code: "AUTH_INVALID_TOKEN",
      });
      const updated = new ApiClient(baseUrl, changed.token);
      assert.equal(
        (await updated.request("/api/account/settings")).account.email,
        "new@settings.test",
      );
      assert.equal(
        await (
          await User.findById(user._id)
        ).comparePassword("new-account-password"),
        true,
      );
      const login = await fetch(baseUrl + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user.username,
          password: "new-account-password",
        }),
      });
      assert.equal(login.status, 200);
      assert.equal(
        (
          await new ApiClient(baseUrl, (await login.json()).token).request(
            "/api/auth/me",
          )
        ).id,
        String(user._id),
      );
    } finally {
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await new Promise((resolve) => provider.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
