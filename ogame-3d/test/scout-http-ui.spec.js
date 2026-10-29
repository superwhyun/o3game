import { test, expect } from '@playwright/test';

test('scout clicks send unique requests without secure-context randomUUID', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined }));
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  const requests = [], errors = [];
  let remaining = 3;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/game/scouts', async route => {
    const order = route.request().postDataJSON();
    requests.push(order);
    remaining--;
    await route.fulfill({ status: 201, json: { snapshot: {
      unassignedShips: { espionageProbe: remaining },
      fleetMovements: requests.map(order => ({ mission: 'spy', requestId: order.requestId, destination: order.destination, status: 'flying', arrivalTime: new Date(Date.now() + 60000).toISOString() }))
    } } });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const { ScoutController } = await import('/src/ui/views/ScoutController.js');
    const { ScoutReportsView } = await import('/src/ui/views/ScoutReportsView.js');
    const { apiService } = await import('/src/services/ApiService.js');
    const root = document.createElement('section');
    root.id = 'scout-http-preview';
    root.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow:auto;background:#111;padding:20px;pointer-events:auto';
    document.body.append(root);
    const state = { userId: 'http-preview', planet: { id: '111111111111111111111111', galaxy: 1, system: 1, planet: 4, name: '출발 콜로니' }, fleet: { espionageProbe: 3 }, unassignedShips: { espionageProbe: 3 }, fleetMovements: [], syncFromServer(snapshot) { Object.assign(this, snapshot); } };
    const position = { position: 8, owner: 'other', planet: { id: '222222222222222222222222', username: 'target' } };
    let view;
    const controller = new ScoutController({ api: apiService, state, notify: title => { root.dataset.lastNotification = title; }, onChange: () => view.render(position) });
    controller.ensureAccount();
    controller.target = { galaxy: 1, system: 1, planet: 8 };
    view = new ScoutReportsView(root, { controller, state, onNavigate: () => {}, onMissions: () => {} });
    view.render(position);
  });
  const launch = page.locator('#scout-http-preview [data-scout-action="launch"]');
  for (let i = 1; i <= 3; i++) {
    await launch.click();
    await expect.poll(() => requests.length).toBe(i);
    await expect(page.locator('#scout-http-preview')).toHaveAttribute('data-last-notification', '정찰 출격');
  }
  expect(new Set(requests.map(order => order.requestId)).size).toBe(3);
  for (const order of requests) {
    expect(order.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(order.destination).toEqual({ galaxy: 1, system: 1, planet: 8 });
  }
  await expect(launch).toBeDisabled();
  expect(errors).toEqual([]);
});
