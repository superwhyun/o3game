import { test, expect } from "@playwright/test";
test("user management opens fresh per-planet details and preserves global research on mobile", async ({
  page,
}) => {
  const id = "111111111111111111111111";
  let detailCalls = 0;
  const sample = {
    _id: id,
    username: '<img src=x onerror="window.injected=true">',
    email: "bot@test.invalid",
    isAiPlayer: true,
    gameCatalog: {
      entities: [
        {
          entityType: "building",
          entityId: "metalMine",
          display: { name: "금속 광산" },
        },
        {
          entityType: "building",
          entityId: "housing",
          display: { name: "주거시설" },
        },
        {
          entityType: "research",
          entityId: "energyTechnology",
          display: { name: "에너지 기술" },
        },
        {
          entityType: "ship",
          entityId: "lightFighter",
          display: { name: "경전투기" },
        },
        {
          entityType: "ship",
          entityId: "smallCargo",
          display: { name: "소형 수송선" },
        },
      ],
    },
    gameSnapshot: {
      currentPlanet: 0,
      serverTime: new Date().toISOString(),
      research: { energyTechnology: 3 },
      fleetFormations: [
        {
          name: "제1함대",
          originPlanetId: "home",
          status: "ready",
          ships: { lightFighter: 2 },
        },
      ],
      fleetMovements: [],
      queueState: {
        all: [
          {
            type: "building",
            planetId: "1",
            itemId: "housing",
            name: "주거시설",
            level: 3,
            status: "building",
            endTime: new Date(Date.now() + 3600000).toISOString(),
          },
          {
            type: "research",
            planetId: "0",
            name: "에너지 기술",
            itemId: "energyTechnology",
            level: 4,
            status: "building",
            endTime: new Date(Date.now() + 3600000).toISOString(),
          },
        ],
      },
      planets: [
        {
          _id: "home",
          name: "본성",
          galaxy: 1,
          system: 1,
          planet: 7,
          resources: { metal: 428.214, crystal: 300, deuterium: 70, food: 600 },
          production: {
            metal: 6000,
            crystal: 3000,
            deuterium: 1000,
            food: -10,
          },
          storage: {
            metal: 20000,
            crystal: 20000,
            deuterium: 20000,
            food: 1000,
          },
          energyState: { production: 100, consumption: 150, balance: -50 },
          area: { used: 10, usable: 100, available: 88, reserved: 2 },
          populationState: {
            count: 30,
            housing: 40,
            employed: 20,
            unemployed: 10,
            happiness: 60,
            stability: 55,
            foodNet: -10,
            growthAllowed: false,
            growthBlockers: ["식량 공급 부족"],
          },
          buildings: { metalMine: 8 },
          fleet: { lightFighter: 5 },
          unassignedShips: { lightFighter: 3 },
          defense: {},
        },
        {
          _id: "colony",
          name: "두 번째 행성",
          galaxy: 2,
          system: 1,
          planet: 15,
          resources: { metal: 800 },
          production: { metal: 3000 },
          storage: { metal: 10000 },
          buildings: { housing: 2 },
          fleet: { smallCargo: 3 },
          unassignedShips: { smallCargo: 3 },
          populationState: { count: 10, housing: 30 },
          area: { used: 2, usable: 100, available: 97, reserved: 1 },
        },
      ],
    },
  };
  await page.route("**/api/auth/has-admin", (r) =>
    r.fulfill({ json: { hasAdmin: true } }),
  );
  await page.route("**/api/admin/users**", (r) => {
    if (
      r
        .request()
        .url()
        .endsWith("/" + id)
    ) {
      detailCalls++;
      return r.fulfill({ json: sample });
    }
    return r.fulfill({
      json: {
        users: [{ ...sample, planets: sample.gameSnapshot.planets }],
        pagination: { total: 1, page: 1, pages: 1, limit: 50 },
      },
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
  await page.evaluate(() => {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("ui-layer").classList.remove("hidden");
    document
      .querySelectorAll(".holo-panel")
      .forEach((e) => e.classList.add("hidden"));
    document.getElementById("admin-panel").classList.remove("hidden");
    document
      .querySelectorAll(".admin-tab-content")
      .forEach((e) => e.classList.remove("active"));
    document.getElementById("tab-users").classList.add("active");
    window.uiManager.loadUsers();
  });
  await expect(page.locator("#users-tbody .user-detail-link")).toHaveCount(1);
  await expect(page.locator("#users-tbody img")).toHaveCount(0);
  await page.locator("#users-tbody .user-detail-link").click();
  const root = page.locator(".admin-user-detail");
  await expect(root).toContainText("AI 봇");
  await expect(root.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(root).toContainText("에너지 수지");
  await expect(root).toContainText("-50");
  await expect(root).toContainText("금속 광산");
  await expect(root).toContainText("Lv.8");
  await expect(root).toContainText("경전투기");
  await expect(root).toContainText("식량 공급 부족");
  await expect(root.locator(".aud-resource-table")).toContainText("428");
  await root.locator("[data-detail-planet]").selectOption("1");
  await expect(root).toContainText("두 번째 행성");
  await expect(root).toContainText("소형 수송선");
  await expect(root).toContainText("주거시설 Lv.3");
  await expect(root).toContainText("에너지 기술");
  await expect(root).toContainText("Lv.3");
  await root.locator("[data-detail-refresh]").click();
  await expect.poll(() => detailCalls).toBe(2);
  await expect(root.locator("[data-detail-planet]")).toHaveValue("1");
  await expect(root.locator("[data-detail-refresh]")).toBeEnabled();
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await root.locator(".aud-section").last().scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".modal-close")).toBeVisible();
  }
  await page.evaluate((id) => window.uiManager.editUser(id), id);
  const editForm = page.locator("#admin-user-edit-form");
  await expect(editForm.locator('input[name="energy"]')).toHaveCount(0);
  await expect(editForm.locator("#admin-user-energy")).toHaveText("-50");
  let savedResources;
  await page.route(`**/api/admin/users/${id}`, (route) => {
    if (route.request().method() === "PUT") {
      savedResources = route.request().postDataJSON().resources;
      return route.fulfill({ json: { message: "updated" } });
    }
    return route.fallback();
  });
  await expect(editForm.locator('input[name="metal"]')).toHaveValue("429");
  await editForm.locator('#admin-user-planet').selectOption("1");
  await editForm.locator('#admin-user-planet').selectOption("0");
  await expect(editForm.locator('input[name="metal"]')).toHaveValue("429");
  expect(await editForm.evaluate(form => form.checkValidity())).toBe(true);
  await editForm.locator('[type="submit"]').click();
  await expect
    .poll(() => savedResources)
    .toEqual({ metal: 429, crystal: 300, deuterium: 70, food: 600 });
});
