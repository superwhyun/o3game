import { test, expect } from '@playwright/test';
const entities = [
  ...['metalMine', 'solarPlant', 'metalStorage', 'crystalStorage', 'deuteriumTank', 'researchLab'].map(entityId => ({ entityType: 'building', entityId, display: { name: entityId, category: 'resources' }, costModel: { baseCost: { metal: 100 } }, timeModel: { baseTime: 60 } })),
  { entityType: 'research', entityId: 'terraforming', display: { name: '테라포밍', category: 'planet' }, costModel: { baseCost: { metal: 100000, crystal: 150000, deuterium: 100000 }, costMultiplier: 1.6 }, timeModel: { baseTime: 7200 }, requirements: { buildings: { researchLab: 10 }, research: { energyTechnology: 12 } } },
  { entityType: 'ship', entityId: 'colonyShip', display: { name: '식민선' }, stats: { cargo: 7500, speed: 2500, attack: 50 } }
];
async function start(page) {
  const snapshot = { id: 'preview', username: 'preview', stateRevision: 1, serverTime: new Date().toISOString(), currentPlanet: 0, areaSettings: { bonusUsableFields: 80 }, research: {}, planets: [{ _id: 'p0', name: 'Earth', galaxy: 1, system: 1, planet: 1, resources: { metal: 10000, crystal: 5000, deuterium: 1000 }, buildings: { metalMine: 1, researchLab: 1 }, research: {}, fleet: {}, defense: {}, population: { count: 30 }, energyState: { production: 300, consumption: 200, balance: 100 }, production: { metal: 0, crystal: 0, deuterium: 0, energy: 100 }, storage: { metal: 10000, crystal: 10000, deuterium: 10000 }, area: { total: 256, usable: 142, used: 132, reserved: 0, available: 10, baseUsablePercent: 40, usablePercent: 40, bonusUsable: 40 } }], queueState: { building: null, research: null, ship: null, defense: null, queue: [] } };
  await page.route('**/api/auth/has-admin', r => r.fulfill({ json: { hasAdmin: true } }));
  await page.route('**/api/auth/me', r => r.fulfill({ json: snapshot }));
  await page.route('**/api/game/catalog', r => r.fulfill({ json: { revision: 1, entities } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
  await page.evaluate(async () => { await window.uiManager.syncUserDataFromServer(); window.uiManager.showDashboard(); });
}

test('energy, storage warnings and terraform navigation remain clear on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await expect(page.locator('#energy-rate')).toHaveText('생산 300 · 소비 200');
  await expect(page.locator('#energy-count')).toHaveText('+100');
  await page.locator('[data-resource=energy]').click();
  await expect(page.locator('.energy-details')).toContainText('생산 300');
  await expect(page.locator('.energy-details')).toContainText('소비 200');
  await page.locator('.modal-close').click();
  await expect(page.locator('#storage-warnings')).toContainText('추가 생산분 저장 안 됨');
  await page.locator('#storage-warnings button').click();
  expect(await page.evaluate(() => window.uiManager.browsers.buildings.currentEntity().id)).toBe('metalStorage');
  await expect(page.locator('#buildings-browser .area-capacity-warning')).toContainText('남은 면적 10칸');
  await page.locator('#buildings-browser .area-capacity-warning summary').click();
  await expect(page.locator('#buildings-browser .area-capacity-warning')).toContainText('100,000');
  await page.locator('#buildings-browser [data-open-entity=terraforming]').click();
  expect(await page.evaluate(() => window.uiManager.browsers.research.currentEntity().id)).toBe('terraforming');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('colony recommendation includes passengers and only displays observed terrain', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { StrikeMap } = await import('/src/ui/views/StrikeMap.js');
    const root = document.createElement('div'); root.id = 'prepared-colony'; root.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#080e18;overflow:auto;padding:10px'; document.body.append(root);
    const positions = Array.from({ length: 15 }, (_, i) => ({ position: i + 1, occupied: false }));
    positions[1].survey = { total: 256, baseUsablePercent: 40, diameter: 12800, minTemp: 10, maxTemp: 50, environment: { name: '열대 행성' }, observedAt: new Date().toISOString() };
    window.preparedColony = new StrikeMap({ root, fetchSystem: async () => ({ positions }), getHome: () => ({ id: 'p', galaxy: 1, system: 1, planet: 1, population: { count: 30 } }), getResources: () => ({ metal: 10000, crystal: 10000, deuterium: 10000 }), getDevelopment: () => ({ terraformLevel: 5, bonusFields: 80 }), getFormations: () => [{ id: 'f', name: '개척', revision: 1, ships: { colonyShip: 1 } }], isPending: () => false, onManage: () => {}, onLaunch: async () => {}, onScout: target => { window.scoutTarget = target; } });
    await window.preparedColony.show(undefined, { targetSlot: 2 }); window.preparedColony.chart.stop();
  });
  const root = page.locator('#prepared-colony');
  await expect(root.locator('.colony-cargo-warning')).toContainText('자원 없이');
  await expect(root.locator('.colony-survey')).toContainText('열대 행성');
  await expect(root.locator('.colony-survey')).toContainText('208칸');
  await root.locator('[data-confirm=recommend]').click();
  const cargo = await root.locator('[data-cargo]').evaluateAll(els => els.reduce((n, el) => n + Number(el.value), 0));
  expect(cargo + 10).toBeLessThanOrEqual(7500);
  expect(cargo).toBeGreaterThan(0);
  await expect(root.locator('.colony-cargo-warning')).toHaveText('');
  await page.evaluate(() => window.preparedColony.openConfirm(3));
  await expect(root.locator('.colony-survey')).toHaveCount(0);
  await root.locator('[data-confirm=scout]').click();
  expect(await page.evaluate(() => window.scoutTarget)).toEqual({ galaxy: 1, system: 1, planet: 3 });
});

test('admin saves a review and users can read escaped decisions and notes', async ({ page }) => {
  await start(page);
  let row = { _id: 'r', authorName: 'player', title: '개척 개선', description: '내용', createdAt: new Date().toISOString() };
  await page.route('**/api/game/improvement-requests**', r => {
    if (r.request().method() === 'PATCH') { row = { ...row, ...r.request().postDataJSON(), reviewStatus: 'reviewed', reviewerName: 'admin', reviewedAt: new Date().toISOString() }; return r.fulfill({ json: { request: row } }); }
    return r.fulfill({ json: { requests: [row], nextCursor: null } });
  });
  await page.evaluate(() => { localStorage.setItem('user', JSON.stringify({ isAdmin: true })); window.uiManager.switchView('improvements'); });
  await page.locator('.improvement-review-editor summary').click();
  await page.locator('[name=decision]').selectOption('partial');
  await page.locator('[name=reviewNote]').fill('추천 적재 반영. <script>window.injected=true</script>');
  await page.getByRole('button', { name: '확인 완료로 저장' }).click();
  await expect(page.locator('.improvement-review-status')).toContainText('확인 완료');
  await expect(page.locator('.improvement-review-status')).toContainText('부분 반영');
  await expect(page.locator('.improvement-review-note')).toContainText('<script>');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.evaluate(() => { localStorage.setItem('user', JSON.stringify({ isAdmin: false })); window.uiManager.improvementsView.show(); });
  await expect(page.locator('.improvement-review-note')).toContainText('추천 적재 반영');
  await expect(page.locator('.improvement-review-editor')).toHaveCount(0);
});
