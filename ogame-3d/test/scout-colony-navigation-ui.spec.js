import { test, expect } from "@playwright/test";
test("scout coordinates select the galaxy target, direct colony needs no formation, and attack opens the selected target", async ({
  page,
}) => {
  let catalogUrl;
  page.on("response", (r) => {
    if (/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url())) catalogUrl = r.url();
  });
  await page.route("**/api/auth/has-admin", (r) =>
    r.fulfill({ json: { hasAdmin: true } }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(
    async ({ catalogUrl }) => {
      const { catalog } = await import(catalogUrl);
      catalog.hydrate({
        entities: ["colonyShip", "espionageProbe", "lightFighter"].map(
          (id) => ({
            entityType: "ship",
            entityId: id,
            display: { name: id },
            stats: {
              speed: id === "espionageProbe" ? 100000000 : 2500,
              cargo: 7500,
              hull: 1000,
              attack: 10,
              shield: 10,
            },
            cost: {},
          }),
        ),
      });
      const ui = window.uiManager,
        c = ui.getScoutController(),
        s = c.state,
        api = c.api;
      api.setToken("isolated-test-token");
      s.userId = "test-player";
      s.serverSpeed = 100;
      s.planet = {
        ...s.planet,
        id: "111111111111111111111111",
        name: "본성",
        galaxy: 1,
        system: 1,
        planet: 7,
        populationState: {
          count: 30,
          housing: 50,
          foodNet: 0,
          foodCapacity: 1000,
          foodProduction: 30,
          foodConsumption: 30,
          employed: 10,
          happiness: 70,
          jobs: {},
          happinessReasons: {},
          growthBlockers: [],
          support: {},
        },
      };
      s.resources = { metal: 10000, crystal: 5000, deuterium: 3000 };
      s.fleet = { colonyShip: 1, espionageProbe: 1 };
      s.unassignedShips = { ...s.fleet };
      s.fleetFormations = [];
      const destination = { galaxy: 2, system: 300, planet: 9 };
      const positions = Array.from({ length: 15 }, (_, i) => ({
        position: i + 1,
        occupied: false,
        scouted: true,
      }));
      positions[7] = {
        position: 8,
        occupied: true,
        scouted: true,
        owner: "other",
        planet: {
          id: "222222222222222222222222",
          name: "적 행성",
          username: "상대",
        },
      };
      api.getGalaxySystem = async () => ({ positions });
      api.getGalaxyTraffic = async () => ({
        routes: [],
        movements: [],
        nextCursor: null,
      });
      api.getScoutReports = async () => ({
        reports: [
          {
            id: "report1",
            destination,
            outcome: "empty",
            observedAt: new Date().toISOString(),
            initialProbeCount: 1,
            survivorCount: 1,
            sections: {},
          },
        ],
        nextCursor: null,
      });
      api.getScoutAlerts = async () => ({ alerts: [] });
      api.getCurrentUser = async () => ({});
      api.launchFleet = async (order) => {
        window.colonyOrder = order;
        return { fleet: { formationName: "식민선" }, snapshot: {} };
      };
      api.launchScout = async (order) => {
        window.scoutOrder = order;
        return { snapshot: {} };
      };
      document.getElementById("auth-screen").classList.add("hidden");
      document.getElementById("ui-layer").classList.remove("hidden");
      ui.switchView("scoutRecords");
    },
    { catalogUrl },
  );
  await page.locator("#scout-records-content [data-record-open]").click();
  await page.locator("#scout-records-content .scout-coordinate").click();
  await expect(page.locator("#galaxy-panel")).toBeVisible();
  await expect(page.locator("#galaxy-holo .slot-detail")).toContainText(
    "[2:300:9]",
  );
  await page.locator("#galaxy-holo [data-action=colonize]").click();
  await expect(page.locator(".direct-colony")).toContainText(
    "편성 없이 식민선 1척",
  );
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.locator(".direct-colony button[type=submit]"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.locator(".direct-colony [name=colonists]").fill("7");
  await page.locator(".direct-colony button[type=submit]").click();
  await expect
    .poll(() => page.evaluate(() => window.colonyOrder?.colonists))
    .toBe(7);
  const order = await page.evaluate(() => window.colonyOrder);
  expect(order.formationId).toBeUndefined();
  expect(order.destination).toEqual({ galaxy: 2, system: 300, planet: 9 });
  expect(order.requestId).toBeTruthy();
  await expect(page.locator(".holo-modal")).toHaveClass(/hidden/);
  await page.locator("#galaxy-holo [data-scout-action=launch]").click();
  await expect
    .poll(() => page.evaluate(() => window.scoutOrder?.destination))
    .toEqual({ galaxy: 2, system: 300, planet: 9 });
  await page.evaluate(() => window.uiManager.galaxyView.select(8));
  await page.locator("#galaxy-holo [data-action=target]").click();
  await expect(page.locator("#combat-panel")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.uiManager.strikeMap?.target))
    .toBe(8);
  expect(await page.evaluate(() => window.uiManager.strikeMap.coords)).toEqual({
    galaxy: 2,
    system: 300,
  });
});
