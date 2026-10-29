const test = require('node:test'), assert = require('node:assert/strict'), mongoose = require('mongoose');
const uri = process.env.FLEET_TEST_MONGODB_URI?.replace(/\/[^/?]+(?=\?|$)/, '/cosmic_flight_settings_test');
test('flight settings are independently stored, validated, authorized and preserve other fleet settings', { skip: !uri }, async () => {
  process.env.JWT_SECRET = 'flight-settings-integration-test-only-at-least-32-characters';
  await mongoose.connect(uri); let server;
  try {
    await mongoose.connection.dropDatabase();
    const Config = require('../models/GameConfig'), User = require('../models/User'), jwt = require('jsonwebtoken'), express = require('express');
    const config = await Config.getConfig();
    config.serverSpeed = 100; config.fleetSettings.fuelConsumptionMultiplier = 3; config.fleetSettings.cargoCapacityMultiplier = 4; await config.save();
    const admin = await User.create({ username:'flight-admin', email:'admin@flight.test', password:'test-password', isAdmin:true, adminRole:'superadmin' });
    const player = await User.create({ username:'flight-player', email:'player@flight.test', password:'test-password' });
    const app = express(), events=[];app.use(express.json());app.set('io',{emit: name=>events.push(name)});app.use('/api/admin',require('../routes/admin'));
    server=app.listen(0);await new Promise(resolve=>server.on('listening',resolve));
    const update = (user,value)=>fetch(`http://127.0.0.1:${server.address().port}/api/admin/config`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({userId:String(user._id)},process.env.JWT_SECRET)}`},body:JSON.stringify({fleetSettings:{flightSpeedMultiplier:value}})});
    assert.equal((await update(player,2)).status,403);
    for (const value of [0,-1,101,'invalid',null]) assert.equal((await update(admin,value)).status,400);
    assert.equal((await update(admin,2)).status,200);
    const saved=await Config.findOne();assert.equal(saved.serverSpeed,100);assert.equal(saved.fleetSettings.flightSpeedMultiplier,2);assert.equal(saved.fleetSettings.fuelConsumptionMultiplier,3);assert.equal(saved.fleetSettings.cargoCapacityMultiplier,4);assert.ok(events.includes('gameConfigUpdated'));
  } finally { if(server)await new Promise(resolve=>server.close(resolve));await mongoose.connection.dropDatabase();await mongoose.disconnect(); }
});
