import { test, expect } from '@playwright/test';

for (const width of [320, 390, 1440]) {
  test(`compact map navigation, touch picker and colony shortcuts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let catalogUrl;
    let calls = 0;
    page.on('response', r => { if (/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url())) catalogUrl = r.url(); });
    await page.route('**/api/auth/check-admin', r => r.fulfill({ json: { hasAdmin: true } }));
    await page.route('**/api/game/galaxy?**', r => { calls++; return r.fulfill({ json: { positions: Array.from({ length: 15 }, (_, i) => i === 3 ? { position: 4, occupied: true, owner: 'self', planet: { id: 'colony', name: '제2거점' } } : { position: i + 1, occupied: false, scouted: i % 4 === 0 }) } }); });
    await page.goto('/');
    await page.waitForFunction(() => window.uiManager?.hasAdmin);
    await page.evaluate(async ({ catalogUrl }) => {
      const { catalog } = await import(catalogUrl);
      catalog.hydrate({ revision: 1, entities: [] });
      const state = window.gameState;
      Object.assign(state.planet, { id: 'home', name: '지구', galaxy: 1, system: 1, planet: 7 });
      state.planets = [
        { _id: 'colony', name: '제2거점', galaxy: 3, system: 20, planet: 4 },
        { _id: 'twelve', name: '12성계', galaxy: 1, system: 12, planet: 3 },
        { _id: 'outer', name: '외곽', galaxy: 1, system: 2, planet: 15 },
        { _id: 'home', name: '지구', galaxy: 1, system: 1, planet: 7 },
        { _id: 'inner', name: 'Colony-with-a-very-long-planet-name-'.repeat(4), galaxy: 1, system: 2, planet: 4 },
      ];
      state.currentPlanet = 3;
      window.uiManager.renderPlanetArea();
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('ui-layer').classList.remove('hidden');
      window.uiManager.switchView('combat');
    }, { catalogUrl });
    const planetSelect = page.locator('#planet-select');
    expect(await planetSelect.locator('option').evaluateAll(options => options.map(option => option.value)))
      .toEqual(['3', '4', '2', '1', '0']);
    await expect(planetSelect).toHaveValue('3');
    expect(await page.evaluate(() => window.gameState.planets.map(planet => planet._id)))
      .toEqual(['colony', 'twelve', 'outer', 'home', 'inner']);
    const nav = page.locator('#strike-map .system-nav');
    await expect(nav.locator('.system-location')).toHaveText('1 은하 · 1 성계');
    await expect(nav.locator(':scope > button')).toHaveCount(4);
    await expect(page.locator('#combat-reports, #scout-reports, #manual-combat-target')).toHaveCount(0);
    await expect(nav.locator('.touch-number')).toHaveCount(0);
    expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height <= 50)).toBe(true);
    await nav.locator('.system-location').click();
    const picker = page.locator('.system-picker:popover-open');
    await expect(picker).toBeVisible();
    await expect(nav.locator('.system-location')).toHaveAttribute('aria-expanded', 'true');
    const before = calls;
    await picker.locator('select').selectOption('2');
    await picker.locator('input[type=range]').evaluate(el => { el.value = 150; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(picker.locator('input[type=number]')).toHaveValue('150');
    expect(calls).toBe(before);
    expect(await picker.evaluate(el => { const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth; })).toBe(true);
    await page.screenshot({ path: `/tmp/o3game-system-picker-${width}.png` });
    await picker.locator('.system-apply').click();
    await expect(page.locator('.system-picker:popover-open')).toHaveCount(0);
    await expect(nav.locator('.system-location')).toHaveText('2 은하 · 150 성계');
    expect(await page.evaluate(() => window.uiManager.strikeMap.coords)).toEqual({ galaxy: 2, system: 150 });
    await nav.locator('.system-arrow').first().click();
    await expect(nav.locator('.system-location')).toHaveText('2 은하 · 149 성계');
    await nav.locator('.system-arrow').last().click();
    await expect(nav.locator('.system-location')).toHaveText('2 은하 · 150 성계');
    await nav.locator('.system-home').click();
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('aria-label', '내 행성 선택');
    await expect(nav.locator('.system-home')).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.locator('.system-location')).toHaveText('2 은하 · 150 성계');
    await expect(picker.locator('.system-picker-fields')).toBeHidden();
    const sortedCoordinates = ['[1:1:7]', '[1:2:4]', '[1:2:15]', '[1:12:3]', '[3:20:4]'];
    await expect(picker.locator('.system-shortcuts small')).toHaveText(sortedCoordinates);
    expect(await picker.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 12 && rect.right <= innerWidth - 12
        && rect.top >= 12 && rect.bottom <= innerHeight - 12
        && [el, ...el.querySelectorAll('.system-shortcuts, .system-shortcuts > div, .system-shortcuts button')]
          .every(node => node.scrollWidth <= node.clientWidth);
    })).toBe(true);
    await page.screenshot({ path: `/tmp/o3game-owned-planets-${width}.png` });
    await picker.getByRole('button', { name: '지구 [1:1:7]', exact: true }).click();
    await expect(nav.locator('.system-location')).toHaveText('1 은하 · 1 성계');
    await nav.locator('.system-home').click();
    await page.locator('.system-picker:popover-open').getByRole('button', { name: '제2거점 [3:20:4]', exact: true }).click();
    await expect(nav.locator('.system-location')).toHaveText('3 은하 · 20 성계');
    await expect(page.locator('#strike-map .strike-confirm')).toContainText('제2거점');
    expect(await page.evaluate(() => window.uiManager.strikeMap.target)).toBe(4);
    await nav.locator('.system-location').click();
    await expect(picker.locator('.system-shortcuts small')).toHaveText(sortedCoordinates);
    await nav.locator('.system-location').click();
    await expect(page.locator('.system-picker:popover-open')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/o3game-compact-operations-${width}.png` });
    await nav.locator('.system-location').click();
    await page.evaluate(() => window.uiManager.switchView('galaxy'));
    await expect(page.locator('.system-picker:popover-open')).toHaveCount(0);
    const galaxyNav = page.locator('#galaxy-panel .system-nav');
    await expect(galaxyNav.locator(':scope > button')).toHaveCount(4);
    expect(await galaxyNav.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height <= 50)).toBe(true);
    await galaxyNav.locator('.system-location').click();
    if (width < 700) {
      const coordinateInput = picker.locator('input[type=number]');
      await coordinateInput.focus();
      await coordinateInput.fill('123');
      // Mobile keyboards resize the viewport while the coordinate field is focused.
      await page.setViewportSize({ width, height: 500 });
      await expect(picker).toBeVisible();
      await expect(coordinateInput).toBeFocused();
      await expect(coordinateInput).toHaveValue('123');
      await expect.poll(() => picker.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 12 && rect.bottom <= innerHeight - 12;
      })).toBe(true);
      await page.setViewportSize({ width, height: 900 });
      await expect(picker).toBeVisible();
      await expect(coordinateInput).toHaveValue('123');
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.system-picker:popover-open')).toHaveCount(0);
    await galaxyNav.locator('.system-home').click();
    await expect(picker.locator('.system-shortcuts small')).toHaveText(sortedCoordinates);
    await galaxyNav.locator('.system-home').click();
    await expect(page.locator('.system-picker:popover-open')).toHaveCount(0);
  });
}
