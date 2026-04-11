/**
 * Default base costs and build/research times for all game entities.
 * These mirror the values in ogame-3d/src/data/gameData.js and are used as
 * fallback when no DB override exists.
 */

const BUILDING_DEFAULTS = {
  metalMine:            { baseCost: { metal: 60,      crystal: 15,     deuterium: 0 },   costMultiplier: 1.5, buildTime: 60 },
  crystalMine:          { baseCost: { metal: 48,      crystal: 24,     deuterium: 0 },   costMultiplier: 1.6, buildTime: 90 },
  deuteriumSynthesizer: { baseCost: { metal: 225,     crystal: 75,     deuterium: 0 },   costMultiplier: 1.5, buildTime: 120 },
  solarPlant:           { baseCost: { metal: 75,      crystal: 30,     deuterium: 0 },   costMultiplier: 1.5, buildTime: 60 },
  fusionReactor:        { baseCost: { metal: 900,     crystal: 360,    deuterium: 180 }, costMultiplier: 1.8, buildTime: 300 },
  robotFactory:         { baseCost: { metal: 400,     crystal: 120,    deuterium: 200 }, costMultiplier: 2.0, buildTime: 180 },
  shipyard:             { baseCost: { metal: 400,     crystal: 200,    deuterium: 100 }, costMultiplier: 2.0, buildTime: 180 },
  researchLab:          { baseCost: { metal: 200,     crystal: 400,    deuterium: 200 }, costMultiplier: 2.0, buildTime: 240 },
  naniteFactory:        { baseCost: { metal: 1000000, crystal: 500000, deuterium: 100000 }, costMultiplier: 2.0, buildTime: 1800 },
  metalStorage:         { baseCost: { metal: 1000,    crystal: 0,      deuterium: 0 },   costMultiplier: 2.0, buildTime: 60 },
  crystalStorage:       { baseCost: { metal: 1000,    crystal: 500,    deuterium: 0 },   costMultiplier: 2.0, buildTime: 60 },
  deuteriumTank:        { baseCost: { metal: 1000,    crystal: 1000,   deuterium: 0 },   costMultiplier: 2.0, buildTime: 60 }
};

const SHIP_DEFAULTS = {
  smallCargo:      { baseCost: { metal: 2000,    crystal: 2000,  deuterium: 0 },     buildTime: 120 },
  largeCargo:      { baseCost: { metal: 6000,    crystal: 6000,  deuterium: 0 },     buildTime: 300 },
  colonyShip:      { baseCost: { metal: 10000,   crystal: 20000, deuterium: 10000 }, buildTime: 600 },
  recycler:        { baseCost: { metal: 10000,   crystal: 6000,  deuterium: 2000 },  buildTime: 300 },
  espionageProbe:  { baseCost: { metal: 0,       crystal: 1000,  deuterium: 0 },     buildTime: 60 },
  solarSatellite:  { baseCost: { metal: 0,       crystal: 2000,  deuterium: 500 },   buildTime: 180 },
  lightFighter:    { baseCost: { metal: 3000,    crystal: 1000,  deuterium: 0 },     buildTime: 120 },
  heavyFighter:    { baseCost: { metal: 6000,    crystal: 4000,  deuterium: 0 },     buildTime: 300 },
  cruiser:         { baseCost: { metal: 20000,   crystal: 7000,  deuterium: 2000 },  buildTime: 600 },
  battleship:      { baseCost: { metal: 45000,   crystal: 15000, deuterium: 0 },     buildTime: 1200 },
  battlecruiser:   { baseCost: { metal: 30000,   crystal: 40000, deuterium: 15000 }, buildTime: 1800 },
  bomber:          { baseCost: { metal: 50000,   crystal: 25000, deuterium: 15000 }, buildTime: 2400 },
  destroyer:       { baseCost: { metal: 60000,   crystal: 50000, deuterium: 15000 }, buildTime: 3000 },
  deathstar:       { baseCost: { metal: 5000000, crystal: 4000000, deuterium: 1000000 }, buildTime: 86400 }
};

const RESEARCH_DEFAULTS = {
  energyTechnology:     { baseCost: { metal: 0,     crystal: 800,   deuterium: 400 },  costMultiplier: 2.0, buildTime: 240 },
  laserTechnology:      { baseCost: { metal: 200,   crystal: 100,   deuterium: 0 },    costMultiplier: 2.0, buildTime: 300 },
  ionTechnology:        { baseCost: { metal: 1000,  crystal: 300,   deuterium: 100 },  costMultiplier: 2.0, buildTime: 600 },
  plasmaTechnology:     { baseCost: { metal: 2000,  crystal: 4000,  deuterium: 1000 }, costMultiplier: 2.0, buildTime: 1200 },
  combustionDrive:      { baseCost: { metal: 400,   crystal: 0,     deuterium: 600 },  costMultiplier: 2.0, buildTime: 180 },
  impulseDrive:         { baseCost: { metal: 2000,  crystal: 4000,  deuterium: 600 },  costMultiplier: 2.0, buildTime: 360 },
  hyperspaceDrive:      { baseCost: { metal: 10000, crystal: 20000, deuterium: 6000 }, costMultiplier: 2.0, buildTime: 1800 },
  hyperspaceTechnology: { baseCost: { metal: 0,     crystal: 4000,  deuterium: 2000 }, costMultiplier: 2.0, buildTime: 900 },
  espionageTechnology:  { baseCost: { metal: 200,   crystal: 1000,  deuterium: 200 },  costMultiplier: 2.0, buildTime: 240 },
  computerTechnology:   { baseCost: { metal: 0,     crystal: 400,   deuterium: 600 },  costMultiplier: 2.0, buildTime: 300 },
  astrophysics:         { baseCost: { metal: 4000,  crystal: 8000,  deuterium: 4000 }, costMultiplier: 1.75, buildTime: 900 },
  gravitonTechnology:   { baseCost: { metal: 0,     crystal: 0,     deuterium: 0 },    costMultiplier: 3.0, buildTime: 1800 },
  weaponsTechnology:    { baseCost: { metal: 800,   crystal: 200,   deuterium: 0 },    costMultiplier: 2.0, buildTime: 300 },
  shieldingTechnology:  { baseCost: { metal: 200,   crystal: 600,   deuterium: 0 },    costMultiplier: 2.0, buildTime: 360 },
  armorTechnology:      { baseCost: { metal: 1000,  crystal: 0,     deuterium: 0 },    costMultiplier: 2.0, buildTime: 240 }
};

const DEFENSE_DEFAULTS = {
  rocketLauncher:   { baseCost: { metal: 2000,    crystal: 0,      deuterium: 0 },     buildTime: 60 },
  lightLaser:       { baseCost: { metal: 1500,    crystal: 500,    deuterium: 0 },     buildTime: 60 },
  heavyLaser:       { baseCost: { metal: 6000,    crystal: 2000,   deuterium: 0 },     buildTime: 120 },
  gaussCannon:      { baseCost: { metal: 20000,   crystal: 15000,  deuterium: 2000 },  buildTime: 300 },
  ionCannon:        { baseCost: { metal: 2000,    crystal: 6000,   deuterium: 0 },     buildTime: 120 },
  plasmaTurret:     { baseCost: { metal: 50000,   crystal: 50000,  deuterium: 30000 }, buildTime: 600 },
  smallShieldDome:  { baseCost: { metal: 10000,   crystal: 10000,  deuterium: 0 },     buildTime: 300 },
  largeShieldDome:  { baseCost: { metal: 50000,   crystal: 50000,  deuterium: 0 },     buildTime: 600 }
};

module.exports = { BUILDING_DEFAULTS, SHIP_DEFAULTS, RESEARCH_DEFAULTS, DEFENSE_DEFAULTS };
