import { test, expect } from '@playwright/test';

test('battle records show resources, losses, read status and legacy fuel on desktop and mobile', async ({ page }) => {
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  let readRequests = 0;
  await page.route('**/api/game/reports/*/read', route => { readRequests++; return route.fulfill({ json: { read: true } }); });
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
  await page.evaluate(() => {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('ui-layer').classList.remove('hidden');
    window.gameState.userId = 'attacker';
    window.uiManager.battleReports = [{ _id: '123456789012345678901234', formationName: '<img src=x>', battleTime: new Date().toISOString(), attacker: { userId: 'attacker', username: 'player', coordinates: { galaxy: 1, system: 1, planet: 3 } }, defender: { userId: 'defender', username: 'enemy', coordinates: { galaxy: 1, system: 1, planet: 5 } }, attackerInitial: { fleet: { lightFighter: 10 } }, defenderInitial: { fleet: { smallCargo: 2 } }, result: { winner: 'attacker', attackerLosses: { lightFighter: 2 }, defenderLosses: { smallCargo: 2 }, loot: { metal: 1200, crystal: 340, deuterium: 56 }, debrisField: { metal: 50, crystal: 20 } }, fuelConsumed: { deuterium: 0 }, fuelPolicy: 'notCharged', returnStatus: 'returning', rounds: [{ round: 1, attackerDamage: 200, defenderDamage: 50 }] }];
    window.uiManager.battleUnreadCount = 1;
    window.uiManager.getRecordHistory('battle').api.getBattleReportPage = async () => ({ reports: window.uiManager.battleReports, pagination: { total: 1, totalPages: 1, page: 1, limit: 20 } });
    window.uiManager.renderBattleRecords();
  });
  await page.locator('#battle-records-btn').click();
  await page.locator('#battle-records-list [data-record-open]').click();
  const card = page.locator('#battle-records-list .battle-report-card');
  await expect(card).toContainText('승리');
  await expect(card).toContainText('1,200');
  await expect(card).toContainText('340');
  await expect(card).toContainText('56');
  await expect(card).toContainText('귀환 중');
  await expect(card.locator('img')).toHaveCount(0);
  await expect(page.locator('#battle-unread-count')).toHaveText('(1)');
  await expect.poll(() => readRequests).toBe(1);
  await expect(card).toContainText('확인함');
  await expect(card.locator('table').first()).toContainText('10');
  await expect(card.locator('table').first()).toContainText('2');
  await expect(card.locator('table').first()).toContainText('8');
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await card.locator('.battle-rounds').scrollIntoViewIfNeeded();
    const box = await card.locator('.battle-rounds').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.evaluate(() => {
    const report = window.uiManager.battleReports[0];
    report.fuelConsumed = null; report.fuelPolicy = null;
    window.gameState.userId = 'defender';
    window.uiManager.getRecordHistory('battle').render();
  });
  await expect(card).toContainText('패배');
  await expect(card).toContainText('약탈당한 금속');
  await expect(card).toContainText('기록 없음');
});

test('outbound mission exposes recall and returning mission hides it', async ({ page }) => {
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  let recalls = 0;
  await page.route('**/api/game/fleets/*/recall', async route => { recalls++; await route.fulfill({ json: {} }); });
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
  await page.evaluate(() => {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('ui-layer').classList.remove('hidden');
    document.querySelectorAll('.holo-panel').forEach(panel => panel.classList.add('hidden'));
    document.getElementById('combat-panel').classList.remove('hidden');
    window.uiManager.currentView = 'combat';
    window.gameState.userId = 'recall-player';
    window.gameState.fleetMovements = [{ id: '123456789012345678901234', formationName: '정찰대', mission: 'spy', status: 'flying', fleet: { espionageProbe: 1 }, origin: { galaxy: 1, system: 1, planet: 3 }, destination: { galaxy: 1, system: 1, planet: 5 }, startTime: new Date(Date.now() - 10000).toISOString(), arrivalTime: new Date(Date.now() + 90000).toISOString() }];
    window.uiManager.renderCombatMissions();
  });
  await page.locator('[data-recall]').click();
  expect(recalls).toBe(1);
  await expect(page.locator('#notification-container')).toContainText('임무를 취소했습니다');
  await page.evaluate(() => {
    const movement = window.gameState.fleetMovements[0];
    movement.status = 'returning'; movement.returnStartTime = new Date().toISOString(); movement.returnTime = new Date(Date.now() + 10000).toISOString();
    window.uiManager.renderCombatMissions();
  });
  await expect(page.locator('[data-recall]')).toHaveCount(0);
  await expect(page.locator('.mission-card')).toContainText('귀환 중');
});
