const User = require('../models/User');
const FleetMovement = require('../models/FleetMovement');
const BattleReport = require('../models/BattleReport');
const GameConfig = require('../models/GameConfig');
const CombatService = require('../services/CombatService');
const { calculateBuildingCost, calculateResearchCost, calculateShipCost } = require('../utils/gameCalculations');
const { applyOfflineProduction } = require('../utils/planetEconomy');
const { settleUserState, settleUsersWithDueQueues } = require('../services/GameStateService');
const entityConfigService = require('../services/EntityConfigService');
const { normalizeError, apiError } = require('../utils/apiErrors');
const { authenticateUser } = require('../middleware/admin');
const { randomUUID } = require('node:crypto');
const { verifyUserToken } = require('../utils/authToken');
const { calculateRaidLoot, calculateSurvivors, mergeCargo } = require('../utils/attackRules');

class SocketHandlers {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map();
    this.presenceUpdates = new Map();
    this.setupGlobalTicks();
  }
  
  handleConnection(socket) {
    console.log(`Client connected: ${socket.id}`);
    
    const run = (event, handler) => socket.on(event, async (data, ack) => {
      if (typeof data === 'function') { ack=data; data=undefined; }
      const requestId=randomUUID();
      try {
        const now=Date.now();
        this.eventLimits ||= new Map();
        for (const [key, bucket] of this.eventLimits) if(bucket.until<=now)this.eventLimits.delete(key);
        const key=event==='authenticate' ? `auth:${socket.handshake?.address || socket.id}` : `user:${socket.userId || socket.id}`;
        const bucket=this.eventLimits.get(key)||{count:0,until:now+60000};
        this.eventLimits.set(key,bucket);
        if(++bucket.count>120)throw apiError(429,'RATE_LIMITED','요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
        if(event==='authenticate') {
          if(typeof data!=='string'||data.length>4096)throw apiError(401,'AUTH_INVALID_TOKEN','유효하지 않은 로그인 토큰입니다.');
          await this.authenticate(socket,data);
        } else {
          if(!socket.authToken)throw apiError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
          const user=await authenticateUser({headers:{authorization:`Bearer ${socket.authToken}`}});
          if(String(user._id)!==String(socket.userId))throw apiError(401,'AUTH_INVALID_TOKEN','유효하지 않은 로그인 토큰입니다.');
          if(event==='getGalaxy') {
            if(!data||typeof data!=='object'||!Number.isSafeInteger(data.galaxy)||data.galaxy<1||data.galaxy>9||!Number.isSafeInteger(data.system)||data.system<1||data.system>499)throw apiError(400,'INVALID_REQUEST','성계 좌표가 올바르지 않습니다.');
          }
          await handler(data);
        }
        if(typeof ack==='function')ack({ok:true,requestId});
      } catch(error) {
        const e=normalizeError(error), packet={error:e.message,message:e.message,code:e.code,status:e.status,requestId};
        socket.emit('apiError',packet);
        if(event==='authenticate'){await this.clearSession(socket).catch(()=>{});socket.emit('auth_error',e.message);}
        else {socket.emit('error',packet);if(e.status===401||e.code==='ACCOUNT_BANNED')await this.clearSession(socket).catch(()=>{});}
        if(typeof ack==='function')ack({ok:false,error:packet});
      }
    });
    run('authenticate', data=>this.authenticate(socket,data));
    run('getPlanetData', ()=>this.getPlanetData(socket));
    run('getGalaxy', data=>this.getGalaxy(socket,data));
    run('getBattleReports', ()=>this.getBattleReports(socket));
    socket.on('disconnect', () => this.handleDisconnect(socket));
  }
  
  async authenticate(socket, token) {
    const previous = socket.authentication || Promise.resolve();
    socket.authentication = previous.catch(() => {}).then(() => this.authenticateSession(socket, token));
    return socket.authentication;
  }

  async updatePresence(userId) {
    const previous = this.presenceUpdates.get(userId) || Promise.resolve();
    const update = previous.catch(() => {}).then(async () => {
      const sockets = [...this.connectedUsers].filter(([, id]) => id === userId);
      await User.updateOne({ _id: userId }, { $set: {
        isOnline: sockets.length > 0,
        socketId: sockets.at(-1)?.[0] || null
      } });
    });
    this.presenceUpdates.set(userId, update);
    try { await update; }
    finally { if (this.presenceUpdates.get(userId) === update) this.presenceUpdates.delete(userId); }
  }

  async clearSession(socket) {
    const userId = this.connectedUsers.get(socket.id);
    this.connectedUsers.delete(socket.id);
    socket.userId = null;
    socket.authToken = null;
    if (userId) {
      await socket.leave(`user:${userId}`);
      await this.updatePresence(userId);
    }
  }

  async authenticateSession(socket, token) {
    try {
      await this.clearSession(socket);
      if (socket.connected === false) return;
      const authRequest = {headers:{authorization:`Bearer ${token}`}};
      const verified = await authenticateUser(authRequest);
      if (authRequest.aiScoped) throw apiError(403, 'FORBIDDEN', 'AI 대리는 HTTP 게임 API만 사용할 수 있습니다.');
      const userId = String(verified._id);
      if (!userId) {
        throw new Error('Token does not include a user id');
      }
      const user = await User.findById(userId);
      if (!user) {
        socket.emit('auth_error', 'User not found');
        return;
      }
      
      if (socket.connected === false) return;
      await socket.join(`user:${userId}`);
      if (socket.connected === false) return;
      this.connectedUsers.set(socket.id, userId);
      socket.userId = userId;
      socket.authToken = token;
      await this.updatePresence(userId);
      if (socket.connected === false) return;
      
      socket.emit('authenticated', { username: user.username });
      await this.getPlanetData(socket);
      
    } catch (error) {
      await this.clearSession(socket).catch(err => console.error('Session cleanup failed:', err.message));
      throw error;
    }
  }
  
  async getPlanetData(socket) {
    if (!socket.userId) return;
    const userId = socket.userId;
    
    try {
      const settled = await settleUserState(userId, new Date());
      if (!settled?.user || socket.userId !== userId || socket.connected === false) return;

      socket.emit('planetData', settled.snapshot);
    } catch (error) {
      throw error;
    }
  }
  
  async queueCommand(socket, command) {
    if (!socket.userId) return;
    try {
      const result = await require('../services/ConstructionService').enqueue(socket.userId, command);
      socket.emit('constructionQueued', result);
      socket.emit('planetData', result.snapshot);
    } catch (error) {
      socket.emit('error', { message: error.message, code: error.code });
    }
  }
  async build(socket, { buildingId, planetId } = {}) {
    return this.queueCommand(socket, { type: 'building', itemId: buildingId, planetId });
  }
  async research(socket, { researchId, planetId } = {}) {
    return this.queueCommand(socket, { type: 'research', itemId: researchId, planetId });
  }
  async buildShip(socket, { shipId, count = 1, planetId } = {}) {
    return this.queueCommand(socket, { type: 'ship', itemId: shipId, count, planetId });
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
      const users=await User.find({'planets.galaxy':galaxy,'planets.system':system}).select('_id username isOnline planets').lean();
      const scoutReports=await require('../models/ScoutReport').find({ownerUserId:socket.userId,'destination.galaxy':galaxy,'destination.system':system,outcome:{$in:['empty','occupied','friendly']}}).sort({observedAt:-1}).lean();
      const {conflicts,...view}=require('../utils/galaxySystem').buildGalaxySystem({galaxy,system,requestingUserId:socket.userId,users,scoutReports});
      socket.emit('galaxyData',view);
    } catch (error) {
      throw error;
    }
  }
  
  async getBattleReports(socket) {
    if (!socket.userId) return;
    const userId = socket.userId;
    
    try {
      const reports = await BattleReport.find({
        $or: [
          { 'attacker.userId': userId },
          { 'defender.userId': userId }
        ]
      }).sort({ battleTime: -1 }).limit(20);
      
      if (socket.userId === userId && socket.connected !== false) socket.emit('battleReports', reports);
    } catch (error) {
      throw error;
    }
  }
  
  async handleDisconnect(socket) {
    console.log(`Client disconnected: ${socket.id}`);
    
    try { await this.clearSession(socket); }
    catch (error) { console.error('Presence update failed:', error.message); }
  }
  
  setupGlobalTicks() {
    this.tickTimer = setInterval(async () => {
      if (this.processingTick) return;
      this.processingTick = true;
      try {
        await this.processFleetArrivals();
        await settleUsersWithDueQueues(new Date());
      } catch (error) { console.error('Game tick failed:', error.message); }
      finally { this.processingTick = false; }
    }, 5000);
  }
  
  async processFleetArrivals() {
    if (this.processingFleets) return;
    this.processingFleets = true;
    try {
      const now = new Date();
      const movements = await FleetMovement.find({ $or: [
        { status: 'flying', arrivalTime: { $lte: now } },
        { status: 'returning', returnTime: { $lte: now } },
        { status: 'returning', mission: 'colonize', notice: /^식민지 개척 완료/ }
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
