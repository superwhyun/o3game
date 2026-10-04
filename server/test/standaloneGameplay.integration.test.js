const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const uri = process.env.STANDALONE_TEST_MONGODB_URI;

test('standalone DB preserves login, state, building queue and existing fleet return', {skip: !uri}, async () => {
  if (!/\/[^/?]*_test[^/?]*(\?|$)/.test(uri)) throw new Error('Use a dedicated _test database');
  process.env.JWT_SECRET = 'standalone-regression-only-secret-2026';
  await mongoose.connect(uri);
  let server;
  try {
    const User = require('../models/User');
    const Movement = require('../models/FleetMovement');
    const Queue = require('../models/BuildingQueue');
    await mongoose.connection.dropDatabase();
    await require('../services/EntityConfigService').initialize();
    await Promise.all([User.init(), Movement.init(), Queue.init()]);
    assert.equal(await require('../services/transactions').supportsTransactions(), false);
    const credential = randomUUID();
    const user = await User.create({username:'standalone_test', email:'standalone@example.test', password:credential, planets:[{galaxy:1,system:1,planet:4,resources:{metal:10000,crystal:10000,deuterium:10000},fleet:{lightFighter:10}}]});
    const express = require('express');
    const app = express(); app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/game', require('../routes/game'));
    app.use('/api/queue', require('../routes/buildingQueue'));
    server = app.listen(0); await new Promise(r => server.on('listening',r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:credential})});
    assert.equal(login.status,200); const {token} = await login.json();
    const headers = {'Content-Type':'application/json',Authorization:`Bearer ${token}`};
    const me = await fetch(base+'/api/auth/me',{headers});
    assert.equal(me.status,200); assert.equal((await me.json()).username,user.username);
    const built = await fetch(base+'/api/queue/build',{method:'POST',headers,body:JSON.stringify({buildingId:'metalMine'})});
    assert.equal(built.status,200,JSON.stringify(await built.json()));
    assert.equal(await Queue.countDocuments({userId:user._id}),1);
    const formation = await fetch(base+'/api/game/fleet-formations',{method:'POST',headers,body:JSON.stringify({originPlanetId:String(user.planets[0]._id)})});
    assert.equal(formation.status,503);
    assert.equal((await User.findById(user._id)).fleetFormations.length,0);
    const launch = await fetch(base+'/api/game/fleets',{method:'POST',headers,body:'{}'});
    const scout = await fetch(base+'/api/game/scouts',{method:'POST',headers,body:'{}'});assert.equal(scout.status,503);
    assert.equal(launch.status,503); assert.equal(await Movement.countDocuments({}),0);
    const move = await Movement.create({userId:user._id,username:user.username,mission:'transport',status:'returning',origin:{galaxy:1,system:1,planet:4},destination:{galaxy:1,system:1,planet:8},fleet:{lightFighter:3},cargo:{metal:0,crystal:0,deuterium:0},startTime:new Date(Date.now()-20000),arrivalTime:new Date(Date.now()-10000),returnTime:new Date(Date.now()-1000)});
    await require('../services/FleetService').processMovement(move._id);
    assert.equal((await Movement.findById(move._id)).status,'completed');
    assert.equal((await User.findById(user._id)).planets[0].fleet.lightFighter,13);
    const stillWorks = await fetch(base+'/api/auth/me',{headers}); assert.equal(stillWorks.status,200);
  } finally {
    if (server) await new Promise(r => server.close(r));
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
