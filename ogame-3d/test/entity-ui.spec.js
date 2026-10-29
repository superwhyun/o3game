import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mongoose = require('../../server/node_modules/mongoose');
const uri = process.env.FLEET_UI_MONGODB_URI;
test.skip(!uri, 'Dedicated cosmic_fleet_ui_test DB required');
test.describe.configure({ mode: 'serial' });
let fixture;
const dir = new URL('../../artifacts/entity-ui/', import.meta.url).pathname;
test.beforeAll(async () => {
  if (!/\/cosmic_fleet_ui_test(\?|$)/.test(uri))
    throw Error('Dedicated UI DB required');
  execFileSync(process.execPath, ['server/scripts/seedFleetPreview.js'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      ...process.env,
      FLEET_PREVIEW_URI: uri,
      JWT_SECRET: 'isolated-fleet-preview-secret-not-for-production-2026',
    },
  });
  fixture = JSON.parse(readFileSync('/tmp/oogame-fleet-preview.json', 'utf8'));
  mkdirSync(dir, { recursive: true });
  await mongoose.connect(uri);
  await require('../../server/models/User').updateOne(
    { _id: fixture.user.id },
    {
      $set: {
        'planets.0.buildings.metalMine': 9,
        'planets.0.buildings.researchLab': 3,
        'planets.0.resources.metal': 200000,
        'planets.0.resources.crystal': 200000,
        'planets.0.resources.deuterium': 200000,
      },
    },
  );
});
test.afterAll(async () => {
  await mongoose.disconnect();
});
async function login(page) {
  await page.addInitScript((f) => {
    localStorage.setItem('token', f.token);
    localStorage.setItem('user', JSON.stringify(f.user));
  }, fixture);
  await page.goto('/');
  await page.locator('.holo-btn[data-view="buildings"]').click();
}
async function completeQueue(type) {
  const Queue = require('../../server/models/BuildingQueue');
  await expect
    .poll(() =>
      Queue.countDocuments({
        userId: fixture.user.id,
        type,
        status: 'building',
      }),
    )
    .toBeGreaterThan(0);
  await Queue.updateMany(
    { userId: fixture.user.id, type, status: 'building' },
    { $set: { endTime: new Date(Date.now() - 1000) } },
  );
}
test('completed construction changes tier, preview preserves commands, research completes and all 64 exhibits render', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const media = page.locator('#buildings-browser .detail-media');
  await expect(media).toHaveAttribute('data-tier', '0');
  await page
    .locator('#buildings-browser [data-model-action="preview"]')
    .click();
  await expect(media).toHaveAttribute('data-tier', '1');
  await expect(media).toHaveAttribute('data-preview', 'true');
  await expect(page.locator('#buildings-browser .detail-amount')).toContainText(
    'Lv 9',
  );
  await page
    .locator('#buildings-browser [data-model-action="preview"]')
    .click();
  await expect(media).toHaveAttribute('data-tier', '0');
  await page.locator('#buildings-browser .entity-row.is-selected [data-command="building"]').click();
  await expect(
    page.locator('#buildings-browser .entity-row.is-selected [data-command="building"]'),
  ).toBeDisabled();
  await expect(media).toHaveAttribute('data-tier', '0');
  await completeQueue('building');
  await page.evaluate(() => window.uiManager.syncUserDataFromServer());
  await expect(media).toHaveAttribute('data-tier', '1');
  await expect(page.locator('#buildings-browser .detail-amount')).toContainText(
    'Lv 10',
  );
  await page
    .locator('#buildings-browser .entity-detail')
    .evaluate((el) => (el.scrollTop = 0));
  await expect(page.locator('.holo-notification')).toHaveCount(0, {
    timeout: 8000,
  });
  await page.screenshot({ path: dir + 'building-desktop.png' });
  // Cancel an upgrade: appearance remains the last completed tier.
  await page.locator('#buildings-browser .entity-row.is-selected [data-command="building"]').click();
  await expect(page.locator('#buildings-panel-queue')).toContainText('L11');
  page.once('dialog', (d) => d.accept());
  const cancelResponse = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().includes('/api/queue/'),
  );
  await page.locator('#buildings-panel-queue .btn-cancel').first().click();
  expect((await cancelResponse).status()).toBe(200);
  await page.evaluate(() => window.uiManager.syncUserDataFromServer());
  await expect(media).toHaveAttribute('data-tier', '1');
  await expect(page.locator('#buildings-panel-queue .btn-cancel')).toHaveCount(
    0,
  );
  await page.locator('.holo-btn[data-view="research"]').click();
  await page
    .locator('#research-browser [data-entity="energyTechnology"]')
    .click();
  await expect(
    page.locator('#research-browser .research-exhibit-note'),
  ).toContainText('발전 코어');
  await page.locator('#research-browser .entity-row.is-selected [data-command="research"]').click();
  await completeQueue('research');
  await page.evaluate(() => window.uiManager.syncUserDataFromServer());
  await expect(page.locator('#research-browser .detail-amount')).toContainText(
    'Lv 1',
  );
  await page
    .locator('#research-browser [data-entity="shieldingTechnology"]')
    .click();
  await page
    .locator('#research-browser .entity-detail')
    .evaluate((el) => (el.scrollTop = 0));
  await expect(page.locator('.holo-notification')).toHaveCount(0, {
    timeout: 8000,
  });
  await page.screenshot({ path: dir + 'research-desktop.png' });
  await page.goto('/entity-lab.html');
  await expect(page.locator('.lab-card img[src]')).toHaveCount(64);
  const urls = await page
    .locator('.lab-card img')
    .evaluateAll((imgs) => imgs.map((i) => i.src));
  expect(new Set(urls).size).toBe(64);
  await page.screenshot({ path: dir + 'contact-sheet.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('planet selection and demolition refresh the completed facility tier', async ({
  page,
}) => {
  const User = require('../../server/models/User');
  const user = await User.findById(fixture.user.id);
  user.planets.push({
    name: '외형 검사 식민지',
    galaxy: 1,
    system: 1,
    planet: 12,
    buildings: { metalMine: 20, researchLab: 3 },
    resources: { metal: 10000, crystal: 10000, deuterium: 10000 },
  });
  await user.save();
  await login(page);
  await page.locator('#planet-select').selectOption('1');
  const media = page.locator('#buildings-browser .detail-media');
  await expect(page.locator('#buildings-browser .detail-amount')).toContainText(
    'Lv 20',
  );
  await expect(media).toHaveAttribute('data-tier', '2');
  page.once('dialog', (d) => d.accept());
  await page.locator('#buildings-browser .entity-row.is-selected [data-command="demolish"]').click();
  await expect(page.locator('#buildings-panel-queue')).toContainText('철거');
  await completeQueue('building');
  await page.evaluate(() => window.uiManager.syncUserDataFromServer());
  await expect(media).toHaveAttribute('data-tier', '1');
  await expect(page.locator('#buildings-browser .detail-amount')).toContainText(
    'Lv 19',
  );
  await page.locator('#planet-select').selectOption('0');
  await expect(page.locator('#buildings-browser .detail-amount')).toContainText(
    'Lv 10',
  );
  await expect(media).toHaveAttribute('data-tier', '1');
  await page.locator('.holo-btn[data-view="research"]').click();
  await page.locator('#research-browser [data-entity="terraforming"]').click();
  await expect(
    page.locator('#research-browser .research-exhibit-note'),
  ).toContainText('환경 조절 타워');
});

test('mobile scrolling, keyboard controls, reduced motion and WebGL fallback preserve actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  const root = page.locator('#buildings-browser');
  await expect(page.locator('#planet-development')).toBeVisible();
  await expect(page.locator('#building-area')).toHaveCount(0);
  await page.locator('#planet-development').click();
  await expect(page.locator('#planet-development-details')).toContainText('개발 현황');
  await page.locator('.modal-close').click();
  const media = root.locator('.detail-media');
  await expect(media).toBeHidden();
  await expect(root.locator('.ship-viewer-canvas')).toHaveCount(0);
  await expect(root.locator('.detail-header')).toBeHidden();
  await expect(root.locator('.detail-section').filter({ hasText: '선행 조건' })).toBeVisible();
  await expect(root.locator('.detail-section').filter({ hasText: '소요 자원' })).toBeVisible();
  await root.locator('[data-details]').click();
  await expect(page.locator('.entity-full-details .detail-header')).toBeVisible();
  await expect(page.locator('.entity-full-details .spec-list')).toBeVisible();
  await expect(page.locator('.entity-full-details')).toContainText('소요 시간');
  await page.locator('.modal-close').click();
  await expect(root.locator('.detail-header')).toBeHidden();
  await root.locator('.entity-detail').evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: dir + 'building-mobile.png' });
  await root.locator('.entity-row.is-selected [data-command="building"]').scrollIntoViewIfNeeded();
  await expect(root.locator('.entity-row.is-selected [data-command="building"]')).toBeVisible();
  // Desktop exposes a compact exhibit beside the title.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(media).toBeVisible();
  await expect(root.locator('.ship-viewer-canvas')).toHaveCount(1);
  await expect(root.locator('.model-controls')).toHaveCount(0);
  expect(await media.evaluate(el => el.getBoundingClientRect().left > el.parentElement.querySelector('.detail-intro').getBoundingClientRect().left)).toBe(true);
  // A lost GL context leaves a still model/description and gameplay buttons available.
  await page.evaluate(async () => {
    const v = window.uiManager.browsers.buildings.viewer;
    const ext = v.renderer.getContext().getExtension('WEBGL_lose_context');
    window.restoreModelContext = () => ext.restoreContext();
    ext.loseContext();
  });
  await expect(root.locator('.model-fallback')).toBeVisible();
  await expect(root.locator('.entity-row.is-selected [data-command="building"]')).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.restoreModelContext());
  await expect(root.locator('.model-fallback')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(media).toBeHidden();
  await page.locator('.holo-btn[data-view="research"]').click();
  await page
    .locator('#research-browser [data-entity="armorTechnology"]')
    .click();
  await page
    .locator('#research-browser .entity-detail')
    .evaluate((el) => (el.scrollTop = 0));
  const commandBox = await page
    .locator('#research-browser .entity-row.is-selected [data-command="research"]')
    .boundingBox();
  const navBox = await page
    .locator('.holo-btn[data-view="research"]')
    .boundingBox();
  expect(commandBox.y + commandBox.height).toBeLessThanOrEqual(navBox.y);
  await page.screenshot({ path: dir + 'research-mobile.png' });
});
test('one inspector survives 50 screen switches without GPU accumulation and stops off screen', async ({
  page,
}) => {
  await login(page);
  await page.locator('.holo-btn[data-view="research"]').click();
  await page
    .locator('#research-browser [data-entity="gravitonTechnology"]')
    .click();
  const measurements = await page.evaluate(async () => {
    const browser = window.uiManager.browsers.research;
    const initial = browser.modelMetrics().memory;
    for (let i = 0; i < 50; i++) {
      window.uiManager.switchView(i % 2 ? 'research' : 'buildings');
    }
    const before = performance.now();
    const times = [];
    let last = before;
    await new Promise((resolve) => {
      function tick(now) {
        times.push(now - last);
        last = now;
        if (now - before < 10000) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    const stats = browser.modelMetrics();
    window.uiManager.switchView('dashboard');
    const sorted = times.slice(1).sort((a, b) => a - b);
    return {
      initial,
      memory: stats.memory,
      draws: stats.render.calls,
      triangles: stats.render.triangles,
      thumbnail: stats.thumbnails,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      running: browser.modelMetrics().running,
    };
  });
  console.log('ENTITY PERFORMANCE', JSON.stringify(measurements));
  expect(measurements.memory.geometries).toBeLessThanOrEqual(
    measurements.initial.geometries + 2,
  );
  expect(measurements.memory.textures).toBeLessThanOrEqual(
    measurements.initial.textures + 1,
  );
  expect(measurements.draws).toBeLessThan(120);
  expect(measurements.triangles).toBeLessThan(50000);
  expect(measurements.thumbnail.entries).toBeLessThanOrEqual(96);
  expect(measurements.thumbnail.bytes).toBeLessThanOrEqual(48 * 1024 * 1024);
  expect(measurements.running).toBe(false);
});

test('WebGL unavailable retains descriptions and accepts a real research command', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).startsWith('webgl')
        ? null
        : original.call(this, type, ...args);
    };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await expect(
    page.locator('#buildings-browser .model-fallback'),
  ).toBeVisible();
  await page.locator('.holo-btn[data-view="research"]').click();
  await page
    .locator('#research-browser [data-entity="energyTechnology"]')
    .click();
  await expect(
    page.locator('#research-browser .research-exhibit-note'),
  ).toContainText('발전 코어');
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      r.url().includes('/api/queue/research'),
  );
  await page.locator('#research-browser .entity-row.is-selected [data-command="research"]').click();
  expect((await response).status()).toBe(200);
  await completeQueue('research');
  await page.evaluate(() => window.uiManager.syncUserDataFromServer());
  await expect(page.locator('#research-browser .detail-amount')).toContainText(
    'Lv 2',
  );
  expect(errors).toEqual([]);
});
