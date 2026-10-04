import { EventEmitter } from '../utils/EventEmitter.js';

export class GameState extends EventEmitter {
  constructor() {
    super();
    
    this.isServerConnected = false;
    this.serverSpeed = 1;
    
    // Resources
    this.resources = {
      metal: 5000,
      crystal: 3000,
      deuterium: 1000,
      energy: 0
    };
    
    this.productionRates = {
      metal: 30,
      crystal: 15,
      deuterium: 0,
      energy: 0
    };
    
    this.energyProduction = 0;
    this.energyConsumption = 0;
    
    this.buildings = {
      metalMine: 1,
      crystalMine: 1,
      deuteriumSynthesizer: 0,
      solarPlant: 1,
      fusionReactor: 0,
      robotFactory: 0,
      shipyard: 0,
      researchLab: 0,
      naniteFactory: 0,
      metalStorage: 0,
      crystalStorage: 0,
      deuteriumTank: 0
    };
    
    this.research = {
      energyTechnology: 0,
      laserTechnology: 0,
      ionTechnology: 0,
      plasmaTechnology: 0,
      combustionDrive: 0,
      impulseDrive: 0,
      hyperspaceDrive: 0,
      hyperspaceTechnology: 0,
      espionageTechnology: 0,
      computerTechnology: 0,
      astrophysics: 0,
      gravitonTechnology: 0,
      weaponsTechnology: 0,
      shieldingTechnology: 0,
      armorTechnology: 0
    };
    
    this.fleet = {
      smallCargo: 2,
      largeCargo: 0,
      colonyShip: 0,
      recycler: 0,
      espionageProbe: 0,
      solarSatellite: 0,
      lightFighter: 5,
      heavyFighter: 0,
      cruiser: 0,
      battleship: 0,
      battlecruiser: 0,
      bomber: 0,
      destroyer: 0,
      deathstar: 0
    };
    
    this.fleetFormations = [];
    this.fleetMovements = [];
    this.planets = [];
    this.unassignedShips = {};
    this.stateRevision = -1;
    this.defense = {};
    this.planet = {
      name: 'Colony-1',
      position: 4,
      galaxy: 1,
      system: 1,
      planet: 1,
      minTemp: -20,
      maxTemp: 40,
      diameter: 12800
    };
    
    this.storage = { metal: 10000, crystal: 10000, deuterium: 10000 };
    this.lastUpdate = Date.now();
    
    // Building/Research/Ship Construction Queue
    this.buildQueue = [];
    this.currentBuild = null;
    this.buildTimer = null;
    this._syncedFromServer = false; // Prevent double sync
    this._resourceTickerStarted = false; // Delay ticker until sync
    
    // DISABLED: Don't load from localStorage (prevents cheating)
    // this.loadFromStorage();
    
    // Data will be loaded from server after login
    this.updateProductionRates();
    // Ticker will start after server sync
    this.startBuildTimer();
  }
  
  // Load user data from server (called after login)
  syncFromServer(userData) {
    console.log('[GameState.syncFromServer] Received userData:', userData);
    if (!userData || !userData.planets) {
      console.warn('[GameState.syncFromServer] No planets data!');
      return;
    }
    
    const revision = userData.stateRevision ?? 0;
    const serverTime = new Date(userData.serverTime || Date.now()).getTime();
    if (this.userId === userData.id && (revision < this.stateRevision || (revision === this.stateRevision && serverTime < (this.snapshotTime || 0)))) return false;
    this.userId = userData.id;
    this.stateRevision = revision;
    this.snapshotTime = serverTime;
    this.serverOffset = serverTime - Date.now();
    this.planets = userData.planets;
    this.fleetFormations = userData.fleetFormations || [];
    this.fleetMovements = userData.fleetMovements || [];
    this.unassignedShips = userData.unassignedShips || {};
    // Sync server settings
    this.serverSpeed = userData.serverSpeed || 1;
    console.log('[GameState.syncFromServer] Server speed set to:', this.serverSpeed);
    
    const currentPlanetIndex = userData.currentPlanet ?? 0;
    this.currentPlanet = currentPlanetIndex;
    this.defaultStorage = userData.defaultStorage || { metal: 10000, crystal: 10000, deuterium: 10000 };
    const planet = userData.planets[currentPlanetIndex] || userData.planets[0];
    console.log('[GameState.syncFromServer] Active planet:', planet);
    if (!planet) {
      console.warn('[GameState.syncFromServer] No active planet found!');
      return;
    }
    
    // Sync resources - use Object.assign to keep reference
    if (planet.resources) {
      Object.assign(this.resources, {
        metal: planet.resources.metal || 0,
        crystal: planet.resources.crystal || 0,
        deuterium: planet.resources.deuterium || 0,
        energy: planet.resources.energy || 0
      });
    }
    
    // Sync buildings
    if (planet.buildings) {
      this.buildings = { ...planet.buildings };
    }
    
    // Sync research (user-level, not planet-level)
    if (userData.research) {
      this.research = { ...userData.research };
    } else if (planet.research) {
      this.research = { ...planet.research };
    }
    
    // Sync fleet
    if (planet.fleet) {
      this.fleet = { ...planet.fleet };
    }

    if (planet.defense) {
      this.defense = { ...planet.defense };
    }
    
    // Sync planet info
    if (planet) {
      this.planet = {
        id: planet._id,
        area: planet.area,
        traits: planet.traits,
        productionModifiers: planet.productionModifiers,
        name: planet.name || 'Colony-1',
        position: planet.position || 4,
        galaxy: planet.galaxy || 1,
        system: planet.system || 1,
        planet: planet.planet || 1,
        minTemp: planet.minTemp ?? -20,
        maxTemp: planet.maxTemp ?? 40,
        diameter: planet.diameter ?? 12800
      };
    }

    this.lastUpdate = new Date(userData.serverTime || planet.lastUpdate || Date.now()).getTime();
    this.recalculateDerivedState(planet);
    this.emit('fleetStateChanged');
    this.emit('resourcesLoaded');
    this.emit('resourceChanged'); // Force UI refresh
    console.log('[GameState] Synced from server:', this.resources);
    
    // Start resource ticker after first sync
    if (!this._resourceTickerStarted) {
      this._syncedFromServer = true;
      this._resourceTickerStarted = true;
      this.startResourceTicker();
      console.log('[GameState] Resource ticker started after sync');
    }
  }
  
  setServerSpeed(speed) {
    this.serverSpeed = speed;
    this.recalculateDerivedState();
  }

  applyEconomySnapshot(snapshot = {}) {
    if (snapshot.resources) {
      Object.assign(this.resources, {
        metal: snapshot.resources.metal ?? this.resources.metal,
        crystal: snapshot.resources.crystal ?? this.resources.crystal,
        deuterium: snapshot.resources.deuterium ?? this.resources.deuterium,
        energy: snapshot.resources.energy ?? this.resources.energy
      });
    }

    if (snapshot.storage) {
      this.storage = {
        metal: snapshot.storage.metal ?? this.storage.metal,
        crystal: snapshot.storage.crystal ?? this.storage.crystal,
        deuterium: snapshot.storage.deuterium ?? this.storage.deuterium
      };
    }

    if (snapshot.production) {
      this.productionRates = {
        metal: Math.round((snapshot.production.metal || 0) * 10) / 10,
        crystal: Math.round((snapshot.production.crystal || 0) * 10) / 10,
        deuterium: Math.round((snapshot.production.deuterium || 0) * 10) / 10,
        energy: 0
      };
      this.resources.energy = Math.round((snapshot.production.energy || 0) * 10) / 10;
      this.energyProduction = Math.max(this.resources.energy, 0);
      this.energyConsumption = Math.max(-this.resources.energy, 0);
      this.emit('productionUpdated', {
        rates: this.productionRates,
        energy: { production: this.energyProduction, consumption: this.energyConsumption }
      });
    }

    this.emit('resourceChanged');
  }
  
  addResource(type, amount) {
    const oldValue = this.resources[type];
    // 소수점 첫째 자리에서 반올림
    const newValue = Math.round((this.resources[type] + amount) * 10) / 10;
    this.resources[type] = Math.min(newValue, this.storage[type] || Infinity);
    
    // Debug: log significant changes
    if (Math.abs(amount) > 1) {
      console.log(`[addResource] ${type}: ${oldValue} + ${amount} = ${this.resources[type]}`);
    }
    
    this.emit('resourceChanged', { type, oldValue, newValue: this.resources[type] });
    return this.resources[type];
  }
  
  consumeResource(type, amount) {
    if (this.resources[type] < amount) return false;
    const oldValue = this.resources[type];
    this.resources[type] -= amount;
    this.emit('resourceChanged', { type, oldValue, newValue: this.resources[type] });
    return true;
  }
  
  hasResources(costs) {
    for (const [resource, amount] of Object.entries(costs)) {
      if (this.resources[resource] < amount) return false;
    }
    return true;
  }
  
  spendResources(costs) {
    if (!this.hasResources(costs)) return false;
    for (const [resource, amount] of Object.entries(costs)) {
      this.consumeResource(resource, amount);
    }
    this.emit('resourcesSpent', costs);
    return true;
  }
  
  updateProductionRates() {
    this.recalculateDerivedState();
  }

  recalculateDerivedState(serverPlanet = null) {
    if (serverPlanet?.storage) {
      this.storage = {
        metal: serverPlanet.storage.metal || 10000,
        crystal: serverPlanet.storage.crystal || 10000,
        deuterium: serverPlanet.storage.deuterium || 10000
      };
    } else {
      this.storage = {
        metal: this.calculateStorageCapacity(this.buildings.metalStorage),
        crystal: this.calculateStorageCapacity(this.buildings.crystalStorage),
        deuterium: this.calculateStorageCapacity(this.buildings.deuteriumTank)
      };
    }

    if (serverPlanet?.production) {
      this.applyEconomySnapshot({
        production: serverPlanet.production,
        storage: this.storage
      });
      return;
    }

    const speed = this.serverSpeed;
    let metalProduction = 30 * speed;
    let crystalProduction = 15 * speed;
    let deuteriumProduction = 0;
    let energyProd = 0;
    let energyCons = 0;
    
    if (this.buildings.metalMine > 0) {
      const level = this.buildings.metalMine;
      metalProduction += 30 * level * Math.pow(1.1, level) * speed;
      energyCons += 10 * level * Math.pow(1.1, level);
    }
    
    if (this.buildings.crystalMine > 0) {
      const level = this.buildings.crystalMine;
      crystalProduction += 20 * level * Math.pow(1.1, level) * speed;
      energyCons += 10 * level * Math.pow(1.1, level);
    }

    if (this.buildings.deuteriumSynthesizer > 0) {
      const level = this.buildings.deuteriumSynthesizer;
      deuteriumProduction += 10 * level * Math.pow(1.1, level) * speed;
      energyCons += 20 * level * Math.pow(1.1, level);
    }
    
    if (this.buildings.solarPlant > 0) {
      const level = this.buildings.solarPlant;
      energyProd += 20 * level * Math.pow(1.1, level);
    }
    
    // 소수점 첫째 자리에서 반올림
    this.productionRates.metal = Math.round(metalProduction * 10) / 10;
    this.productionRates.crystal = Math.round(crystalProduction * 10) / 10;
    this.productionRates.deuterium = Math.round(deuteriumProduction * 10) / 10;
    this.energyProduction = Math.round(energyProd * 10) / 10;
    this.energyConsumption = Math.round(energyCons * 10) / 10;
    this.resources.energy = Math.round((energyProd - energyCons) * 10) / 10;
    
    this.emit('productionUpdated', {
      rates: this.productionRates,
      energy: { production: energyProd, consumption: energyCons }
    });
  }

  calculateStorageCapacity(level = 0) {
    return 10000 * Math.floor(2.5 * Math.exp(20 * level / 33));
  }
  
  startResourceTicker() {
    setInterval(() => {
      const now = Date.now();
      const deltaHours = (now - this.lastUpdate) / 3600000;
      this.lastUpdate = now;
      
      for (const [resource, rate] of Object.entries(this.productionRates)) {
        if (rate > 0) {
          const amount = rate * deltaHours;
          this.addResource(resource, amount);
        }
      }
      
      this.saveToStorage();
    }, 1000);
  }
  
  upgradeBuilding(buildingId) {
    const currentLevel = this.buildings[buildingId] || 0;
    this.buildings[buildingId] = currentLevel + 1;
    this.updateProductionRates();
    this.emit('buildingUpgraded', { buildingId, level: this.buildings[buildingId] });
    return this.buildings[buildingId];
  }
  
  getBuildingLevel(buildingId) {
    return this.buildings[buildingId] || 0;
  }
  
  upgradeResearch(researchId) {
    const currentLevel = this.research[researchId] || 0;
    this.research[researchId] = currentLevel + 1;
    this.emit('researchCompleted', { researchId, level: this.research[researchId] });
    return this.research[researchId];
  }
  
  getResearchLevel(researchId) {
    return this.research[researchId] || 0;
  }
  
  hasTechRequirements(requirements) {
    if (!requirements) return true;
    for (const [tech, level] of Object.entries(requirements)) {
      if (this.buildings[tech] < level && this.research[tech] < level) {
        return false;
      }
    }
    return true;
  }
  
  addShips(shipId, count) {
    this.fleet[shipId] = (this.fleet[shipId] || 0) + count;
    this.emit('fleetChanged', { shipId, count: this.fleet[shipId] });
  }
  
  // DISABLED: Local storage for game data - prevents cheating
  // All permanent data (resources, buildings, research, fleet) is stored in server database
  // Client-side localStorage can be manipulated by users
  saveToStorage() {
    // NO-OP: Game data stored in MongoDB only
  }
  
  loadFromStorage() {
    // NO-OP: Data loaded from server via apiService
  }
  
  reset() {
    location.reload();
  }
  
  // Build Queue Methods
  addToQueue(type, id, name, icon, duration, level = 1) {
    const item = {
      type, // 'building', 'research', 'ship'
      id,
      name,
      icon,
      level,
      duration: Math.floor(duration), // seconds
      remaining: Math.floor(duration),
      startTime: Date.now()
    };
    
    this.buildQueue.push(item);
    this.emit('queueUpdated', { queue: this.buildQueue });
    this.saveToStorage();
    
    // If nothing is building, start immediately
    if (!this.currentBuild) {
      this.processQueue();
    }
    
    return item;
  }
  
  processQueue() {
    if (this.buildQueue.length === 0) {
      this.currentBuild = null;
      this.emit('buildComplete', { type: 'queueEmpty' });
      this.saveToStorage();
      return;
    }
    
    this.currentBuild = this.buildQueue.shift();
    this.currentBuild.startTime = Date.now();
    this.emit('buildStarted', { build: this.currentBuild, queue: this.buildQueue });
    this.emit('queueUpdated', { queue: this.buildQueue, current: this.currentBuild });
    this.saveToStorage();
  }
  
  startBuildTimer() {
    setInterval(() => {
      if (!this.currentBuild) return;
      
      const elapsed = (Date.now() - this.currentBuild.startTime) / 1000;
      this.currentBuild.remaining = Math.max(0, this.currentBuild.duration - elapsed);
      
      this.emit('buildProgress', { 
        build: this.currentBuild, 
        progress: 1 - (this.currentBuild.remaining / this.currentBuild.duration)
      });
      
      if (this.currentBuild.remaining <= 0) {
        this.completeBuild();
      }
    }, 1000);
  }
  
  completeBuild() {
    if (!this.currentBuild) return;
    
    const { type, id, level } = this.currentBuild;
    
    // Apply the build
    if (type === 'building') {
      this.upgradeBuilding(id);
    } else if (type === 'research') {
      this.upgradeResearch(id);
    } else if (type === 'ship') {
      this.addShips(id, 1);
    }
    
    this.emit('buildComplete', { build: this.currentBuild });
    
    // Process next item in queue
    this.currentBuild = null;
    if (this.buildQueue.length > 0) {
      setTimeout(() => this.processQueue(), 500);
    } else {
      this.emit('queueUpdated', { queue: [] });
    }
    this.saveToStorage();
  }
  
  cancelBuild(index) {
    if (index === -1 && this.currentBuild) {
      // Cancel current build (refund?)
      this.currentBuild = null;
      this.saveToStorage();
      this.processQueue();
    } else if (index >= 0 && index < this.buildQueue.length) {
      // Cancel queued build
      this.buildQueue.splice(index, 1);
      this.emit('queueUpdated', { queue: this.buildQueue });
      this.saveToStorage();
    }
  }
  
  getQueueStatus() {
    return {
      current: this.currentBuild,
      queue: this.buildQueue,
      total: this.buildQueue.length + (this.currentBuild ? 1 : 0)
    };
  }
}

export const gameState = new GameState();
