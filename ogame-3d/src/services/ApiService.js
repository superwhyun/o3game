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
    const authToken = this.token;
    const url = `${API_URL}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers
      }
    });
    
    const data = await response.json();
    if (this.token !== authToken) throw Object.assign(new Error('로그인 상태가 변경되었습니다.'), {status:401,code:'AUTH_CHANGED'});
    
    if (!response.ok) {
      throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status, code: data.code });
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
  
  async demolishBuilding(buildingId, planetId) {
    return this.request('/api/queue/demolish', { method: 'POST', body: JSON.stringify({ buildingId, planetId }) });
  }
  async selectPlanet(planetId) {
    return this.request('/api/queue/planet', { method: 'POST', body: JSON.stringify({ planetId }) });
  }

  // Start research
  async startResearch(researchId, planetId = '0') {
    return this.request('/api/queue/research', {
      method: 'POST',
      body: JSON.stringify({ researchId, planetId })
    });
  }
  
  // Build ship (entityType 'defense' queues a defense structure instead)
  async buildShip(shipId, count = 1, planetId = '0', entityType = 'ship') {
    return this.request('/api/queue/ship', {
      method: 'POST',
      body: JSON.stringify({ shipId, count, planetId, entityType })
    });
  }

  // Entity catalog (buildings, research, ships, defense)
  async getCatalog() {
    return this.request('/api/game/catalog');
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

  async launchFleet(order) {
    return this.request('/api/game/fleets', { method: 'POST', body: JSON.stringify(order) });
  }
  async getFleetRequest(requestId) { return this.request(`/api/game/fleet-requests/${requestId}`); }
  async getFleetFormations() { return this.request('/api/game/fleet-formations'); }
  async createFormation(originPlanetId) {
    return this.request('/api/game/fleet-formations', { method:'POST', body:JSON.stringify({originPlanetId}) });
  }
  async saveFormation(id, input) {
    return this.request(`/api/game/fleet-formations/${id}`, { method:'PATCH', body:JSON.stringify(input) });
  }
  async deleteFormation(id, expectedRevision) {
    return this.request(`/api/game/fleet-formations/${id}`, { method:'DELETE', body:JSON.stringify({expectedRevision}) });
  }

  async launchScout(order) { return this.request('/api/game/scouts', {method:'POST',body:JSON.stringify(order)}); }
  async getScoutReports(query={}) { return this.request('/api/game/scout-reports?'+new URLSearchParams(query)); }
  async getScoutAlerts(query={}) { return this.request('/api/game/scout-alerts?'+new URLSearchParams(query)); }
  async getScoutReport(id) { return this.request('/api/game/scout-reports/'+encodeURIComponent(id)); }

  async getBattleReports() {
    return this.request('/api/game/reports');
  }
}

export const apiService = new ApiService();
