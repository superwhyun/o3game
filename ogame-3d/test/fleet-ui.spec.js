import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mongoose = require("../../server/node_modules/mongoose");
test.describe.configure({ mode: "serial" });
const uri = process.env.FLEET_UI_MONGODB_URI;
const fixtureFile =
  process.env.FLEET_UI_FIXTURE_FILE || "/tmp/oogame-fleet-preview.json";
test.skip(
  !uri,
  "Run only against a dedicated cosmic_fleet_ui_test database and isolated servers.",
);
const artifacts = new URL("../../artifacts/fleet-ui/", import.meta.url)
  .pathname;
let fixture;
test.beforeAll(async () => {
  if (!/\/cosmic_fleet_ui_test(\?|$)/.test(uri))
    throw new Error("Dedicated UI test DB required");
  execFileSync(process.execPath, ["server/scripts/seedFleetPreview.js"], {
    cwd: new URL("../../", import.meta.url),
    env: {
      ...process.env,
      FLEET_PREVIEW_URI: uri,
      JWT_SECRET: "isolated-fleet-preview-secret-not-for-production-2026",
    },
  });
  fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
  await mongoose.connect(uri);
});
test.afterAll(async () => {
  await mongoose.disconnect();
});
async function login(page) {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
  }, fixture);
  await page.goto("/");
  await page.locator('.holo-btn[data-view="fleet"]').click();
}
async function quantity(page, id, value) {
  const input = page.locator(`[data-quantity="${id}"]`);
  await input.fill(String(value));
  await input.dispatchEvent("change");
}
async function save(page) {
  await page.locator('[data-action="save"]').click();
  await expect(page.locator(".draft-state")).toHaveText(
    "편성이 저장되었습니다.",
  );
}
async function fastArrival() {
  const Movement = require("../../server/models/FleetMovement");
  const now = Date.now();
  await Movement.updateMany(
    { status: "flying" },
    {
      $set: {
        startTime: new Date(now - 2500),
        arrivalTime: new Date(now - 500),
      },
    },
  );
}

test("two visual formations, drag launch, reload, server return, dirty draft and keyboard controls", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.locator('[data-action="create"]').first().click();
  await expect(page.locator("[data-formation]")).toHaveCount(1);
  await quantity(page, "lightFighter", 40);
  await quantity(page, "cruiser", 5);
  await save(page);
  await page.locator('[data-action="create"]').first().click();
  await expect(page.locator("[data-formation]")).toHaveCount(2);
  await quantity(page, "lightFighter", 20);
  await quantity(page, "battleship", 3);
  await save(page);
  await expect(
    page.locator('[data-fleet-thumb="lightFighter"]').first(),
  ).toHaveAttribute("src", /^data:image/);
  await page.screenshot({ path: artifacts + "hangar-desktop.png" });
  // Polling updates must preserve the user's unsaved quantities/name.
  await page.locator("[data-name]").fill("제2 기동함대");
  await quantity(page, "lightFighter", 21);
  await page.evaluate(() => window.uiManager.syncMilitaryState());
  await expect(page.locator("[data-name]")).toHaveValue("제2 기동함대");
  await expect(page.locator('[data-quantity="lightFighter"]')).toHaveValue(
    "21",
  );
  await page.locator('.holo-btn[data-view="combat"]').click();
  await expect(page.locator(".fleet-unsaved")).toBeVisible();
  await page.locator('[data-action="stay"]').click();
  await expect(page.locator("#fleet-panel")).toBeVisible();
  await page.locator('[data-action="reset"]').click();
  await page.locator('.holo-btn[data-view="combat"]').click();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(2);
  await page.waitForFunction(
    () => window.uiManager.strikeMap.positions.length === 15,
  );
  await page.screenshot({ path: artifacts + "combat-desktop.png" });
  const first = page.locator("[data-combat-fleet]").first();
  const id = await first.getAttribute("data-combat-fleet");
  const card = await first.boundingBox();
  const target = await page
    .locator('.orbit-host [data-slot="8"]')
    .boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
  await expect(page.locator('[data-confirm="launch"]')).toBeEnabled();
  await expect(page.locator(".strike-confirm")).toContainText("1함대");
  await page.locator('[data-confirm="launch"]').click();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(1);
  await expect(page.locator("[data-movement]")).toHaveCount(1);
  await expect(page.locator(`[data-combat-fleet="${id}"]`)).toHaveCount(0);
  await page.locator("[data-movement]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: artifacts + "mission-desktop.png" });
  await page.reload();
  await page.locator('.holo-btn[data-view="combat"]').click();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(1);
  await expect(page.locator("[data-movement]")).toHaveCount(1);
  // Only the isolated fixture clock advances; actual travel formula stays unchanged.
  await fastArrival();
  await expect(page.locator("[data-movement]")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(2);
  await page.locator("[data-combat-fleet]").first().focus();
  await page.keyboard.press("Enter");
  await page.locator('.orbit-host [data-slot="8"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-confirm="launch"]')).toBeEnabled();
  await page.locator('[data-confirm="cancel"]').click();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(2);
  await page.screenshot({ path: artifacts + "returned-desktop.png" });
  expect(errors).toEqual([]);
});

test("response lost after commit recovers the same mission without a second launch", async ({
  page,
}) => {
  await login(page);
  await page.locator('.holo-btn[data-view="combat"]').click();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(2);
  const api = process.env.FLEET_UI_API_URL || "http://localhost:3999";
  let lost = false;
  await page.route(api + "/api/game/fleets", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page.locator("[data-combat-fleet]").first().click();
  await page.locator('.orbit-host [data-slot="8"]').focus();
  await page.keyboard.press("Enter");
  await page.locator('[data-confirm="launch"]').click();
  await expect(page.locator("[data-movement]")).toHaveCount(1, {
    timeout: 15000,
  });
  const Movement = require("../../server/models/FleetMovement");
  expect(
    await Movement.countDocuments({ status: { $in: ["flying", "returning"] } }),
  ).toBe(1);
  await fastArrival();
  await expect(page.locator("[data-movement]")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(2);
});

test("390px touch composition, target selection, cancel and mission feedback", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    baseURL: process.env.FLEET_UI_BASE_URL || "http://localhost:5179",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator("[data-formation]")).toHaveCount(2);
  await page.screenshot({ path: artifacts + "hangar-mobile.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator('.holo-btn[data-view="combat"]').tap();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(2);
  await page.screenshot({ path: artifacts + "combat-mobile.png" });
  await page.locator("[data-combat-fleet]").first().tap();
  // Real Chrome touch input exercises Pointer Events and edge scrolling.
  const token = page.locator("[data-combat-fleet]").first();
  await token.scrollIntoViewIfNeeded();
  const tokenBox = await token.boundingBox();
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  const x = Math.round(tokenBox.x + tokenBox.width / 2);
  const y = Math.round(tokenBox.y + Math.min(tokenBox.height / 2, 60));
  await touch("touchStart", x, y);
  await expect
    .poll(() => page.evaluate(() => Boolean(window.uiManager.strikeMap.drag)))
    .toBe(true);
  await touch("touchMove", x, 235);
  await page.waitForTimeout(1400);
  const drop = await page.evaluate(() =>
    window.uiManager.strikeMap.chart.slotCenter(8),
  );
  await touch("touchMove", drop.x, drop.y);
  await touch("touchEnd", drop.x, drop.y);
  await expect(page.locator('[data-confirm="launch"]')).toBeEnabled();
  await page.screenshot({ path: artifacts + "touch-confirm-mobile.png" });
  await page.locator('[data-confirm="cancel"]').tap();
  // Touch can choose a card, then a planet without dragging.
  await page.locator('.orbit-host [data-slot="8"]').scrollIntoViewIfNeeded();
  await page.locator('.orbit-host [data-slot="8"]').tap();
  await expect(page.locator('[data-confirm="launch"]')).toBeEnabled();
  await page.locator('[data-confirm="cancel"]').tap();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(2);
  await page.locator("[data-combat-fleet]").first().tap();
  await page.locator('.orbit-host [data-slot="8"]').tap();
  await page.locator('[data-confirm="launch"]').tap();
  await expect(page.locator("[data-combat-fleet]")).toHaveCount(1);
  await page.locator("[data-movement]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: artifacts + "mission-mobile.png" });
  await fastArrival();
  await expect(page.locator("[data-movement]")).toHaveCount(0, {
    timeout: 30000,
  });
  expect(errors).toEqual([]);
  await context.close();
});

test("multi-tab updates preserve a dirty draft and expose revision conflicts", async ({
  context,
}) => {
  const first = await context.newPage(),
    second = await context.newPage();
  await login(first);
  await login(second);
  await first.locator("[data-formation]").nth(1).click();
  await second.locator("[data-formation]").nth(1).click();
  await first.locator("[data-name]").fill("저장 전 초안");
  await second.locator("[data-name]").fill("제2 기동함대");
  await save(second);
  await expect(first.locator(".draft-state")).toContainText(
    "서버 편성이 변경",
    { timeout: 15000 },
  );
  await expect(first.locator("[data-name]")).toHaveValue("저장 전 초안");
  await expect(first.locator('[data-action="save"]')).toBeDisabled();
  await first.locator('[data-action="reset"]').click();
  await expect(first.locator("[data-name]")).toHaveValue("제2 기동함대");
  await first.locator("[data-name]").fill("2함대");
  await save(first);
  await expect(second.locator("[data-name]")).toHaveValue("2함대", {
    timeout: 15000,
  });
  await first.close();
  await second.close();
});

test('colony fleet drag onto unclaimed planet creates colony and consumes one colony ship', async ({ page }) => {
  execFileSync(process.execPath, ['server/scripts/seedFleetPreview.js'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, FLEET_PREVIEW_URI: uri, JWT_SECRET: 'isolated-fleet-preview-secret-not-for-production-2026' },
  });
  fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  const User = require('../../server/models/User');
  await User.updateOne({ _id: fixture.user.id }, { $set: { 'planets.0.fleet.colonyShip': 2 } });
  await login(page);
  await page.locator('[data-action="create"]').first().click();
  await quantity(page, 'colonyShip', 2);
  await save(page);
  await page.locator('.holo-btn[data-view="combat"]').click();
  await page.waitForFunction(() => window.uiManager.strikeMap.positions.length === 15);
  const card = await page.locator('[data-combat-fleet]').boundingBox();
  const target = await page.locator('.orbit-host [data-slot="9"]').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('[name="mission"]')).toHaveValue('colonize');
  await page.locator('[data-confirm="launch"]').click();
  await expect(page.locator('[data-combat-fleet]')).toHaveCount(0);
  await expect(page.locator('[data-movement]')).toContainText('식민지 개척');
  await fastArrival();
  await expect.poll(async () => (await User.findById(fixture.user.id)).planets.length, { timeout: 30000 }).toBe(2);
  await expect(page.locator('[data-movement]')).toHaveCount(0, { timeout: 30000 });
  const user = await User.findById(fixture.user.id);
  expect(user.planets[0].fleet.colonyShip).toBe(1);
  expect(user.planets[1].planet).toBe(9);
  await page.reload();
  await expect(page.locator('#planet-select option')).toHaveCount(2);
});
