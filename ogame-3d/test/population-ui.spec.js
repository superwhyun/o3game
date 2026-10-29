import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ENTITY_CATALOG_DEFAULTS: entities } = require('../../server/data/catalog');

function fixture() {
  return {
    id: '222222222222222222222222', username: 'population-preview', stateRevision: 10,
    serverTime: new Date().toISOString(), currentPlanet: 0, serverSpeed: 1,
    exchange: { rates: { metal: 3, crystal: 2, deuterium: 1, food: 2 }, fee: .05 },
    planets: [{ _id: '111111111111111111111111', name: '생활 콜로니', galaxy: 1, system: 1, planet: 1,
      resources: { metal: 5000, crystal: 3000, deuterium: 1000, food: 240, energy: 0 },
      buildings: { metalMine: 2, housing: 1, hydroponicFarm: 1, cultureCenter: 1, school: 1, clinic: 1 }, research: {}, fleet: {}, defense: {},
      area: { total: 100, available: 35, usable: 40, used: 5, reserved: 0, baseUsablePercent: 40, usablePercent: 40 },
      production: { metal: 100, crystal: 15, deuterium: 0, food: 10, energy: 0 },
      storage: { metal: 10000, crystal: 10000, deuterium: 10000, food: 1000 },
      populationState: {
        count: 10, housing: 25, employed: 4, unemployed: 6, culture: 20,
        happiness: 80, stability: 65, productionMultiplier: 1.4375,
        knowledge: 100, knowledgeCapacity: 10, health: 50, healthCapacity: 5, happinessMultiplier: 1.15, knowledgeMultiplier: 1.25,
        foodProduction: 20, foodConsumption: 10, foodNet: 10, foodCapacity: 1000, starving: false,
        growthProgress: .5, growthAllowed: true, growthBlockers: [], nextGrowthSeconds: 3600,
        happinessReasons: { base: 50, culture: 30, housing: 0, food: 0 },
        support: { housing: 15, food: 10, culture: 10 },
        jobs: { school: { name: '교육원', required: 1, assigned: 1, ratio: 1 }, clinic: { name: '의료센터', required: 1, assigned: 1, ratio: 1 }, metalMine: { name: '금속 광산', required: 2, assigned: 2, ratio: 1 }, hydroponicFarm: { name: '수경농장', required: 1, assigned: 1, ratio: 1 }, cultureCenter: { name: '문화센터', required: 1, assigned: 1, ratio: 1 } }
      }
    }], research: {}, queueState: { building: null, research: null, ship: null, defense: null, queue: [] }
  };
}
async function preview(page, snapshot = fixture()) {
  await page.route('**/api/auth/has-admin', route => route.fulfill({ json: { hasAdmin: true } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: snapshot }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin !== undefined);
  await page.evaluate(async ({ snapshot, entities }) => {
    const { catalog } = await import('/src/data/catalog.js');
    catalog.hydrate({ revision: 1, entities });
    window.gameState.syncFromServer(snapshot);
    window.uiManager.showDashboard();
    window.uiManager.updatePlanetInfo();
  }, { snapshot, entities });
}

test('population headers fit mobile and desktop; overview shows all live details', async ({ page }) => {
  await preview(page);
  for (const width of [320, 360, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = page.locator('#command-controls');
    await expect(controls).toBeVisible();
    await expect(controls.locator('#planet-select')).toBeVisible();
    await expect(page.locator('#esm-toggle')).toHaveCount(0);
    await expect(page.locator('#coords-display')).toHaveCount(0);
    await expect(page.locator('#user-section')).toBeVisible();
    await expect.poll(() => controls.evaluate(el => el.parentElement.matches('.holo-sidebar.left'))).toBe(width > 1200);
    if (width > 1200) {
      await expect(controls.locator('.time-display')).toBeVisible();
      expect(await page.locator('#user-section').evaluate(el => {
        const sidebar = el.closest('.holo-sidebar.left');
        return Boolean(sidebar) && el.getBoundingClientRect().top >= [...sidebar.querySelectorAll('.nav-section')].at(-1).getBoundingClientRect().bottom;
      })).toBe(true);
      expect(await controls.evaluate(el => el.getBoundingClientRect().bottom <= el.parentElement.querySelector('.nav-section').getBoundingClientRect().top)).toBe(true);
      await page.screenshot({ path: `/tmp/o3game-command-controls-${width}.png` });
    }
    await expect(page.locator('#header-population-count')).toBeVisible();
    await expect(page.locator('#header-population-count')).toHaveText('10');
    await expect(page.locator('#header-population-housing')).toHaveText('주거 25');
    await expect(page.locator('#food-count')).toBeVisible();
    await expect(page.locator('#food-count')).toHaveText('240');
    await expect(page.locator('#food-rate')).toHaveText('+10/h');
    await expect(page.locator('[data-resource="food"]')).toHaveAttribute('title', /저장 1,000/);
    const cellsFit = await page.locator('.holo-resources').evaluate(el => [...el.querySelectorAll('.resource-cell')].every(cell => {
      const bounds = cell.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && [...cell.querySelectorAll('.resource-name, .resource-value')].every(span => span.scrollWidth <= span.clientWidth + 1);
    }));
    expect(cellsFit, `resource cells at ${width}px`).toBe(true);
    await expect(page.locator('#population-summary')).toHaveCount(0);
    const overview = page.locator('#dashboard-population');
    for (const text of ['지식 / 건강', '144%', '식량 공급', '행복도 구성', '지식과 건강', '자동 일자리 배치', '금속 광산', '콜로니 초기 지원']) {
      await expect(overview).toContainText(text);
    }
    expect(await page.locator('[data-view="trade"]').evaluate(el => el.parentElement === document.querySelector('[data-view="galaxy"]').parentElement)).toBe(true);
    await expect(page.locator('#modal-overlay')).toBeHidden();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const p = window.gameState.planet.populationState;
    Object.assign(p, { count: 12, foodNet: -2, foodConsumption: 12, growthAllowed: false, growthBlockers: ['식량 공급 부족'], starving: true });
    window.gameState.resources.food = 0;
    window.gameState.productionRates.food = -2;
    window.uiManager.updateResourceDisplay();
  });
  await expect(page.locator('#dashboard-population')).toContainText('성장 중단: 식량 공급 부족');
  await expect(page.locator('#dashboard-population')).toContainText('식량이 고갈');
  await expect(page.locator('#header-population-count')).toHaveText('12');
  await expect(page.locator('#food-count')).toHaveText('0');
  await expect(page.locator('#food-rate')).toHaveText('-2/h');
  await expect(page.locator('[data-resource="food"]')).toHaveClass(/is-negative/);
  await page.screenshot({ path: '/tmp/o3game-population-mobile.png' });
  await page.evaluate(() => { window.gameState.resources.food = 1; window.gameState.lastUpdate = Date.now() - 3600000; });
  await expect.poll(() => page.evaluate(() => window.gameState.resources.food)).toBe(0);
  await page.evaluate(async () => {
    const { StrikeMap } = await import('/src/ui/views/StrikeMap.js');
    new StrikeMap({ root: document.getElementById('strike-map'), fetchSystem: async () => ({ planets: [] }),
      getHome: () => ({ galaxy: 1, system: 1, planet: 1 }), getFormations: () => [], isPending: () => false,
      onManage() {}, onLaunch() {} });
    document.getElementById('dashboard-panel').classList.add('hidden');
    document.getElementById('combat-panel').classList.remove('hidden');
  });
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.locator('.strike-head .galaxy-nav');
    await expect(nav).toBeVisible();
    expect(await nav.evaluate(el => {
      const bounds = [...el.querySelectorAll('input, button')].map(node => node.getBoundingClientRect());
      return bounds.every(b => Math.abs(b.height - 44) < 1 && Math.abs(b.bottom - bounds[0].bottom) < 1);
    })).toBe(true);
    await page.screenshot({ path: `/tmp/o3game-strike-controls-${width}.png` });
  }
});

test('civil facilities show capacities, jobs and staffing in compact and full details', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await preview(page);
  await page.evaluate(() => window.uiManager.switchView('buildings'));
  const root = page.locator('#buildings-browser');
  await expect(root.locator('[data-tab]')).toHaveText(['자원', '제조', '인구']);
  for (const [id, tab, label] of [['housing', 'population', '인구 수용량'], ['hydroponicFarm', 'population', '식량 생산'], ['cultureCenter', 'population', '문화 수용량'], ['school', 'population', '교육 수용량'], ['clinic', 'population', '의료 수용량']]) {
    await root.locator(`[data-tab="building:${tab}"]`).click();
    await root.locator(`[data-entity="${id}"]`).click();
    await expect(root.locator('.detail-effects')).toContainText(label);
    await expect(root.locator('.detail-effects')).toContainText('다음 단계 +10');
    if (id !== 'housing') await expect(root.locator('.detail-effects')).toContainText('인력 1.0 / 1');
    await expect(root.locator('.detail-media')).toBeHidden();
    await root.locator('[data-details]').click();
    await expect(page.locator('.entity-full-details')).toContainText(label);
    await page.locator('.modal-close').click();
  }
});

test('administrator can load coefficients, recover from failed save and save changes', async ({ page }) => {
  const settings = { initialPopulation: 10, initialHousingExtra: 5, initialFoodHours: 24, foodStorage: 1000, foodConsumptionPerPopulation: 1, growthHours: 2, minimumGrowthHappiness: 40, baseHappiness: 50, cultureHappinessRange: 30, overcrowdingPenalty: 30, starvationPenalty: 30, stabilitySensitivity: .5, productionSensitivity: .01 };
  let saved, attempts = 0;
  await page.route('**/api/admin/config', async route => {
    if (route.request().method() === 'PUT') {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 500, json: { error: '저장 실패 테스트' } });
      saved = route.request().postDataJSON();
    }
    return route.fulfill({ json: { populationSettings: settings } });
  });
  await preview(page);
  await page.evaluate(() => { window.uiManager.setupAdminEvents(); window.uiManager.switchView('admin'); window.uiManager.loadAdminTabData('settings'); document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.remove('active')); document.getElementById('tab-settings').classList.add('active'); });
  await expect(page.locator('#population-setting-growthHours')).toHaveValue('2');
  await page.locator('#population-setting-growthHours').fill('1');
  const save = page.locator('#population-settings-form button[type="submit"]');
  await save.click();
  await expect(page.locator('#population-settings-message')).toContainText('저장 실패 테스트');
  await expect(page.locator('#population-setting-growthHours')).toHaveValue('1');
  await save.click();
  await expect(page.locator('#population-settings-message')).toContainText('인구 설정을 저장');
  expect(saved.populationSettings.growthHours).toBe(1);
  expect(Object.keys(saved.populationSettings)).toHaveLength(13);
  await expect(save).toBeEnabled();
});


test('civil research explains the affected capacity and happiness', async ({ page }) => {
  await preview(page);
  await page.evaluate(() => window.uiManager.switchView('research'));
  const root = page.locator('#research-browser');
  await expect(root.locator('[data-tab]')).toHaveText(['전체', '인구', '행성', '전투', '추진']);
  await root.locator('[data-tab="research:population"]').click();
  for (const [id, label] of [['urbanPlanning', '주거시설 수용량'], ['agriculturalTechnology', '농장 식량 생산'], ['educationTechnology', '교육원 수용량'], ['medicalTechnology', '의료센터 수용량'], ['socialPolicy', '행복도']]) {
    await root.locator(`[data-entity="${id}"]`).click();
    await expect(root.locator('.detail-effects')).toContainText(label);
    await expect(root.locator('.detail-effects')).toContainText('다음 단계');
  }
});


test('row commands act on their own building/research, show time and enforce availability', async ({ page }) => {
  await preview(page);
  await page.evaluate(() => {
    window.uiManager.switchView('buildings');
    window.rowCommands = [];
    const browser = window.uiManager.browsers.buildings;
    browser.onCommand = entity => new Promise(resolve => {
      window.rowCommands.push(`build:${entity.id}`);
      window.finishRowCommand = resolve;
    });
    browser.onDemolish = async entity => { window.rowCommands.push(`demolish:${entity.id}`); };
  });
  const root = page.locator('#buildings-browser');
  const row = id => root.locator(`.entity-row:has([data-entity="${id}"])`);
  await expect(row('metalMine').locator('.entity-row-time')).not.toBeEmpty();
  await expect(row('metalMine').locator('[data-command="building"]')).toHaveText('+');
  await expect(row('deuteriumSynthesizer').locator('[data-command="demolish"]')).toBeDisabled();
  // Crystal mine is not selected: its + button must still issue a crystal command.
  await row('crystalMine').locator('[data-command="building"]').click();
  await expect.poll(() => page.evaluate(() => window.rowCommands)).toEqual(['build:crystalMine']);
  await expect(row('metalMine').locator('[data-command="building"]')).toBeDisabled();
  await expect(row('metalMine').locator('[data-command="demolish"]')).toBeDisabled();
  await page.evaluate(() => window.finishRowCommand());
  await expect(row('metalMine').locator('[data-command="building"]')).toBeEnabled();
  await row('metalMine').locator('[data-command="demolish"]').click();
  await expect.poll(() => page.evaluate(() => window.rowCommands)).toEqual(['build:crystalMine', 'demolish:metalMine']);
  await expect(root.locator('.detail-command [data-command]')).toHaveCount(0);
  for (const width of [320, 390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(row('metalMine').locator('[data-command="building"]')).toBeVisible();
    await expect(root.locator('.model-controls')).toHaveCount(0);
    if (width > 700) {
      expect(await root.locator('.detail-heading').evaluate(el => {
        const title = el.querySelector('.detail-intro').getBoundingClientRect();
        const model = el.querySelector('.detail-media').getBoundingClientRect();
        return model.left >= title.right - 1 && Math.abs(model.top - title.top) <= 16 && model.height <= 180;
      })).toBe(true);
    }
    expect(await row('metalMine').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await root.locator('.entity-name').evaluateAll(els => els.every(el => el.clientWidth >= 70 && el.scrollWidth <= el.clientWidth + 1))).toBe(true);
    await expect(row('metalMine').locator('.entity-name')).toHaveText('금속 광산');
    await page.screenshot({ path: `/tmp/o3game-row-commands-${width}.png` });
  }
  await page.evaluate(() => {
    window.gameState.resources.metal = 0;
    window.uiManager.browsers.buildings.render();
  });
  await expect(row('metalMine').locator('[data-command="building"]')).toBeDisabled();
  await page.evaluate(() => {
    window.gameState.resources.metal = 5000;
    window.gameState.buildings.researchLab = 2;
    window.uiManager.switchView('research');
    window.uiManager.browsers.research.onCommand = async entity => window.rowCommands.push(`research:${entity.id}`);
  });
  const research = page.locator('#research-browser');
  const education = research.locator('.entity-row:has([data-entity="educationTechnology"])');
  await expect(education.locator('[data-command="research"]')).toBeEnabled();
  await expect(education.locator('[data-command="demolish"]')).toHaveCount(0);
  for (const width of [320, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(education.locator('.entity-name')).toHaveText('교육체계');
    expect(await research.locator('.entity-name').evaluateAll(els => els.every(el => el.clientWidth >= 70 && el.scrollWidth <= el.clientWidth + 1))).toBe(true);
    await page.screenshot({ path: `/tmp/o3game-research-row-commands-${width}.png` });
  }
  await education.locator('[data-command="research"]').click();
  await expect.poll(() => page.evaluate(() => window.rowCommands.at(-1))).toBe('research:educationTechnology');
  await expect(research.locator('.detail-command [data-command]')).toHaveCount(0);
});


test('trade quotes, validation, failure recovery and climate surfaces reflect the current planet', async ({ page }) => {
  let attempts = 0, submitted;
  await page.route('**/api/game/trade', route => {
    submitted = route.request().postDataJSON();
    if (++attempts === 1) return route.fulfill({ status: 500, json: { error: '거래 실패 테스트' } });
    const snapshot = fixture();
    snapshot.stateRevision = 11;
    snapshot.planets[0].resources.metal = 4700;
    snapshot.planets[0].resources.crystal = 3190;
    return route.fulfill({ json: { quote: { received: 190 }, snapshot } });
  });
  await preview(page);
  const surfaces = [];
  for (const [type, name] of [['ice', '얼음 행성'], ['volcanic', '화산 행성'], ['tropical', '열대 행성'], ['desert', '사막 행성']]) {
    await page.evaluate(({type, name}) => {
      window.gameState.planet.environment = { type, name, description: `${name} 지형` };
      window.uiManager.updatePlanetInfo();
    }, {type, name});
    await expect(page.locator('#planet-environment')).toHaveText(name);
    await expect(page.locator('#planet-visual')).toHaveAttribute('data-environment', type);
    surfaces.push(await page.locator('#planet-visual').evaluate(el => getComputedStyle(el).backgroundImage));
    await page.screenshot({ path: `/tmp/o3game-planet-${type}.png` });
  }
  expect(new Set(surfaces).size).toBe(4);
  await page.evaluate(() => document.getElementById('admin-btn').classList.remove('hidden'));
  await expect(page.locator('.sidebar-account #admin-btn')).toBeVisible();
  await page.locator('[data-view="trade"]').click();
  await expect(page.locator('#trade-quote')).toContainText('금속 300 → 수정 190');
  await expect(page.locator('#trade-rates')).toContainText('수수료 5%');
  await page.locator('#trade-to').selectOption('metal');
  await expect(page.locator('#trade-submit')).toBeDisabled();
  await expect(page.locator('#trade-quote')).toContainText('서로 다른');
  await page.locator('#trade-to').selectOption('crystal');
  await page.locator('#trade-amount').fill('999999');
  await expect(page.locator('#trade-submit')).toBeDisabled();
  await expect(page.locator('#trade-quote')).toContainText('지불 자원이 부족');
  await page.locator('#trade-amount').fill('300');
  await page.locator('#trade-submit').click();
  await expect(page.locator('#trade-message')).toContainText('거래 실패 테스트');
  await expect(page.locator('#trade-submit')).toBeEnabled();
  await page.locator('#trade-submit').click();
  await expect(page.locator('#trade-message')).toContainText('교환 완료');
  expect(submitted).toEqual({ planetId: '111111111111111111111111', from: 'metal', to: 'crystal', amount: 300 });
  await expect.poll(() => page.evaluate(() => window.gameState.resources.crystal)).toBeGreaterThanOrEqual(3190);
  await page.evaluate(() => { window.gameState.planet.populationState.foodCapacity = 250; });
  await page.locator('#trade-to').selectOption('food');
  await expect(page.locator('#trade-quote')).toContainText('저장 공간이 부족');
  await expect(page.locator('#trade-submit')).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.locator('#resource-trade-form').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
