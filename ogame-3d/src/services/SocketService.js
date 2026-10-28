import { io } from 'socket.io-client';
import { EventEmitter } from '../utils/EventEmitter.js';
import { SERVER_URL } from './serverUrl.js';

class SocketService extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }
  
  connect(token) {
    if (this.socket?.connected) return;
    
    this.socket = io(SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true
    });
    
    this.socket.on('connect', () => {
      console.log('✅ Connected to server');
      this.connected = true;
      this.reconnectAttempts = 0;
      
      // Authenticate
      if (token) {
        this.socket.emit('authenticate', token);
      }
      
      this.emit('connected');
    });
    
    this.socket.on('authenticated', (data) => {
      console.log('Authenticated as:', data.username);
      this.emit('authenticated', data);
    });
    
    this.socket.on('auth_error', (error) => {
      console.error('Auth error:', error);
      this.emit('auth_error', error);
    });
    
    this.socket.on('planetData', (data) => {
      this.emit('planetData', data);
    });
    
    this.socket.on('buildingComplete', (data) => {
      this.emit('buildingComplete', data);
    });
    
    this.socket.on('researchComplete', (data) => {
      this.emit('researchComplete', data);
    });
    
    this.socket.on('shipBuilt', (data) => {
      this.emit('shipBuilt', data);
    });
    
    this.socket.on('fleetSent', (data) => {
      this.emit('fleetSent', data);
    });
    
    this.socket.on('galaxyData', (data) => {
      this.emit('galaxyData', data);
    });
    
    this.socket.on('battleComplete', (data) => {
      this.emit('battleComplete', data);
    });
    
    this.socket.on('battleReports', (data) => {
      this.emit('battleReports', data);
    });
    
    this.socket.on('incomingFleet', (data) => {
      this.emit('incomingFleet', data);
    });
    
    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.emit('error', error);
    });
    
    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
      this.connected = false;
      this.emit('disconnected', reason);
      
      // Attempt reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(token), 2000 * this.reconnectAttempts);
      }
    });
    
    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.emit('connect_error', error);
    });
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }
  
  // Game actions
  getPlanetData() {
    if (!this.connected) return;
    this.socket.emit('getPlanetData');
  }
  
  build(buildingId) {
    if (!this.connected) return;
    this.socket.emit('build', { buildingId });
  }
  
  research(researchId) {
    if (!this.connected) return;
    this.socket.emit('research', { researchId });
  }
  
  buildShip(shipId, count = 1) {
    if (!this.connected) return;
    this.socket.emit('buildShip', { shipId, count });
  }
  
  sendFleet(fleet, target, mission, cargo = {}, speed = 100) {
    if (!this.connected) return;
    this.socket.emit('sendFleet', { fleet, target, mission, cargo, speed });
  }
  
  getGalaxy(galaxy, system) {
    if (!this.connected) return;
    this.socket.emit('getGalaxy', { galaxy, system });
  }
  
  getBattleReports() {
    if (!this.connected) return;
    this.socket.emit('getBattleReports');
  }
}

export const socketService = new SocketService();
