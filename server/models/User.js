const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const planetSchema = new mongoose.Schema({
  name: { type: String, default: 'Colony-1' },
  position: { type: Number, default: 4 },
  galaxy: { type: Number, default: 1 },
  system: { type: Number, default: 1 },
  planet: { type: Number, default: 1 },
  minTemp: { type: Number, default: -20 },
  maxTemp: { type: Number, default: 40 },
  diameter: { type: Number, default: 12800 },
  
  resources: {
    metal: { type: Number, default: 500 },
    crystal: { type: Number, default: 300 },
    deuterium: { type: Number, default: 100 },
    energy: { type: Number, default: 0 }
  },
  
  buildings: {
    metalMine: { type: Number, default: 0 },
    crystalMine: { type: Number, default: 0 },
    deuteriumSynthesizer: { type: Number, default: 0 },
    solarPlant: { type: Number, default: 0 },
    fusionReactor: { type: Number, default: 0 },
    robotFactory: { type: Number, default: 0 },
    shipyard: { type: Number, default: 0 },
    researchLab: { type: Number, default: 0 },
    naniteFactory: { type: Number, default: 0 },
    metalStorage: { type: Number, default: 0 },
    crystalStorage: { type: Number, default: 0 },
    deuteriumTank: { type: Number, default: 0 }
  },
  
  research: {
    energyTechnology: { type: Number, default: 0 },
    laserTechnology: { type: Number, default: 0 },
    ionTechnology: { type: Number, default: 0 },
    plasmaTechnology: { type: Number, default: 0 },
    combustionDrive: { type: Number, default: 0 },
    impulseDrive: { type: Number, default: 0 },
    hyperspaceDrive: { type: Number, default: 0 },
    hyperspaceTechnology: { type: Number, default: 0 },
    espionageTechnology: { type: Number, default: 0 },
    computerTechnology: { type: Number, default: 0 },
    astrophysics: { type: Number, default: 0 },
    gravitonTechnology: { type: Number, default: 0 },
    weaponsTechnology: { type: Number, default: 0 },
    shieldingTechnology: { type: Number, default: 0 },
    armorTechnology: { type: Number, default: 0 }
  },
  
  fleet: {
    smallCargo: { type: Number, default: 0 },
    largeCargo: { type: Number, default: 0 },
    colonyShip: { type: Number, default: 0 },
    recycler: { type: Number, default: 0 },
    espionageProbe: { type: Number, default: 0 },
    solarSatellite: { type: Number, default: 0 },
    lightFighter: { type: Number, default: 0 },
    heavyFighter: { type: Number, default: 0 },
    cruiser: { type: Number, default: 0 },
    battleship: { type: Number, default: 0 },
    battlecruiser: { type: Number, default: 0 },
    bomber: { type: Number, default: 0 },
    destroyer: { type: Number, default: 0 },
    deathstar: { type: Number, default: 0 }
  },
  
  defense: {
    rocketLauncher: { type: Number, default: 0 },
    lightLaser: { type: Number, default: 0 },
    heavyLaser: { type: Number, default: 0 },
    gaussCannon: { type: Number, default: 0 },
    ionCannon: { type: Number, default: 0 },
    plasmaTurret: { type: Number, default: 0 },
    smallShieldDome: { type: Number, default: 0 },
    largeShieldDome: { type: Number, default: 0 },
    antiBallisticMissile: { type: Number, default: 0 },
    interplanetaryMissile: { type: Number, default: 0 }
  },
  
  lastUpdate: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  
  // Game Data
  planets: [planetSchema],
  currentPlanet: { type: Number, default: 0 },
  
  // Game Stats
  rank: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  
  // Online Status
  isOnline: { type: Boolean, default: false },
  socketId: { type: String, default: null },
  
  // Admin
  isAdmin: { type: Boolean, default: false },
  adminRole: { type: String, enum: ['superadmin', 'moderator', 'support'], default: null }
});

// Password hashing & Initialize first planet
userSchema.pre('save', async function() {
  // Hash password if modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  
  // Initialize first planet for new users
  if (this.isNew && this.planets.length === 0) {
    const GameConfig = mongoose.model('GameConfig');
    const config = await GameConfig.getConfig();
    const startResources = config.newPlayerSettings || { startingMetal: 500, startingCrystal: 300, startingDeuterium: 100 };
    
    this.planets.push({
      name: 'Colony-1',
      position: Math.floor(Math.random() * 15) + 1,
      resources: {
        metal: startResources.startingMetal,
        crystal: startResources.startingCrystal,
        deuterium: startResources.startingDeuterium
      }
    });
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
