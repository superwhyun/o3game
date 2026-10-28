import { test, expect } from '@playwright/test';
async function cargoPercent(root, id, percent) {
  await root.locator(`[data-resource=${id}] input[type=range]`).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, percent);
}

for (const width of [390, 1440]) {
  test(`touch cargo respects shared capacity and launches numeric quantities at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/auth/check-admin', r => r.fulfill({ json: { hasAdmin: true } }));
    await page.goto('/');
    await page.waitForFunction(() => window.uiManager?.hasAdmin);
    await page.evaluate(async () => {
      document.getElementById('auth-screen').classList.add('hidden');
      const { bindCargoControls } = await import('/src/ui/CargoControls.js');
      const root = document.createElement('div');
      root.id = 'touch-fixture';
      root.style.cssText = 'position:fixed;inset:10px;z-index:10000;background:#09121f;color:white;padding:12px;overflow:auto';
      root.innerHTML = `<form><label>탑승 인구<input name="colonists" type="number" min="1" max="100" value="10"></label><section id="cargo-fixture">${['metal','crystal','deuterium'].map(id => `<label>${id}<input name="${id}" data-cargo="${id}" type="number" value="0" min="0"></label>`).join('')}</section><button type="submit">출발</button></form><label>성계<input id="touch-system" name="system" type="number" min="1" max="499" value="1"></label><label>건조 수량<input id="touch-count" type="number" min="1" max="20" value="1"></label><label>배율<input id="touch-decimal" type="number" min="0.1" max="10" step="0.1" value="0.3"></label>`;
      document.body.append(root);
      const form = root.querySelector('form');
      window.touchCargo = bindCargoControls(root.querySelector('#cargo-fixture'), {
        capacity: 1000, stock: { metal: 2000, crystal: 400, deuterium: 50 },
        population: () => Number(form.elements.colonists.value),
      });
      form.elements.colonists.addEventListener('input', () => window.touchCargo.sync());
      form.addEventListener('submit', event => { event.preventDefault(); window.touchOrder = Object.fromEntries(new FormData(form)); });
      window.touchEvents = 0;
      root.querySelector('#touch-count').addEventListener('input', () => window.touchEvents++);
    });
    const root = page.locator('#touch-fixture');
    const metal = root.locator('[data-resource=metal]');
    const crystal = root.locator('[data-resource=crystal]');
    await cargoPercent(root, 'metal', 50);
    await expect(root.locator('input[data-cargo=metal]')).toHaveValue('495');
    await expect(metal.locator('output')).toContainText('50%');
    await crystal.locator('[data-percent="100"]').click();
    await expect(root.locator('input[data-cargo=crystal]')).toHaveValue('400');
    await metal.locator('[data-percent="100"]').click();
    await expect(root.locator('input[data-cargo=metal]')).toHaveValue('590');
    await expect(root.locator('.cargo-total')).toContainText('남은 공간 0');
    expect(await page.evaluate(() => document.activeElement?.tagName === 'INPUT')).toBe(false);
    // Slider events update the actual dispatched numeric value, including clamping against other cargo.
    await metal.locator('input[type=range]').evaluate(el => { el.value = 25; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(root.locator('input[data-cargo=metal]')).toHaveValue('247');
    await root.locator('[type=submit]').click();
    expect(await page.evaluate(() => window.touchOrder)).toEqual({ colonists: '10', metal: '247', crystal: '400', deuterium: '0' });
    await root.locator('.cargo-exact-toggle').click();
    await root.locator('input[data-cargo=metal]').fill('2000');
    await expect(root.locator('input[data-cargo=metal]')).toHaveValue('590');
    await expect(root.locator('input[data-cargo=crystal]')).toHaveValue('400');
    // Changing passengers reduces cargo so the launch stays within shared capacity.
    const population = root.locator('input[name=colonists]').locator('..').locator('..').locator('.quantity-presets');
    await population.getByRole('button', { name: '탑승 인구 최대', exact: true }).click();
    await expect(root.locator('input[data-cargo=metal]')).toHaveValue('590');
    await expect(root.locator('input[data-cargo=crystal]')).toHaveValue('310');
    await expect(root.locator('#touch-system')).toHaveValue('1');
    expect(await root.locator('#touch-system').evaluate(el => !!el.closest('.touch-number'))).toBe(false);
    const count = root.locator('#touch-count').locator('..').locator('..');
    await count.getByRole('button', { name: '건조 수량 최대', exact: true }).click();
    await expect(root.locator('#touch-count')).toHaveValue('20');
    expect(await page.evaluate(() => window.touchEvents)).toBe(1);
    await root.locator('#touch-count').evaluate(el => { el.max = 10; el.disabled = true; });
    await expect(count.locator('input[type=range]')).toHaveAttribute('max', '10');
    await expect(count.locator('button').first()).toBeDisabled();
    const decimal = root.locator('#touch-decimal').locator('..').locator('..');
    await decimal.getByRole('button', { name: '배율 ＋', exact: true }).click();
    await expect(root.locator('#touch-decimal')).toHaveValue('0.4');
    expect(await root.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/o3game-touch-controls-${width}.png` });
  });
}

for (const width of [390, 1440]) {
  test(`fleet transport and direct colony use touch cargo at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let catalogUrl;
    page.on('response', response => { if (/\/src\/data\/catalog\.js(?:\?|$)/.test(response.url())) catalogUrl = response.url(); });
    await page.route('**/api/auth/check-admin', r => r.fulfill({ json: { hasAdmin: true } }));
    await page.goto('/');
    await page.waitForFunction(() => window.uiManager?.hasAdmin);
    await page.evaluate(async ({ catalogUrl }) => {
      const { catalog } = await import(catalogUrl);
      catalog.hydrate({ revision: 1, entities: [
        { entityType: 'ship', entityId: 'smallCargo', display: { name: '소형 화물선' }, stats: { speed: 5000, cargo: 1000 } },
        { entityType: 'ship', entityId: 'colonyShip', display: { name: '식민선' }, stats: { speed: 2500, cargo: 1000 } },
      ] });
      const { StrikeMap } = await import('/src/ui/views/StrikeMap.js');
      const root = document.createElement('div');
      root.id = 'transport-fixture';
      root.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow:auto;background:#080e18;padding:10px;pointer-events:auto';
      document.body.append(root);
      window.transportOrders = [];
      window.transportPreview = new StrikeMap({ root,
        fetchSystem: async () => ({ positions: [{ position: 4, occupied: true, owner: 'self', planet: { id: 'destination', name: '제2행성' } }] }),
        getHome: () => ({ id: 'home', galaxy: 1, system: 1, planet: 1 }),
        getResources: () => ({ metal: 2000, crystal: 400, deuterium: 50 }),
        getFormations: () => [{ id: 'formation', name: '수송 함대', revision: 1, crew: 1, requiredCrew: 1, ships: { smallCargo: 1 } }],
        isPending: () => false, onManage: () => {}, onLaunch: async order => { window.transportOrders.push(order); },
      });
      await window.transportPreview.show({ galaxy: 1, system: 1 }, { targetSlot: 4 });
      window.transportPreview.chart.stop();
    }, { catalogUrl });
    const root = page.locator('#transport-fixture');
    await root.locator('.mission-choice label').filter({ hasText: '수송' }).click();
    await expect(root.locator('.combat-cargo')).toHaveJSProperty('open', true);
    await cargoPercent(root, 'metal', 50);
    await root.locator('[data-resource=crystal] [data-percent="100"]').click();
    await page.screenshot({ path: `/tmp/o3game-transport-touch-${width}.png` });
    expect(await root.locator('.galaxy-nav').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await root.locator('[data-confirm=launch]').click();
    expect(await page.evaluate(() => window.transportOrders.map(({ mission, cargo }) => ({ mission, cargo })))).toEqual([
      { mission: 'transport', cargo: { metal: 500, crystal: 400, deuterium: 0 } },
    ]);
    await page.evaluate(async () => {
      const { DirectColonyView } = await import('/src/ui/views/DirectColonyView.js');
      const root = document.getElementById('transport-fixture');
      window.colonyOrders = [];
      new DirectColonyView(root, {
        state: { planet: { id: 'home', name: '지구', galaxy: 1, system: 1, planet: 1, populationState: { count: 100 } }, resources: { metal: 2000, crystal: 400, deuterium: 50 }, serverSpeed: 1, flightSpeedMultiplier: 1 },
        destination: { galaxy: 2, system: 20, planet: 3 }, isPending: false,
        onLaunch: async order => window.colonyOrders.push(order), onClose: () => {},
      });
    });
    for (const id of ['metal','crystal','deuterium']) await cargoPercent(root, id, 0);
    await root.locator('[name=colonists]').locator('..').locator('..').getByRole('button', { name: '탑승 인구 최대', exact: true }).click();
    await root.locator('[data-resource=metal] [data-percent="100"]').click();
    await root.locator('[type=submit]').click();
    expect(await page.evaluate(() => window.colonyOrders.map(({ colonists, cargo }) => ({ colonists, cargo })))).toEqual([
      { colonists: 100, cargo: { metal: 900, crystal: 0, deuterium: 0 } },
    ]);
    expect(await root.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/o3game-colony-touch-${width}.png` });
  });
}

test('mobile shipyard maximum uses affordability and formation percent controls preserve the draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let catalogUrl;
  page.on('response', response => { if (/\/src\/data\/catalog\.js(?:\?|$)/.test(response.url())) catalogUrl = response.url(); });
  await page.route('**/api/auth/check-admin', r => r.fulfill({ json: { hasAdmin: true } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(async ({ catalogUrl }) => {
    const { catalog } = await import(catalogUrl);
    catalog.hydrate({ revision: 1, entities: [{ entityType: 'ship', entityId: 'smallCargo', display: { name: '소형 화물선', category: 'civilian' }, stats: { speed: 5000, cargo: 1000, crew: 1 }, costModel: { baseCost: { metal: 100, crystal: 50 } }, timeModel: { baseTime: 30 }, requirements: {} }] });
    const state = window.gameState;
    Object.assign(state.resources, { metal: 1000, crystal: 500, deuterium: 0 });
    Object.assign(state.planet, { id: 'home', name: '지구', galaxy: 1, system: 1, planet: 1, populationState: { count: 100 } });
    state.planets = [{ _id: 'home', name: '지구', fleet: { smallCargo: 20 } }];
    state.fleetFormations = [{ id: 'fleet', name: '수송함대', revision: 1, status: 'ready', originPlanetId: 'home', crew: 0, requiredCrew: 0, ships: {} }];
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('ui-layer').classList.remove('hidden');
    const ui = window.uiManager;
    ui.showDashboard();
    ui.switchView('shipyard');
    const browser = ui.getBrowser('shipyard');
    browser.getTabs = () => [{ key: 'ship', type: 'ship', label: '함선' }];
    browser.entitiesForTab = () => [catalog.get('ship', 'smallCargo')];
    window.touchBuildOrders = [];
    browser.onCommand = async (entity, count) => window.touchBuildOrders.push({ id: entity.id, count });
    browser.render();
  }, { catalogUrl });
  const browser = page.locator('#shipyard-browser');
  await expect(browser.locator('.unit-count')).toHaveAttribute('max', '10');
  await browser.locator('.touch-number .quantity-presets button').last().click();
  await expect(browser.locator('.unit-count')).toHaveValue('10');
  expect(await page.evaluate(() => document.activeElement?.classList.contains('unit-count'))).toBe(false);
  await browser.locator('[data-command=ship]').click();
  expect(await page.evaluate(() => window.touchBuildOrders)).toEqual([{ id: 'smallCargo', count: 10 }]);
  expect(await browser.locator('.detail-command').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/o3game-touch-shipyard-390.png' });
  await page.evaluate(() => {
    window.uiManager.switchView('fleet');
    window.uiManager.formationView.load('fleet');
  });
  const formation = page.locator('#fleet-panel');
  const quantity = formation.locator('[data-quantity=smallCargo]');
  await quantity.locator('..').locator('..').locator('input[type=range]').evaluate(el => { el.value = 10; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(quantity).toHaveValue('10');
  expect(await page.evaluate(() => ({ count: window.uiManager.formationView.draft.ships.smallCargo, dirty: window.uiManager.formationView.dirty }))).toEqual({ count: 10, dirty: true });
  await quantity.locator('..').locator('..').getByRole('button', { name: '소형 화물선 배정 수량 최대', exact: true }).click();
  await expect(quantity).toHaveValue('20');
  expect(await formation.locator('.ship-count-controls').first().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/o3game-touch-formation-390.png' });
});
