import { test, expect } from '@playwright/test';
test('scout report modes show observed charts, unknown sections and responsive details', async ({ page }) => {
  await page.route('**/api/auth/check-admin', r => r.fulfill({ json: { hasAdmin: true } }));
  await page.goto('/');
  await page.waitForFunction(() => window.uiManager?.hasAdmin);
  await page.evaluate(async () => {
    const { reportCard } = await import('/src/ui/views/ScoutReportsView.js');
    const { applyDisplayMode } = await import('/src/ui/views/displayModes.js');
    document.body.innerHTML = '<main id="report" style="max-width:800px;margin:auto"></main>';
    window.changeMode = applyDisplayMode;
    document.getElementById('report').innerHTML = reportCard({ id:'test', destination:{galaxy:2,system:3,planet:4}, outcome:'occupied', targetName:'관측 행성', observedAt:new Date().toISOString(), initialProbeCount:2, survivorCount:1, sections:{environment:{diameter:12800,minTemp:-20,maxTemp:40,maxTotal:625,total:240,usable:100,prospectiveUsable:120,production:{metal:1.2,crystal:1}}, resources:{metal:12000,crystal:4000,deuterium:0}, fleet:{smallCargo:2}, buildings:{metalMine:5}} });
    applyDisplayMode('graphics');
  });
  const report = page.locator('#report');
  await expect(report.locator('.scout-mode-graphics')).toBeVisible();
  await expect(report.locator('.scout-mode-simple')).toBeHidden();
  await expect(report.locator('.scout-mode-graphics')).toContainText('12,000');
  await expect(report.locator('.scout-area-chart')).toHaveAttribute('aria-label', '게임 최대 625칸 중 전체 면적 240칸');
  await expect(report.locator('.scout-mode-graphics')).toContainText('전체 면적 240 / 게임 최대 625칸');
  await expect(report.locator('.scout-production-bonus')).toHaveCount(1);
  await expect(report.locator('.scout-production-extra')).toHaveText('+20%');
  const metalChart = report.locator('.scout-production-chart').first();
  await expect(metalChart).toHaveAttribute('aria-label', '금속 120%, 추가 보정 +20%');
  expect(await metalChart.locator('.scout-production-base').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await metalChart.locator('.scout-production-bonus').evaluate(el => getComputedStyle(el).backgroundColor));
  const defense = report.locator('.scout-graph-section').filter({ has: page.locator('h5', { hasText:'방어시설' }) });
  await expect(defense).toContainText('미확인');
  await expect(defense.locator('progress')).toHaveCount(0);
  await expect(report.locator('.scout-full-information .scout-information').first()).toBeHidden();
  await expect(report.locator('.scout-full-information')).toBeHidden();
  await expect(report.locator('.scout-mode-graphics')).toContainText('정찰선 2척 출격 · 1척 생존');
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(report.locator('.scout-mode-graphics')).toBeVisible();
  }
  await page.evaluate(() => window.changeMode('simple'));
  await expect(report.locator('.scout-mode-simple')).toBeVisible();
  await expect(report.locator('.scout-mode-graphics')).toBeHidden();
  await page.evaluate(() => window.changeMode('detailed'));
  await expect(report.locator('.scout-mode-simple')).toBeHidden();
  await expect(report.locator('.scout-mode-graphics')).toBeHidden();
  await expect(report.locator('.scout-mode-detailed')).toBeVisible();
  await report.locator('.scout-full-information > summary').click();
  await expect(report.locator('.scout-full-information .scout-terrain')).toBeVisible();
});
