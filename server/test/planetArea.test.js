const test = require('node:test');
const assert = require('node:assert/strict');
const { totalArea, calculateArea, normalizeLegacyArea, productionModifiers, createPlanetTraits } = require('../utils/planetArea');
test('absolute area, upgrade reservations, 100 percent cap and zero-sized planets', () => {
  const p = { diameter: 12800, baseUsablePercent: 40, buildings: { metalMine: 15, researchLab: 10 } };
  assert.equal(totalArea(p), 256);
  assert.equal(totalArea({ diameter: 25600 }), 1024);
  const q = [{type:'building', planetId:'1', status:'pending'}, {type:'building', planetId:'1', status:'building',action:'demolish'}, {type:'building', planetId:'0', status:'building'}];
  assert.deepEqual(calculateArea(p, 5, q, '1'), {total:256,baseUsablePercent:40,usablePercent:50,usable:128,used:25,reserved:1,available:102,overCapacity:false});
  assert.equal(calculateArea(p, 100).usable, 256);
  assert.equal(calculateArea({diameter:0,baseUsablePercent:0,buildings:{}}).usable,0);
});
test('legacy backfill is idempotent, includes pending area, preserves overfull buildings', () => {
  const p = {diameter:8000,buildings:{metalMine:80}};
  normalizeLegacyArea(p,[{type:'building',planetId:'0',status:'pending'}]);
  assert.equal(p.baseUsablePercent,81);
  assert.equal(normalizeLegacyArea(p),false);
  const over = {diameter:800,buildings:{metalMine:20}};
  normalizeLegacyArea(over); assert.equal(over.baseUsablePercent,100); assert.equal(over.buildings.metalMine,20); assert.equal(calculateArea(over).overCapacity,true);
});
test('temperature and mineral bonuses remain bounded and new traits are stable data', () => {
  assert.equal(productionModifiers({minTemp:0,maxTemp:0}).deuterium,1.02);
  assert.equal(productionModifiers({minTemp:-200,maxTemp:-100}).solar,.8);
  assert.equal(productionModifiers({minTemp:200,maxTemp:300}).deuterium,.8);
  assert.deepEqual(createPlanetTraits(() => 0),{baseUsablePercent:40,traits:{metal:.8,crystal:.8}});
});
