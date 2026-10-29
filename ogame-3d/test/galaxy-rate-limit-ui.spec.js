import { test, expect } from "@playwright/test";
async function ready(page) {
  await page.route("**/api/auth/has-admin", (r) =>
    r.fulfill({ json: { hasAdmin: true } }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
}
test("identical reads share one request and 429 honors Retry-After without request floods", async ({
  page,
}) => {
  let calls = 0,
    blocked = false;
  await page.route("**/api/game/galaxy?*", async (r) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await r.fulfill(
      blocked
        ? {
            status: 429,
            headers: { "Retry-After": "2" },
            json: { error: "요청이 너무 많습니다.", code: "RATE_LIMITED" },
          }
        : { json: { positions: [] } },
    );
  });
  await ready(page);
  await page.evaluate(async () => {
    const api = window.uiManager.getScoutController().api;
    api.setToken("rate-limit-test");
    await Promise.all(
      Array.from({ length: 10 }, () => api.getGalaxySystem(2, 300)),
    );
  });
  expect(calls).toBe(1);
  blocked = true;
  const errors = await page.evaluate(async () => {
    const api = window.uiManager.scouts.api,
      out = [];
    for (let i = 0; i < 6; i++)
      try {
        await api.getGalaxySystem(2, 301);
      } catch (e) {
        out.push({ status: e.status, code: e.code, retryAfter: e.retryAfter });
      }
    return out;
  });
  expect(calls).toBe(2);
  expect(errors).toHaveLength(6);
  expect(
    errors.every((e) => e.status === 429 && e.code === "RATE_LIMITED"),
  ).toBe(true);
  await page.evaluate(() => {
    window.uiManager.scouts.api.rateLimitedUntil = Date.now() - 1;
  });
  blocked = false;
  await page.evaluate(() =>
    window.uiManager.scouts.api.getGalaxySystem(2, 301),
  );
  expect(calls).toBe(3);
});
test("record target navigation fetches one system, repeat selection avoids extra reports, and rate failures preserve the chart", async ({
  page,
}) => {
  let galaxy = 0,
    reports = 0,
    blocked = false;
  const positions = Array.from({ length: 15 }, (_, i) => ({
    position: i + 1,
    occupied: false,
    scouted: true,
  }));
  await page.route("**/api/game/galaxy?*", (r) => {
    galaxy++;
    return r.fulfill(
      blocked
        ? {
            status: 429,
            headers: { "Retry-After": "5" },
            json: { error: "요청이 너무 많습니다.", code: "RATE_LIMITED" },
          }
        : { json: { positions } },
    );
  });
  await page.route("**/api/game/scout-reports?*", (r) => {
    reports++;
    return r.fulfill({ json: { reports: [], nextCursor: null } });
  });
  await page.route("**/api/game/scout-alerts?*", (r) =>
    r.fulfill({ json: { alerts: [], nextCursor: null } }),
  );
  await page.route("**/api/game/galaxy/traffic?*", (r) =>
    r.fulfill({ json: { routes: [], movements: [] } }),
  );
  await ready(page);
  await page.evaluate(async () => {
    const ui = window.uiManager,
      c = ui.getScoutController();
    c.api.setToken("navigation-test");
    c.state.userId = "test-user";
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("ui-layer").classList.remove("hidden");
    await ui.showGalaxyTarget({ galaxy: 2, system: 300, planet: 9 });
  });
  await expect(page.locator("#galaxy-holo .slot-detail")).toContainText(
    "[2:300:9]",
  );
  expect(galaxy).toBe(1);
  await expect.poll(() => reports).toBe(1);
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) window.uiManager.galaxyView.select(9);
  });
  expect(reports).toBe(1);
  blocked = true;
  await page.evaluate(() =>
    window.uiManager.galaxyView.show({ galaxy: 2, system: 300 }),
  );
  await expect(page.locator("#galaxy-holo .galaxy-error")).toContainText(
    "요청이 너무 많습니다",
  );
  await expect(page.locator("#galaxy-holo .slot-detail")).toContainText(
    "[2:300:9]",
  );
  expect(
    await page.locator('#galaxy-holo [data-slot="9"]').count(),
  ).toBeGreaterThan(0);
  expect(galaxy).toBe(2);
  await page.evaluate(() =>
    window.uiManager.galaxyView.show({ galaxy: 2, system: 300 }),
  );
  expect(galaxy).toBe(2);
});
