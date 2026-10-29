import { test, expect } from "@playwright/test";
for (const width of [1440, 390]) {
  test(`planet abandonment requires name confirmation, shows API errors and keeps the last planet at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/auth/check-admin", (r) =>
      r.fulfill({ json: { hasAdmin: true } }),
    );
    await page.goto("/");
    await page.waitForFunction(() => window.uiManager?.hasAdmin);
    await page.evaluate(() => {
      const ui = window.uiManager,
        state = window.gameState;
      document.getElementById("auth-screen").classList.add("hidden");
      document.getElementById("ui-layer").classList.remove("hidden");
      state.userId = "abandon-player";
      state.planets = [
        {
          _id: "111111111111111111111111",
          name: "포기할 별",
          galaxy: 1,
          system: 1,
          planet: 7,
        },
        {
          _id: "222222222222222222222222",
          name: "새 거점",
          galaxy: 2,
          system: 10,
          planet: 3,
        },
      ];
      state.currentPlanet = 0;
      state.planet = {
        ...state.planet,
        id: state.planets[0]._id,
        ...state.planets[0],
        area: {
          usablePercent: 40,
          available: 100,
          reserved: 0,
          used: 0,
          total: 300,
          usable: 140,
        },
      };
      window.abandonCalls = [];
      window.abandonFailure = true;
      const api = ui.getScoutController().api;
      api.abandonPlanet = async (id, name) => {
        window.abandonCalls.push({ id, name });
        if (window.abandonFailure)
          throw Object.assign(Error("함대 귀환 후 다시 시도해 주세요."), {
            status: 409,
            code: "PLANET_BUSY",
          });
        return {
          abandonedPlanet:{pirateLevel:2},
          snapshot: {
            id: state.userId,
            currentPlanet: 0,
            planets: [
              {
                ...state.planets[1],
                buildings: {},
                research: {},
                fleet: {},
                defense: {},
                resources: {},
                area: state.planet.area,
              },
            ],
            research: { astrophysics: 3 },
            queueState: {
              all: [],
              queue: [],
              building: null,
              research: null,
              ship: null,
              defense: null,
            },
          },
        };
      };
      ui.showPlanetDevelopment();
    });
    await page.locator("#planet-abandon-open").click();
    const form = page.locator("#planet-abandon-form");
    await expect(page.locator(".planet-abandon")).toContainText(
      "되돌릴 수 없습니다",
    );
    await expect(page.locator(".planet-abandon")).toContainText("표준 병력과 시설로 전환");
    const submit = form.locator("[type=submit]");
    await expect(submit).toBeDisabled();
    await form.locator("input").fill("다른 별");
    await expect(submit).toBeDisabled();
    expect(await page.evaluate(() => window.abandonCalls.length)).toBe(0);
    await form.locator("input").fill("포기할 별");
    await expect(submit).toBeEnabled();
    expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.locator("#planet-abandon-cancel").click();
    expect(await page.evaluate(() => window.abandonCalls.length)).toBe(0);
    await page.evaluate(() => window.uiManager.showPlanetAbandon());
    await form.locator("input").fill("포기할 별");
    await submit.click();
    await expect(page.locator("#planet-abandon-error")).toContainText(
      "함대 귀환",
    );
    await expect(submit).toBeEnabled();
    await page.evaluate(() => {
      window.abandonFailure = false;
    });
    await submit.click();
    await expect(page.locator("#modal-overlay")).toBeHidden();
    expect(
      await page.evaluate(() => ({
        length: window.gameState.planets.length,
        name: window.gameState.planet.name,
        research: window.gameState.research.astrophysics,
      })),
    ).toEqual({ length: 1, name: "새 거점", research: 3 });
    expect(await page.evaluate(() => window.abandonCalls.at(-1))).toEqual({
      id: "111111111111111111111111",
      name: "포기할 별",
    });
    await page.evaluate(() => window.uiManager.showPlanetDevelopment());
    await expect(page.locator("#planet-abandon-open")).toBeDisabled();
  });
}
