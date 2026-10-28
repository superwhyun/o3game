const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ENTITY_IDS } = require('../data/catalog');
const { coordinateKey, pickHomeCoordinate } = require('../utils/universe');

const COORDINATE_KEY_PATH = 'planets.coordinateKey';
const MAX_HOME_ALLOCATION_ATTEMPTS = 5;

// Missile counters predate the catalog; keep their stored values.
const LEGACY_DEFENSE_FIELDS = ['antiBallisticMissile', 'interplanetaryMissile'];

function buildLevelFields(ids) {
  return Object.fromEntries(
    [...new Set(ids)].map((id) => [id, { type: Number, default: 0 }])
  );
}

const planetSchema = new mongoose.Schema({
  name: { type: String, default: 'Colony-1' },
  // Orbit slot shown in the UI; always mirrors `planet` (see syncPlanetCoordinate).
  position: { type: Number, default: 4 },
  galaxy: { type: Number, default: 1 },
  system: { type: Number, default: 1 },
  planet: { type: Number, default: 1 },
  // "galaxy:system:planet" — backs the unique index so two players can never
  // own the same slot, even when they register at the same moment.
  coordinateKey: { type: String },
  environmentType: { type: String, enum: ['ice', 'volcanic', 'tropical', 'desert'] },
  minTemp: { type: Number, default: -20 },
  maxTemp: { type: Number, default: 40 },
  diameter: { type: Number, default: 12800, min: 0 },
  baseUsablePercent: { type: Number, min: 0, max: 100 },
  areaVersion: { type: Number },
  traits: { metal: { type: Number, min: 0.8, max: 1.2 }, crystal: { type: Number, min: 0.8, max: 1.2 } },
  
  resources: {
    metal: { type: Number, default: 500 },
    crystal: { type: Number, default: 300 },
    deuterium: { type: Number, default: 100 },
    energy: { type: Number, default: 0 },
    food: { type: Number, default: 0, min: 0 }
  },
  
  // Level / count fields are generated from server/data/catalog —
  // adding an entity there automatically adds its field here.
  buildings: buildLevelFields(ENTITY_IDS.building),
  research: buildLevelFields(ENTITY_IDS.research),
  fleet: buildLevelFields(ENTITY_IDS.ship),
  defense: buildLevelFields([...ENTITY_IDS.defense, ...LEGACY_DEFENSE_FIELDS]),
  
  population: {
    version: { type: Number }, count: { type: Number, min: 0 },
    growthProgress: { type: Number, min: 0, max: 1 },
    starvationProgress: { type: Number, min: 0, max: 1, default: 0 },
    baseHousing: { type: Number, min: 0 }, baseFood: { type: Number, min: 0 },
    baseCulture: { type: Number, min: 0 }, foodCapacity: { type: Number, min: 0 }
  },
  lastUpdate: { type: Date, default: Date.now }
});

const formationSchema = new mongoose.Schema({
  number: { type: Number, required: true },
  name: { type: String, required: true },
  originPlanetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  ships: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  crew: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  crewVersion: Number,
  status: { type: String, enum: ['ready', 'onMission'], default: 'ready' },
  activeMovementId: { type: mongoose.Schema.Types.ObjectId, default: null },
  revision: { type: Number, default: 1 },
  notice: { type: String, default: '' }
});
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  
  tokenVersion: { type: Number, default: 0 },
  preferences: { uiMode: { type: String, enum: ['simple', 'detailed', 'graphics'], default: 'detailed' } },
  // Game Data
  planets: [planetSchema],
  fleetFormations: { type: [formationSchema], default: () => [] },
  nextFleetNumber: { type: Number, default: 1 },
  stateRevision: { type: Number, default: 0 },
  currentPlanet: { type: Number, default: 0 },
  research: buildLevelFields(ENTITY_IDS.research),
  researchScopeVersion: { type: Number, default: 0 },
  terraformingLevel: { type: Number, default: 0, min: 0, max: 30 },
  
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
  isAiPlayer: { type: Boolean, default: false },
  isPirate: { type: Boolean, default: false },
  pirate: {level:Number,developmentScore:Number,lastUpdate:Date,rebuildProgress:{type:Number,default:0}},
  isAdmin: { type: Boolean, default: false },
  adminRole: { type: String, enum: ['superadmin', 'moderator', 'support'], default: null },
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: '' }
}, { optimisticConcurrency: true });

userSchema.index(
  { [COORDINATE_KEY_PATH]: 1 },
  { unique: true, partialFilterExpression: { [COORDINATE_KEY_PATH]: { $exists: true } } }
);

function syncPlanetCoordinate(planet) {
  planet.position = planet.planet;
  planet.coordinateKey = coordinateKey(planet);
}

/** Every coordinate currently owned by any player. */
async function loadOccupiedCoordinateKeys(UserModel) {
  const rows = await UserModel.aggregate([
    { $unwind: '$planets' },
    { $project: { _id: 0, galaxy: '$planets.galaxy', system: '$planets.system', planet: '$planets.planet' } }
  ]);
  return new Set(rows.map(coordinateKey));
}

function isCoordinateConflict(error) {
  return error?.code === 11000 && Boolean(error.keyPattern?.[COORDINATE_KEY_PATH] || error.keyValue?.[COORDINATE_KEY_PATH]);
}

// Password hashing & Initialize first planet
userSchema.pre('save', async function() {
  // Hash password if modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  
  // Initialize first planet for new users on a free coordinate
  if (this.isNew && this.planets.length === 0) {
    const GameConfig = require('./GameConfig');
    const config = await GameConfig.getConfig();
    const startResources = config.newPlayerSettings || { startingMetal: 500, startingCrystal: 300, startingDeuterium: 100 };
    const home = pickHomeCoordinate(await loadOccupiedCoordinateKeys(this.constructor), this.$locals.homeAllocation);
    
    this.planets.push({
      name: 'Colony-1',
      ...require('../utils/planetArea').createPlanetEnvironment(),
      areaVersion: 1,
      ...home,
      resources: {
        metal: startResources.startingMetal,
        crystal: startResources.startingCrystal,
        deuterium: startResources.startingDeuterium
      }
    });
  }

  require('../utils/userResearch').normalizeUserResearch(this);
  if (this.isNew) {
    const config = await require('./GameConfig').getConfig();
    this.planets.forEach(planet => require('../utils/populationEconomy').initializePopulation(planet, config));
  }
  this.planets.forEach(syncPlanetCoordinate);
  require('../utils/formationRules').reconcileFormations(this);
  this.stateRevision = (this.stateRevision || 0) + 1;
});

/**
 * Create a player with a home planet. If another registration grabbed the same
 * coordinate first, the unique index rejects the insert and we retry with a
 * fresh document (re-saving the failed one would re-hash its password).
 * @param {object} fields  user fields (username, email, password, ...)
 */
userSchema.statics.createWithHomePlanet = async function(fields, homeAllocation = {}) {
  for (let attempt = 1; attempt <= MAX_HOME_ALLOCATION_ATTEMPTS; attempt++) {
    const user = new this(fields);
    user.$locals.homeAllocation = homeAllocation;
    try {
      await user.save();
      return user;
    } catch (error) {
      if (!isCoordinateConflict(error) || attempt === MAX_HOME_ALLOCATION_ATTEMPTS) throw error;
    }
  }
  return null;
};

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
module.exports.syncPlanetCoordinate = syncPlanetCoordinate;
module.exports.isCoordinateConflict = isCoordinateConflict;
