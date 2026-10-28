import { test, expect } from '@playwright/test';

test('galaxy and fleet maps use their own planet shading after switching menus', async ({ page }) => {
  let catalogUrl;
  page.on('response', r => {if (/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url())) catalogUrl=r.url();});
  await page.route('**/api/auth/check-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  const positions = Array.from({ length: 15 }, (_, i) => ({ position: i + 1, occupied: false, scouted: false }));
  positions[3] = { position: 4, occupied: true, owner: 'self', planet: { id: 'home', name: '내 행성', username: 'me' } };
  positions[7] = { position: 8, occupied: true, owner: 'other', scouted: true, planet: { id: 'other', name: '정찰한 행성', username: 'neighbor' } };
  positions[9].scouted = true;
  positions[11] = {position:12,occupied:true,owner:'other',scouted:true,planet:{id:'pirate',name:'해적 행성 Lv.3',username:'해적',isPirate:true,pirateLevel:3}};
  await page.route('**/api/game/galaxy?**', route => route.fulfill({ json: { positions } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
  await page.evaluate(async ({catalogUrl}) => {
    const { catalog } = await import(catalogUrl);
    catalog.hydrate({ revision: 1, entities: [] });
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('ui-layer').classList.remove('hidden');
    Object.assign(window.gameState.planet, { id: 'home', name: '내 행성', galaxy: 1, system: 1, planet: 4 });
  },{catalogUrl});
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await expect(page.locator('#galaxy-holo .slot-planet')).toHaveCount(4);
  await page.locator('.holo-btn[data-view="combat"]').click();
  await expect(page.locator('#strike-map .slot-planet')).toHaveCount(4);
  for (const view of ['galaxy', 'combat', 'galaxy', 'combat']) {
    await page.locator(`.holo-btn[data-view="${view}"]`).click();
    const root = page.locator(view === 'galaxy' ? '#galaxy-holo' : '#strike-map');
    await expect(root.locator('.slot-planet')).toHaveCount(4);
    const paints = await root.locator('.orbit-svg').evaluate(svg => {
      return [...svg.querySelectorAll('.slot-planet, .star-core, .star-halo')].map(body => {
        const id = getComputedStyle(body).fill.match(/#([^)"]+)/)?.[1];
        const target = id && document.getElementById(id);
        return { id, local: target?.closest('svg') === svg, visible: target?.closest('.holo-panel')?.classList.contains('hidden') === false };
      });
    });
    expect(paints).toHaveLength(6);
    expect(paints.every(paint => paint.id && paint.local && paint.visible)).toBe(true);
    await expect(root.locator('[data-slot="8"] .slot-label')).toHaveText('정찰한 행성');
    await expect(root.locator('[data-slot="9"] .slot-marker')).toHaveCount(1);
    await expect(root.locator('[data-slot="12"] .planet-pirate')).toHaveCount(1);
    await expect(root.locator('[data-slot="12"] .slot-label')).toHaveText('해적 행성 Lv.3');
  }
  const ids = await page.locator('.orbit-svg radialGradient').evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#strike-map [data-slot="4"] .slot-planet')).toBeVisible();
});
