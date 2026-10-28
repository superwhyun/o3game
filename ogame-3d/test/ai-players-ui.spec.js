import { test, expect } from "@playwright/test";
for (const role of ["superadmin", "moderator"]) {
  test(`AI management permissions and responsive forms: ${role}`, async ({
    page,
  }) => {
    await page.route("**/api/auth/check-admin", (r) =>
      r.fulfill({ json: { hasAdmin: true } }),
    );
    await page.route("**/api/auth/me", (r) =>
      r.fulfill({
        json: { username: "admin", isAdmin: true, adminRole: role },
      }),
    );
    await page.route("**/api/admin/users**", r => r.fulfill({json:{users:[], pagination:{total:0,page:1,pages:0}}}));
    let models = [],
      players = [],
      testFails = true;
    const writes = [];
    await page.route("**/api/admin/ai-models**", async (r) => {
      const req = r.request(),
        method = req.method(),
        url = req.url();
      if (url.endsWith("/test"))
        return r.fulfill({
          status: testFails ? 502 : 200,
          json: testFails
            ? { error: "모델 키 확인 필요", code: "AI_MODEL_AUTH_FAILED" }
            : { connected: true, model: "test/model" },
        });
      if (method === "POST" || method === "PUT") {
        const data = req.postDataJSON();
        writes.push({ method, data });
        const m = {
          id: "111111111111111111111111",
          ...data,
          apiKeyConfigured: true,
        };
        delete m.apiKey;
        models = [m];
        return r.fulfill({ json: { model: m } });
      }
      return r.fulfill({ json: { models } });
    });
    await page.route("**/api/admin/ai-players**", async (r) => {
      const req = r.request(),
        method = req.method();
      if (method === "POST") {
        const data = req.postDataJSON();
        writes.push({ method, data });
        const p = {
          id: "222222222222222222222222",
          ...data,
          planets: [{ name: "Colony-1" }],
          runs: 0,
          actions: 0,
        };
        players = [p];
        return r.fulfill({ json: { player: p } });
      }
      if (method === "PATCH") {
        const data = req.postDataJSON();
        writes.push({ method, data });
        Object.assign(players[0], data);
        return r.fulfill({ json: { player: players[0] } });
      }
      return r.fulfill({
        json: { players, worker: { configured: true, connected: true } },
      });
    });
    await page.goto("/");
    await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
    await page.evaluate(() => {
      document.getElementById("auth-screen").classList.add("hidden");
      document.getElementById("ui-layer").classList.remove("hidden");
      document
        .querySelectorAll(".main-panel")
        .forEach((e) => e.classList.remove("active"));
      document
        .querySelectorAll(".holo-panel")
        .forEach((e) => e.classList.add("hidden"));
      document.getElementById("admin-panel").classList.remove("hidden");
      document
        .querySelectorAll(".admin-tab-content")
        .forEach((e) => e.classList.remove("active"));
      document.getElementById("tab-users").classList.add("active");
      window.uiManager.loadAdminTabData("users");
    });
    await expect(page.locator('#users-human-section')).toBeVisible();
    await page.locator('[data-user-kind="bot"]').click();
    const root = page.locator("#tab-ai");
    await expect(root).toContainText("실행 프로그램: 연결됨");
    if (role === "moderator") {
      await expect(root.locator("form")).toHaveCount(0);
      return;
    }
    await expect(page.locator('.admin-tab[data-tab="ai"]')).toHaveCount(0);
    await expect(page.locator("#users-human-section")).toBeHidden();
    await expect(page.locator('[data-user-kind="bot"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await root.locator(".ai-model-settings > summary").click();
    const form = root.locator("[data-ai-form=model]");
    await form.locator("[name=name]").fill("외부 모델");
    await form.locator("[name=model]").fill("test/model");
    await form.locator("[name=apiKey]").fill("test-key");
    await form.locator("[name=isDefault]").check();
    await expect(form.locator("[data-base-url]")).toBeHidden();
    await form.locator("[name=provider]").selectOption("vercel");
    await expect(form.locator("[data-base-url]")).toBeHidden();
    await form.locator("[name=provider]").selectOption("compatible");
    await expect(form.locator("[data-base-url]")).toBeVisible();
    await form.locator("[name=baseUrl]").fill("http://localhost:11434/v1");
    await form.getByRole("button", { name: "모델 저장", exact: true }).click();
    await expect(root.locator(".ai-model-list")).toContainText("외부 모델");
    expect(writes[0].data.provider).toBe("compatible");
    await root
      .getByRole("button", { name: "연결 테스트", exact: true })
      .click();
    await expect(root.locator("[data-ai-message]")).toContainText(
      "AI_MODEL_AUTH_FAILED",
    );
    testFails = false;
    await root
      .getByRole("button", { name: "연결 테스트", exact: true })
      .click();
    await expect(root.locator("[data-ai-message]")).toContainText("연결 성공");
    await root.getByRole("button", { name: "수정", exact: true }).click();
    await expect(form.locator("[name=apiKey]")).toHaveValue("");
    await form.locator("[name=name]").fill("수정한 모델");
    await form.getByRole("button", { name: "모델 저장", exact: true }).click();
    await expect(root.locator(".ai-model-list")).toContainText("수정한 모델");
    expect(writes[1].data.apiKey).toBeUndefined();
    const create = root.locator("[data-ai-form=create-player]");
    await create
      .locator("[name=username]")
      .fill("<img src=x onerror=alert(1)>");
    await expect(create.locator("[name=modelId]")).toHaveValue(
      "111111111111111111111111",
    );
    await create
      .locator("[name=modelId]")
      .selectOption("111111111111111111111111");
    await create.locator("[name=count]").fill("3");
    await create.locator("[name=score-development]").fill("50");
    await create
      .getByRole("button", { name: "플레이어 생성", exact: true })
      .click();
    await expect(root.locator("[data-ai-message]")).toContainText("합계를 100");
    expect(writes).toHaveLength(2);
    await create.locator("[name=score-expansion]").fill("30");
    await create.locator("[name=galaxy]").selectOption("7");
    await create
      .getByRole("button", { name: "플레이어 생성", exact: true })
      .click();
    await expect(root.locator(".ai-player-list .ai-card")).toHaveCount(1);
    await expect(root.locator(".ai-player-list img")).toHaveCount(0);
    expect(writes[2].data.galaxy).toBe(7);
    expect(writes[2].data.count).toBe(3);
    expect(writes[2].data.randomPlacement).toBe(true);
    expect(writes[2].data.behaviorScores).toEqual({
      development: 50,
      expansion: 30,
      attack: 20,
    });
    expect(writes[2].data.allowAttacks).toBe(false);
    expect(writes[2].data.proposeImprovements).toBe(true);
    await expect(
      root.locator("[data-ai-form=player] [name=proposeImprovements]"),
    ).toBeChecked();
    await root.getByRole("button", { name: "즉시 중지", exact: true }).click();
    await expect(
      root.getByRole("button", { name: "시작", exact: true }),
    ).toBeVisible();
    expect(writes[3].data.enabled).toBe(false);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [320, 740],
    ]) {
      await page.setViewportSize({ width, height });
      await root.locator("[data-ai-form=player]").scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
}
