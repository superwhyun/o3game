import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mongoose = require('../../server/node_modules/mongoose');
const uri = process.env.FLEET_UI_MONGODB_URI;
test.skip(!uri, 'Dedicated UI test DB required');
test.describe.configure({ mode: 'serial' });
let fixture;
test.beforeAll(async () => { if (!/\/cosmic_fleet_ui_test(\?|$)/.test(uri)) throw Error('Dedicated UI test DB required'); await mongoose.connect(uri); });
test.beforeEach(async () => {
 execFileSync(process.execPath, ['server/scripts/seedFleetPreview.js'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, FLEET_PREVIEW_URI: uri, JWT_SECRET: 'isolated-fleet-preview-secret-not-for-production-2026' } });
 fixture = JSON.parse(readFileSync('/tmp/oogame-fleet-preview.json', 'utf8'));
});
test.afterAll(async () => { await mongoose.disconnect(); });
async function login(page, auth = fixture) {
 await page.addInitScript(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }, auth);
 await page.goto('/'); await page.locator('.holo-btn[data-view="galaxy"]').click();
}
test('map draws colored internal, external and return arrows without blocking planet selection', async ({ page }) => {
 const User = require('../../server/models/User'), Movement = require('../../server/models/FleetMovement');
 const other = await User.findOne({ username: 'target_ui_test' });
 const now = Date.now(), origin = { galaxy: 1, system: 1, planet: 4 }, destination = { galaxy: 1, system: 1, planet: 8 }, remote = { galaxy: 2, system: 17, planet: 12 };
 const base = { userId: other._id, username: other.username, mission: 'transport', origin, destination, startTime: new Date(now), arrivalTime: new Date(now + 600000) };
 await Movement.insertMany([base, { ...base }, { ...base, userId: fixture.user.id, username: fixture.user.username, origin: destination, destination: origin }, { ...base, origin: remote }, { ...base, destination: remote, status: 'returning', returnStartTime: new Date(now), returnTime: new Date(now + 600000) }]);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await login(page);
 await expect(page.locator('.traffic-course')).toHaveCount(4);
 await expect(page.locator('.traffic-course.is-returning')).toHaveCount(1);
 await expect(page.locator('.traffic-external')).toHaveText('[2:17] 성계');
 await expect(page.locator('[data-traffic-count]')).toHaveText('5 / 5');
 const response = await page.request.get('http://localhost:3999/api/game/galaxy/traffic?galaxy=1&system=1', { headers: { Authorization: `Bearer ${fixture.token}` } });
 const data = await response.json();
 expect(data.routes.some(r=>r.count===2)).toBeTruthy();
 expect(data.routes.filter(r=>!r.isSelf).every(r=>!('fleet' in r)&&!('mission' in r))).toBeTruthy();
 await page.locator('.slot-row[data-slot="8"]').click();
 await expect(page.locator('.slot-detail')).toContainText('하이네센');
 await expect(page.locator('.traffic-course')).toHaveCount(4);
 await page.locator('[data-traffic-filter]').selectOption('self');
 await expect(page.locator('.traffic-course')).toHaveCount(1);
 await expect(page.locator('.traffic-course')).toHaveAttribute('stroke','#54e0d2');
 await page.locator('[data-traffic-filter]').selectOption('all');
 await page.locator('.traffic-list summary').click();
 await page.locator('[data-traffic-route]').first().focus();await page.keyboard.press('Enter');
 await expect(page.locator('.traffic-detail')).toBeVisible();
 await page.screenshot({ path: '../artifacts/fleet-ui/traffic-desktop.png' });
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-traffic-filter]').selectOption('others');
 await expect(page.locator('.traffic-course')).toHaveCount(3);
 await expect(page.locator('.traffic-detail')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({ path: '../artifacts/fleet-ui/traffic-mobile.png' });
 await page.locator('[data-traffic-filter]').selectOption('self');
 await page.locator('[data-traffic-route]').click();
 await page.locator('[data-traffic-missions]').click();
 await expect(page.locator('#combat-panel')).toBeVisible();
 expect(errors).toEqual([]);
});

test('another commander launches real fleets; internal, external, return and completion update the observer', async ({ page, browser }) => {
 const User = require('../../server/models/User'), Movement = require('../../server/models/FleetMovement');
 const jwt = require('../../server/node_modules/jsonwebtoken');
 const { randomUUID } = await import('node:crypto');
 const other = await User.findOne({username:'target_ui_test'});
 other.planets[0].fleet.smallCargo=2;await other.save();
 const remote = await User.create({username:'remote_traffic',email:'remote-traffic@test.invalid',password:randomUUID(),planets:[{galaxy:2,system:17,planet:12,fleet:{smallCargo:2}}]});
 const auth = user => ({token:jwt.sign({userId:String(user._id)},'isolated-fleet-preview-secret-not-for-production-2026'),user:{id:String(user._id),username:user.username}});
 await login(page);
 await expect(page.locator('.traffic-course')).toHaveCount(0);
 const otherContext=await browser.newContext();const otherPage=await otherContext.newPage();
 try {
  await login(otherPage,auth(other));
  await otherPage.locator('.holo-btn[data-view="fleet"]').click();
  await otherPage.locator('[data-action="create"]').first().click();
  await otherPage.locator('[data-quantity="smallCargo"]').fill('1');await otherPage.locator('[data-quantity="smallCargo"]').dispatchEvent('change');
  await otherPage.locator('[data-action="save"]').click();await expect(otherPage.locator('.draft-state')).toHaveText('편성이 저장되었습니다.');
  await otherPage.locator('.holo-btn[data-view="combat"]').click();
  await otherPage.waitForFunction(()=>window.uiManager.strikeMap.positions.length===15);
  await otherPage.locator('[data-combat-fleet]').click();await otherPage.locator('#strike-map .orbit-host [data-slot="4"]').click();
  await otherPage.locator('[name="mission"]').selectOption('transport');await otherPage.locator('[data-confirm="launch"]').click();
  await expect(otherPage.locator('[data-movement]')).toHaveCount(1);
  await expect(page.locator('.traffic-course')).toHaveCount(1,{timeout:15000});
  await expect(page.locator('.traffic-owners')).toContainText(other.username);
  const launch = async(user,token,target,destination)=>{
   const headers={Authorization:`Bearer ${token}`};
   const created=await page.request.post('http://localhost:3999/api/game/fleet-formations',{headers,data:{originPlanetId:String(user.planets[0]._id)}});
   expect(created.status()).toBe(201);const body=await created.json();
   // Formation mutation responses include the selected formation ID at the top level.
   const id=body.formationId;
   const saved=await page.request.patch(`http://localhost:3999/api/game/fleet-formations/${id}`,{headers,data:{name:'교통 확인 함대',ships:{smallCargo:1},expectedRevision:1}});expect(saved.ok()).toBeTruthy();
   const sent=await page.request.post('http://localhost:3999/api/game/fleets',{headers,data:{requestId:randomUUID(),formationId:id,originPlanetId:String(user.planets[0]._id),expectedRevision:2,expectedTargetPlanetId:String(target),destination,mission:'transport',cargo:{}}});
   expect(sent.status()).toBe(201);
  };
  await launch(remote,auth(remote).token,fixture.planetId,{galaxy:1,system:1,planet:4});
  const viewer=await User.findById(fixture.user.id);
  await launch(viewer,fixture.token,remote.planets[0]._id,{galaxy:2,system:17,planet:12});
  await expect(page.locator('.traffic-course')).toHaveCount(3,{timeout:15000});
  await expect(page.locator('.traffic-external')).toHaveText('[2:17] 성계');
  await page.locator('[data-traffic-filter]').selectOption('incoming');await expect(page.locator('.traffic-course')).toHaveCount(2);
  await page.locator('[data-traffic-filter]').selectOption('all');
  await page.locator('.traffic-list summary').click();await page.locator('[data-traffic-route]').first().click();
  await expect(page.locator('.traffic-individual')).toHaveCount(1);
  await page.locator('.galaxy-chart-column').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:'../artifacts/fleet-ui/traffic-live-routes.png'});
  await require('../../server/services/EntityConfigService').initialize();
  const service=require('../../server/services/FleetService');
  for(const m of await Movement.find({status:'flying'})){
   m.startTime=new Date(Date.now()-60000);m.arrivalTime=new Date(Date.now()-1000);await m.save();
   await service.processMovement(m._id,new Date());
  }
  await expect(page.locator('.traffic-course.is-returning')).toHaveCount(3,{timeout:15000});
  for(const m of await Movement.find({status:'returning'})){
   m.returnTime=new Date(Date.now()-1000);await m.save();await service.processMovement(m._id,new Date());
  }
  await expect(page.locator('.traffic-course')).toHaveCount(0,{timeout:15000});
  await expect(page.locator('[data-traffic-count]')).toHaveText('0 / 0');
 } finally {await otherContext.close();}
});

test('late system responses, offline recovery, reduced motion and logout preserve a clean traffic view', async ({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await login(page);
 await expect(page.locator('[data-traffic-count]')).toHaveText('0 / 0');
 let release;const delayed=new Promise(resolve=>release=resolve);
 await page.route('**/api/game/galaxy/traffic?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('system')==='2') {await delayed;await route.fulfill({json:{galaxy:1,system:2,serverTime:new Date().toISOString(),total:99,routes:[],movements:[],nextCursor:null}});} else await route.continue();
 });
 const waiting=page.waitForRequest(r=>r.url().includes('/galaxy/traffic?')&&r.url().includes('system=2'));
 await page.evaluate(()=>{void window.uiManager.galaxyView.show({galaxy:1,system:2});});
 await waiting;
 await page.evaluate(()=>window.uiManager.galaxyView.show({galaxy:1,system:1}));release();
 await expect(page.locator('[data-traffic-count]')).toHaveText('0 / 0');
 await page.unroute('**/api/game/galaxy/traffic?*');
 await page.route('**/api/game/galaxy/traffic?*',route=>route.abort());
 await page.evaluate(()=>window.uiManager.galaxyView.refreshTraffic());
 await expect(page.locator('.traffic-status')).toContainText('연결 지연');
 await page.unroute('**/api/game/galaxy/traffic?*');await page.evaluate(()=>window.uiManager.galaxyView.refreshTraffic());
 await expect(page.locator('.traffic-status')).not.toContainText('연결 지연');
 await page.locator('.slot-row[data-slot="8"]').click();
 await page.evaluate(()=>window.uiManager.galaxyView.refreshTraffic());
 await expect(page.locator('.slot-detail')).toContainText('하이네센');
 await page.locator('.holo-btn[data-view="dashboard"]').click();
 expect(await page.evaluate(()=>window.uiManager.galaxyView.trafficController.active)).toBe(false);
 await page.locator('#logout-btn').click();
 expect(await page.evaluate(()=>window.uiManager.galaxyView.traffic.routes.length)).toBe(0);
});

test('1000 movements remain one bundled route with paged details and no chart accumulation',async({page})=>{
 const User=require('../../server/models/User'),Movement=require('../../server/models/FleetMovement');
 const other=await User.findOne({username:'target_ui_test'});
 const now=Date.now();
 await Movement.insertMany(Array.from({length:1000},()=>({userId:other._id,username:other.username,mission:'spy',origin:{galaxy:1,system:1,planet:8},destination:{galaxy:1,system:1,planet:4},startTime:new Date(now),arrivalTime:new Date(now+600000)})));
 await login(page);
 await expect(page.locator('[data-traffic-count]')).toHaveText('1000 / 1000');
 await expect(page.locator('.traffic-course')).toHaveCount(1);
 await page.locator('.traffic-list summary').click();await page.locator('[data-traffic-route]').click();
 await expect(page.locator('.traffic-individual')).toHaveCount(50);
 await page.locator('[data-traffic-more]').click();await expect(page.locator('.traffic-individual')).toHaveCount(100);
 const before=await page.locator('.orbit-host svg *').count();
 for(let i=0;i<20;i++){
  await page.locator('.holo-btn[data-view="dashboard"]').click();
  expect(await page.evaluate(()=>window.uiManager.galaxyView.chart.frame)).toBe(null);
  await page.locator('.holo-btn[data-view="galaxy"]').click();
  await expect(page.locator('.traffic-course')).toHaveCount(1);
 }
 await expect(page.locator('[data-traffic-count]')).toHaveText('1000 / 1000');
 expect(await page.locator('.orbit-host svg *').count()).toBe(before);
 const p95=await page.evaluate(async()=>{
  const frameTimes=[];let previous=performance.now();
  for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const now=performance.now();frameTimes.push(now-previous);previous=now;}
  frameTimes.sort((a,b)=>a-b);return frameTimes[Math.floor(frameTimes.length*.95)];
 });
 console.log('TRAFFIC PERFORMANCE',JSON.stringify({movements:1000,routes:1,svgNodes:before,p95}));
 expect(p95).toBeLessThan(100);
});
