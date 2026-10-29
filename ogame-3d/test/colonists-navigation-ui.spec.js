import { test, expect } from '@playwright/test';

async function previewMap(page) {
  await page.route('**/api/auth/has-admin', r => r.fulfill({ json: { hasAdmin: true } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager);
  await page.evaluate(async () => {
    const { catalog } = await import('/src/data/catalog.js');
    const { StrikeMap } = await import('/src/ui/views/StrikeMap.js');
    catalog.hydrate({ revision: 1, entities: [{ entityType: 'ship', entityId: 'colonyShip', display: { name: '식민선' }, stats: { speed: 2500, cargo: 7500, attack: 50 } }] });
    const root = document.createElement('div');
    root.id = 'colonist-map-preview';
    root.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow:auto;background:#080e18;padding:10px;pointer-events:auto';
    document.body.append(root);
    const positions = Array.from({ length: 15 }, (_, i) => ({ position: i + 1, occupied: false }));
    window.previewOrders = [];
    window.failPreviewLaunch = false;
    window.previewSpeed = { serverSpeed: 1 };
    window.colonistMap = new StrikeMap({ root, fetchSystem: async () => ({ positions }), getHome: () => ({ id: 'home', galaxy: 1, system: 1, planet: 1, population: { count: 30 } }), getSpeedSettings: () => window.previewSpeed, getFormations: () => [{ id: 'formation', name: '개척 함대', revision: 1, ships: { colonyShip: 1 } }], isPending: () => false, onManage: () => {}, onLaunch: async order => { window.previewOrders.push(order); if (window.failPreviewLaunch) throw new Error('인구가 부족합니다.'); } });
    await window.colonistMap.show(undefined, { targetSlot: 4 });
    window.colonistMap.chart.stop();
  });
}

test('mobile colony confirmation defaults to ten people, preserves edits and sends selected population', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await previewMap(page);
  const count = page.locator('#colonist-map-preview [name="colonists"]');
  await expect(count).toHaveValue('10');
  await expect(count).toHaveAttribute('max', '30');
  await count.fill('7');
  await page.evaluate(() => { window.previewSpeed.serverSpeed = 100; window.colonistMap.refresh(); });
  await expect(count).toHaveValue('7');
  await page.evaluate(() => { window.failPreviewLaunch = true; });
  await page.locator('#colonist-map-preview [data-confirm=launch]').click();
  await expect(page.locator('#colonist-map-preview [role=alert]')).toContainText('인구가 부족');
  await expect(count).toHaveValue('7');
  await page.evaluate(() => { window.failPreviewLaunch = false; });
  await page.locator('#colonist-map-preview [data-confirm=launch]').click();
  await expect(page.locator('#colonist-map-preview .strike-confirm')).toBeHidden();
  expect(await page.evaluate(() => window.previewOrders.map(order => order.colonists))).toEqual([7, 7]);
});

test('mobile coordinate drafts survive blur and refresh, apply by button and Enter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await previewMap(page);
  const root = page.locator('#colonist-map-preview');
  const galaxy = root.locator('[data-nav=galaxy]');
  const system = root.locator('[data-nav=system]');
  await galaxy.fill('2');
  await system.fill('15');
  await system.blur();
  await page.evaluate(() => window.colonistMap.nav.sync({ galaxy: 1, system: 1 }));
  await expect(galaxy).toHaveValue('2');
  await expect(system).toHaveValue('15');
  expect(await page.evaluate(() => window.colonistMap.coords)).toEqual({ galaxy: 1, system: 1 });
  await root.locator('[data-nav=apply]').click();
  expect(await page.evaluate(() => window.colonistMap.coords)).toEqual({ galaxy: 2, system: 15 });
  await system.fill('16');
  await system.press('Enter');
  expect(await page.evaluate(() => window.colonistMap.coords)).toEqual({ galaxy: 2, system: 16 });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => { const el = document.querySelector('#colonist-map-preview .galaxy-nav'); return el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth; })).toBe(true);
  }
});

test('star-system view preserves both mobile inputs until the move button is tapped', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route('**/api/auth/has-admin', r => r.fulfill({ json: { hasAdmin: true } }));
  await page.route('**/api/game/galaxy?*', r => r.fulfill({ json: { positions: [] } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
  await page.evaluate(() => { window.uiManager.showDashboard(); window.uiManager.switchView('galaxy'); });
  await page.locator('#galaxy-input').fill('2');
  await page.locator('#system-input').fill('15');
  await page.locator('#system-input').blur();
  await page.evaluate(() => window.uiManager.galaxyView.nav.sync({ galaxy: 1, system: 1 }));
  await expect(page.locator('#galaxy-input')).toHaveValue('2');
  await expect(page.locator('#system-input')).toHaveValue('15');
  await page.locator('#galaxy-apply').click();
  expect(await page.evaluate(() => window.uiManager.galaxyView.coords)).toEqual({ galaxy: 2, system: 15 });
  expect(await page.evaluate(() => { const el = document.querySelector('#galaxy-panel .galaxy-nav'); return el.scrollWidth <= el.clientWidth; })).toBe(true);
});
