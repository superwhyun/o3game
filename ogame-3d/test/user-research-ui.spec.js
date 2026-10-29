import { test, expect } from '@playwright/test';

test('shared research level, queue and combined lab time remain visible after switching planets', async ({ page }) => {
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  const entities = [
    { entityType: 'building', entityId: 'researchLab', display: { name: '연구소' }, effects: { constructionModifiers: [{ targetTypes: ['research'], mode: 'linearDivider', value: .1, base: 1 }] } },
    { entityType: 'research', entityId: 'energyTechnology', display: { name: '에너지 기술', category: 'planet' }, costModel: { baseCost: { crystal: 100 }, costMultiplier: 2 }, timeModel: { baseTime: 240, timeMultiplier: 2 }, requirements: { buildings: { researchLab: 1 } } }
  ];
  const snapshot = { id: 'research-preview', username: 'preview', stateRevision: 1, serverTime: new Date().toISOString(), currentPlanet: 0, serverSpeed: 1, research: { energyTechnology: 2 }, researchInfrastructure: { networkLevel: 0, originPlanetId: 'planet-0', originLabLevel: 2, labs: [{ planetId: 'planet-0', name: '행성 0', level: 2 }, { planetId: 'planet-1', name: '행성 1', level: 3 }, { planetId: 'planet-2', name: '행성 2', level: 0 }], labsBusy: false, researchBusy: false }, planets: [2, 3, 0].map((level, index) => ({ _id: `planet-${index}`, name: `행성 ${index}`, galaxy: 1, system: 1, planet: index + 1, resources: { metal: 5000, crystal: 3000, deuterium: 1000 }, buildings: { researchLab: level }, research: { energyTechnology: 2 }, fleet: {}, defense: {}, production: { metal: 30, crystal: 15, deuterium: 0 }, storage: { metal: 10000, crystal: 10000, deuterium: 10000 } })), queueState: { building: null, research: null, ship: null, defense: null, queue: [] } };
  await page.route('**/api/auth/me', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/game/catalog', route => route.fulfill({ json: { revision: 1, entities } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
  await page.evaluate(async () => {
    await window.uiManager.syncUserDataFromServer();
    window.uiManager.showDashboard();
    window.uiManager.switchView('research');
  });
  const row = page.locator('#research-browser .entity-row');
  await expect(page.locator('#research-network-summary')).toContainText('연구망 Lv 0');
  await expect(row.locator('.entity-amount')).toHaveText('Lv 2');
  await expect(row.locator('.entity-row-time')).toHaveText('13분 20초'); // Only origin lab: 960 / 1.2
  await page.evaluate(() => {
    window.gameState.researchInfrastructure.networkLevel = 1;
    window.uiManager.renderResearchSwiper();
  });
  await expect(row.locator('.entity-row-time')).toHaveText('10분 40초');
  await expect(page.locator('#research-browser .research-linked-labs')).toContainText('행성 0 Lv 2 + 행성 1 Lv 3');
  await page.evaluate(() => {
    window.gameState.currentPlanet = 1;
    window.gameState.researchInfrastructure.originPlanetId = 'planet-1';
    window.gameState.researchInfrastructure.originLabLevel = 3;
    window.gameState.buildings = { researchLab: 3 };
    window.uiManager.renderResearchSwiper();
  });
  await expect(row.locator('.entity-amount')).toHaveText('Lv 2');
  await expect(row.locator('.entity-row-time')).toHaveText('10분 40초');
  await page.evaluate(() => {
    window.gameState.currentPlanet = 2;
    window.gameState.researchInfrastructure.originPlanetId = 'planet-2';
    window.gameState.researchInfrastructure.originLabLevel = 0;
    window.gameState.buildings = { researchLab: 0 };
    window.uiManager.renderResearchSwiper();
  });
  await expect(row.locator('[data-command="research"]')).toBeDisabled();
  await expect(page.locator('#research-browser .research-linked-labs')).toContainText('이 행성에 연구소 Lv 1 필요');
  await page.evaluate(() => {
    window.uiManager.queueItems.research = { id: 'queue', type: 'research', itemId: 'energyTechnology', planetId: '0', level: 3, name: '에너지 기술', icon: '⚡', status: 'building', endTime: new Date(Date.now() + 60000).toISOString(), duration: 60 };
    window.uiManager.renderResearchSwiper();
    window.uiManager.updateBuildQueueUI(null, window.uiManager.queueItems.research, null, []);
  });
  await expect(row.locator('[data-command="research"]')).toBeDisabled();
  await expect(page.locator('#research-panel-queue')).toContainText('에너지 기술');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#research-network-summary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
