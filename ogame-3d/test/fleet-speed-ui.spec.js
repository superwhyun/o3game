import { test, expect } from '@playwright/test';

test('fleet ETA ignores economy speed and responds to flight speed changes', async ({ page }) => {
  let catalogUrl;
  page.on('response',r=>{if(/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url()))catalogUrl=r.url()});
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  await page.goto('/');
  await page.evaluate(async ({catalogUrl}) => {
    const { catalog } = await import(catalogUrl);
    const { StrikeMap } = await import('/src/ui/views/StrikeMap.js');
    catalog.hydrate({ revision: 1, entities: [{ entityType: 'ship', entityId: 'smallCargo', display: { name: '화물선' }, stats: { speed: 5000, cargo: 5000, attack: 5 } }] });
    const root = document.createElement('div');
    root.id = 'speed-map-preview';
    root.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow:auto;background:#080e18;padding:20px;pointer-events:auto';
    document.body.append(root);
    const positions = Array.from({ length: 15 }, (_, i) => ({ position: i + 1, occupied: false }));
    positions[3] = { position: 4, occupied: true, owner: 'self', planet: { id: 'home', name: '내 행성' } };
    positions[13] = { position: 14, occupied: true, owner: 'other', scouted: true, planet: { id: 'other', name: '목표' } };
    window.previewSpeed = { serverSpeed: 1, flightSpeedMultiplier: 1 };
    window.speedMap = new StrikeMap({ root, fetchSystem: async () => ({ positions }), getHome: () => ({ id: 'home', galaxy: 1, system: 1, planet: 4 }), getSpeedSettings: () => window.previewSpeed, getFormations: () => [{ id: 'formation', name: '검증 함대', revision: 1, ships: { smallCargo: 1 } }], isPending: () => false, onManage: () => {}, onLaunch: () => {} });
    await window.speedMap.show(undefined, { targetSlot: 14 });
    window.speedMap.chart.stop();
  }, {catalogUrl});
  await expect(page.locator('#speed-map-preview .strike-confirm')).toContainText('8분 48초');
  await page.evaluate(() => { window.previewSpeed.serverSpeed = 100; window.speedMap.refresh(); });
  await expect(page.locator('#speed-map-preview .strike-confirm')).toContainText('8분 48초');
  await page.evaluate(() => { window.previewSpeed.flightSpeedMultiplier = 2; window.speedMap.refresh(); });
  await expect(page.locator('#speed-map-preview .strike-confirm')).toContainText('4분 24초');
});

test('administrator can save flight speed independently through a compact selector', async ({ page }) => {
  let saved;
  await page.route('**/api/auth/check-admin', r => r.fulfill({json:{hasAdmin:true}}));
  await page.route('**/api/admin/config', async r => {
    if (r.request().method() === 'PUT') saved = r.request().postDataJSON();
    await r.fulfill({json:{fleetSettings:{flightSpeedMultiplier:saved?.fleetSettings.flightSpeedMultiplier || 2},serverSpeed:100,populationSettings:{},areaSettings:{bonusUsableFields:40}}});
  });
  await page.goto('/'); await page.waitForFunction(()=>window.uiManager?.hasAdmin);
  await page.evaluate(async()=>{
    document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('ui-layer').classList.remove('hidden');
    document.getElementById('admin-panel').classList.remove('hidden'); document.getElementById('tab-settings').classList.add('active');
    window.uiManager.syncUserDataFromServer = async()=>{};
    window.uiManager.setupAdminEvents();
    await window.uiManager.loadPopulationSettings();
  });
  const form=page.locator('#flight-settings-form');
  await expect(form.locator('select')).toHaveValue('2');
  await expect(form).toContainText('건설·생산 배율과 독립적');
  await form.locator('select').selectOption('5');
  await form.locator('button[type=submit]').click();
  await expect(form.locator('[role=status]')).toContainText('이동 배율 5배로 저장');
  expect(saved).toEqual({fleetSettings:{flightSpeedMultiplier:5}});
});
