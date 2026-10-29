import { test, expect } from '@playwright/test';

test('compact scout command leaves space and expanded reports remain scrollable at different heights', async ({ page }) => {
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  await page.goto('/');
  await page.evaluate(async () => {
    const { GalaxyView } = await import('/src/ui/views/GalaxyView.js');
    const { ScoutController } = await import('/src/ui/views/ScoutController.js');
    const { ScoutReportsView } = await import('/src/ui/views/ScoutReportsView.js');
    const root = document.getElementById('galaxy-holo');
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('ui-layer').classList.remove('hidden');
    document.querySelectorAll('.holo-panel').forEach(el => el.classList.add('hidden'));
    document.getElementById('galaxy-panel').classList.remove('hidden');
    const positions = Array.from({ length: 15 }, (_, i) => ({ position: i + 1, occupied: false, scouted: false }));
    positions[7] = { position: 8, occupied: true, owner: 'other', scouted: true, planet: { name: '관측 콜로니', username: 'neighbor' } };
    const controls = Object.fromEntries(['prev','next','galaxy','system','home'].map(key => [key, document.createElement(key === 'galaxy' || key === 'system' ? 'input' : 'button')]));
    const galaxy = new GalaxyView({ root, controls, fetchSystem: async () => ({ positions }), getHome: () => ({ galaxy: 1, system: 1 }), onTarget: () => {} });
    await galaxy.show();
    galaxy.chart.stop();
    const state = { userId: 'layout-preview', planet: { id: 'home', galaxy: 1, system: 1, planet: 4, name: '지구' }, fleet: { espionageProbe: 2 }, unassignedShips: { espionageProbe: 2 }, fleetMovements: [] };
    let view;
    const controller = new ScoutController({ api: {}, state, notify: () => {}, onChange: () => view.render(positions[7]), storage: { getItem: () => null, setItem: () => {} } });
    controller.ensureAccount();
    controller.target = { galaxy: 1, system: 1, planet: 8 };
    controller.targetReports = [{ id: 'report', destination: controller.target, outcome: 'occupied', observedAt: new Date().toISOString(), targetName: '관측 콜로니', targetCommander: 'neighbor', informationTier: 4, sections: { resources: { metal: 5000, crystal: 3000, deuterium: 1000 }, buildings: { metalMine: 10, crystalMine: 8, deuteriumSynthesizer: 6, solarPlant: 7, shipyard: 3, researchLab: 5 }, research: { espionageTechnology: 5, energyTechnology: 8 } }, initialProbeCount: 1, survivorCount: 1 }];
    view = new ScoutReportsView(galaxy.scoutEl, { controller, state, onNavigate: () => {}, onMissions: () => {} });
    view.render(positions[7]);
  });
  await page.locator('#galaxy-holo .scout-report summary').click();
  for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 600], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const command = await page.locator('#galaxy-holo .scout-command').boundingBox();
    expect(command.height).toBeLessThanOrEqual(120);
    expect((await page.locator('#galaxy-holo .scout-launch').boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.locator('#galaxy-holo .scout-survivors').scrollIntoViewIfNeeded();
    const last = await page.locator('#galaxy-holo .scout-survivors').boundingBox();
    expect(last.y).toBeGreaterThanOrEqual(0);
    expect(last.y + last.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
