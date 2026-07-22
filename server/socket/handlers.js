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
    try {
      const now = new Date();
      const FleetMovement = require('../models/FleetMovement');
      const arrivingFleets = await FleetMovement.find({
        arrivalTime: { $lte: now },
        status: 'flying'
      });
      
      for (const fleet of arrivingFleets) {
        await this.handleFleetArrival(fleet);
      }

      const returningFleets = await FleetMovement.find({
        returnTime: { $lte: now },
        status: 'returning'
      });

      for (const fleet of returningFleets) {
        await this.completeFleetReturn(fleet);
      }
    } catch (error) {
      console.error('Error processing fleet arrivals:', error);
    }
  }
  
  async handleFleetArrival(fleet) {
    const targetUser = await User.findOne({
      'planets.galaxy': fleet.destination.galaxy,
      'planets.system': fleet.destination.system,
      'planets.planet': fleet.destination.planet
    });
    
    if (fleet.mission === 'transport' && targetUser) {
        const targetPlanet = targetUser.planets.find(p =>
            p.galaxy === fleet.destination.galaxy
            && p.system === fleet.destination.system
            && p.planet === fleet.destination.planet
        );

        if (targetPlanet) {
            for (const [resource, amount] of Object.entries(fleet.cargo || {})) {
                targetPlanet.resources[resource] = (targetPlanet.resources[resource] || 0) + amount;
            }
            targetUser.markModified('planets');
            await targetUser.save();
            fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
        }
    } else if (fleet.mission === 'attack' && targetUser) {
        const targetPlanet = targetUser.planets.find(p => 
            p.galaxy === fleet.destination.galaxy && 
            p.system === fleet.destination.system && 
            p.planet === fleet.destination.planet
        );

        if (targetPlanet) {
            // Setup an auto-generated defense deck for the defender since UI isn't built yet
            // Putting all defenses in wave 0, and all ships evenly spread or in wave 1
            const defenderDeck = Array(8).fill(null).map(() => ({}));
            
            // For now, put all defenses in Wave 0, all mobile ships in Wave 1
            let defenseAssigned = false;
            for (const [defId, count] of Object.entries(targetPlanet.defense || {})) {
                if (count > 0 && !defenseAssigned) {
                    defenderDeck[0].defenseType = defId;
                    defenderDeck[0].defenseCount = count;
                    defenseAssigned = true;
                }
            }
            let shipAssigned = false;
            for (const [shipId, count] of Object.entries(targetPlanet.fleet || {})) {
                if (count > 0 && !shipAssigned) {
                    defenderDeck[1].shipType = shipId;
                    defenderDeck[1].shipCount = count;
                    shipAssigned = true;
                }
            }

            const techs = {
                attacker: {}, // Fetch attacker techs in real code
                defender: targetUser.research || {}
            };

            const combatResult = await CombatService.simulateBattle8Wave(fleet.fleetDeck, defenderDeck, techs);
            const survivingFleet = calculateSurvivors(
                fleet.fleet.toObject ? fleet.fleet.toObject() : fleet.fleet,
                combatResult.attackerLosses || {}
            );
            const survivorCargoCapacity = Object.entries(survivingFleet).reduce((total, [shipType, count]) => {
                const cargo = entityConfigService.getEntity('ship', shipType)?.stats?.cargo || 0;
                return total + (cargo * count);
            }, 0);
            const carriedCargo = Object.values(fleet.cargo || {}).reduce((total, amount) => total + amount, 0);
            const remainingCargoCapacity = Math.max(0, survivorCargoCapacity - carriedCargo);
            const defenderResourcesForLoot = Object.fromEntries(
                ['metal', 'crystal', 'deuterium'].map((resource) => [
                    resource,
                    Math.max(0, Math.floor(targetPlanet.resources[resource] || 0))
                ])
            );
            const loot = combatResult.winner === 'attacker'
                ? calculateRaidLoot(defenderResourcesForLoot, remainingCargoCapacity)
                : { metal: 0, crystal: 0, deuterium: 0 };

            for (const [resource, amount] of Object.entries(loot)) {
                targetPlanet.resources[resource] -= amount;
            }
            fleet.fleet = survivingFleet;
            fleet.cargo = mergeCargo(
                fleet.cargo?.toObject ? fleet.cargo.toObject() : (fleet.cargo || {}),
                loot
            );

            // Create BattleReport
            const battleReport = new BattleReport({
                attacker: {
                    userId: fleet.userId,
                    username: fleet.username,
                    coordinates: fleet.origin
                },
                defender: {
                    userId: targetUser._id,
                    username: targetUser.username,
                    coordinates: fleet.destination
                },
                rounds: combatResult.rounds,
                result: {
                    winner: combatResult.winner,
                    attackerLosses: combatResult.attackerLosses,
                    defenderLosses: combatResult.defenderLosses,
                    debrisField: combatResult.debrisField,
                    loot,
                    moonChance: combatResult.moonChance
                }
            });
            await battleReport.save();

            fleet.battleReport = battleReport._id;
            
            // Deduct defender losses
            for (const [type, count] of Object.entries(combatResult.defenderLosses || {})) {
                if (targetPlanet.fleet && targetPlanet.fleet[type]) targetPlanet.fleet[type] = Math.max(0, targetPlanet.fleet[type] - count);
                if (targetPlanet.defense && targetPlanet.defense[type]) targetPlanet.defense[type] = Math.max(0, targetPlanet.defense[type] - count);
            }

            await targetUser.save();
        }
    }

    fleet.status = 'returning';
    fleet.returnTime = new Date(Date.now() + (fleet.arrivalTime - fleet.startTime));
    await fleet.save();
  }

  async completeFleetReturn(fleet) {
    const owner = await User.findById(fleet.userId);
    if (!owner) {
      fleet.status = 'completed';
      await fleet.save();
      return;
    }

    const originPlanet = owner.planets.find((planet) => (
      planet.galaxy === fleet.origin.galaxy
      && planet.system === fleet.origin.system
      && planet.planet === fleet.origin.planet
    ));
    if (!originPlanet) {
      throw new Error(`Fleet ${fleet._id} has no valid origin planet`);
    }

    for (const [shipType, amount] of Object.entries(fleet.fleet || {})) {
      originPlanet.fleet[shipType] = (originPlanet.fleet[shipType] || 0) + amount;
    }
    for (const [resource, amount] of Object.entries(fleet.cargo || {})) {
      originPlanet.resources[resource] = (originPlanet.resources[resource] || 0) + amount;
    }

    owner.markModified('planets');
    await owner.save();
    fleet.status = 'completed';
    await fleet.save();
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
