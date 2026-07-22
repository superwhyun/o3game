const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('token');
  }
  
  setToken(token) {
    this.token = token;
    localStorage.setItem('token', token);
  }
  
  clearToken() {
    this.token = null;
    localStorage.removeItem('token');
  }
  
  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    return headers;
  }
  
  async request(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    
    return data;
  }
  
  // Auth
  async register(username, email, password) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
    
    if (data.token) {
      this.setToken(data.token);
    }
    
    return data;
  }
  
  async login(username, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    
    if (data.token) {
      this.setToken(data.token);
    }
    if (data.user) {
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    
    return data;
  }
  
  async getCurrentUser() {
    const user = await this.request('/api/auth/me');
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    }
    return user;
  }
  
  async logout() {
    this.clearToken();
  }
  
  // Check if authenticated
  isAuthenticated() {
    return !!this.token;
  }
  
  // Check if any admin exists
  async checkAdmin() {
    return this.request('/api/auth/check-admin');
  }
  
  // Setup first admin
  async setupAdmin(username, email, password) {
    const data = await this.request('/api/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
    
    if (data.token) {
      this.setToken(data.token);
    }
    if (data.user) {
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    
    return data;
  }
  
  // ─── Build Queue API ───────────────────────────────────────────────────────
  
  // Get current build queue
  async getBuildQueue() {
    return this.request('/api/queue');
  }
  
  // Start building construction
  async startBuilding(buildingId, planetId = '0') {
    return this.request('/api/queue/build', {
      method: 'POST',
      body: JSON.stringify({ buildingId, planetId })
    });
  }
  
  // Start research
  async startResearch(researchId) {
    return this.request('/api/queue/research', {
      method: 'POST',
      body: JSON.stringify({ researchId })
    });
  }
  
  // Build ship
  async buildShip(shipId, count = 1, planetId = '0') {
    return this.request('/api/queue/ship', {
      method: 'POST',
      body: JSON.stringify({ shipId, count, planetId })
    });
  }
  
  // Check if build is complete
  async checkBuildComplete(queueId) {
    return this.request(`/api/queue/check/${queueId}`, {
      method: 'POST'
    });
  }
  
  // Cancel queued item
  async cancelBuild(queueId) {
    return this.request(`/api/queue/${queueId}`, {
      method: 'DELETE'
    });
  }

  async getGalaxySystem(galaxy, system) {
    const query = new URLSearchParams({ galaxy: String(galaxy), system: String(system) });
    return this.request(`/api/game/galaxy?${query.toString()}`);
  }

  async getFleetMovements() {
    return this.request('/api/game/fleets');
  }

  async launchFleet({ mission, fleet, cargo, destination, speed = 100 }) {
    return this.request('/api/game/fleets', {
      method: 'POST',
      body: JSON.stringify({ mission, fleet, cargo, destination, speed })
    });
  }

  async getBattleReports() {
    return this.request('/api/game/reports');
  }
}

export const apiService = new ApiService();
