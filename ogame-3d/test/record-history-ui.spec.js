import { test, expect } from "@playwright/test";
for (const type of ["scout", "battle"]) {
  test(`${type} records have paginated lists, details, confirmed selective deletion and mobile layout`, async ({
    page,
  }) => {
    await page.route("**/api/auth/check-admin", (r) =>
      r.fulfill({ json: { hasAdmin: true } }),
    );
    await page.goto("/");
    await page.waitForFunction(() => window.uiManager?.hasAdmin);
    await page.evaluate(async (type) => {
      const { RecordHistoryView } = await import(
        "/src/ui/views/RecordHistoryView.js"
      );
      document.getElementById("auth-screen").classList.add("hidden");
      document.getElementById("ui-layer").classList.remove("hidden");
      const root = document.getElementById(
        type === "scout" ? "scout-records-content" : "battle-records-list",
      );
      const panel = root.closest(".holo-panel");
      document
        .querySelectorAll(".main-content > .holo-panel")
        .forEach((el) => el.classList.add("hidden"));
      panel.classList.remove("hidden");
      let rows = Array.from({ length: 23 }, (_, i) => ({
        id: String(i + 1).padStart(24, "0"),
        _id: String(i + 1).padStart(24, "0"),
        targetName: `행성 ${i + 1}`,
        destination: { galaxy: 2, system: 10, planet: 3 },
        observedAt: new Date().toISOString(),
        outcome: "occupied",
        informationTier: 2,
        sections: { resources: { metal: 12345 } },
        initialProbeCount: 1,
        survivorCount: 1,
        attacker: {
          userId: "test-user",
          coordinates: { galaxy: 1, system: 1, planet: 7 },
        },
        defender: {
          userId: "enemy",
          coordinates: { galaxy: 2, system: 10, planet: 3 },
        },
        formationName: `함대 ${i + 1}`,
        battleTime: new Date().toISOString(),
        result: {
          winner: "attacker",
          loot: { metal: 12345 },
          attackerLosses: {},
          defenderLosses: {},
          debrisField: {},
        },
      }));
      window.recordCalls = [];
      window.failDelete = false;
      const list = async (page, limit) => ({
        reports: rows.slice((page - 1) * limit, page * limit),
        pagination: {
          total: rows.length,
          totalPages: Math.max(1, Math.ceil(rows.length / limit)),
          page,
          limit,
        },
      });
      const api = {
        getScoutReports: (q) => list(q.page, q.limit),
        getBattleReportPage: list,
        deleteReports: async (type, ids) => {
          window.recordCalls.push(ids);
          if (window.failDelete) throw Error("삭제할 수 없습니다.");
          rows = rows.filter((r) => !ids.includes(r.id));
        },
        markScoutReportRead: async (id) => {
          window.readId = id;
        },
        markBattleReportRead: async (id) => {
          window.readId = id;
        },
      };
      window.recordView = new RecordHistoryView(root, {
        api,
        state: { userId: "test-user" },
        type,
        onCoordinate: (target) => {
          window.coordinateTarget = target;
        },
      });
      await window.recordView.show();
    }, type);
    const root = page.locator(
      type === "scout" ? "#scout-records-content" : "#battle-records-list",
    );
    await expect(root.locator(".record-row")).toHaveCount(20);
    await expect(root.locator(".record-detail")).toHaveCount(0);
    await expect(root.locator(".record-read-status.is-unread")).toHaveCount(20);
    await root.locator("[data-record-open]").first().click();
    await expect(root.locator(".record-detail")).toBeVisible();
    await expect(root.locator(".record-detail")).toContainText("12,345");
    if (type === "scout") {
      await root.locator("[data-scout-galaxy]").click();
      expect(await page.evaluate(() => window.coordinateTarget)).toEqual({
        galaxy: 2,
        system: 10,
        planet: 3,
      });
    } else
      await expect
        .poll(() => page.evaluate(() => window.readId))
        .toBe("000000000000000000000001");
    await expect(
      root.locator(".record-toolbar .record-read-status"),
    ).toHaveText("읽음");
    await expect(root.locator('[data-record-step="-1"]')).toBeDisabled();
    await root.locator('[data-record-step="1"]').click();
    await expect(root.locator(".record-detail")).toContainText(
      type === "scout" ? "행성 2" : "함대 2",
    );
    await expect
      .poll(() => page.evaluate(() => window.readId))
      .toBe("000000000000000000000002");
    await root.locator('[data-record-step="-1"]').click();
    await root.locator("[data-record-back]").click();
    await expect(root.locator(".record-row.is-read")).toHaveCount(2);
    // Navigation also crosses numbered page boundaries without returning to the list.
    await root.locator("[data-record-open]").last().click();
    await root.locator('[data-record-step="1"]').click();
    await expect(root.locator(".record-detail")).toContainText(
      type === "scout" ? "행성 21" : "함대 21",
    );
    await expect
      .poll(() => page.evaluate(() => window.recordView.page))
      .toBe(2);
    await root.locator('[data-record-step="-1"]').click();
    await expect(root.locator(".record-detail")).toContainText(
      type === "scout" ? "행성 20" : "함대 20",
    );
    await root.locator("[data-record-back]").click();

    await root.locator("[data-select-record]").first().check();
    await root.locator("[data-record-delete]").click();
    await expect(root.locator("[data-record-confirm]")).toBeVisible();
    expect(await page.evaluate(() => window.recordCalls.length)).toBe(0);
    await root.locator("[data-record-cancel]").click();
    await root.locator("[data-record-delete]").click();
    await page.evaluate(() => {
      window.failDelete = true;
    });
    await root.locator("[data-record-confirm]").click();
    await expect(root.locator("[role=status]")).toContainText(
      "삭제할 수 없습니다.",
    );
    await expect(root.locator(".record-row")).toHaveCount(20);
    await page.evaluate(() => {
      window.failDelete = false;
    });
    await root.locator("[data-record-confirm]").click();
    await expect(root.locator(".record-toolbar")).toContainText("총 22건");
    await root.locator('[data-record-page="2"]').first().click();
    await expect(root.locator(".record-row")).toHaveCount(2);
    await root.locator("[data-select-page]").check();
    await root.locator("[data-record-delete]").click();
    await root.locator("[data-record-confirm]").click();
    await expect(root.locator(".record-toolbar")).toContainText("총 20건");
    await expect(root.locator("[aria-current=page]")).toHaveText("1");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(root.locator(".record-row")).toHaveCount(20);
      expect(
        await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      const layout = await root
        .locator(".record-open")
        .first()
        .evaluate((el) => {
          const children = [...el.children].map((child) =>
            child.getBoundingClientRect(),
          );
          return {
            height: el.getBoundingClientRect().height,
            centers: children.map((rect) => rect.y + rect.height / 2),
          };
        });
      expect(layout.height).toBeLessThanOrEqual(44);
      expect(
        Math.max(...layout.centers) - Math.min(...layout.centers),
      ).toBeLessThanOrEqual(1);
    }
  });
}
test("desktop notifications are single, compact and dismissible; mobile notifications are suppressed", async ({
  page,
}) => {
  await page.route("**/api/auth/check-admin", (r) =>
    r.fulfill({ json: { hasAdmin: true } }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(() => {
    window.uiManager.showNotification("첫 알림", "내용", "info");
    window.uiManager.showNotification(
      "두 번째",
      "아주 긴 내용 ".repeat(40),
      "error",
    );
  });
  const notices = page.locator(".holo-notification");
  await expect(notices).toHaveCount(1);
  const bounds = await notices.boundingBox();
  expect(bounds.height).toBeLessThan(90);
  expect(bounds.width).toBeLessThanOrEqual(280);
  await page.getByRole("button", { name: "알림 닫기" }).click();
  await expect(notices).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.uiManager.showNotification("모바일", "가리지 않음"),
  );
  await expect(notices).toHaveCount(0);
});
