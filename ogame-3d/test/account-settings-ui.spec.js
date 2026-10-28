import { test, expect } from "@playwright/test";
test("user settings manage account details, persist three presentation modes with actual graphs, and control AI delegation on desktop and mobile", async ({
  page,
}) => {
  let uiMode = "detailed",
    email = "pilot@example.test",
    delegate = null,
    saved,
    passwordCalls = 0;
  const account = () => ({
    id: "test-player",
    username: "pilot",
    email,
    preferences: { uiMode },
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const body = method === "GET" ? {} : route.request().postDataJSON();
    let json;
    if (path === "/api/auth/check-admin") json = { hasAdmin: true };
    else if (path === "/api/account/settings" && method === "GET")
      json = {
        account: account(),
        delegation: delegate,
        worker: { configured: true, connected: true },
      };
    else if (path === "/api/account/settings") {
      uiMode = body.uiMode;
      json = { account: account() };
    } else if (path === "/api/account/ai-models")
      json = {
        models: [
          {
            id: "111111111111111111111111",
            name: "등록 Qwen",
            model: "qwen",
            isDefault: true,
          },
        ],
      };
    else if (path === "/api/account/email") {
      email = body.email;
      json = { account: account() };
    } else if (path === "/api/account/password") {
      passwordCalls++;
      json = { account: account(), token: "new-test-token" };
    } else if (path === "/api/account/delegation") {
      saved = body;
      delegate = {
        ...delegate,
        ...body,
        lastAction: "금속 광산 건설",
        lastReason: "에너지와 자원을 확인했습니다.",
        runs: 3,
        actions: 2,
        kind: "delegate",
      };
      json = { delegation: delegate };
    } else json = {};
    await route.fulfill({ json });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(() => {
    const ui = window.uiManager,
      s = window.gameState;
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("ui-layer").classList.remove("hidden");
    s.userId = "test-player";
    s.preferences = { uiMode: "detailed" };
    s.resources = {
      ...s.resources,
      metal: 500,
      crystal: 250,
      deuterium: 100,
      food: 40,
    };
    s.storage = { metal: 1000, crystal: 500, deuterium: 1000, food: 80 };
    s.productionRates = { metal: 100, crystal: 50, deuterium: 10, food: -5 };
    s.energyProduction = 60;
    s.energyConsumption = 80;
    s.planet = {
      ...s.planet,
      name: "본성",
      area: { used: 12, reserved: 3, usable: 100 },
      populationState: {
        count: 120,
        housing: 150,
        employed: 90,
        happiness: 80,
      },
    };
    ui.syncMilitarySocket = () => {};
    ui.syncUserDataFromServer = async () => {};
  });
  await page.locator("#account-settings-btn").click();
  const root = page.locator("#account-settings-content");
  await expect(root.getByRole("heading", { name: "화면 모드" })).toBeVisible();
  for (const mode of ["simple", "detailed", "graphics"]) {
    const form = root.locator("[data-settings-form=mode]");
    await form.locator(`input[value=${mode}]`).check();
    await form.locator("[type=submit]").click();
    await expect(page.locator("html")).toHaveAttribute("data-ui-mode", mode);
    await page.locator("[data-view=dashboard]").click();
    const graphics = page.locator("#mode-graphics");
    if (mode === "graphics") {
      await expect(graphics).toBeVisible();
      await expect(page.locator('#dashboard-panel .population-card')).toBeHidden();
      await expect(page.locator('#dashboard-panel .stats-card')).toBeHidden();
      await expect(page.locator('#dashboard-panel .fleet-card')).toBeVisible();
      await expect(graphics.locator("progress")).toHaveCount(10);
      await expect(graphics.locator("progress").first()).toHaveAttribute(
        "value",
        "500",
      );
      await expect(
        graphics.locator(".production-graph.is-negative"),
      ).toContainText("-5/h");
      await expect(
        graphics.locator('progress[aria-label="인구 / 주거"]'),
      ).toHaveAttribute("value", "120");
      await expect(
        graphics.locator('progress[aria-label="취업 인구"]'),
      ).toHaveAttribute("value", "90");
      await expect(graphics).toContainText("에너지 수지");
    } else {
      await expect(graphics).toBeHidden();
      await expect(page.locator('#dashboard-panel .population-card')).toBeVisible();
      await expect(page.locator('#dashboard-panel .stats-card')).toBeVisible();
    }
    if (mode === "simple")
      await expect(page.locator(".activity-card")).toBeHidden();
    else await expect(page.locator(".activity-card")).toBeVisible();
    await page.locator("#account-settings-btn").click();
    await expect(root.locator(`[name=uiMode][value=${mode}]`)).toBeChecked();
  }
  await root.getByRole("tab", {name:"AI 대리",exact:true}).click();
  await expect(root.locator("[data-settings-form=mode]")).toBeHidden();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const scroll = page.locator(".account-settings-scroll");
    await root.locator("[data-delegate-stop]").scrollIntoViewIfNeeded();
    expect(
      await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
  const delegation = root.locator("[data-settings-form=delegation]");
  await delegation.locator("[name=enabled]").check();
  await delegation.locator("[name=strategy]").selectOption("economy");
  await delegation.locator("[type=submit]").click();
  await expect.poll(() => saved?.enabled).toBe(true);
  expect(saved.modelId).toBe("111111111111111111111111");
  expect(saved.allowAttacks).toBe(false);
  expect(saved.proposeImprovements).toBe(true);
  await expect(root.locator(".delegation-status")).toContainText(
    "금속 광산 건설",
  );
  await root.locator("[data-delegate-stop]").click();
  await expect.poll(() => saved).toEqual({ enabled: false });
  await expect(delegation.locator("[data-settings-status]")).toHaveText(
    "AI 대리를 중지했습니다.",
  );
  await root.getByRole("tab", {name:"계정·화면",exact:true}).click();
  await expect(root.locator("[data-settings-form=delegation]")).toBeHidden();
  const mail = root.locator("[data-settings-form=email]");
  await mail.locator("[name=email]").fill("new@example.test");
  await mail.locator("[name=currentPassword]").fill("old-password");
  await mail.locator("[type=submit]").click();
  await expect(mail.locator("[data-settings-status]")).toHaveText(
    "저장했습니다.",
  );
  await expect(mail.locator("[name=currentPassword]")).toHaveValue("");
  const password = root.locator("[data-settings-form=password]");
  await password.locator("[name=currentPassword]").fill("old-password");
  await password.locator("[name=newPassword]").fill("new-password");
  await password.locator("[name=confirmPassword]").fill("mismatch");
  await password.locator("[type=submit]").click();
  await expect(password.locator("[role=alert]")).toContainText("일치하지");
  expect(passwordCalls).toBe(0);
  await password.locator("[name=confirmPassword]").fill("new-password");
  await password.locator("[type=submit]").click();
  await expect(password.locator("[data-settings-status]")).toContainText(
    "비밀번호를 변경했습니다",
  );
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBe(
    "new-test-token",
  );
  await expect(password.locator("[name=newPassword]")).toHaveValue("");
  await page.locator("[data-view=dashboard]").click();
  await page
    .locator("#mode-graphics .holo-card")
    .last()
    .scrollIntoViewIfNeeded();
  const rect = await page
    .locator("#mode-graphics .holo-card")
    .last()
    .boundingBox();
  expect(rect.y + rect.height).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('delegation status refresh keeps form edits and shows persisted run history', async ({page}) => {
  await page.route('**/api/auth/check-admin', r => r.fulfill({json:{hasAdmin:true}}));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager);
  await page.evaluate(async () => {
    const {AccountSettingsView}=await import('/src/ui/views/AccountSettingsView.js');
    document.body.innerHTML='<main id="settings" style="width:100%;max-width:800px;margin:auto"></main>';
    let calls=0;
    const api={token:'test',getDelegationModels:async()=>({models:[]}),getAccountSettings:async()=>({account:{username:'pilot',email:'pilot@example.test',preferences:{uiMode:'detailed'}},worker:{configured:true,connected:true},delegation:{enabled:true,runs:++calls,actions:1,nextRunAt:new Date(Date.now()-1000).toISOString(),lastAction:'다른 작업 재판단',history:[{runId:'run1',at:new Date().toISOString(),acted:true,action:'[2:1:8] 광산 건설',reason:'식민지 개발'},{runId:'run0',at:new Date().toISOString(),acted:false,recheck:true,action:'재판단 · 작업 완료',reason:'최신 상태 확인'}]}})};
    window.settingsCheck=new AccountSettingsView(document.getElementById('settings'),{api,onMode:()=>{},onToken:()=>{}});
    await window.settingsCheck.show();
  });
  await page.getByRole("tab",{name:"AI 대리",exact:true}).click();
  await expect(page.locator('.delegation-log')).toHaveCount(2);
  await expect(page.locator('.delegation-status')).toContainText('계속 실행');
  await page.getByRole('tab',{name:'계정·화면',exact:true}).click();
  const email=page.locator('[name=email]');
  await email.fill('unfinished@example.test');
  await page.getByRole('tab',{name:'AI 대리',exact:true}).click();
  await page.locator('.delegation-log').first().locator('summary').click();
  await page.evaluate(() => window.settingsCheck.refreshStatus());
  await expect(email).toHaveValue('unfinished@example.test');
  await expect(page.locator('.delegation-status')).toContainText('실행 2회');
  await expect(page.locator('.delegation-log').first()).toHaveAttribute('open','');
  await expect(page.locator('.delegation-history')).toContainText('재판단');
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
