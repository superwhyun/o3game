import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`demolition requires an explicit confirmation and survives refresh at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    let order;
    await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
    await page.route('**/api/queue/demolish', async route => {
      requests++;
      order = route.request().postDataJSON();
      const snapshot = await page.evaluate(() => ({ id: window.gameState.userId, username: 'preview', stateRevision: 1, serverTime: new Date().toISOString(), currentPlanet: 0, planets: [{ _id: 'home', name: '내 행성', galaxy: 1, system: 1, planet: 4, resources: { metal: 5000, crystal: 3000, deuterium: 1000 }, buildings: { metalMine: 2 }, research: {}, fleet: {}, defense: {}, production: { metal: 30, crystal: 15, deuterium: 0 }, storage: { metal: 10000, crystal: 10000, deuterium: 10000 } }], queueState: { building: null, research: null, ship: null, defense: null, queue: [] } }));
      await route.fulfill({ json: { snapshot } });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
    await page.evaluate(async () => {
      const { catalog } = await import('/src/data/catalog.js');
      catalog.hydrate({ revision: 1, entities: [{ entityType: 'building', entityId: 'metalMine', display: { name: '금속 광산', category: 'resources' }, costModel: { baseCost: { metal: 100 } }, timeModel: { baseTime: 30 }, requirements: {}, effects: {} }] });
      window.gameState.userId = 'preview';
      window.gameState.currentPlanet = 0;
      window.gameState.buildings.metalMine = 2;
      Object.assign(window.gameState.planet, { id: 'home', name: '내 행성', galaxy: 1, system: 1, planet: 4 });
      window.confirm = () => { window.nativeConfirmCalled = true; return true; };
      window.uiManager.showDashboard();
      window.uiManager.switchView('buildings');
    });
    const demolition = page.locator('#buildings-browser [data-command="demolish"][data-command-entity="metalMine"]');
    for (const dismiss of ['cancel', 'close', 'escape']) {
      await demolition.click();
      await expect(page.locator('#demolition-confirmation')).toBeVisible();
      await expect(page.locator('#demolition-confirmation')).toContainText('Lv 2 → Lv 1');
      await expect(page.locator('#demolition-confirmation')).toContainText('자원은 환급되지 않습니다');
      expect(requests).toBe(0);
      await page.evaluate(() => { for (let i = 0; i < 3; i++) window.uiManager.renderBuildingSwiper(); });
      await expect(page.locator('#demolition-confirmation')).toBeVisible();
      if (dismiss === 'cancel') await page.locator('[data-demolition-cancel]').click();
      if (dismiss === 'close') await page.locator('.modal-close').click();
      if (dismiss === 'escape') await page.keyboard.press('Escape');
      await expect(page.locator('#modal-overlay')).toBeHidden();
      await expect(demolition).toBeEnabled();
      expect(requests).toBe(0);
    }
    await demolition.click();
    await page.evaluate(() => { window.gameState.planet.id = 'different-planet'; });
    await page.locator('[data-demolition-confirm]').click();
    await expect(demolition).toBeEnabled();
    expect(requests).toBe(0);
    await page.evaluate(() => { window.gameState.planet.id = 'home'; });
    await demolition.click();
    await page.locator('[data-demolition-confirm]').click();
    await expect(page.locator('#notification-container')).toContainText('철거 예약');
    expect(requests).toBe(1);
    expect(order).toEqual({ buildingId: 'metalMine', planetId: '0' });
    expect(await page.evaluate(() => window.nativeConfirmCalled)).toBeUndefined();
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });
}
