import { apiService } from './ApiService.js';
import { socketService } from './SocketService.js';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

class AdminService {
  constructor() {
    this.token = localStorage.getItem('token');
  }
  
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`
    };
  }
  
  async request(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: this.getHeaders()
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  
  // Check if current user is admin
  isAdmin() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.isAdmin || false;
  }
  
  // Get game config
  async getConfig() {
    return this.request('/api/admin/config');
  }
  
  // Update game config
  async updateConfig(config) {
    return this.request('/api/admin/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
  }
  
  // Set server speed
  async setSpeed(speed) {
    return this.request('/api/admin/speed', {
      method: 'POST',
      body: JSON.stringify({ speed })
    });
  }
  
  // Get server stats
  async getStats() {
    return this.request('/api/admin/stats');
  }
  
  // Get users list
  async getUsers(page = 1, limit = 50, search = '') {
    return this.request(`/api/admin/users?page=${page}&limit=${limit}&search=${search}`);
  }
  
  // Get single user
  async getUser(userId) {
    return this.request(`/api/admin/users/${userId}`);
  }
  
  // Update user
  async updateUser(userId, data) {
    return this.request(`/api/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }
  
  // Delete user
  async deleteUser(userId) {
    return this.request(`/api/admin/users/${userId}`, {
      method: 'DELETE'
    });
  }
  
  // Toggle maintenance mode
  async toggleMaintenance(enabled, message) {
    return this.request('/api/admin/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled, message })
    });
  }
  
  // Send announcement
  async sendAnnouncement(message, type = 'info') {
    return this.request('/api/admin/announcement', {
      method: 'POST',
      body: JSON.stringify({ message, type })
    });
  }
  
  // ── Entity Base Config ──────────────────────────────────────────────────────

  // Get entity configs for a given type ('building' | 'ship' | 'research')
  async getEntityConfig(type) {
    return this.request(`/api/admin/entity-config?type=${type}`);
  }

  // Update a single entity config
  async updateEntityConfig(type, id, data) {
    return this.request(`/api/admin/entity-config/${type}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  // Bulk update entity configs
  async bulkUpdateEntityConfig(updates) {
    return this.request('/api/admin/entity-config/bulk', {
      method: 'POST',
      body: JSON.stringify({ updates })
    });
  }

  // Reset entity configs for a type to hardcoded defaults
  async resetEntityConfig(type) {
    return this.request(`/api/admin/entity-config/reset/${type}`, {
      method: 'POST'
    });
  }

  // Add resources to user
  async addResource(userId, resourceType, amount = 5000, planetIndex = 0) {
    return this.request(`/api/admin/users/${userId}/resources`, {
      method: 'POST',
      body: JSON.stringify({ resourceType, amount, planetIndex })
    });
  }
  
  // Listen for admin events
  onServerSpeedChange(callback) {
    socketService.on('serverSpeedChanged', callback);
  }
  
  onConfigUpdate(callback) {
    socketService.on('gameConfigUpdated', callback);
  }
  
  onMaintenanceMode(callback) {
    socketService.on('maintenanceMode', callback);
  }
}

export const adminService = new AdminService();
