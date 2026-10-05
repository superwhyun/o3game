const test = require('node:test');
const assert = require('node:assert/strict');
test('traffic rejects late system/account responses, preserves last data on failure and has no hidden refresh', async () => {
 const { FleetTrafficController } = await import('../../ogame-3d/src/ui/views/FleetTrafficController.js');
 let account='a';const requests=[], data=[], errors=[];
 const c=new FleetTrafficController({ getAccount:()=>account, fetchTraffic:(g,s,o)=>new Promise((resolve,reject)=>requests.push({g,s,o,resolve,reject})), onData:d=>data.push(d), onStatus:e=>errors.push(e), onReset:()=>{},onDetails:()=>{} });
 c.setSystem({galaxy:1,system:1});const first=c.refresh();
 c.setSystem({galaxy:1,system:2});const second=c.refresh();
 requests[1].resolve({routes:[],total:0});await second;
 requests[0].resolve({routes:[{id:'old'}]});await first;assert.equal(data.length,1);
 const failed=c.refresh();requests[2].reject(Error('offline'));await failed;assert.equal(data.length,1);assert.equal(errors.at(-1),'offline');
 c.setActive(false);await c.refresh();assert.equal(requests.length,3);
 c.setActive(true);const pending=c.refresh();account='b';requests[3].resolve({routes:[]});await pending;assert.equal(data.length,1);
 const next=c.refresh();requests[4].resolve({routes:[]});await next;assert.equal(data.length,2);
});
test('traffic detail pagination deduplicates IDs and ignores a replaced selection', async()=>{
 const { FleetTrafficController }=await import('../../ogame-3d/src/ui/views/FleetTrafficController.js');
 const requests=[],details=[];
 const c=new FleetTrafficController({getAccount:()=> 'a',fetchTraffic:(g,s,o)=>new Promise(resolve=>requests.push({o,resolve})),onData:()=>{},onStatus:()=>{},onReset:()=>{},onDetails:rows=>details.push(rows)});
 c.setSystem({galaxy:1,system:1});const first=c.select({id:'route-a'});requests[0].resolve({movements:[{id:'one'}],nextCursor:'cursor'});await first;
 const more=c.loadMore();requests[1].resolve({movements:[{id:'one'},{id:'two'}],nextCursor:null});await more;assert.equal(details.at(-1).length,2);
 const stale=c.select({id:'route-a'}),fresh=c.select({id:'route-b'});
 requests[3].resolve({movements:[{id:'new'}],nextCursor:null});await fresh;requests[2].resolve({movements:[{id:'old'}],nextCursor:null});await stale;assert.equal(details.at(-1)[0].id,'new');
 await c.select(null);assert.equal(c.route,null);assert.equal(c.rows.length,0);
});
