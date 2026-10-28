import { SERVER_URL as API_URL } from './serverUrl.js';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('token');
    this.rateLimitedUntil = 0;
    this.readsInFlight = new Map();
  }
  
  setToken(token) {
    if (this.token !== token) { this.rateLimitedUntil = 0; this.readsInFlight.clear(); }
    this.token = token;
    localStorage.setItem('token', token);
  }
  
  clearToken() {
    this.token = null;
    this.rateLimitedUntil = 0;
    this.readsInFlight.clear();
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
  
  request(endpoint, options = {}) {
    const read = !options.method || options.method === 'GET';
    const key = `${this.token || ''}:${endpoint}`;
    if (read && this.readsInFlight.has(key)) return this.readsInFlight.get(key);
    const request = this.performRequest(endpoint, options);
    if (read) {
      this.readsInFlight.set(key, request);
      const clear = () => { if (this.readsInFlight.get(key) === request) this.readsInFlight.delete(key); };
      request.then(clear, clear);
    }
    return request;
  }

  async performRequest(endpoint, options = {}) {
    const authToken = this.token;
    if (this.rateLimitedUntil > Date.now()) {
      const seconds = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000);
      throw Object.assign(new Error(`요청 제한 해제까지 약 ${seconds}초 남았습니다.`), {status:429,code:'RATE_LIMITED',retryAfter:String(seconds)});
    }
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
      if (response.status === 429) {
        const header = response.headers.get('Retry-After');
        const delay = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header || '') - Date.now();
        this.rateLimitedUntil = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000);
      }
      throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status, code: data.code, requestId: data.requestId, details: data.details, retryAfter: response.headers.get('Retry-After') });
    }
    
    return data;
  }
  
  exchangeResources(planetId, from, to, amount) {
    return this.request('/api/game/trade', { method: 'POST', body: JSON.stringify({ planetId, from, to, amount }) });
  }

  getImprovementRequests(before, status = 'all') {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (status !== 'all') params.set('status', status);
    return this.request('/api/game/improvement-requests' + (params.size ? `?${params}` : ''));
  }

  createImprovementRequest(title, description) {
    return this.request('/api/game/improvement-requests', { method: 'POST', body: JSON.stringify({ title, description }) });
  }

  deleteImprovementRequest(id) {
    return this.request(`/api/game/improvement-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  reviewImprovementRequest(id, decision, reviewNote) {
    return this.request(`/api/game/improvement-requests/${encodeURIComponent(id)}/review`, { method: 'PATCH', body: JSON.stringify({ decision, reviewNote }) });
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

  async renamePlanet(planetId, name) {
    return this.request(`/api/game/planets/${encodeURIComponent(planetId)}/name`, {
      method: 'PATCH', body: JSON.stringify({ name })
    });
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

  async getGalaxyTraffic(galaxy, system, options = {}) {
    const query = new URLSearchParams({ galaxy: String(galaxy), system: String(system), ...options });
    return this.request(`/api/game/galaxy/traffic?${query}`);
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

  recallFleet(id) {
    return this.request(`/api/game/fleets/${encodeURIComponent(id)}/recall`, { method: 'POST' });
  }

  async getBattleReports(before) {
    return this.request('/api/game/reports' + (before ? `?before=${encodeURIComponent(before)}` : ''));
  }

  getBattleReportPage(page = 1, limit = 20) {
    return this.request('/api/game/reports?' + new URLSearchParams({ page, limit }));
  }

  getAccountSettings() { return this.request('/api/account/settings'); }
  getDelegationModels() { return this.request('/api/account/ai-models'); }
  saveUiMode(uiMode) { return this.request('/api/account/settings', { method: 'PATCH', body: JSON.stringify({ uiMode }) }); }
  changeEmail(email, currentPassword) { return this.request('/api/account/email', { method: 'PATCH', body: JSON.stringify({ email, currentPassword }) }); }
  changePassword(currentPassword, newPassword) { return this.request('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); }
  saveDelegation(settings) { return this.request('/api/account/delegation', { method: 'PATCH', body: JSON.stringify(settings) }); }

  abandonPlanet(planetId, confirmationName) {
    return this.request(`/api/game/planets/${encodeURIComponent(planetId)}`, { method: 'DELETE', body: JSON.stringify({ confirmationName }) });
  }

  deleteReports(type, ids) {
    return this.request(type === 'scout' ? '/api/game/scout-reports' : '/api/game/reports', { method: 'DELETE', body: JSON.stringify({ ids }) });
  }

  markScoutReportRead(id) {
    return this.request(`/api/game/scout-reports/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  }

  markBattleReportRead(id) {
    return this.request(`/api/game/reports/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  }
}

export const apiService = new ApiService();
