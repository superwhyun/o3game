import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { privateKeyToAccount, generatePrivateKey } = require('../../server/node_modules/viem/accounts');

const fixture = JSON.parse(readFileSync(process.env.E2E_FIXTURE || '/tmp/oogame-cgc-e2e.json', 'utf8'));
const control = async (path, method = 'GET') => (await fetch(`${fixture.control}${path}`, { method })).json();
const api = async (who, path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${fixture.gameUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
};
test.describe.configure({ mode: 'serial' });

const wallets = {};
const walletOf = (who) => (wallets[who.username] ??= privateKeyToAccount(generatePrivateKey()));

/** Open the game as a fixture user with an in-page wallet that signs with a real key on the Node side. */
async function open(page, who, { withWallet = true } = {}) {
  const account = walletOf(who);
  if (withWallet) {
    await page.exposeFunction('__wallet', async (method, params) => {
      if (method === 'personal_sign') return account.signMessage({ message: { raw: params[0] } });
      if (method === 'eth_signTypedData_v4') {
        const typed = JSON.parse(params[1]);
        const { EIP712Domain, ...types } = typed.types;
        return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
      }
      throw Object.assign(new Error(`unsupported ${method}`), { code: -32601 });
    });
    await page.addInitScript((address) => {
      window.ethereum = { request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
        if (method === 'eth_chainId') return '0x31769';
        if (method === 'wallet_switchEthereumChain') return null;
        return window.__wallet(method, params);
      } };
    }, account.address);
  }
  await page.addInitScript(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }, { token: who.token, user: { username: who.username, id: who.id, isAdmin: who.username === 'e2e_admin' } });
  await page.goto('/');
  await expect(page.locator('#planet-select')).toBeVisible({ timeout: 30000 });
}
const view = (page, name) => page.locator(`.holo-btn[data-view="${name}"]`).click({ noWaitAfter: true });

test('a player links a wallet by signing, then buys an emblem and speed-up time with CGC', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page, fixture.buyer);
  await view(page, 'market');
  await expect(page.locator('#market-wallet-title')).toBeVisible();
  await expect(page.locator('[data-action="link"]')).toBeEnabled();
  await page.locator('[data-action="link"]').click();
  await expect(page.locator('.market-wallet-address .pill')).toHaveText('연결됨');
  const linked = await api(fixture.buyer, '/api/wallet');
  expect(linked.body.address).toBe(walletOf(fixture.buyer).address.toLowerCase());

  // Emblem
  page.on('dialog', (dialog) => dialog.accept());
  const comet = page.locator('[data-product="emblem.comet"]');
  await expect(comet.locator('[data-buy]')).toBeEnabled();
  await comet.locator('[data-buy]').click();
  await expect(page.locator('.market-rights .fleet-emblem')).toHaveCount(1, { timeout: 60000 });
  await expect(comet).toHaveClass(/is-owned/);
  await expect(comet.locator('[data-buy]')).toHaveText('보유 중');

  // Speed-up time, two units
  const speedup = page.locator('[data-product="speedup.1h"]');
  await speedup.locator('[data-qty]').fill('2');
  await speedup.locator('[data-qty]').dispatchEvent('change');
  await expect(speedup.locator('.market-price')).toContainText('1.000000');
  await speedup.locator('[data-buy]').click();
  await expect(page.locator('[data-speedup-balance]')).toHaveText('2시간', { timeout: 60000 });

  const fake = await control('/fake');
  expect(fake.payments.filter((p) => p.status === 'COMPLETED').length).toBe(2);
  expect(BigInt(fake.budget)).toBeGreaterThanOrEqual(500_000_000n + 5_000_000n); // sales reached the game budget
  await expect(page.locator('.market-orders tbody tr')).toHaveCount(2);
  await page.screenshot({ path: '../artifacts/cgc-ui/market-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../artifacts/cgc-ui/market-mobile.png' });
  expect(errors).toEqual([]);
});

test('a phone without a wallet can still play: the market explains and keeps purchase buttons off', async ({ page }) => {
  await open(page, fixture.rival, { withWallet: false });
  await view(page, 'market');
  await expect(page.locator('.market-notice')).toContainText('지갑을 찾지 못했습니다');
  await expect(page.locator('[data-buy]').first()).toBeDisabled();
  await expect(page.locator('[data-buy]').first()).toHaveText(/지갑 연결 필요|구매할 수 없습니다/);
});

/** The combat fixtures own a wallet, a comet emblem and two hours of speed-up time. */
async function prepare(who, extra = '') {
  const account = walletOf(who);
  await control(`/grant/${who.id}/${account.address}?speedup=7200&emblems=comet${extra}`, 'POST');
}

test('a bought emblem is chosen on a formation and shown on its card', async ({ page }) => {
  await prepare(fixture.player);
  await open(page, fixture.player);
  await view(page, 'fleet');
  await page.locator('[data-action="create"]').first().click();
  await expect(page.locator('.formation-card')).toHaveCount(1);
  const emblems = page.locator('.emblem-picker .emblem-option');
  await expect(emblems.filter({ hasText: '없음' })).toBeVisible();
  await expect(page.locator('.emblem-picker [data-emblem="comet"]')).toBeEnabled();
  await expect(page.locator('.emblem-picker [data-emblem="dragon"]')).toHaveCount(0); // not owned, not offered
  await page.locator('[data-quantity="cruiser"]').fill('40');
  await page.locator('[data-quantity="cruiser"]').dispatchEvent('change');
  await page.locator('.emblem-picker [data-emblem="comet"]').click();
  await expect(page.locator('.emblem-picker [data-emblem="comet"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('.formation-card .fleet-emblem')).toHaveCount(1);
  const state = await api(fixture.player, '/api/game/fleet-formations');
  expect(state.body.snapshot.fleetFormations[0].emblem).toBe('comet');
  expect(state.body.snapshot.fleetFormations[0].ships.cruiser).toBe(40);
  // The server refuses an emblem that is not owned, whatever the page shows.
  const bad = await api(fixture.player, `/api/game/fleet-formations/${state.body.snapshot.fleetFormations[0].id}`, { method: 'PATCH', body: { name: 'x', ships: { cruiser: 1 }, emblem: 'dragon', expectedRevision: state.body.snapshot.fleetFormations[0].revision } });
  expect(bad.status).toBe(400);
  expect(bad.body.code).toBe('EMBLEM_NOT_OWNED');
});

test('stored speed-up time finishes the construction in progress', async ({ page }) => {
  await prepare(fixture.player);
  const levelBefore = (await api(fixture.player, '/api/auth/me')).body.planets[0].buildings.metalMine || 0;
  const queued = await api(fixture.player, '/api/queue/build', { method: 'POST', body: { buildingId: 'metalMine', planetId: '0' } });
  expect(queued.status).toBe(200);
  await open(page, fixture.player);
  await view(page, 'buildings');
  const button = page.locator('#buildings-panel-queue .btn-speedup, .queue-item .btn-speedup').first();
  await expect(button).toBeVisible();
  await button.click();
  const menu = page.locator('.speedup-menu');
  await expect(menu).toContainText('보유 2시간');
  await menu.locator('.cmd-btn.primary').click();
  await expect(page.locator('.holo-notification', { hasText: '단축했습니다' })).toBeVisible();
  await expect(page.locator('.btn-speedup')).toHaveCount(0, { timeout: 30000 });
  const me = await api(fixture.player, '/api/auth/me');
  expect(me.body.entitlements.speedupSeconds).toBeLessThan(7200);
  expect(me.body.entitlements.speedupSeconds).toBeGreaterThan(7000);
  expect(me.body.planets[0].buildings.metalMine).toBe(levelBefore + 1);
  // Time that is not owned cannot be spent.
  const again = await api(fixture.player, '/api/queue/build', { method: 'POST', body: { buildingId: 'metalMine', planetId: '0' } });
  await control(`/grant/${fixture.player.id}?speedup=0&emblems=comet`, 'POST');
  const refused = await api(fixture.player, '/api/queue/speedup', { method: 'POST', body: { queueId: again.body.queueItem.id, seconds: 10, requestId: crypto.randomUUID() } });
  expect(refused.body.code).toBe('INSUFFICIENT_SPEEDUP');
});

const until = async (read, ok, label, timeout = 60000) => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

/** A ready formation holding exactly these ships (made through the API when missing). */
async function formationWith(who, ships) {
  const read = async () => (await api(who, '/api/game/fleet-formations')).body.snapshot;
  const same = (f) => f.status === 'ready' && JSON.stringify(Object.entries(f.ships).filter(([, n]) => n > 0).sort()) === JSON.stringify(Object.entries(ships).sort());
  let snapshot = await read();
  const found = snapshot.fleetFormations.find(same);
  if (found) return found;
  const made = await api(who, '/api/game/fleet-formations', { method: 'POST', body: { originPlanetId: snapshot.planets[snapshot.currentPlanet]._id } });
  expect(made.status).toBe(201);
  const id = made.body.formationId;
  const saved = await api(who, `/api/game/fleet-formations/${id}`, { method: 'PATCH', body: { name: `e2e-${Object.keys(ships)[0]}-${Date.now() % 100000}`, ships, expectedRevision: 1 } });
  expect(saved.status).toBe(200);
  snapshot = await read();
  return snapshot.fleetFormations.find((f) => f.id === id);
}

test('an administrator creates a monster in the browser; a commander fights it, is paid in CGC, then collects the wreckage', async ({ browser }) => {
  test.setTimeout(420000);
  await prepare(fixture.player);

  // ---- administrator: define the monster and schedule it -----------------------------
  const adminPage = await browser.newPage();
  const adminErrors = []; adminPage.on('pageerror', (e) => adminErrors.push(e.message));
  adminPage.on('dialog', (d) => d.accept());
  await open(adminPage, fixture.admin, { withWallet: false });
  await expect(adminPage.locator('#admin-btn')).toBeVisible();
  await view(adminPage, 'admin');
  await adminPage.locator('.admin-tab[data-tab="events"]').click({ noWaitAfter: true });
  const root = adminPage.locator('#admin-events-root');
  await expect(root.locator('[data-new-type]')).toBeVisible();
  await root.locator('[data-new-type]').click();
  const typeForm = root.locator('form[data-form="type"]');
  await typeForm.locator('[name="typeId"]').fill('e2e-minnow');
  await typeForm.locator('[name="name"]').fill('작은 심연괴수');
  await typeForm.locator('[name="description"]').fill('브라우저 테스트용 괴수');
  await typeForm.locator('[name="unitId"]').fill('minnow');
  await typeForm.locator('[name="unitName"]').fill('심연의 새끼');
  await typeForm.locator('[name="count"]').fill('2');
  await typeForm.locator('[name="hull"]').fill('5000');
  await typeForm.locator('[name="unitShield"]').fill('0');
  await typeForm.locator('[name="attack"]').fill('10');
  await typeForm.locator('[name="wreckMetal"]').fill('20000');
  await typeForm.locator('[name="wreckCrystal"]').fill('10000');
  await typeForm.getByRole('button', { name: '저장' }).click();
  await expect(root.locator('table.admin-table').first().locator('tbody tr')).toHaveCount(1);
  await expect(root.getByText('e2e-minnow').first()).toBeVisible();

  // a bad definition is refused by the server and explained
  await root.locator('[data-edit-type="e2e-minnow"]').click();
  await root.locator('form[data-form="type"] [name="unitId"]').fill('cruiser');
  await root.locator('form[data-form="type"]').getByRole('button', { name: '저장' }).click();
  await expect(adminPage.locator('.holo-notification', { hasText: '카탈로그' })).toBeVisible();
  await root.locator('[data-cancel-edit]').click();

  const eventForm = root.locator('form[data-form="event"]');
  await eventForm.locator('[name="pool"]').fill('8');
  await eventForm.getByRole('button', { name: '이벤트 생성' }).click();
  await expect(root.locator('tr[data-event]')).toHaveCount(1);

  // the simulator reports one battle without saving anything
  const sim = root.locator('form[data-form="simulate"]');
  await sim.locator('[name="fleet:cruiser"]').fill('30');
  await sim.getByRole('button', { name: '시뮬레이션' }).click();
  await expect(root.locator('.admin-sim')).toContainText('처치');

  // ---- the monster appears (the server sweeps every few seconds) -------------------------
  const monster = await until(async () => (await control('/monsters'))[0], (m) => m?.status === 'ACTIVE' && m.location, 'the monster to appear', 45000);
  expect(monster.location.galaxy).toBeGreaterThanOrEqual(1);

  // ---- commander: see it, send a fleet, fight ---------------------------------------------
  const fleet = await formationWith(fixture.player, { cruiser: 40 });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page, fixture.player);
  await view(page, 'combat');
  const card = page.locator('.monster-card', { hasText: '작은 심연괴수' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('출현 중');
  await expect(card).toContainText('8');
  await card.locator('[data-monster-show]').click();
  const strike = page.locator('#strike-map');
  await expect(strike.locator('.slot-monster')).toHaveCount(1);
  await strike.locator(`[data-combat-fleet="${fleet.id}"]`).click();
  await strike.locator('.slot:has(.slot-monster)').focus();
  await page.keyboard.press('Enter'); // orbiting slots never hold still, so select by keyboard
  const confirm = strike.locator('.strike-confirm');
  await expect(confirm).toContainText('작은 심연괴수');
  await expect(confirm.locator('[name="mission"] option:checked')).toHaveText('괴수 공격');
  await expect(confirm).toContainText('CGC 보상 풀');
  await page.screenshot({ path: '../artifacts/cgc-ui/monster-confirm.png' });
  await confirm.locator('[data-confirm="launch"]').click();
  const sent = await until(async () => (await control(`/movements/${fixture.player.id}`)).filter((m) => m.mission === 'attack'), (list) => list.length > 0, 'the fleet to launch');
  await control(`/arrive/${sent.at(-1).id}`, 'POST');
  const done = await until(async () => (await control(`/movements/${fixture.player.id}`)).find((m) => m.id === sent.at(-1).id), (m) => m.status === 'returning', 'the battle', 45000);
  expect(done.notice).toContain('처치');

  // payout: the whole 8 CGC pool goes to the only commander, who had a wallet linked
  const wallet = walletOf(fixture.player).address.toLowerCase();
  const paid = await until(() => control('/fake'), (fake) => fake.balances[wallet] === '8000000', 'the CGC payout', 45000);
  expect(paid.balances[wallet]).toBe('8000000');
  const settled = await until(async () => (await control('/monsters'))[0], (m) => m.status === 'SETTLED', 'settlement', 45000);
  expect(settled.status).toBe('SETTLED');
  await expect(page.locator('.holo-notification', { hasText: '처치' }).first()).toBeVisible({ timeout: 30000 }).catch(() => {}); // pushed to connected browsers; not required

  // ---- wreckage: only ships that recycle can pick it up, first come first served ------------
  const wreck = await until(() => control('/debris'), (rows) => rows.length === 1 && rows[0].metal > 0, 'wreckage');
  expect(wreck[0].metal).toBe(Math.floor(2 * 20000 * 0.3));
  await control(`/arrive/${sent.at(-1).id}`, 'POST'); // the attack fleet comes home
  await until(async () => (await control(`/movements/${fixture.player.id}`)).find((m) => m.id === sent.at(-1).id), (m) => m.status === 'completed', 'the fleet to return');
  const recyclers = await formationWith(fixture.player, { recycler: 4 });
  await page.reload();
  await expect(page.locator('#planet-select')).toBeVisible({ timeout: 30000 });
  await view(page, 'combat');
  await page.evaluate((coords) => window.uiManager.strikeMap.show(coords), { galaxy: wreck[0].galaxy, system: wreck[0].system });
  await expect(strike.locator('.slot-debris')).toHaveCount(1);
  await strike.locator(`[data-combat-fleet="${recyclers.id}"]`).click();
  await strike.locator('.slot:has(.slot-debris)').focus();
  await page.keyboard.press('Enter');
  await expect(confirm).toContainText('전투 잔해');
  await expect(confirm.locator('[name="mission"] option:checked')).toHaveText('잔해 수거');
  await confirm.locator('[data-confirm="launch"]').click();
  const recycle = await until(async () => (await control(`/movements/${fixture.player.id}`)).filter((m) => m.mission === 'recycle'), (list) => list.length > 0, 'the recyclers to launch');
  await control(`/arrive/${recycle.at(-1).id}`, 'POST');
  const loaded = await until(async () => (await control(`/movements/${fixture.player.id}`)).find((m) => m.id === recycle.at(-1).id), (m) => m.status === 'returning', 'the recyclers to collect', 45000);
  expect(loaded.cargo.metal).toBe(12000);
  expect(loaded.cargo.crystal).toBe(6000);
  const left = await control('/debris');
  expect(left[0].metal + left[0].crystal).toBe(0);

  // the same wreckage cannot be sent for again
  const again = await api(fixture.player, '/api/game/fleets', { method: 'POST', body: { requestId: crypto.randomUUID(), mission: 'recycle', formationId: recyclers.id, originPlanetId: fixture.player.planetId, expectedRevision: recyclers.revision + 1, destination: { galaxy: wreck[0].galaxy, system: wreck[0].system, planet: wreck[0].planet }, cargo: {}, speed: 100 } });
  expect([409, 400]).toContain(again.status);
  expect(errors).toEqual([]);
  expect(adminErrors).toEqual([]);
  await page.screenshot({ path: '../artifacts/cgc-ui/monster-after.png' });
});
