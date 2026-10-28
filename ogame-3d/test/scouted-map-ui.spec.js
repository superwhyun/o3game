import { test, expect } from '@playwright/test';

test('only explored slots become planets and observed foreign names use a different color', async ({ page }) => {
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  await page.goto('/');
  await page.evaluate(async () => {
    const { GalaxyView } = await import('/src/ui/views/GalaxyView.js');
    const root = document.createElement('div');
    root.id = 'scouted-map-preview';
    root.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow:auto;background:#080e18;padding:20px;pointer-events:auto';
    document.body.append(root);
    const positions = Array.from({ length: 15 }, (_, i) => ({ position: i + 1, occupied: false, scouted: false }));
    positions[3] = { position: 4, occupied: true, owner: 'self', planet: { name: '내 콜로니', username: 'me' } };
    positions[7] = { position: 8, occupied: true, owner: 'other', scouted: false, planet: { name: null, username: 'neighbor' } };
    positions[9].scouted = true;
    const controls = Object.fromEntries(['prev','next','galaxy','system','home'].map(key => [key, document.createElement(key === 'galaxy' || key === 'system' ? 'input' : 'button')]));
    window.previewPositions = positions;
    window.scoutedMap = new GalaxyView({ root, controls, fetchSystem: async () => ({ positions: structuredClone(window.previewPositions) }), getHome: () => ({ galaxy: 1, system: 1 }), onTarget: () => {} });
    await window.scoutedMap.show();
    window.scoutedMap.chart.stop();
  });
  await expect(page.locator('#scouted-map-preview .slot-list')).toHaveCount(0);
  const slots = page.locator('#scouted-map-preview .orbit-svg .slots');
  await expect(slots.locator('[data-slot="4"] .slot-planet')).toHaveCount(1);
  await expect(slots.locator('[data-slot="4"] .slot-label')).toHaveText('내 콜로니');
  await expect(slots.locator('[data-slot="8"] .slot-marker')).toHaveCount(1);
  await expect(slots.locator('[data-slot="8"] .slot-label')).toHaveCount(0);
  await expect(slots.locator('[data-slot="9"] .slot-marker')).toHaveCount(1);
  await expect(slots.locator('[data-slot="10"] .slot-planet.planet-empty')).toHaveCount(1);
  await page.evaluate(async () => {
    Object.assign(window.previewPositions[7], { scouted: true, planet: { name: '푸른별 콜로니', username: 'neighbor' } });
    await window.scoutedMap.refreshMap();
    window.scoutedMap.chart.stop();
  });
  await expect(slots.locator('[data-slot="8"] .slot-marker')).toHaveCount(0);
  await expect(slots.locator('[data-slot="8"] .slot-planet')).toHaveCount(1);
  await expect(slots.locator('[data-slot="8"] .slot-label')).toHaveText('푸른별 콜로니');
  const ownColor = await slots.locator('[data-slot="4"] .slot-label').evaluate(el => getComputedStyle(el).fill);
  const foreignColor = await slots.locator('[data-slot="8"] .slot-label').evaluate(el => getComputedStyle(el).fill);
  expect(foreignColor).toBe('rgb(159, 193, 234)');
  expect(ownColor).not.toBe(foreignColor);
  await page.locator('#scouted-map-preview .orbit-svg .slot[data-slot="8"]').press('Enter');
  await expect(page.locator('#scouted-map-preview .slot-detail-title')).toHaveText('푸른별 콜로니');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(slots.locator('[data-slot="8"] .slot-label')).toBeVisible();
  }
});
