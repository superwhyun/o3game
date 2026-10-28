import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mongoose = require("../../server/node_modules/mongoose");
const uri = process.env.FLEET_UI_MONGODB_URI;
test.skip(!uri, "Dedicated UI test DB required");
test.describe.configure({ mode: "serial" });
let fixture;
test.beforeAll(async () => {
  if (!/\/cosmic_fleet_ui_test(\?|$)/.test(uri))
    throw Error("Dedicated UI test DB required");
  execFileSync(process.execPath, ["server/scripts/seedFleetPreview.js"], {
    cwd: new URL("../../", import.meta.url),
    env: {
      ...process.env,
      FLEET_PREVIEW_URI: uri,
      JWT_SECRET: "isolated-fleet-preview-secret-not-for-production-2026",
    },
  });
  fixture = JSON.parse(readFileSync("/tmp/oogame-fleet-preview.json", "utf8"));
  await mongoose.connect(uri);
  const User = require("../../server/models/User");
  const Report = require("../../server/models/ScoutReport");
  await Report.createIndexes();
  await User.updateOne(
    { _id: fixture.user.id },
    {
      $set: {
        "planets.0.fleet.espionageProbe": 5,
        "planets.0.buildings.shipyard": 3,
        "planets.0.research.combustionDrive": 3,
        "planets.0.research.espionageTechnology": 5,
      },
    },
  );
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
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="8"]').press('Enter');
}
async function settle() {
  const Movement = require("../../server/models/FleetMovement");
  const service = require("../../server/services/FleetService");
  process.env.JWT_SECRET =
    "isolated-fleet-preview-secret-not-for-production-2026";
  await require("../../server/services/EntityConfigService").initialize();
  for (const m of await Movement.find({ mission: "spy", status: "flying" })) {
    await service.processMovement(m._id, new Date(+m.arrivalTime + 1));
  }
  for (const m of await Movement.find({
    mission: "spy",
    status: "returning",
  })) {
    await service.processMovement(m._id, new Date(+m.returnTime + 1));
  }
}
const imageDir = new URL("../../artifacts/fleet-ui/", import.meta.url).pathname;
test("three clicks, information report, return, empty orbit and reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.locator('.holo-btn[data-view="shipyard"]').click();
  await page.locator('[data-entity="espionageProbe"]').click();
  await page.locator("#shipyard-panel [data-command]").click();
  await expect
    .poll(async () =>
      mongoose.connection.db
        .collection("buildingqueues")
        .countDocuments({
          userId: new mongoose.Types.ObjectId(fixture.user.id),
          itemId: "espionageProbe",
        }),
    )
    .toBe(1);
  // Only this isolated fixture's build clock is advanced; the real build route and settlement run.
  await mongoose.connection.db
    .collection("buildingqueues")
    .updateMany(
      {
        userId: new mongoose.Types.ObjectId(fixture.user.id),
        itemId: "espionageProbe",
      },
      { $set: { endTime: new Date(Date.now() - 1000) } },
    );
  await page.reload();
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="8"]').press('Enter');
  await expect(page.locator("[data-scout-available]")).toHaveText("6");
  const origin = await mongoose.connection.db
    .collection("users")
    .findOne({ _id: new mongoose.Types.ObjectId(fixture.user.id) });
  expect(origin.planets[0].fleet.espionageProbe).toBe(6);
  // Hold launch responses so rapid clicks exercise optimistic inventory and independent request IDs.
  let handled = 0;
  await page.route("**/api/game/scouts", async (route) => {
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ response });
    handled++;
  });
  const launch = page.locator('[data-scout-action="launch"]');
  await launch.click();
  await launch.click();
  await launch.click();
  await expect
    .poll(async () =>
      mongoose.connection.db
        .collection("fleetmovements")
        .countDocuments({ mission: "spy" }),
    )
    .toBe(3);
  await expect.poll(() => handled).toBe(3);
  await page.unroute("**/api/game/scouts");
  await settle();
  await page.reload();
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="8"]').press('Enter');
  await expect(page.locator(".scout-panel .scout-report")).toBeVisible();
  await expect(page.locator(".scout-panel")).toContainText("정보 4단계");
  await expect(page.locator("[data-scout-available]")).toHaveText("6");
  await page.locator(".scout-panel summary").click();
  await expect(page.locator(".scout-panel")).toContainText("주둔 함선");
  await page.screenshot({ path: imageDir + "scout-desktop.png" });
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="9"]').press('Enter');
  await expect(page.locator(".scout-panel")).toContainText(
    "아직 관측한 정보가 없습니다.",
  );
  await page.locator('[data-scout-action="launch"]').click();
  await expect
    .poll(async () =>
      mongoose.connection.db
        .collection("fleetmovements")
        .countDocuments({ mission: "spy" }),
    )
    .toBe(4);
  await settle();
  await page.reload();
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="9"]').press('Enter');
  await expect(page.locator(".scout-panel")).toContainText("미점령 행성 · 개척 조사");
  await page.locator('.scout-panel details summary').first().click();
  await expect(page.locator('.scout-panel .scout-terrain')).toContainText('자연 상태 사용 불가');
  await page.locator('.holo-btn[data-view="combat"]').click();
  await page.locator("#scout-reports > summary").click();
  await expect(
    page.locator("#scout-reports-content .scout-report"),
  ).toHaveCount(4);
  expect(errors).toEqual([]);
});
test("mobile zero probes and committed lost response recover exactly once", async ({
  page,
}) => {
  page.on("response", (r) => {
    if (r.status() >= 400)
      console.log("HTTP failure", r.status(), new URL(r.url()).pathname);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.locator("[data-scout-available]")).toHaveText("6");
  let aborted = 0;
  await page.route("**/api/game/scouts", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
    aborted++;
  });
  await page.locator('[data-scout-action="launch"]').click();
  await expect
    .poll(async () =>
      mongoose.connection.db
        .collection("fleetmovements")
        .countDocuments({ mission: "spy" }),
    )
    .toBe(5);
  await expect.poll(() => aborted).toBe(1);
  await page.unroute("**/api/game/scouts");
  await page.reload();
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="8"]').press('Enter');
  await settle();
  await page.reload();
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="8"]').press('Enter');
  await expect(page.locator(".scout-panel .scout-report")).toBeVisible();
  await page.screenshot({ path: imageDir + "scout-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await mongoose.connection.db
      .collection("fleetmovements")
      .countDocuments({ mission: "spy" }),
  ).toBe(5);
  await mongoose.connection.db
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(fixture.user.id) },
      { $set: { "planets.0.fleet.espionageProbe": 0 } },
    );
  await page.reload();
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="8"]').press('Enter');
  await expect(page.locator('[data-scout-action="launch"]')).toBeDisabled();
  await expect(page.locator(".scout-panel")).toContainText(
    "정찰선을 먼저 건조",
  );
  await page.locator('#galaxy-holo .orbit-svg .slot[data-slot="4"]').press('Enter');
  await expect(page.locator(".scout-panel")).toContainText("아군 행성");
});
