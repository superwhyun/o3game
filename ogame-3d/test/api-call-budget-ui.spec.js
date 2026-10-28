import { test, expect } from "@playwright/test";
async function setup(page) {
  let catalogUrl;
  const counts = {};
  page.on("response", (r) => {
    if (/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url())) catalogUrl = r.url();
  });
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    counts[path] = (counts[path] || 0) + 1;
    let json = {};
    if (path === "/api/auth/check-admin") json = { hasAdmin: true };
    if (path === "/api/game/reports") json = { reports: [], unreadCount: 0 };
    if (path === "/api/game/scout-reports") json = { reports: [] };
    if (path === "/api/game/scout-alerts") json = { alerts: [] };
    if (path === "/api/game/galaxy/traffic")
      json = { routes: [], movements: [] };
    if (path === "/api/game/galaxy")
      json = {
        positions: Array.from({ length: 15 }, (_, i) => ({
          position: i + 1,
          occupied: false,
          scouted: true,
        })),
      };
    if (path.includes("/api/queue/check/"))
      return r.fulfill({
        status: 503,
        json: { error: "temporarily unavailable", code: "SERVICE_UNAVAILABLE" },
      });
    return r.fulfill({ json });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(async (url) => {
    const { catalog } = await import(url);
    catalog.hydrate({ entities: [] });
    const ui = window.uiManager,
      c = ui.getScoutController();
    c.api.setToken("call-budget-test");
    c.state.userId = "budget-user";
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("ui-layer").classList.remove("hidden");
    window.auditTime = Date.now();
    window.realNow = Date.now;
    Date.now = () => window.auditTime;
  }, catalogUrl);
  return counts;
}
test("steady galaxy and fleet polling share user state and respect per-minute request budgets", async ({
  page,
}) => {
  const counts = await setup(page);
  await page.evaluate(async () => {
    const ui = window.uiManager;
    ui.currentView = "galaxy";
    ui.renderGalaxy();
    await ui.galaxyLoad;
    ui.galaxyView.select(9);
    ui.galaxyView.chart.stop();
    await ui.syncMilitaryState();
  });
  const before = { ...counts };
  for (let i = 1; i <= 4; i++)
    await page.evaluate(async (step) => {
      window.auditTime += 15001;
      await window.uiManager.syncMilitaryState();
      if (step % 2 === 0)
        await window.uiManager.syncUserDataFromServer({ minAge: 30000 });
    }, i);
  const delta = Object.fromEntries(
    Object.entries(counts).map(([k, n]) => [k, n - (before[k] || 0)]),
  );
  expect(delta["/api/auth/me"]).toBe(4);
  expect(delta["/api/game/fleet-formations"] || 0).toBe(0);
  expect(delta["/api/game/reports"]).toBe(1);
  expect(delta["/api/game/scout-reports"]).toBe(4); // history + selected target, twice per minute
  expect(delta["/api/game/scout-alerts"]).toBe(2);
  expect(delta["/api/game/galaxy"]).toBe(2);
  expect(delta["/api/game/galaxy/traffic"]).toBe(4);
  expect(Object.values(delta).reduce((a, b) => a + b, 0)).toBe(17);
  const fleetBefore = { ...counts };
  await page.evaluate(() => {
    window.uiManager.currentView = "fleet";
  });
  for (let i = 0; i < 4; i++)
    await page.evaluate(async () => {
      window.auditTime += 15001;
      await window.uiManager.syncMilitaryState();
    });
  await expect
    .poll(() =>
      Object.entries(counts).reduce(
        (n, [k, v]) => n + v - (fleetBefore[k] || 0),
        0,
      ),
    )
    .toBe(5);
  const fleetDelta = Object.fromEntries(
    Object.entries(counts).map(([k, n]) => [k, n - (fleetBefore[k] || 0)]),
  );
  expect(Object.values(fleetDelta).reduce((a, b) => a + b, 0)).toBe(5);
  expect(fleetDelta["/api/game/scout-reports"]).toBe(0);
  const eventBefore = { ...counts };
  await page.evaluate(async () => {
    window.auditTime += 4000;
    await window.uiManager.syncMilitaryState({ event: true });
  });
  await expect
    .poll(
      () =>
        (counts["/api/game/reports"] || 0) -
        (eventBefore["/api/game/reports"] || 0),
    )
    .toBe(1);
  expect(counts["/api/auth/me"] - eventBefore["/api/auth/me"]).toBe(1);
  // Hidden tabs remember changes without querying; foreground resumes with one refresh.
  const hiddenBefore = Object.values(counts).reduce((a, b) => a + b, 0);
  await page.evaluate(async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    window.auditTime += 4000;
    await window.uiManager.syncMilitaryState({ event: true });
  });
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(hiddenBefore);
  expect(await page.evaluate(() => window.uiManager.militaryDirty)).toBe(true);
  await page.evaluate(() => {
    delete document.hidden;
  });
  const mapBefore = counts["/api/game/galaxy"];
  await page.evaluate(async () => {
    const ui = window.uiManager;
    ui.currentView = "galaxy";
    await ui.getScoutController().selectTarget({ ...ui.galaxyView.coords, planet:9 });
    ui.galaxyView.lastFetchAt = Date.now();
    await ui.syncMilitaryState();
  });
  expect(counts["/api/game/galaxy"]).toBe(mapBefore + 1);

  await page.evaluate(() => {
    Date.now = window.realNow;
  });
});
test("failed construction completion checks back off instead of retrying every second", async ({
  page,
}) => {
  const counts = await setup(page);
  await page.evaluate(() => {
    const ui = window.uiManager;
    ui.queueItems.building = {
      id: "111111111111111111111111",
      endTime: new Date(window.auditTime - 1).toISOString(),
      startTime: new Date(window.auditTime - 10000).toISOString(),
      duration: 10,
    };
  });
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      window.uiManager.updateLocalQueueDisplay();
    });
    await expect
      .poll(() =>
        page.evaluate(() => !!window.uiManager.queueItems.building.checking),
      )
      .toBe(false);
    await page.evaluate(() => {
      window.auditTime += 1000;
    });
  }
  expect(counts["/api/queue/check/111111111111111111111111"]).toBe(2);
  await page.evaluate(() => {
    Date.now = window.realNow;
  });
});

test("reopening admin does not multiply speed-change requests", async ({
  page,
}) => {
  const counts = await setup(page);
  await page.evaluate(() => {
    const ui = window.uiManager;
    // Tab loading is independent of event binding; this check exercises the real speed action.
    ui.loadAdminTabData = () => {};
    ui.initAdminPanel();
    ui.initAdminPanel();
    ui.initAdminPanel();
    document
      .querySelectorAll(".holo-panel")
      .forEach((p) => p.classList.add("hidden"));
    document.getElementById("admin-panel").classList.remove("hidden");
    document
      .querySelectorAll(".admin-tab-content")
      .forEach((p) => p.classList.remove("active"));
    document.getElementById("tab-dashboard").classList.add("active");
  });
  await page.locator(".speed-btn").first().click();
  await expect.poll(() => counts["/api/admin/speed"] || 0).toBe(1);
  await page.evaluate(() => {
    Date.now = window.realNow;
  });
});
