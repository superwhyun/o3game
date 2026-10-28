const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { execFileSync } = require('node:child_process');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');
const User = require('../models/User');
const Queue = require('../models/BuildingQueue');
const Config = require('../models/GameConfig');
const entities = require('../services/EntityConfigService');
const { settleUserState } = require('../services/GameStateService');
const { calculateProduction, applyOfflineProduction } = require('../utils/planetEconomy');
const actions = require('../services/ConstructionService');

test('real MongoDB area, construction, demolition, traits and terraforming lifecycle', {timeout:120000}, async t => {
  const repl = await MongoMemoryReplSet.create({ replSet: { count:1 }, binary: { version:'7.0.24' } });
  let server;
  try {
    await mongoose.connect(repl.getUri('planet_area_test'));
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    await Config.create({areaSettings:{bonusUsableFields:0},resourceSettings:{defaultStorage:{metal:1e12,crystal:1e12,deuterium:1e12}}});
    await entities.initialize();
    await Promise.all([User.init(),Queue.init()]);
    const express = require('express'); const app=express(); app.use(express.json());
    app.use('/api/queue',require('../routes/buildingQueue')); app.use('/api/auth',require('../routes/auth'));
    server=app.listen(0); await new Promise(r=>server.on('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    let fixtureNumber=0;
    async function fixture(planets) {
      fixtureNumber++;
      return User.create({username:`area${fixtureNumber}`,email:`area${fixtureNumber}@example.test`,password:randomBytes(24).toString('hex'),planets:planets.map((p,index)=>({galaxy:1,system:fixtureNumber,planet:index+1,diameter:12800,baseUsablePercent:40,areaVersion:1,traits:{metal:1,crystal:1},resources:{metal:1e10,crystal:1e10,deuterium:1e10},...p}))});
    }
    async function request(user,path,body,method='POST') {
      const response=await fetch(base+'/api/queue'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({userId:user._id},process.env.JWT_SECRET)}`},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,body:await response.json()};
    }
    async function complete(user,id) {
      await Queue.updateOne({_id:id},{$set:{endTime:new Date(Date.now()-100),startTime:new Date(Date.now()-1000)}});
      return settleUserState(user._id);
    }
    await t.test('last available cell concurrency accepts exactly one and does not charge rejected request',async()=>{
      const user=await fixture([{diameter:8000,buildings:{metalMine:39}}]);
      const before=(await User.findById(user._id)).planets[0].resources.crystal;
      const responses=await Promise.all([request(user,'/build',{buildingId:'crystalMine',planetId:'0'}),request(user,'/build',{buildingId:'solarPlant',planetId:'0'})]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
      assert.equal(responses.find(r=>r.status===400).body.code,'INSUFFICIENT_AREA');
      assert.equal(await Queue.countDocuments({userId:user._id}),1);
      const state=await settleUserState(user._id);assert.equal(state.snapshot.planets[0].area.reserved,1);assert.equal(state.snapshot.planets[0].area.available,0);
      assert.ok((await User.findById(user._id)).planets[0].resources.crystal>=before-1000);
      await complete(user,responses.find(r=>r.status===200).body.queueItem.id);
      const once=await settleUserState(user._id);const twice=await settleUserState(user._id);
      assert.equal(once.snapshot.planets[0].area.used,40);assert.equal(twice.snapshot.planets[0].area.used,40);assert.equal(twice.snapshot.planets[0].area.reserved,0);
    });
    await t.test('planet selection, invalid targets, sequential levels, cancellation dependency and duplicate refund',async()=>{
      const user=await fixture([{},{}]);
      assert.equal((await request(user,'/planet',{planetId:'1'})).body.snapshot.currentPlanet,1);
      const q1=await request(user,'/build',{buildingId:'metalMine'});assert.equal(q1.body.queueItem.planetId,'1');
      const separate=await request(user,'/build',{buildingId:'crystalMine',planetId:'0'});assert.equal(separate.body.queueItem.status,'building');assert.equal(q1.body.queueItem.status,'building');
      const q2=await request(user,'/build',{buildingId:'metalMine',planetId:'1'});assert.equal(q2.body.queueItem.level,2);
      const q3=await request(user,'/build',{buildingId:'metalMine',planetId:'1'});assert.equal(q3.body.queueItem.level,3);
      assert.equal((await request(user,'/build',{buildingId:'metalMine',planetId:'99'})).body.code,'INVALID_PLANET');
      assert.equal((await request(user,`/${q1.body.queueItem.id}`,undefined,'DELETE')).body.code,'DEPENDENT_QUEUE');
      assert.equal((await request(user,`/${q3.body.queueItem.id}`,undefined,'DELETE')).status,200);
      const duplicate=await request(user,`/${q3.body.queueItem.id}`,undefined,'DELETE');assert.equal(duplicate.body.code,'QUEUE_NOT_ACTIVE');
      assert.equal((await request(user,`/${q2.body.queueItem.id}`,undefined,'DELETE')).status,200);
      await complete(user,q1.body.queueItem.id);
      const state=await settleUserState(user._id);assert.equal(state.snapshot.planets[0].buildings.metalMine,0);assert.equal(state.snapshot.planets[1].buildings.metalMine,1);
      // Completed items cannot be cancelled/refunded.
      assert.equal((await request(user,`/${q1.body.queueItem.id}`,undefined,'DELETE')).body.code,'QUEUE_NOT_ACTIVE');
    });
    await t.test('demolition recovers land, forbids conflicting prerequisites and shrinks storage',async()=>{
      const user=await fixture([{diameter:8000,buildings:{metalMine:38,robotFactory:2}}]);
      assert.equal((await request(user,'/build',{buildingId:'crystalMine'})).body.code,'INSUFFICIENT_AREA');
      const demolition=await request(user,'/demolish',{buildingId:'metalMine'});assert.equal(demolition.status,200);assert.equal(demolition.body.queueItem.level,37);
      assert.equal((await request(user,'/build',{buildingId:'metalMine'})).body.code,'BUILDING_BUSY');
      await complete(user,demolition.body.queueItem.id);
      assert.equal((await request(user,'/build',{buildingId:'crystalMine'})).status,200);
      const other=await fixture([{buildings:{robotFactory:2,researchLab:10},research:{energyTechnology:12,astrophysics:4}}]);
      const demolishRobot=await request(other,'/demolish',{buildingId:'robotFactory'});assert.equal(demolishRobot.status,200);
      assert.equal((await request(other,'/build',{buildingId:'shipyard'})).body.code,'REQUIREMENTS_NOT_MET');
      const research=await request(other,'/research',{researchId:'terraforming'});assert.equal(research.status,200);
      assert.equal((await request(other,'/demolish',{buildingId:'researchLab'})).body.code,'LAB_BUSY');
      const cfg=await Config.findOne();cfg.resourceSettings.defaultStorage.metal=10000;await cfg.save();
      const storageUser=await fixture([{buildings:{metalStorage:2},resources:{metal:21000,crystal:10000,deuterium:10000}}]);
      const storage=await request(storageUser,'/demolish',{buildingId:'metalStorage'});assert.equal(storage.status,200);
      const after=await complete(storageUser,storage.body.queueItem.id);assert.ok(after.snapshot.planets[0].resources.metal<=after.snapshot.planets[0].storage.metal);
      cfg.resourceSettings.defaultStorage.metal=1e12;await cfg.save();
    });
    await t.test('global terraforming increases each planet percentage but not absolute size and preserves user research',async()=>{
      const user=await fixture([{buildings:{researchLab:10},research:{energyTechnology:12,astrophysics:4}},{diameter:25600,research:{energyTechnology:3}}]);
      const before=await settleUserState(user._id);
      const q=await request(user,'/research',{researchId:'terraforming',planetId:'0'});assert.equal(q.status,200);assert.equal(q.body.snapshot.research.terraforming,0);
      const after=await complete(user,q.body.queueItem.id);
      for(let i=0;i<2;i++){assert.equal(after.snapshot.planets[i].area.usablePercent,42);assert.equal(after.snapshot.planets[i].area.total,before.snapshot.planets[i].area.total);}
      assert.ok(after.snapshot.planets[1].area.usable-before.snapshot.planets[1].area.usable>after.snapshot.planets[0].area.usable-before.snapshot.planets[0].area.usable);
      const selected=await request(user,'/planet',{planetId:'1'});assert.equal(selected.body.snapshot.research.energyTechnology,12);assert.equal(selected.body.snapshot.research.terraforming,1);
      await User.updateOne({_id:user._id},{$set:{terraformingLevel:30}});
      assert.equal((await request(user,'/research',{researchId:'terraforming',planetId:'0'})).body.code,'TERRAFORMING_MAX_LEVEL');
    });
    await t.test('production modifiers affect mines only; cold/hot temperature and offline production agree',async()=>{
      const buildings={metalMine:5,crystalMine:5,deuteriumSynthesizer:5,solarPlant:5};
      const neutral={buildings,traits:{metal:1,crystal:1},minTemp:-20,maxTemp:40};
      const cold={...neutral,traits:{metal:1.2,crystal:.8},minTemp:-100,maxTemp:-80};
      const hot={...neutral,minTemp:100,maxTemp:120};
      const normal=calculateProduction(neutral);const c=calculateProduction(cold);const h=calculateProduction(hot);
      assert.ok(c.metal>normal.metal);assert.ok(c.crystal<normal.crystal);assert.ok(c.deuterium>h.deuterium);assert.ok(c.energy<h.energy);
      assert.ok(Math.abs(c.metal-(30+(normal.metal-30)*1.2))<1e-9);
      const now=new Date();const p={...cold,resources:{metal:0,crystal:0,deuterium:0},lastUpdate:new Date(now-3600000)};
      applyOfflineProduction(p,await Config.findOne(),now);assert.equal(p.resources.metal,c.metal);assert.equal(p.resources.deuterium,c.deuterium);
    });
    await t.test('failed queue insert rolls back resource/metadata writes',async()=>{
      const user=await fixture([{}]);const before=await User.findById(user._id).lean();
      const original=Queue.create;Queue.create=async()=>{throw new Error('injected write failure');};
      try{assert.equal((await request(user,'/build',{buildingId:'metalMine'})).status,500);}finally{Queue.create=original;}
      const after=await User.findById(user._id).lean();assert.deepEqual(after.planets[0].resources,before.planets[0].resources);assert.equal(after.stateRevision,before.stateRevision);assert.equal(await Queue.countDocuments({userId:user._id}),0);
    });
    await t.test('dry-run and repeatable migration preserve overfull planets without changing size',async()=>{
      const user=await fixture([{diameter:8000,buildings:{metalMine:80}}]);
      await User.updateOne({_id:user._id},{$unset:{'planets.0.areaVersion':1,'planets.0.baseUsablePercent':1}});
      const run=(args=[])=>execFileSync(process.execPath,['scripts/migratePlanetAreas.js',...args],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,MONGODB_URI:repl.getUri('planet_area_test')},encoding:'utf8'});
      assert.match(run(),/"changedUsers":1/);assert.equal((await User.findById(user._id)).planets[0].areaVersion,undefined);
      assert.match(run(['--apply']),/"changedUsers":1/);assert.match(run(['--apply']),/"changedUsers":0/);
      assert.equal((await User.findById(user._id)).planets[0].diameter,8000);
    });
  }finally{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await repl.stop();}
});
