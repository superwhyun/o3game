const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const GameConfig = require('./models/GameConfig');

dotenv.config(); // Should pick up .env in the same directory

async function inspect() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not defined in environment');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const users = await User.find();
  console.log(`Found ${users.length} users`);
  
  for (const user of users) {
    console.log('--- User:', user.username, '---');
    user.planets.forEach((p, idx) => {
      console.log(`Planet ${idx} resources:`, JSON.stringify(p.resources));
      console.log(`Planet ${idx} lastUpdate:`, p.lastUpdate);
      
      // Check for NaN
      if (isNaN(p.resources.deuterium)) {
        console.log('!!! DEUTERIUM IS NaN !!!');
      }
    });
  }

  const config = await GameConfig.getConfig();
  console.log('GameConfig resourceSettings:', JSON.stringify(config.resourceSettings, null, 2));

  await mongoose.disconnect();
}

inspect().catch(console.error);
