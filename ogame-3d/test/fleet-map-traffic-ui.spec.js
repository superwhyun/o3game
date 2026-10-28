import { test, expect } from '@playwright/test';
for (const width of [390,1440]) {
  test(`fleet operations draws outbound, returning and external routes without extra controls at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:1000});
    let catalogUrl, trafficCalls=0;
    page.on('response',r=>{if(/\/src\/data\/catalog\.js(?:\?|$)/.test(r.url()))catalogUrl=r.url();});
    await page.route('**/api/auth/check-admin',r=>r.fulfill({json:{hasAdmin:true}}));
    const positions=Array.from({length:15},(_,i)=>({position:i+1,occupied:false}));
    positions[3]={position:4,occupied:true,owner:'self',planet:{id:'home',name:'지구'}};
    positions[8]={position:9,occupied:true,owner:'other',scouted:true,planet:{id:'target',name:'목표'}};
    await page.route('**/api/game/galaxy?**',r=>r.fulfill({json:{positions}}));
    await page.route('**/api/game/galaxy/traffic?**',r=>{
      trafficCalls++;
      const url=new URL(r.request().url()), empty=url.searchParams.get('system')==='2';
      const now=Date.now();
      const routes=[{id:'outbound',ownerKey:'mine',username:'me',isSelf:true,count:1,status:'flying',from:{galaxy:1,system:1,planet:4},to:{galaxy:1,system:1,planet:9},startedAt:new Date(now-30000).toISOString(),endsAt:new Date(now+30000).toISOString()},{id:'return',ownerKey:'mine',username:'me',isSelf:true,count:1,status:'returning',from:{galaxy:2,system:40},to:{galaxy:1,system:1,planet:4},startedAt:new Date(now-30000).toISOString(),endsAt:new Date(now+30000).toISOString()}];
      return r.fulfill({json:{routes:empty?[]:routes,total:empty?0:2,serverTime:new Date(now).toISOString()}});
    });
    await page.goto('/');await page.waitForFunction(()=>window.uiManager?.hasAdmin);
    await page.evaluate(async(url)=>{
      const {catalog}=await import(url);catalog.hydrate({revision:1,entities:[]});
      const state=window.gameState;state.userId='mine';Object.assign(state.planet,{id:'home',name:'지구',galaxy:1,system:1,planet:4});
      document.getElementById('auth-screen').classList.add('hidden');document.getElementById('ui-layer').classList.remove('hidden');
      window.uiManager.switchView('combat');
    },catalogUrl);
    const map=page.locator('#strike-map');
    await expect(map.locator('.traffic-course')).toHaveCount(2);
    await expect(map.locator('.traffic-course.is-returning')).toHaveCount(1);
    await expect(map.locator('.traffic-external text')).toHaveText('[2:40] 성계');
    expect(await map.locator('.traffic-course').evaluateAll(paths=>paths.every(p=>p.getAttribute('d')?.startsWith('M')&&p.getAttribute('marker-end')))).toBe(true);
    const paints=await map.locator('.traffic-course').evaluateAll(paths=>paths.map(p=>document.getElementById(p.getAttribute('marker-end').match(/#([^)]+)/)[1])?.closest('svg')===p.closest('svg')));
    expect(paints).toEqual([true,true]);
    await expect(map.locator('.fleet-traffic')).toBeHidden();
    expect(trafficCalls).toBe(1);
    await page.evaluate(()=>window.uiManager.strikeMap.openConfirm(9));
    await expect(map.locator('.traffic-course')).toHaveCount(2);
    await page.evaluate(()=>window.uiManager.strikeMap.show({galaxy:1,system:2}));
    await expect(map.locator('.traffic-course')).toHaveCount(0);
    expect(trafficCalls).toBe(2);
    await page.evaluate(()=>window.uiManager.switchView('dashboard'));
    expect(await page.evaluate(()=>window.uiManager.strikeMap.trafficController.active)).toBe(false);
  });
}
