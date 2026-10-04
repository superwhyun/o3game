const User = require('../models/User');
const FleetMovement = require('../models/FleetMovement');
const BattleReport = require('../models/BattleReport');
const GameConfig = require('../models/GameConfig');
const CombatService = require('../services/CombatService');
const { calculateBuildingCost, calculateResearchCost, calculateShipCost } = require('../utils/gameCalculations');
const { applyOfflineProduction } = require('../utils/planetEconomy');
const { settleUserState, settleUsersWithDueQueues } = require('../services/GameStateService');
const entityConfigService = require('../services/EntityConfigService');
const { verifyUserToken } = require('../utils/authToken');
const { calculateRaidLoot, calculateSurvivors, mergeCargo } = require('../utils/attackRules');

class SocketHandlers {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map();
    this.setupGlobalTicks();
  }
  
  handleConnection(socket) {
    console.log(`Client connected: ${socket.id}`);
    
    socket.on('authenticate', (token) => this.authenticate(socket, token));
    socket.on('getPlanetData', () => this.getPlanetData(socket));
    socket.on('getGalaxy', (data) => this.getGalaxy(socket, data));
    socket.on('getBattleReports', () => this.getBattleReports(socket));
    socket.on('disconnect', () => this.handleDisconnect(socket));
  }
  
  async authenticate(socket, token) {
    try {
      const { userId } = verifyUserToken(token);
      if (!userId) {
        throw new Error('Token does not include a user id');
      }
      const user = await User.findById(userId);
      if (!user) {
        socket.emit('auth_error', 'User not found');
        return;
      }
      
      user.isOnline = true;
      user.socketId = socket.id;
      user.lastLogin = new Date();
      await user.save();
      
      socket.join(`user:${userId}`);
      this.connectedUsers.set(socket.id, userId);
      socket.userId = userId;
      
      socket.emit('authenticated', { username: user.username });
      this.getPlanetData(socket);
      
    } catch (error) {
      socket.emit('auth_error', error.message);
    }
  }
  
  async getPlanetData(socket) {
    if (!socket.userId) return;
    
    try {
      const settled = await settleUserState(socket.userId, new Date());
      if (!settled?.user) return;

      socket.emit('planetData', settled.snapshot);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }
  
  async build(socket, { buildingId }) {
    if (!socket.userId) return;
    
    try {
      const user = await User.findById(socket.userId);
      const planet = user.planets[user.currentPlanet];
      const currentLevel = planet.buildings[buildingId] || 0;
      const cost = await calculateBuildingCost(buildingId, currentLevel + 1);
      
      if (!this.hasResources(planet.resources, cost)) {
        socket.emit('error', { message: 'Insufficient resources' });
        return;
      }
      
      this.deductResources(planet.resources, cost);
      planet.buildings[buildingId] = currentLevel + 1;
      planet.lastUpdate = new Date();
      await user.save();
      
      socket.emit('buildingComplete', { buildingId, level: currentLevel + 1 });
      this.getPlanetData(socket);
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }
  
  async research(socket, { researchId }) {
    if (!socket.userId) return;
    
    try {
      const user = await User.findById(socket.userId);
      const planet = user.planets[user.currentPlanet];
      const currentLevel = planet.research[researchId] || 0;
      const cost = await calculateResearchCost(researchId, currentLevel);
      
      if (!this.hasResources(planet.resources, cost)) {
        socket.emit('error', { message: 'Insufficient resources' });
        return;
      }
      
      this.deductResources(planet.resources, cost);
      planet.research[researchId] = currentLevel + 1;
      planet.lastUpdate = new Date();
      await user.save();
      
      socket.emit('researchComplete', { researchId, level: currentLevel + 1 });
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }
  
  async buildShip(socket, { shipId, count = 1 }) {
    if (!socket.userId) return;
    
    try {
      const user = await User.findById(socket.userId);
      const planet = user.planets[user.currentPlanet];
      
      if (planet.buildings.shipyard < 1) {
        socket.emit('error', { message: 'Shipyard required' });
        return;
      }
      
      const totalCost = await calculateShipCost(shipId, count);
      if (!totalCost) {
        socket.emit('error', { message: 'Invalid ship type' });
        return;
      }

      if (!this.hasResources(planet.resources, totalCost)) {
        socket.emit('error', { message: 'Insufficient resources' });
        return;
      }

      this.deductResources(planet.resources, totalCost);
      planet.fleet[shipId] = (planet.fleet[shipId] || 0) + count;
      planet.lastUpdate = new Date();
      await user.save();
      
      socket.emit('shipBuilt', { shipId, count, total: planet.fleet[shipId] });
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }
  
  async sendFleet(socket, { fleet, fleetDeck, target, mission, cargo = {}, speed = 100 }) {
    if (!socket.userId) return;
    
    try {
      const user = await User.findById(socket.userId);
      const originPlanet = user.planets[user.currentPlanet];
      
      // Calculate total required ships from deck if provided, else use flat fleet
      let requiredShips = fleet || {};
      if (fleetDeck && fleetDeck.length > 0) {
        requiredShips = {};
        for(const slot of fleetDeck) {
            if(slot && slot.type && slot.count) {
                requiredShips[slot.type] = (requiredShips[slot.type] || 0) + slot.count;
            }
        }
      }

      for (const [shipId, count] of Object.entries(requiredShips)) {
        if ((originPlanet.fleet[shipId] || 0) < count) {
          socket.emit('error', { message: `Not enough ${shipId}` });
          return;
        }
      }
      
      const distance = Math.sqrt(
        Math.pow(target.galaxy - originPlanet.galaxy, 2) +
        Math.pow(target.system - originPlanet.system, 2) +
        Math.pow(target.planet - originPlanet.planet, 2)
      );
      
      let slowestSpeed = Infinity;
      for (const shipId of Object.keys(requiredShips)) {
        const definition = entityConfigService.getEntity('ship', shipId);
        const speedStat = definition?.stats?.speed;
        if (speedStat && speedStat < slowestSpeed) {
          slowestSpeed = speedStat;
        }
      }
      
      const travelTime = Math.floor((3500 / (speed / 100)) * Math.sqrt(distance * 10 / slowestSpeed));
      
      for (const [shipId, count] of Object.entries(requiredShips)) {
        originPlanet.fleet[shipId] -= count;
      }
      
      for (const [res, amount] of Object.entries(cargo)) {
        originPlanet.resources[res] -= amount;
      }
      
      const FleetMovement = require('../models/FleetMovement');
      
      // Compute flat fleet totals if only fleetDeck is provided
      let computedFleet = fleet;
      if (!fleet && fleetDeck) {
        computedFleet = {};
        for (const slot of fleetDeck) {
          if (slot && slot.type && slot.count) {
            computedFleet[slot.type] = (computedFleet[slot.type] || 0) + slot.count;
          }
        }
      }

      const movement = new FleetMovement({
        userId: socket.userId,
        username: user.username,
        mission,
        fleet: computedFleet,
        fleetDeck: fleetDeck || Array(8).fill({ type: null, count: 0 }),
        cargo,
        origin: {
          galaxy: originPlanet.galaxy,
          system: originPlanet.system,
          planet: originPlanet.planet
        },
        destination: target,
        startTime: new Date(),
        arrivalTime: new Date(Date.now() + travelTime * 1000),
        speed
      });
      
      await movement.save();
      
      socket.emit('fleetSent', {
        movementId: movement._id,
        arrivalTime: movement.arrivalTime,
        travelTime
      });
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }
  
  async getGalaxy(socket, { galaxy, system }) {
    if (!socket.userId) return;
    
    try {
      const planets = await User.find({
        'planets.galaxy': galaxy,
        'planets.system': system
      }, 'username planets.$ isOnline socketId');
      
      const systemData = [];
      for (let i = 1; i <= 15; i++) {
        const user = planets.find(p => p.planets.some(planet => planet.planet === i));
        
        if (user) {
          systemData.push({
            position: i,
            username: user.username,
            hasPlanet: true,
            isOnline: user.isOnline
          });
        } else {
          systemData.push({ position: i, hasPlanet: false });
        }
      }
      
      socket.emit('galaxyData', { galaxy, system, planets: systemData });
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }
  
  async getBattleReports(socket) {
    if (!socket.userId) return;
    
    try {
      const reports = await BattleReport.find({
        $or: [
          { 'attacker.userId': socket.userId },
          { 'defender.userId': socket.userId }
        ]
      }).sort({ battleTime: -1 }).limit(20);
      
      socket.emit('battleReports', reports);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }
  
  handleDisconnect(socket) {
    console.log(`Client disconnected: ${socket.id}`);
    
    if (socket.userId) {
      this.connectedUsers.delete(socket.id);
      User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        socketId: null
      }).exec();
    }
  }
  
  setupGlobalTicks() {
    setInterval(async () => {
      await this.processFleetArrivals();
      await settleUsersWithDueQueues(new Date());
    }, 5000);
  }
  
  async processFleetArrivals() {
    if (this.processingFleets) return;
    this.processingFleets = true;
    try {
      const now = new Date();
      const movements = await FleetMovement.find({ $or: [
        { status: 'flying', arrivalTime: { $lte: now } },
        { status: 'returning', returnTime: { $lte: now } }
      ] }).select('_id');
      for (const movement of movements) {
        try {
          const users = await require('../services/FleetService').processMovement(movement._id, now);
          for (const id of users) this.io.to(`user:${id}`).emit('fleetStateChanged');
        } catch (error) { console.error('Fleet processing failed:', movement._id, error.message); }
      }
    } finally { this.processingFleets = false; }
  }

  hasResources(resources, cost) {
    for (const [res, amount] of Object.entries(cost)) {
      if ((resources[res] || 0) < amount) return false;
    }
    return true;
  }
  
  deductResources(resources, cost) {
    for (const [res, amount] of Object.entries(cost)) {
      resources[res] -= amount;
    }
  }
  
}

module.exports = SocketHandlers;
