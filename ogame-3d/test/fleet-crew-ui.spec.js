import { test, expect } from "@playwright/test";
test("fleet editor shows crew transfer and upkeep previews, saves reduced crews and stays usable on mobile", async ({
  page,
}) => {
  let catalogUrl;
  page.on("response", (r) => {
    if (/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url())) catalogUrl = r.url();
  });
  await page.route("**/api/auth/check-admin", (r) =>
    r.fulfill({ json: { hasAdmin: true } }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(async (url) => {
    const { catalog } = await import(url);
    catalog.hydrate({
      entities: [
        {
          entityType: "ship",
          entityId: "lightFighter",
          display: { name: "경전투기" },
          stats: {
            crew: 1,
            upkeep: { metal: 0.1, deuterium: 0.05 },
            speed: 12500,
            cargo: 50,
            attack: 50,
            hull: 4000,
            shield: 10,
          },
        },
      ],
    });
    const s = window.gameState,
      ui = window.uiManager;
    document.querySelector("#auth-screen").classList.add("hidden");
    document.querySelector("#ui-layer").classList.remove("hidden");
    s.userId = "crew-ui";
    s.serverSpeed = 1;
    const planet = {
      _id: "111111111111111111111111",
      name: "본성",
      population: { count: 88 },
      populationState: {
        count: 88,
        foodConsumption: 100,
        fleetFoodConsumption: 12,
      },
      fleet: { lightFighter: 200 },
      fleetSupport: { crew: 12, shortages: [] },
    };
    s.planets = [planet];
    s.planet = { ...s.planet, id: planet._id, name: planet.name };
    s.fleet = planet.fleet;
    s.fleetFormations = [
      {
        id: "222222222222222222222222",
        number: 1,
        name: "1함대",
        originPlanetId: planet._id,
        status: "ready",
        ships: { lightFighter: 200 },
        crew: 12,
        requiredCrew: 12,
        revision: 1,
        upkeep: { food: 12, metal: 20, deuterium: 10 },
      },
    ];
    s.fleetMovements = [];
    ui.syncMilitarySocket = () => {};
    ui.switchView("fleet");
    ui.formationView.save = async (_id, input) => {
      const f = s.fleetFormations[0];
      const required = input.ships.lightFighter > 0 ? 10 + Math.floor(input.ships.lightFighter / 100) : 0;
      planet.population.count += f.crew - required;
      f.ships = input.ships;
      f.crew = required;
      f.requiredCrew = f.crew;
      f.upkeep = {
        food: f.crew,
        metal: input.ships.lightFighter * 0.1,
        deuterium: input.ships.lightFighter * 0.05,
      };
      f.revision++;
      return {};
    };
  }, catalogUrl);
  const editor = page.locator(".formation-editor");
  await expect(editor).toContainText("배치 승무원 12명 / 편성 필요 12명");
  await expect(editor).toContainText("행성에서 배치 가능 88명");
  await expect(editor.locator(".formation-specs").first()).toContainText(
    "시간당 유지비: 식량 12 · 금속 20 · 중수소 10",
  );
  await expect(
    editor.locator("p.fleet-notice").filter({ hasText: "시간당 유지비" }),
  ).toHaveCount(0);
  await expect(editor).toContainText('기본 10명 + 함선 100척당 1명');
  expect(await page.locator('.holo-resources > [data-resource]').evaluateAll(els => els.map(el => el.dataset.resource))).toEqual(['metal', 'crystal', 'deuterium', 'food', 'energy', 'population']);
  await editor.locator("[data-quantity=lightFighter]").fill("100");
  await editor.locator("[data-quantity=lightFighter]").dispatchEvent("change");
  await expect(editor).toContainText("편성 필요 11명");
  await editor.locator("[data-quantity=lightFighter]").fill("99");
  await editor.locator("[data-quantity=lightFighter]").dispatchEvent("change");
  await expect(editor).toContainText("편성 필요 10명");
  await editor.locator("[data-quantity=lightFighter]").fill("10");
  await editor.locator("[data-quantity=lightFighter]").dispatchEvent("change");
  await expect(editor).toContainText("편성 필요 10명");
  await expect(editor).toContainText(
    "시간당 유지비: 식량 10 · 금속 1 · 중수소 0.5",
  );
  await editor.locator("[data-action=save]").click();
  await expect(editor).toContainText("배치 승무원 10명 / 편성 필요 10명");
  await expect(editor).toContainText("행성에서 배치 가능 90명");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await editor.locator("[data-action=delete]").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(editor.locator("[data-action=delete]")).toBeVisible();
  }
  await page.evaluate(() => {
    const s = window.gameState,
      ui = window.uiManager;
    s.fleetFormations[0].crew = 5;
    s.planets[0].fleetSupport.shortages = ["food"];
    ui.formationView.render(true);
  });
  await expect(editor).toContainText("보급 부족");
  await expect(editor.locator("[data-action=save]")).toBeEnabled();
});
