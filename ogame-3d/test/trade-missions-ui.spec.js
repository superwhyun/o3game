import { test, expect } from '@playwright/test';

for (const width of [320, 390, 1440]) {
  test(`exchange shows net receipt, limits by storage, swaps and submits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/auth/check-admin', r => r.fulfill({ json: { hasAdmin: true } }));
    await page.goto('/');
    await page.waitForFunction(() => window.uiManager?.hasAdmin);
    await page.evaluate(() => {
      const state = window.gameState, ui = window.uiManager;
      Object.assign(state.resources, { metal: 1000, crystal: 0, deuterium: 400, food: 100 });
      Object.assign(state.storage, { metal: 2000, crystal: 100, deuterium: 1000 });
      Object.assign(state.planet, { id: 'trade-home', name: '지구', populationState: { foodCapacity: 200, count: 30, housing: 40, foodNet: 0, jobs: {}, happinessReasons: {}, growthAllowed: false, growthBlockers: [], support: {} } });
      state.exchange = { rates: { metal: 3, crystal: 2, deuterium: 1, food: 2 }, fee: .05 };
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('ui-layer').classList.remove('hidden');
      window.tradeRequests = [];
      state.syncFromServer = snapshot => Object.assign(state.resources, snapshot.resources);
      ui.getScoutController().api.exchangeResources = async (planetId, from, to, amount) => {
        window.tradeRequests.push({ planetId, from, to, amount });
        const received = Math.floor(amount / state.exchange.rates[from] * state.exchange.rates[to] * .95);
        state.resources[from] -= amount; state.resources[to] += received;
        return { quote: { received }, snapshot: { resources: { ...state.resources } } };
      };
      ui.switchView('trade');
    });
    const form = page.locator('#resource-trade-form');
    await expect(form.locator('.touch-number')).toHaveCount(0);
    await expect(form.locator('#trade-amount')).toHaveAttribute('max', '159');
    await form.locator('.exchange-max').click();
    await expect(form.locator('#trade-amount')).toHaveValue('159');
    await expect(form.locator('.exchange-received')).toHaveText('100');
    await expect(form.locator('[data-side=to] [data-after]')).toHaveText('교환 후 100');
    await form.locator('#trade-percentage').evaluate(el => { el.value = 50; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(form.locator('#trade-amount')).toHaveValue('79');
    await expect(form.locator('.exchange-received')).toHaveText('50');
    expect(await page.evaluate(() => document.activeElement?.id === 'trade-amount')).toBe(false);
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/o3game-exchange-${width}.png` });
    await form.locator('#trade-submit').click();
    await expect(form.locator('#trade-message')).toContainText('교환 완료');
    expect(await page.evaluate(() => window.tradeRequests)).toEqual([{ planetId: 'trade-home', from: 'metal', to: 'crystal', amount: 79 }]);
    await form.locator('.exchange-swap').click();
    await expect(form.locator('#trade-from')).toHaveValue('crystal');
    await expect(form.locator('#trade-to')).toHaveValue('metal');
    // Choosing the other side's resource automatically keeps the pair distinct.
    await form.locator('#trade-from').selectOption('metal');
    await expect(form.locator('#trade-to')).toHaveValue('crystal');
    await page.evaluate(() => { window.gameState.resources.crystal = 100; window.uiManager.renderTradeQuote(); });
    await expect(form.locator('#trade-submit')).toBeDisabled();
    await expect(form.locator('#trade-quote')).toContainText('저장고가 가득');
    await expect(form.locator('#trade-amount')).toHaveAttribute('max', '0');
  });
}

test('owned targets offer deployment/transport, foreign and pirate targets only attack, empty targets require a direct colony ship', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let catalogUrl;
  page.on('response', r => { if (/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url())) catalogUrl = r.url(); });
  await page.route('**/api/auth/check-admin', r => r.fulfill({ json: { hasAdmin: true } }));
  const positions = Array.from({ length: 15 }, (_, i) => ({ position: i + 1, occupied: false }));
  positions[3] = { position: 4, occupied: true, owner: 'self', planet: { id: 'colony', name: '제2행성' } };
  positions[6] = { position: 7, occupied: true, owner: 'self', planet: { id: 'home', name: '지구' } };
  positions[8] = { position: 9, occupied: true, owner: 'other', scouted: true, planet: { id: 'other', name: '외부행성' } };
  positions[12] = { position: 13, occupied: true, owner: 'other', scouted: true, planet: { id: 'pirate', name: '해적', isPirate: true, pirateLevel: 2 } };
  await page.route('**/api/game/galaxy?**', r => r.fulfill({ json: { positions } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(async ({ catalogUrl }) => {
    const { catalog } = await import(catalogUrl);
    catalog.hydrate({ revision: 1, entities: [
      { entityType: 'ship', entityId: 'smallCargo', display: { name: '소형 화물선' }, stats: { speed: 5000, cargo: 1000 } },
      { entityType: 'ship', entityId: 'colonyShip', display: { name: '식민선' }, stats: { speed: 2500, cargo: 1000 } },
    ] });
    const state = window.gameState;
    Object.assign(state.planet, { id: 'home', name: '지구', galaxy: 1, system: 1, planet: 7, populationState: { count: 30 } });
    Object.assign(state.resources, { metal: 1000, crystal: 400, deuterium: 50 });
    state.fleetFormations = [{ id: 'formation', name: '함대', revision: 1, crew: 1, requiredCrew: 1, status: 'ready', originPlanetId: 'home', ships: { smallCargo: 1, colonyShip: 1 } }];
    document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('ui-layer').classList.remove('hidden');
    window.uiManager.switchView('combat');
    window.missionOrders = [];
    window.uiManager.strikeMap.onLaunch = async order => window.missionOrders.push(order);
    await window.uiManager.strikeMap.show({ galaxy: 1, system: 1 });
  }, { catalogUrl });
  await page.locator('[data-combat-fleet=formation]').click();
  await page.locator('#strike-map [data-slot="4"]').press('Enter');
  const confirm = page.locator('#strike-map .strike-confirm');
  await expect(confirm.locator('.mission-choice label')).toHaveCount(2);
  await expect(confirm.locator('[value=deploy]')).toBeChecked();
  await expect(confirm.locator('.mission-explanation')).toContainText('목적지에 남습니다');
  await confirm.locator('[data-resource=metal] [data-percent="100"]').click();
  await confirm.locator('[data-confirm=launch]').click();
  expect(await page.evaluate(() => window.missionOrders[0].mission)).toBe('deploy');
  await page.evaluate(() => window.uiManager.strikeMap.openConfirm(4));
  await confirm.locator('.mission-choice label').filter({ hasText: '수송' }).click();
  await expect(confirm.locator('.mission-explanation')).toContainText('출발지로 돌아옵니다');
  await confirm.locator('[data-confirm=launch]').click();
  expect(await page.evaluate(() => window.missionOrders[1].mission)).toBe('transport');
  for (const slot of [9, 13]) {
    await page.evaluate(slot => window.uiManager.strikeMap.openConfirm(slot), slot);
    await expect(confirm.locator('.mission-choice')).toHaveCount(0);
    await expect(confirm.locator('[name=mission]')).toHaveValue('attack');
    await expect(confirm.locator('.combat-cargo')).toHaveCount(0);
    await confirm.locator('[data-confirm=launch]').click();
    expect(await page.evaluate(() => window.missionOrders.at(-1).mission)).toBe('attack');
    expect(await page.evaluate(() => window.missionOrders.at(-1).cargo)).toEqual({});
  }
  // Shortages stay visible and update while the confirmation is open.
  await page.evaluate(() => { window.gameState.planet.fleetSupport = { shortages: ['food'] }; window.uiManager.strikeMap.openConfirm(4); });
  await expect(confirm.locator('[data-confirm=launch]')).toBeEnabled();
  await expect(confirm).toContainText('기지 이동은 가능합니다');
  await confirm.locator('.mission-choice label').filter({ hasText: '수송' }).click();
  await expect(confirm.locator('[data-confirm=launch]')).toBeDisabled();
  await expect(confirm).toContainText('식량 고갈');
  await expect(confirm).not.toContainText('미편성');
  await page.evaluate(() => { window.gameState.planet.fleetSupport.shortages = []; window.uiManager.strikeMap.refresh(); });
  await expect(confirm.locator('[data-confirm=launch]')).toBeEnabled();
  await page.evaluate(() => window.uiManager.strikeMap.openConfirm(12));
  await expect(confirm).toContainText('성계도의 식민선 보내기');
  await expect(confirm.locator('[data-confirm=launch]')).toHaveCount(0);
  await expect(confirm.locator('[name=colonists]')).toHaveCount(0);
  await page.evaluate(() => window.uiManager.strikeMap.openConfirm(7));
  await expect(confirm).toContainText('출발지');
  await expect(confirm.locator('[data-confirm=launch]')).toHaveCount(0);
  // The roster belongs to the selected planet; active missions remain empire-wide.
  await page.evaluate(() => {
    const state = window.gameState;
    state.planets = [{ ...state.planet, _id: 'home', fleet: { smallCargo: 1, colonyShip: 1 } }, { _id: 'colony', name: '제2행성', galaxy: 1, system: 1, planet: 4, resources: { metal: 12, crystal: 0, deuterium: 0 }, fleet: { smallCargo: 1 }, populationState: { count: 20 }, fleetSupport: { shortages: [], crew: 1 } }];
    state.fleetFormations.push({ id: 'remote', name: '원격함대', revision: 1, crew: 1, requiredCrew: 1, status: 'ready', originPlanetId: 'colony', ships: { smallCargo: 1 } });
    window.uiManager.strikeMap.refresh();
  });
  await expect(page.locator('[data-combat-fleet]')).toHaveCount(1);
  await expect(page.locator('[data-combat-fleet=remote]')).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.gameState, ui = window.uiManager;
    state.fleetMovements = ['home', 'colony'].map((base, i) => ({ id: 'movement-' + i, formationName: '임무함대-' + base, status: i ? 'returning' : 'flying', mission: 'transport', fleet: { smallCargo: 1 }, origin: { galaxy: 1, system: 1, planet: i ? 4 : 7 }, destination: { galaxy: 1, system: 2, planet: 3 }, startTime: new Date().toISOString(), arrivalTime: new Date(Date.now() + 60000).toISOString(), returnTime: new Date(Date.now() + 120000).toISOString() }));
    ui.renderCombatMissions();
  });
  await expect(page.locator('#combat-missions [data-movement]')).toHaveCount(2);
  await page.evaluate(() => {
    const state = window.gameState;
    Object.assign(state.planet, state.planets[1], { id: 'colony' });
    Object.assign(state.resources, state.planets[1].resources);
    window.uiManager.strikeMap.refresh();
  });
  await expect(page.locator('[data-combat-fleet]')).toHaveCount(1);
  await expect(page.locator('[data-combat-fleet=formation]')).toHaveCount(0);
  await expect(page.locator('#combat-missions [data-movement]')).toHaveCount(2);
  await page.locator('[data-combat-fleet=remote]').click();
  await page.locator('#strike-map [data-slot="9"]').press('Enter');
  await expect(confirm).toContainText('출발 제2행성 [1:1:4]');
  await confirm.locator('[data-confirm=launch]').click();
  expect(await page.evaluate(() => window.missionOrders.at(-1).originPlanetId)).toBe('colony');
  await page.evaluate(() => window.uiManager.switchView('fleet'));
  await expect(page.locator('[data-formation]')).toHaveCount(1);
  await page.locator('[data-scope]').selectOption('all');
  await expect(page.locator('[data-formation]')).toHaveCount(2);
  await page.locator('[data-formation=remote]').click();
  await expect(page.locator('.formation-editor')).toContainText('제2행성');
  await page.evaluate(async () => {
    window.uiManager.switchView('combat');
    await window.uiManager.strikeMap.show({ galaxy: 2, system: 10 }, { targetSlot: 7 });
  });
  expect(await page.evaluate(() => {
    const map = window.uiManager.strikeMap;
    const chart = map.chart.svg.getBoundingClientRect();
    const origin = map.courseOrigin();
    const roster = map.squad.root.getBoundingClientRect();
    const host = map.chart.container.getBoundingClientRect();
    const confirmation = map.confirmEl.getBoundingClientRect();
    return roster.top >= host.bottom && roster.top - host.bottom <= 2
      && roster.bottom <= confirmation.top
      && origin.x >= chart.left && origin.x <= chart.right
      && origin.y >= chart.top && origin.y <= chart.bottom;
  })).toBe(true);
  await page.locator('#strike-map .orbit-host').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.uiManager.strikeMap.drawConfirmArrow());
  expect(await page.locator('.course-overlay').last().evaluate(el => el.style.clipPath)).toContain('inset(');
  await page.screenshot({ path: '/tmp/o3game-mobile-fleet-layout.png' });
  // Once the map scrolls away, its preview must not cross the fleet or form.
  await confirm.locator('[data-confirm=launch]').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.uiManager.strikeMap.drawConfirmArrow());
  await expect(page.locator('.course-overlay').last()).toBeHidden();
  // An empty origin roster must not clear an owned destination during polling.
  await page.evaluate(() => {
    window.gameState.fleetFormations = [];
    window.uiManager.switchView('combat');
    window.uiManager.strikeMap.openConfirm(7);
    window.uiManager.strikeMap.refresh();
  });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.mission-choice label')).toHaveCount(2);
  await expect(confirm.locator('[data-confirm=launch]')).toBeDisabled();
  expect(await page.evaluate(() => window.uiManager.strikeMap.target)).toBe(7);
});
