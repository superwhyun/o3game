/** Isolated real DB + HTTP preview. Never connects to the user's game database. */
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');
const root = join(__dirname, '../..');
const secret = randomBytes(32).toString('hex');
let repl, backend, frontend;
async function main() {
  repl = await MongoMemoryReplSet.create({replSet:{count:1},binary:{version:'7.0.24'}});
  const uri = repl.getUri('planet_area_ui_test');
  await mongoose.connect(uri);
  const Config = require('../models/GameConfig');
  const User = require('../models/User');
  await Config.create({resourceSettings:{defaultStorage:{metal:1e12,crystal:1e12,deuterium:1e12}}});
  await require('../services/EntityConfigService').initialize();
  const user = await User.create({username:'planet_preview',isAdmin:true,adminRole:'superadmin',email:'planet-preview@example.test',password:randomBytes(24).toString('hex'),planets:[
    {name:'빙하 광산',galaxy:1,system:1,planet:4,diameter:8000,minTemp:-100,maxTemp:-80,baseUsablePercent:40,areaVersion:1,traits:{metal:1.2,crystal:.8},buildings:{metalMine:18,crystalMine:8,deuteriumSynthesizer:4,solarPlant:10},resources:{metal:1e9,crystal:1e9,deuterium:1e9}},
    {name:'테라포밍 거점',galaxy:1,system:1,planet:8,diameter:16000,minTemp:60,maxTemp:80,baseUsablePercent:40,areaVersion:1,traits:{metal:.9,crystal:1.15},buildings:{metalMine:5,researchLab:10},research:{energyTechnology:12,astrophysics:4},resources:{metal:1e9,crystal:1e9,deuterium:1e9}}
  ]});
  const token=jwt.sign({userId:user._id},secret);
  const file=process.env.PLANET_UI_FIXTURE_FILE || '/tmp/oogame-planet-preview.json';
  writeFileSync(file,JSON.stringify({uri,token,user:{id:String(user._id),username:user.username},userId:String(user._id)}));
  await mongoose.disconnect();
  backend=spawn(process.execPath,['index.js'],{cwd:join(root,'server'),env:{...process.env,MONGODB_URI:uri,JWT_SECRET:secret,PORT:'3037',CLIENT_URL:'http://localhost:5178'},stdio:'inherit'});
  frontend=spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5178','--strictPort'],{cwd:join(root,'ogame-3d'),env:{...process.env,VITE_SERVER_URL:'http://localhost:3037'},stdio:'inherit'});
  console.log(`Preview fixture: ${file}; browser http://localhost:5178`);
}
async function cleanup(){backend?.kill();frontend?.kill();await mongoose.disconnect();await repl?.stop();process.exit();}
process.on('SIGINT',cleanup);process.on('SIGTERM',cleanup);
main().catch(async e=>{console.error(e);await cleanup();});
