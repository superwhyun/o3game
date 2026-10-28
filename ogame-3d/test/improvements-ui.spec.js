import { test, expect } from '@playwright/test';

for (const admin of [false, true]) {
  test(`${admin ? 'administrator' : 'user'} improvement form, list and deletion on mobile and desktop`, async ({ page }) => {
    await page.route('**/api/auth/check-admin', route => route.fulfill({ json: { hasAdmin: true } }));
    await page.goto('/');
    await page.waitForFunction(() => window.uiManager?.hasAdmin === true);
    let records = [{ _id: '1', title: '<img src=x onerror="window.injected=true">', description: '행성 목록 개선\n모바일에서 보기 쉽게', authorName: 'player', authorType:'ai', reviewStatus:'reviewed', decision:'partial', reviewNote:'일부 반영', createdAt: new Date().toISOString() }];
    let deleteCalls = 0;
    let failSubmission = true;
    await page.route('**/api/game/improvement-requests**', async route => {
      const request = route.request();
      if (request.method() === 'POST') {
        if (failSubmission) return route.fulfill({ status: 500, json: { error: '일시적인 등록 오류' } });
        const item = { _id: 'new', ...request.postDataJSON(), authorName: 'player', createdAt: new Date().toISOString() };
        records = [item, ...records];
        return route.fulfill({ status: 201, json: { request: item } });
      }
      if (request.method() === 'DELETE') {
        deleteCalls++;
        records = records.filter(item => item._id !== request.url().split('/').at(-1));
        return route.fulfill({ json: { deleted: true } });
      }
      const status = new URL(request.url()).searchParams.get('status');
      if (status) return route.fulfill({ json: { requests: records.filter(item => item.decision === status || (status === 'pending' && !item.decision)), nextCursor: null } });
      const before = new URL(request.url()).searchParams.get('before');
      return route.fulfill({ json: { requests: before ? [{ _id: 'older', title: '이전 제안', description: '내용', authorName: 'other', createdAt: new Date().toISOString() }] : records, nextCursor: before ? null : '1' } });
    });
    await page.evaluate(admin => {
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('ui-layer').classList.remove('hidden');
      const user = { username: 'player', isAdmin: admin };
      localStorage.setItem('user', JSON.stringify(user));
      window.uiManager.updateUserDisplay(user);
      document.getElementById('admin-btn').classList.toggle('hidden', !admin);
    }, admin);
    await page.locator('#improvements-btn').click();
    await expect(page.locator('#improvements-btn .label')).toHaveText(admin ? '개선 요청' : '개선 제안');
    await expect(page.locator('#admin-btn')).toBeVisible({ visible: admin });
    await expect(page.locator('.improvement-card')).toHaveCount(1);
    await expect(page.locator('.improvement-card img')).toHaveCount(0);
    await expect(page.locator('.improvement-row')).toHaveCount(1);
    await expect(page.locator('.improvement-description')).toBeHidden();
    await page.locator('.improvement-row').click();
    await expect(page.locator('.improvement-ai-badge')).toHaveText('AI 제안');
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    await expect(page.locator('[data-delete]')).toHaveCount(admin ? 1 : 0);
    await page.locator('[data-filter]').selectOption('rejected');
    await expect(page.locator('.improvement-card')).toHaveCount(0);
    await expect(page.locator('[data-more]')).toBeHidden();
    await page.locator('[data-filter]').selectOption('partial');
    await expect(page.locator('.improvement-card')).toHaveCount(1);
    await page.locator('[data-filter]').selectOption('all');
    await expect(page.locator('[data-more]')).toBeVisible();
    await page.locator('[data-more]').click();
    await expect(page.locator('.improvement-card')).toHaveCount(2);
    await expect(page.locator('[data-more]')).toBeHidden();
    await page.locator('.improvement-compose > summary').click();
    await page.locator('input[name=title]').fill('모바일 메뉴 개선');
    await page.locator('textarea[name=description]').fill('메뉴를 더 작게 보여 주세요.');
    await page.getByRole('button', { name: '제안 등록', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('일시적인 등록 오류');
    await expect(page.locator('input[name=title]')).toHaveValue('모바일 메뉴 개선');
    failSubmission = false;
    await page.getByRole('button', { name: '제안 등록', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('개선 제안을 등록했습니다.');
    await expect(page.locator('.improvement-card')).toHaveCount(3);
    await expect(page.locator('input[name=title]')).toHaveValue('');
    if (admin) {
      const card = page.locator('.improvement-card').first();
      await card.locator('.improvement-row').click();
      await card.locator('[data-delete]').click();
      await card.locator('[data-cancel]').click();
      expect(deleteCalls).toBe(0);
      await card.locator('[data-delete]').click();
      await card.locator('[data-confirm]').click();
      await expect(page.locator('.improvement-card')).toHaveCount(2);
      expect(deleteCalls).toBe(1);
    }
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.locator('.improvement-card').last().scrollIntoViewIfNeeded();
      const box = await page.locator('.improvement-card').last().boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const row = page.locator('.improvement-row').last();
      const titleBox = await row.locator('strong').boundingBox();
      const statusBox = await row.locator('b').boundingBox();
      expect(Math.abs((titleBox.y + titleBox.height / 2) - (statusBox.y + statusBox.height / 2))).toBeLessThan(2);
      await page.locator('#improvements-btn').scrollIntoViewIfNeeded();
      await expect(page.locator('#improvements-btn')).toBeVisible();
    }
  });
}
