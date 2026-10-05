const test = require('node:test');
const assert = require('node:assert/strict');
test('traffic curves follow endpoints and elapsed leg time, owner color is stable', async () => {
 const { ownerColor, progressOf, curveOf, pointOnCurve } = await import('../../ogame-3d/src/ui/views/trafficMath.js');
 const from={x:1,y:2}, to={x:90,y:100}, curve=curveOf(from,to,2);
 assert.deepEqual(pointOnCurve(curve,0),from);assert.deepEqual(pointOnCurve(curve,1),to);
 assert.equal(progressOf(1000,2000,1500),.5);assert.equal(progressOf(1000,2000,3000),1);assert.equal(progressOf(1000,2000,0),0);
 assert.equal(ownerColor('a',true),'#54e0d2');assert.equal(ownerColor('abc',false),ownerColor('abc',false));assert.notEqual(ownerColor('abc',false),ownerColor('abc',true));
});
