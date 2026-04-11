import * as THREE from 'three';
import { gameState } from '../core/GameState.js';
import * as GameData from '../data/gameData.js';
import { adminService } from '../services/AdminService.js';
import { apiService } from '../services/ApiService.js';
import { EntityConfigManager } from './EntityConfigManager.js';

export class UIManager {
  constructor(spaceScene) {
    this.spaceScene = spaceScene;
    this.currentView = 'dashboard';
    this.currentCategory = 'resources';
    this.currentShipType = 'civil';
    this.resourceChart = null;
    this.chartData = { labels: [], metal: [], crystal: [], deuterium: [] };
    this.buildingSwiper = null;
    this.researchSwiper = null;
    this.shipyardSwiper = null;
    this.activityLog = [];
    this.queueCountdown = null;  // Local countdown timer
    this.queueItems = {
      building: null,
      research: null,
      ship: null
    }; // Track each queue type separately
    this.lastPendingQueue = []; // Store the most recent pending items
    this.initialized = false; // Prevent duplicate init
    this.init();
  }
  
  async init() {
    if (this.initialized) {
      console.log('[UIManager] Already initialized, skipping...');
      return;
    }
    this.initialized = true;
    
    this.bindElements();
    this.bindEvents();
    this.setupGameStateListeners();
    await this.loadQueueOnce(); // Load once initially
    await this.checkAdminExists();
  }
  
  async checkAdminExists() {
    try {
      const data = await apiService.checkAdmin();
      this.hasAdmin = data.hasAdmin;
      
      if (!this.hasAdmin) {
        // Admin이 없으면 setup 화면 표시
        this.showAdminSetup();
      } else {
        // Admin이 있으면 로그인 화면으로
        await this.checkAuthStatus();
      }
    } catch (err) {
      console.error('Failed to check admin:', err);
      // 에러 시 일단 로그인 화면으로
      await this.checkAuthStatus();
    }
  }
  
  showAdminSetup() {
    if (this.adminSetupScreen) {
      this.adminSetupScreen.classList.remove('hidden');
      if (this.authScreen) this.authScreen.classList.add('hidden');
      if (this.uiLayer) this.uiLayer.classList.add('hidden');
    }
  }
  
  async checkAuthStatus() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const token = localStorage.getItem('token');
    
    if (user && user.username && token) {
      // 로그인 된 상태 - 서버에서 최신 데이터 동기화
      this.showDashboard();
      this.updateUserDisplay(user);
      
      // 서버에서 데이터 동기화 (DB 기준)
      await this.syncUserDataFromServer();
      
      this.initializeDashboard();
      
      // 이미 로그인된 상태에서 새로고침 시 게임 초기화
      if (window.initGame && !window.gameInitialized) {
        window.gameInitialized = true;
        window.initGame();
      }
      
      // 관리자 권한 확인
      if (adminService.isAdmin()) {
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn) adminBtn.classList.remove('hidden');
      }
    } else {
      // 로그인 안 된 상태 - 로그인 화면 표시
      this.showLoginScreen();
    }
  }
  
  initializeDashboard() {
    console.log('[initializeDashboard] Current resources:', gameState.resources);
    this.initResourceChart();
    this.updateResourceDisplay();
    this.updatePlanetInfo();
    this.startClock();
    this.renderDashboard();
    this.renderBuildingSwiper();
    this.renderResearchSwiper();
    this.renderShipyardSwiper();
    console.log('[initializeDashboard] Dashboard initialized with resources:', gameState.resources);
  }
  
  showLoginScreen() {
    if (this.authScreen) this.authScreen.classList.remove('hidden');
    if (this.uiLayer) this.uiLayer.classList.add('hidden');
  }
  
  showDashboard() {
    if (this.authScreen) this.authScreen.classList.add('hidden');
    if (this.uiLayer) this.uiLayer.classList.remove('hidden');
  }
  
  updateUserDisplay(user) {
    if (!this.userSection || !user) return;
    
    this.userSection.innerHTML = `
      <div class="user-info">
        <span class="username">${user.username}</span>
        <button class="holo-btn-small" id="logout-btn">
          <span class="icon">🚪</span>
        </button>
      </div>
    `;
    
    document.getElementById('logout-btn')?.addEventListener('click', () => this.handleLogout());
  }
  
  // Sync user data from server (prevents client-side cheating)
  async syncUserDataFromServer() {
    try {
      // Fetch latest user data from server
      const userData = await apiService.getCurrentUser();
      console.log('[syncUserDataFromServer] Raw userData:', userData);
      console.log('[syncUserDataFromServer] planets:', userData.planets);
      
      // Sync to GameState
      gameState.syncFromServer(userData);
      if (userData.queueState) {
        this.hydrateQueueState(userData.queueState);
      }
      this.refreshSyncedViews();
      
      // If admin panel is open, refresh stats to sync speed, etc.
      if (this.currentView === 'admin') {
        this.loadAdminStatistics();
      }
      
      console.log('[syncUserDataFromServer] Synced. GameState resources:', gameState.resources);
    } catch (err) {
      console.error('Failed to sync user data:', err);
    }
  }

  refreshSyncedViews() {
    this.updateResourceDisplay();
    this.updatePlanetInfo();
    this.renderBuildingSwiper();
    this.renderResearchSwiper();
    this.renderShipyardSwiper();
    this.renderFleet();
  }

  hydrateQueueState(queueState) {
    if (!queueState) return;

    this.queueItems.building = queueState.building;
    this.queueItems.research = queueState.research;
    this.queueItems.ship = queueState.ship;
    this.lastPendingQueue = queueState.queue || [];

    this.updateBuildQueueUI(
      queueState.building,
      queueState.research,
      queueState.ship,
      this.lastPendingQueue
    );

    this.startLocalCountdown();
  }
  
  bindElements() {
    if (this._elementsBound) {
      console.log('[bindElements] Already bound, skipping');
      return;
    }
    this._elementsBound = true;
    console.log('[bindElements] Binding DOM elements');
    
    this.resourceElements = {
      metal: {
        count: document.getElementById('metal-count'),
        rate: document.getElementById('metal-rate'),
        capacity: document.getElementById('metal-capacity'),
        fill: document.getElementById('metal-fill'),
        ring: document.getElementById('metal-ring')
      },
      crystal: {
        count: document.getElementById('crystal-count'),
        rate: document.getElementById('crystal-rate'),
        capacity: document.getElementById('crystal-capacity'),
        fill: document.getElementById('crystal-fill'),
        ring: document.getElementById('crystal-ring')
      },
      deuterium: {
        count: document.getElementById('deuterium-count'),
        rate: document.getElementById('deuterium-rate'),
        capacity: document.getElementById('deuterium-capacity'),
        fill: document.getElementById('deuterium-fill'),
        ring: document.getElementById('deuterium-ring')
      },
      energy: { count: document.getElementById('energy-count'), rate: document.getElementById('energy-rate'), ring: document.getElementById('energy-ring') }
    };
    this.navButtons = document.querySelectorAll('.holo-btn');
    this.panels = {
      dashboard: document.getElementById('dashboard-panel'),
      buildings: document.getElementById('buildings-panel'),
      research: document.getElementById('research-panel'),
      shipyard: document.getElementById('shipyard-panel'),
      galaxy: document.getElementById('galaxy-panel'),
      fleet: document.getElementById('fleet-panel'),
      admin: document.getElementById('admin-panel')
    };
    // Auth elements
    this.authScreen = document.getElementById('auth-screen');
    this.adminSetupScreen = document.getElementById('admin-setup-screen');
    this.uiLayer = document.getElementById('ui-layer');
    this.authForm = document.getElementById('auth-form');
    this.authTitle = document.getElementById('auth-title');
    this.authSubmit = document.getElementById('auth-submit');
    this.registerFields = document.getElementById('register-fields');
    this.authToggleText = document.getElementById('auth-toggle-text');
    this.authToggleBtn = document.getElementById('auth-toggle-btn');
    this.userSection = document.getElementById('user-section');
    this.isLoginMode = true;
    this.hasAdmin = false;
    this.categoryButtons = document.querySelectorAll('.cat-btn[data-category]');
    this.shipTypeButtons = document.querySelectorAll('.cat-btn[data-ship-type]');
    this.modalOverlay = document.getElementById('modal-overlay');
    this.modalClose = document.querySelector('.modal-close');
  }
  
  bindEvents() {
    this.navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.switchView(view);
        this.navButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    this.categoryButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentCategory = btn.dataset.category;
        this.categoryButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderBuildingSwiper();
      });
    });
    this.shipTypeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentShipType = btn.dataset.shipType;
        this.shipTypeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderShipyardSwiper();
      });
    });
    this.modalClose.addEventListener('click', () => this.hideModal());
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) this.hideModal();
    });
    
    // Auth events
    this.authForm?.addEventListener('submit', (e) => this.handleAuthSubmit(e));
    this.authToggleBtn?.addEventListener('click', () => this.toggleAuthMode());
    
    // Admin setup events
    const setupForm = document.getElementById('admin-setup-form');
    setupForm?.addEventListener('submit', (e) => this.handleAdminSetup(e));
  }
  
  setupGameStateListeners() {
    gameState.on('resourceChanged', () => this.updateResourceDisplay());
    gameState.on('productionUpdated', () => { 
      this.updateResourceDisplay(); 
      this.updateDashboardMetrics(); 
    });
    gameState.on('buildingUpgraded', ({ buildingId }) => {
      const building = GameData.BUILDINGS[buildingId];
      this.showNotification('Construction Complete', building?.name + ' upgraded!', 'success');
      this.addActivityLog('Built: ' + building?.name);
      this.renderBuildingSwiper();
      this.updateDashboardMetrics();
      if (this.spaceScene) this.spaceScene.createExplosion(new THREE.Vector3(0, 0, 4), 1.5);
    });
    gameState.on('researchCompleted', ({ researchId }) => {
      const research = GameData.RESEARCH[researchId];
      this.showNotification('Research Complete', research?.name + ' researched!', 'success');
      this.addActivityLog('Researched: ' + research?.name);
      this.renderResearchSwiper();
    });
    
    // Build queue listeners removed - using local countdown instead
    // See loadQueueOnce() and startLocalCountdown() methods
  }
  
  startClock() {
    const updateTime = () => {
      const now = new Date();
      const timeEl = document.getElementById('system-time');
      if (timeEl) timeEl.textContent = now.toLocaleTimeString('ko-KR', { hour12: false });
    };
    updateTime();
    setInterval(updateTime, 1000);
  }
  
  switchView(view) {
    this.currentView = view;
    Object.values(this.panels).forEach(panel => {
      if (panel) panel.classList.add('hidden');
    });
    if (this.panels[view]) {
      this.panels[view].classList.remove('hidden');
    }
    if (view === 'galaxy') this.renderGalaxy();
    if (view === 'fleet') this.renderFleet();
    if (view === 'admin') this.initAdminPanel();
    
    // Refresh queue display to apply view-based filtering immediately
    this.updateBuildQueueUI(
      this.queueItems.building,
      this.queueItems.research,
      this.queueItems.ship,
      this.lastPendingQueue
    );
  }
  
  updateResourceDisplay() {
    const { resources, productionRates, energyProduction, energyConsumption } = gameState;
    
    // Debug: log when resources change significantly
    if (Math.abs(resources.metal - (this._lastMetal || 0)) > 100) {
      console.log('[updateResourceDisplay] Metal changed:', this._lastMetal, '->', resources.metal);
      console.log('[updateResourceDisplay] gameState === window.gameState:', gameState === window.gameState);
      console.log('[updateResourceDisplay] gameState.resources:', gameState.resources);
      this._lastMetal = resources.metal;
    }
    
    // 소수점 첫째 자리에서 반올림하는 헬퍼 함수
    const round1 = (num) => Math.round(num * 10) / 10;
    const formatFillLine = (current, capacity) => {
      if (!capacity) return '0.0%';
      return `${Math.min((current / capacity) * 100, 100).toFixed(1)}%`;
    };
    
    if (this.resourceElements.metal.count) {
      this.resourceElements.metal.count.textContent = GameData.formatNumber(round1(resources.metal));
      this.resourceElements.metal.rate.textContent = '+' + GameData.formatNumber(round1(productionRates.metal)) + '/h';
      const metalPct = Math.min((resources.metal / gameState.storage.metal) * 100, 100);
      this.resourceElements.metal.ring.style.strokeDashoffset = 283 - (283 * metalPct / 100);
      if (this.resourceElements.metal.fill) {
        this.resourceElements.metal.fill.textContent = formatFillLine(resources.metal, gameState.storage.metal);
      }
    }
    
    if (this.resourceElements.crystal.count) {
      this.resourceElements.crystal.count.textContent = GameData.formatNumber(round1(resources.crystal));
      this.resourceElements.crystal.rate.textContent = '+' + GameData.formatNumber(round1(productionRates.crystal)) + '/h';
      const crystalPct = Math.min((resources.crystal / gameState.storage.crystal) * 100, 100);
      this.resourceElements.crystal.ring.style.strokeDashoffset = 283 - (283 * crystalPct / 100);
      if (this.resourceElements.crystal.fill) {
        this.resourceElements.crystal.fill.textContent = formatFillLine(resources.crystal, gameState.storage.crystal);
      }
    }
    
    if (this.resourceElements.deuterium.count) {
      this.resourceElements.deuterium.count.textContent = GameData.formatNumber(round1(resources.deuterium));
      this.resourceElements.deuterium.rate.textContent = (productionRates.deuterium >= 0 ? '+' : '') + GameData.formatNumber(round1(productionRates.deuterium)) + '/h';
      const deutPct = Math.min((resources.deuterium / gameState.storage.deuterium) * 100, 100);
      this.resourceElements.deuterium.ring.style.strokeDashoffset = 283 - (283 * deutPct / 100);
      if (this.resourceElements.deuterium.fill) {
        this.resourceElements.deuterium.fill.textContent = formatFillLine(resources.deuterium, gameState.storage.deuterium);
      }
    }
    
    if (this.resourceElements.energy.count) {
      const energyDiff = round1(energyProduction - energyConsumption);
      this.resourceElements.energy.count.textContent = (energyDiff >= 0 ? '+' : '') + GameData.formatNumber(energyDiff);
      this.resourceElements.energy.rate.textContent = GameData.formatNumber(round1(energyProduction)) + '/' + GameData.formatNumber(round1(energyConsumption));
      this.resourceElements.energy.count.style.color = energyDiff >= 0 ? '#22c55e' : '#ef4444';
    }
  }
  
  async initResourceChart() {
    const ctx = document.getElementById('resource-chart');
    if (!ctx) return;
    
    try {
      const Chart = (await import('chart.js/auto')).default;
      
      for (let i = 0; i < 20; i++) {
        this.chartData.labels.push('');
        this.chartData.metal.push(gameState.resources.metal);
        this.chartData.crystal.push(gameState.resources.crystal);
        this.chartData.deuterium.push(gameState.resources.deuterium);
      }
      
      this.resourceChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: this.chartData.labels,
          datasets: [
            { label: 'Metal', data: this.chartData.metal, borderColor: '#9ca3af', backgroundColor: 'rgba(156,163,175,0.1)', tension: 0.4, pointRadius: 0 },
            { label: 'Crystal', data: this.chartData.crystal, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)', tension: 0.4, pointRadius: 0 },
            { label: 'Deuterium', data: this.chartData.deuterium, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)', tension: 0.4, pointRadius: 0 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#fff', font: { family: 'Orbitron' } } } },
          scales: {
            x: { display: false },
            y: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: 'rgba(255,255,255,0.6)', font: { family: 'Rajdhani' } } }
          },
          animation: { duration: 0 }
        }
      });
      
      setInterval(() => this.updateChart(), 2000);
    } catch (e) {
      console.log('Chart.js not available');
    }
  }
  
  updateChart() {
    if (!this.resourceChart) return;
    this.chartData.metal.shift();
    this.chartData.metal.push(gameState.resources.metal);
    this.chartData.crystal.shift();
    this.chartData.crystal.push(gameState.resources.crystal);
    this.chartData.deuterium.shift();
    this.chartData.deuterium.push(gameState.resources.deuterium);
    this.resourceChart.update('none');
  }
  
  updateDashboardMetrics() {
    const elMetal = document.getElementById('dash-metal-rate');
    const elCrystal = document.getElementById('dash-crystal-rate');
    const elDeut = document.getElementById('dash-deut-rate');
    const elEnergy = document.getElementById('dash-energy-rate');
    
    // 소수점 첫째 자리에서 반올림하는 헬퍼 함수
    const round1 = (num) => Math.round(num * 10) / 10;
    
    if (elMetal) elMetal.textContent = '+' + GameData.formatNumber(round1(gameState.productionRates.metal));
    if (elCrystal) elCrystal.textContent = '+' + GameData.formatNumber(round1(gameState.productionRates.crystal));
    if (elDeut) elDeut.textContent = (gameState.productionRates.deuterium >= 0 ? '+' : '') + GameData.formatNumber(round1(gameState.productionRates.deuterium));
    if (elEnergy) elEnergy.textContent = round1(gameState.energyProduction - gameState.energyConsumption);
    
    const barMetal = document.getElementById('dash-metal-bar');
    const barCrystal = document.getElementById('dash-crystal-bar');
    const barDeut = document.getElementById('dash-deut-bar');
    const barEnergy = document.getElementById('dash-energy-bar');
    
    if (barMetal) barMetal.style.width = Math.min((gameState.productionRates.metal / 1000) * 100, 100) + '%';
    if (barCrystal) barCrystal.style.width = Math.min((gameState.productionRates.crystal / 500) * 100, 100) + '%';
    if (barDeut) barDeut.style.width = Math.min((Math.abs(gameState.productionRates.deuterium) / 200) * 100, 100) + '%';
    if (barEnergy) barEnergy.style.width = Math.min((gameState.energyProduction / 1000) * 100, 100) + '%';
  }
  
  renderDashboard() {
    this.updateDashboardMetrics();
    this.renderFleetVisual();
    this.renderActivityLog();
  }
  
  renderBuildingSwiper() {
    const container = document.getElementById('building-slides');
    if (!container) return;
    
    container.innerHTML = '';
    const buildings = Object.values(GameData.BUILDINGS).filter(b => b.category === this.currentCategory);
    
    buildings.forEach(building => {
      const level = gameState.getBuildingLevel(building.id);
      const cost = GameData.calculateBuildingCost(building.id, level + 1);
      const canAfford = gameState.hasResources(cost);
      const hasTech = gameState.hasTechRequirements(building.requirements);
      
      const slide = document.createElement('div');
      slide.className = 'swiper-slide';
      
      let costHtml = '';
      for (const [res, amount] of Object.entries(cost)) {
        const hasEnough = gameState.resources[res] >= amount;
        costHtml += '<span class="cost-tag ' + (hasEnough ? '' : 'insufficient') + '">';
        costHtml += (GameData.RESOURCES[res]?.icon || '') + ' ' + GameData.formatNumber(amount);
        costHtml += '</span>';
      }
      
      // Calculate build time
      const baseTime = building.buildTime || 60;
      const robotBonus = gameState.buildings.robotFactory > 0 ? Math.pow(0.9, gameState.buildings.robotFactory) : 1;
      const naniteBonus = gameState.buildings.naniteFactory > 0 ? Math.pow(0.5, gameState.buildings.naniteFactory) : 1;
      const buildTime = Math.floor(baseTime * Math.pow(1.5, level) * robotBonus * naniteBonus);
      
      slide.innerHTML = '<div class="holo-slide-card ' + (!canAfford || !hasTech ? 'disabled' : '') + '">' +
        '<div class="slide-icon">' + building.icon + '</div>' +
        '<h3 class="slide-title">' + building.name + '</h3>' +
        '<div class="slide-level">LEVEL ' + level + '</div>' +
        '<p class="slide-desc">' + building.description + '</p>' +
        '<div class="build-time">' + this.formatBuildTime(buildTime) + '</div>' +
        '<div class="slide-costs">' + costHtml + '</div>' +
        '<button class="holo-action-btn" data-building="' + building.id + '" ' + (!canAfford || !hasTech ? 'disabled' : '') + '>' +
        (!hasTech ? 'LOCKED' : !canAfford ? 'NO RESOURCES' : 'CONSTRUCT') +
        '</button></div>';
      
      const btn = slide.querySelector('.holo-action-btn');
      if (canAfford && hasTech) {
        btn.addEventListener('click', () => this.startConstruction(building.id));
      }
      
      container.appendChild(slide);
    });
    
    if (this.buildingSwiper) this.buildingSwiper.destroy();
    this.buildingSwiper = new Swiper('.building-swiper', {
      slidesPerView: 'auto',
      spaceBetween: 20,
      grabCursor: true,
      pagination: { el: '.swiper-pagination', clickable: true },
      navigation: { prevEl: '.swiper-button-prev', nextEl: '.swiper-button-next' }
    });
  }
  
  renderResearchSwiper() {
    const container = document.getElementById('research-slides');
    if (!container) return;
    
    container.innerHTML = '';
    const researches = Object.values(GameData.RESEARCH);
    
    researches.forEach(research => {
      const level = gameState.getResearchLevel(research.id);
      const cost = GameData.calculateResearchCost(research.id, level);
      const canAfford = gameState.hasResources(cost);
      const hasTech = gameState.hasTechRequirements(research.requirements);
      const hasLab = gameState.buildings.researchLab > 0;
      
      const slide = document.createElement('div');
      slide.className = 'swiper-slide';
      
      let costHtml = '';
      for (const [res, amount] of Object.entries(cost)) {
        const hasEnough = gameState.resources[res] >= amount;
        costHtml += '<span class="cost-tag ' + (hasEnough ? '' : 'insufficient') + '">';
        costHtml += (GameData.RESOURCES[res]?.icon || '⚡') + ' ' + GameData.formatNumber(amount);
        costHtml += '</span>';
      }
      
      // Calculate research time
      const baseTime = research.researchTime || 60;
      const labLevel = gameState.buildings.researchLab || 1;
      const researchTime = Math.floor(baseTime * Math.pow(1.5, level) / (1 + labLevel * 0.1));
      
      slide.innerHTML = '<div class="holo-slide-card ' + (!canAfford || !hasTech || !hasLab ? 'disabled' : '') + '">' +
        '<div class="slide-icon">' + research.icon + '</div>' +
        '<h3 class="slide-title">' + research.name + '</h3>' +
        '<div class="slide-level">LEVEL ' + level + '</div>' +
        '<p class="slide-desc">' + research.description + '</p>' +
        '<div class="build-time">' + this.formatBuildTime(researchTime) + '</div>' +
        '<div class="slide-costs">' + costHtml + '</div>' +
        '<button class="holo-action-btn" data-research="' + research.id + '" ' + (!canAfford || !hasTech || !hasLab ? 'disabled' : '') + '>' +
        (!hasLab ? 'NO LAB' : !hasTech ? 'LOCKED' : !canAfford ? 'NO RESOURCES' : 'RESEARCH') +
        '</button></div>';
      
      const btn = slide.querySelector('.holo-action-btn');
      if (canAfford && hasTech && hasLab) {
        btn.addEventListener('click', () => this.startResearch(research.id));
      }
      
      container.appendChild(slide);
    });
    
    if (this.researchSwiper) this.researchSwiper.destroy();
    this.researchSwiper = new Swiper('.research-swiper', {
      slidesPerView: 'auto',
      spaceBetween: 20,
      grabCursor: true,
      pagination: { el: '.swiper-pagination', clickable: true },
      navigation: { prevEl: '.swiper-button-prev', nextEl: '.swiper-button-next' }
    });
  }
  
  renderShipyardSwiper() {
    const container = document.getElementById('shipyard-slides');
    if (!container) return;
    
    container.innerHTML = '';
    const ships = Object.values(GameData.SHIPS).filter(s => s.type === this.currentShipType);
    const hasShipyard = gameState.buildings.shipyard > 0;
    
    ships.forEach(ship => {
      const owned = gameState.fleet[ship.id] || 0;
      const cost = ship.cost;
      const canAfford = gameState.hasResources(cost);
      const hasTech = gameState.hasTechRequirements(ship.techRequirements);
      
      const slide = document.createElement('div');
      slide.className = 'swiper-slide';
      
      let costHtml = '';
      for (const [res, amount] of Object.entries(cost)) {
        const hasEnough = gameState.resources[res] >= amount;
        costHtml += '<span class="cost-tag ' + (hasEnough ? '' : 'insufficient') + '">';
        costHtml += (GameData.RESOURCES[res]?.icon || '') + ' ' + GameData.formatNumber(amount);
        costHtml += '</span>';
      }
      
      // Calculate build time
      const shipyardLevel = gameState.buildings.shipyard || 1;
      const naniteBonus = gameState.buildings.naniteFactory > 0 ? Math.pow(0.5, gameState.buildings.naniteFactory) : 1;
      const buildTime = Math.floor((ship.buildTime || 60) / (1 + shipyardLevel * 0.1) * naniteBonus);
      
      slide.innerHTML = '<div class="holo-slide-card ' + (!canAfford || !hasTech || !hasShipyard ? 'disabled' : '') + '">' +
        '<div class="slide-icon">' + ship.icon + '</div>' +
        '<h3 class="slide-title">' + ship.name + '</h3>' +
        '<div class="slide-level">OWNED: ' + owned + '</div>' +
        '<p class="slide-desc">' + ship.description + '</p>' +
        '<div style="display:flex;gap:10px;margin:10px 0;font-size:0.75rem;color:rgba(255,255,255,0.6);">' +
        '<span>ATK:' + ship.stats.attack + '</span>' +
        '<span>DEF:' + ship.stats.shield + '</span>' +
        '<span>HP:' + GameData.formatNumber(ship.stats.hull) + '</span>' +
        '</div>' +
        '<div class="build-time">' + this.formatBuildTime(buildTime) + '</div>' +
        '<div class="slide-costs">' + costHtml + '</div>' +
        '<button class="holo-action-btn" data-ship="' + ship.id + '" ' + (!canAfford || !hasTech || !hasShipyard ? 'disabled' : '') + '>' +
        (!hasShipyard ? 'NO SHIPYARD' : !hasTech ? 'LOCKED' : !canAfford ? 'NO RESOURCES' : 'BUILD') +
        '</button></div>';
      
      const btn = slide.querySelector('.holo-action-btn');
      if (canAfford && hasTech && hasShipyard) {
        btn.addEventListener('click', () => this.buildShip(ship.id));
      }
      
      container.appendChild(slide);
    });
    
    if (this.shipyardSwiper) this.shipyardSwiper.destroy();
    this.shipyardSwiper = new Swiper('.shipyard-swiper', {
      slidesPerView: 'auto',
      spaceBetween: 20,
      grabCursor: true,
      pagination: { el: '.swiper-pagination', clickable: true },
      navigation: { prevEl: '.swiper-button-prev', nextEl: '.swiper-button-next' }
    });
  }
  
  async startConstruction(buildingId) {
    try {
      const result = await apiService.startBuilding(buildingId);
      if (result.snapshot) {
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
      }
      this.showNotification('Construction Queued', `${result.queueItem.name} Level ${result.queueItem.level}`, 'success');
      if (this.spaceScene) this.spaceScene.createLaser(new THREE.Vector3(5, 5, 5), new THREE.Vector3(0, 0, 3), 0x00f5ff);
      this.renderBuildingSwiper();
    } catch (err) {
      this.showNotification('Error', err.message, 'error');
    }
  }
  
  async startResearch(researchId) {
    try {
      const result = await apiService.startResearch(researchId);
      if (result.snapshot) {
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
      }
      this.showNotification('Research Queued', `${result.queueItem.name} Level ${result.queueItem.level}`, 'success');
      if (this.spaceScene) this.spaceScene.createLaser(new THREE.Vector3(-5, 5, 5), new THREE.Vector3(0, 0, 3), 0xa855f7);
      this.renderResearchSwiper();
    } catch (err) {
      this.showNotification('Error', err.message, 'error');
    }
  }
  
  async buildShip(shipId) {
    try {
      const result = await apiService.buildShip(shipId);
      if (result.snapshot) {
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
      }
      this.showNotification('Ship Queued', `${result.queueItem.name}`, 'success');
      this.renderShipyardSwiper();
    } catch (err) {
      this.showNotification('Error', err.message, 'error');
    }
  }
  
  formatBuildTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
  
  renderGalaxy() {
    const container = document.getElementById('galaxy-holo');
    if (!container) return;
    
    container.innerHTML = '';
    for (let i = 1; i <= 15; i++) {
      const slot = document.createElement('div');
      slot.className = 'galaxy-slot';
      if (i === gameState.planet.planet) slot.classList.add('own');
      
      slot.innerHTML = '<span class="slot-number">' + i + '</span>';
      slot.addEventListener('click', () => {
        this.showNotification('Galaxy Scan', 'Position [1:1:' + i + '] selected', 'success');
      });
      
      container.appendChild(slot);
    }
  }
  
  renderFleet() {
    const container = document.getElementById('fleet-grid');
    if (!container) return;
    
    container.innerHTML = '';
    const ships = Object.entries(gameState.fleet).filter(([_, count]) => count > 0);
    
    if (ships.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.5);padding:40px;">No ships in fleet</div>';
      return;
    }
    
    ships.forEach(([shipId, count]) => {
      const ship = GameData.SHIPS[shipId];
      const card = document.createElement('div');
      card.className = 'holo-card';
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.gap = '15px';
      card.innerHTML = '<div style="font-size:2rem;">' + (ship?.icon || '🚀') + '</div>' +
        '<div><h4 style="color:#fff;margin-bottom:4px;">' + (ship?.name || shipId) + '</h4>' +
        '<span style="color:var(--holo-cyan);font-family:Orbitron;font-size:1.2rem;">' + count + ' UNITS</span></div>';
      container.appendChild(card);
    });
  }
  
  renderFleetVisual() {
    const totalEl = document.getElementById('total-ships');
    const breakdownEl = document.getElementById('fleet-breakdown');
    if (!totalEl || !breakdownEl) return;
    
    const total = Object.values(gameState.fleet).reduce((a, b) => a + b, 0);
    totalEl.textContent = total;
    
    const military = Object.entries(gameState.fleet)
      .filter(([id, count]) => count > 0 && GameData.SHIPS[id]?.type === 'military')
      .length;
    const civil = Object.entries(gameState.fleet)
      .filter(([id, count]) => count > 0 && GameData.SHIPS[id]?.type === 'civil')
      .length;
    
    breakdownEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '<div style="display:flex;justify-content:space-between;"><span style="color:rgba(255,255,255,0.5);font-size:0.75rem;">MILITARY</span><span style="color:var(--holo-cyan);">' + military + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;"><span style="color:rgba(255,255,255,0.5);font-size:0.75rem;">CIVIL</span><span style="color:var(--holo-green);">' + civil + '</span></div>' +
      '</div>';
  }
  
  updatePlanetInfo() {
    const nameEl = document.getElementById('planet-name');
    const sizeEl = document.getElementById('planet-size');
    const tempEl = document.getElementById('planet-temp');
    const posEl = document.getElementById('planet-pos');
    const coordsEl = document.getElementById('coords-display');
    
    if (nameEl) nameEl.textContent = gameState.planet.name;
    if (sizeEl) sizeEl.textContent = gameState.planet.diameter.toLocaleString() + 'km';
    if (tempEl) tempEl.textContent = gameState.planet.minTemp + '°C ~ ' + gameState.planet.maxTemp + '°C';
    if (posEl) posEl.textContent = gameState.planet.position;
    if (coordsEl) coordsEl.textContent = '[' + gameState.planet.galaxy + ':' + gameState.planet.system + ':' + gameState.planet.planet + ']';
  }
  
  addActivityLog(message) {
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.activityLog.unshift({ timestamp, message });
    if (this.activityLog.length > 20) this.activityLog.pop();
    this.renderActivityLog();
  }
  
  renderActivityLog() {
    const container = document.getElementById('activity-log');
    if (!container) return;
    
    container.innerHTML = this.activityLog.map(log => 
      '<div class="log-entry"><span class="timestamp">[' + log.timestamp + ']</span><span class="message">' + log.message + '</span></div>'
    ).join('');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN PANEL - Tab-based Management
  // ═══════════════════════════════════════════════════════════════════════════
  
  initAdminPanel() {
    // Initialize admin tabs
    this.setupAdminTabs();
    
    // Setup all admin event handlers
    this.setupAdminEvents();
    
    // Initialize entity config manager (once)
    if (!this.entityConfigManager) {
      this.entityConfigManager = new EntityConfigManager();
      this.entityConfigManager.init();
    }
    
    // Load initial data for active tab
    const activeTab = document.querySelector('.admin-tab.active')?.dataset.tab || 'dashboard';
    this.loadAdminTabData(activeTab);
  }
  
  setupAdminTabs() {
    const tabs = document.querySelectorAll('.admin-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show corresponding content
        const tabId = tab.dataset.tab;
        document.querySelectorAll('.admin-tab-content').forEach(content => {
          content.classList.remove('active');
        });
        document.getElementById(`tab-${tabId}`)?.classList.add('active');
        
        // Load tab data
        this.loadAdminTabData(tabId);
      });
    });
  }
  
  loadAdminTabData(tabId) {
    switch(tabId) {
      case 'dashboard':
        this.loadAdminStatistics();
        break;
      case 'users':
        this.loadUsers();
        break;
      case 'settings':
        // Settings are static, just ensure values are current
        break;
      case 'entity':
        // Entity config loads itself
        break;
    }
  }
  
  setupAdminEvents() {
    // Search users
    document.getElementById('search-users')?.addEventListener('click', () => this.loadUsers());
    document.getElementById('user-search')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadUsers();
    });
    
    // Page size change
    document.getElementById('users-page-size')?.addEventListener('change', () => this.loadUsers(1));
    
    // Filter changes
    document.getElementById('users-filter-status')?.addEventListener('change', () => this.loadUsers(1));
    document.getElementById('users-sort')?.addEventListener('change', () => this.loadUsers(1));
    
    // Server speed control
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const speed = parseFloat(btn.dataset.speed);
        try {
          await adminService.setSpeed(speed);
          document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById('current-speed').textContent = speed + 'x';
          this.showNotification('Success', `Server speed set to ${speed}x`, 'success');
        } catch (err) {
          this.showNotification('Error', err.message, 'error');
        }
      });
    });
    
    // Refresh stats
    document.getElementById('refresh-stats')?.addEventListener('click', () => this.loadAdminStatistics());
    
    // Send announcement
    document.getElementById('send-announcement')?.addEventListener('click', async () => {
      const message = document.getElementById('announce-message').value;
      const type = document.getElementById('announce-type').value;
      if (!message) return;
      
      try {
        await adminService.sendAnnouncement(message, type);
        this.showNotification('Success', 'Announcement sent to all users', 'success');
        document.getElementById('announce-message').value = '';
      } catch (err) {
        this.showNotification('Error', err.message, 'error');
      }
    });
    
    // Load initial stats
    this.loadAdminStatistics();
  }
  
  async loadUsers(page = 1) {
    const search = document.getElementById('user-search')?.value || '';
    const pageSize = parseInt(document.getElementById('users-page-size')?.value || '50');
    const tbody = document.getElementById('users-tbody');
    const showingEl = document.getElementById('users-showing');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;"><span class="loading-spinner">↻</span> Loading users...</td></tr>';
    
    try {
      const data = await adminService.getUsers(page, pageSize, search);
      
      // Update user count badge
      const badge = document.getElementById('user-count-badge');
      if (badge && data.pagination) {
        badge.textContent = data.pagination.totalUsers || 0;
        badge.style.display = data.pagination.totalUsers > 0 ? 'inline-flex' : 'none';
      }
      
      // Update showing text
      if (showingEl && data.pagination) {
        const start = (page - 1) * pageSize + 1;
        const end = Math.min(page * pageSize, data.pagination.totalUsers);
        showingEl.textContent = `Showing ${start}-${end} of ${data.pagination.totalUsers} users`;
      }
      
      if (data.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--holo-cyan);">No users found</td></tr>';
        return;
      }
      
      tbody.innerHTML = data.users.map(user => {
        const planet = user.planets?.[0];
        const resources = planet?.resources || {};
        
        return `
        <tr data-user-id="${user._id}">
          <td class="col-username">
            <div class="user-name">${user.username}</div>
            <div class="user-email" style="font-size:0.75rem;color:rgba(0,245,255,0.5);">${user.email || ''}</div>
          </td>
          <td class="col-status">
            <span class="user-status ${user.isOnline ? 'online' : 'offline'}">${user.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </td>
          <td class="col-planets">${user.planets?.length || 1}</td>
          <td class="col-resources">
            <div class="user-resources">
              <span class="res-m" title="Metal">⚙️ ${this.formatNumber(resources.metal || 0)}</span>
              <span class="res-c" title="Crystal">💎 ${this.formatNumber(resources.crystal || 0)}</span>
              <span class="res-d" title="Deuterium">💧 ${this.formatNumber(resources.deuterium || 0)}</span>
            </div>
          </td>
          <td class="col-lastlogin">${user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}</td>
          <td class="col-actions">
            <div class="user-actions">
              <button onclick="window.editUser('${user._id}')">Edit</button>
              <button onclick="window.viewUser('${user._id}')">View</button>
              <button class="res-btn metal" onclick="window.addResource('${user._id}', 'metal')" title="+5000 Metal">+M</button>
              <button class="res-btn crystal" onclick="window.addResource('${user._id}', 'crystal')" title="+5000 Crystal">+C</button>
              <button class="res-btn deuterium" onclick="window.addResource('${user._id}', 'deuterium')" title="+5000 Deuterium">+D</button>
              <button class="delete" onclick="window.deleteUser('${user._id}')">Delete</button>
            </div>
          </td>
        </tr>
      `}).join('');
      
      // Setup pagination
      this.renderPagination(data.pagination, page);
      
      // Setup user actions
      window.editUser = (id) => this.editUser(id);
      window.viewUser = (id) => this.viewUserDetails(id);
      window.deleteUser = (id) => this.deleteUser(id);
      window.addResource = (userId, resourceType) => this.addResourceToUser(userId, resourceType);
      
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--holo-red);">Error loading users: ${err.message}</td></tr>`;
    }
  }
  
  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
  
  viewUserDetails(userId) {
    // TODO: Open user detail modal
    this.showNotification('Info', 'View user: ' + userId, 'info');
  }
  
  renderPagination(pagination, currentPage) {
    const container = document.getElementById('user-pagination');
    if (!container || !pagination) return;
    
    let html = '';
    for (let i = 1; i <= pagination.totalPages; i++) {
      html += `<button class="${i === currentPage ? 'active' : ''}" onclick="window.loadUsersPage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
    
    window.loadUsersPage = (page) => this.loadUsers(page);
  }
  
  async loadAdminStatistics() {
    try {
      const stats = await adminService.getStats();
      
      // Update statistics
      if (document.getElementById('stat-total-users')) 
        document.getElementById('stat-total-users').textContent = stats.users?.total || '-';
      if (document.getElementById('stat-online-users'))
        document.getElementById('stat-online-users').textContent = stats.users?.online || '-';
      if (document.getElementById('stat-active-fleets'))
        document.getElementById('stat-active-fleets').textContent = stats.fleets?.active || '-';
      if (document.getElementById('stat-battles-today'))
        document.getElementById('stat-battles-today').textContent = stats.battles?.today || '-';
        
      // Update speed display
      const speed = stats.serverSpeed || gameState.serverSpeed || 1;
      const currentSpeedEl = document.getElementById('current-speed');
      if (currentSpeedEl) {
        currentSpeedEl.textContent = speed + 'x';
      }
      
      // Update button active state
      document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
      });

      // Update local gameState speed if they differ
      if (gameState.serverSpeed !== speed) {
        gameState.serverSpeed = speed;
      }
      
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }
  
  async editUser(userId) {
    // TODO: Open user edit modal
    this.showNotification('Info', 'Edit user: ' + userId, 'info');
  }
  
  async deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      await adminService.deleteUser(userId);
      this.showNotification('Success', 'User deleted', 'success');
      this.loadUsers();
    } catch (err) {
      this.showNotification('Error', err.message, 'error');
    }
  }
  
  async addResourceToUser(userId, resourceType) {
    try {
      const result = await adminService.addResource(userId, resourceType, 5000);
      this.showNotification('Success', `Added 5000 ${resourceType} to user`, 'success');
      
      // Update the user's resource display in the table immediately
      if (result && result.resources) {
        this.updateUserResourceDisplay(userId, result.resources);
      }
    } catch (err) {
      this.showNotification('Error', err.message, 'error');
    }
  }
  
  // Update resource display for a specific user in the table
  updateUserResourceDisplay(userId, resources) {
    const row = document.querySelector(`tr[data-user-id="${userId}"]`);
    if (!row) return;
    
    const resCell = row.querySelector('.col-resources .user-resources');
    if (resCell) {
      resCell.innerHTML = `
        <span class="res-m" title="Metal">⚙️ ${this.formatNumber(resources.metal || 0)}</span>
        <span class="res-c" title="Crystal">💎 ${this.formatNumber(resources.crystal || 0)}</span>
        <span class="res-d" title="Deuterium">💧 ${this.formatNumber(resources.deuterium || 0)}</span>
      `;
    }
  }
  
  // Build Queue UI Methods
  // Now supports separate queues: building, research, ship (all can run simultaneously)
  updateBuildQueueUI(building, research, ship, pendingQueue) {
    // Main queue (bottom right)
    const queueContainer = document.getElementById('build-queue');
    const queueList = document.getElementById('queue-list');
    const queueCount = document.getElementById('queue-count');
    
    // Sidebar queue
    const queueSidebar = document.getElementById('queue-holo-sidebar');
    const queueSidebarEmpty = document.getElementById('queue-sidebar-empty');
    const queueSidebarList = document.getElementById('queue-list-sidebar');
    
    // Count all active + pending items
    const activeCount = [building, research, ship].filter(Boolean).length;
    const total = activeCount + (pendingQueue?.length || 0);
    
    if (total === 0) {
      if (queueContainer) queueContainer.classList.add('hidden');
      if (queueSidebarEmpty) queueSidebarEmpty.style.display = 'block';
      if (queueSidebarList) queueSidebarList.style.display = 'none';
      if (queueCount) queueCount.textContent = 0;
      return;
    }
    
    if (queueContainer) queueContainer.classList.remove('hidden');
    if (queueCount) queueCount.textContent = total;
    
    // Build HTML for all active queues
    let html = '';
    let sidebarHtml = '';
    
    // Helper to render a queue item
    const renderQueueItem = (item, isPending = false) => {
      if (!item) return '';
      
      let remaining = 0;
      let percent = 0;
      let timeText = '';
      
      if (isPending || item.status === 'pending') {
        timeText = `Waiting... (${this.formatBuildTime(item.duration)})`;
        percent = 0;
      } else {
        remaining = Math.max(0, Math.ceil((new Date(item.endTime) - Date.now()) / 1000));
        if (item.duration > 0 && item.startTime) {
          const totalSeconds = (new Date(item.endTime) - new Date(item.startTime)) / 1000;
          const elapsed = (Date.now() - new Date(item.startTime)) / 1000;
          percent = Math.min(100, Math.max(0, Math.floor((elapsed / totalSeconds) * 100)));
        }
        timeText = this.formatBuildTime(remaining);
      }
      
      return `
        <div class="queue-item ${item.type} ${isPending ? 'pending' : ''}" data-queue-type="${item.type}" data-queue-id="${item.id || item._id}">
          <div class="queue-icon">${item.icon}</div>
          <div class="queue-info">
            <div class="queue-name">${item.name} ${item.level > 1 ? 'L' + item.level : ''}</div>
            <div class="queue-time" data-type="${item.type}-time">${timeText}</div>
          </div>
          <div class="queue-progress">
            <div class="queue-progress-bar" data-type="${item.type}-progress" style="width: ${percent}%"></div>
          </div>
          <button class="btn-cancel" onclick="uiManager.handleCancelClick('${item.id || item._id}', '${item.name}', ${!isPending})" title="Cancel">×</button>
        </div>
      `;
    };
    
    // Determine filtering based on current panel
    // building panel -> only building items
    // research panel -> only research items
    // shipyard panel -> only ship items
    // dashboard or others -> all items
    let filterType = null;
    if (this.currentView === 'buildings') filterType = 'building';
    else if (this.currentView === 'research') filterType = 'research';
    else if (this.currentView === 'shipyard') filterType = 'ship';
    
    // Update Sidebars (Global view with conditional filtering)
    let globalHtml = '';
    
    // Add active items if they match filter
    if (!filterType || filterType === 'building') globalHtml += renderQueueItem(building);
    if (!filterType || filterType === 'research') globalHtml += renderQueueItem(research);
    if (!filterType || filterType === 'ship') globalHtml += renderQueueItem(ship);
    
    // Add pending items if they match filter
    pendingQueue?.forEach(item => {
      if (!filterType || item.type === filterType) {
        globalHtml += renderQueueItem(item, true);
      }
    });
    
    if (queueList) queueList.innerHTML = globalHtml;
    if (queueSidebarList) queueSidebarList.innerHTML = globalHtml;
    if (queueSidebarEmpty) queueSidebarEmpty.style.display = globalHtml ? 'none' : 'block';
    if (queueSidebarList) queueSidebarList.style.display = globalHtml ? 'block' : 'none';

    // Update Per-Panel Queues (Filtered view)
    const renderPanelQueue = (type, containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      
      const activeItem = type === 'building' ? building : (type === 'research' ? research : ship);
      const pendingItems = pendingQueue?.filter(item => item.type === type) || [];
      
      let panelHtml = '';
      if (activeItem) panelHtml += renderQueueItem(activeItem);
      pendingItems.forEach(item => {
        panelHtml += renderQueueItem(item, true);
      });
      
      container.innerHTML = panelHtml;
      
      // Show/Hide the whole section based on content
      const section = container.closest('.panel-queue-section');
      if (section) {
        section.style.display = panelHtml ? 'block' : 'none';
      }
    };

    renderPanelQueue('building', 'buildings-panel-queue');
    renderPanelQueue('research', 'research-panel-queue');
    renderPanelQueue('ship', 'shipyard-panel-queue');
  }
  
  // Local Countdown Methods (replaces polling)
  startLocalCountdown() {
    if (this.queueCountdown) {
      clearInterval(this.queueCountdown);
    }
    
    this.queueCountdown = setInterval(() => {
      this.updateLocalQueueDisplay();
    }, 1000);
  }
  
  updateLocalQueueDisplay() {
    const now = Date.now();
    
    // Update each active queue type
    for (const type of ['building', 'research', 'ship']) {
      const item = this.queueItems[type];
      if (!item || !item.endTime) continue;
      
      const remaining = Math.max(0, Math.ceil((new Date(item.endTime) - now) / 1000));
      
      // Update UI with remaining time and actual duration for this type
      this.updateQueueTimeDisplay(type, remaining, item.duration);
      
      // If completed, check with server
      if (remaining === 0 && !item.checking) {
        item.checking = true;
        this.checkBuildComplete(item.id || item._id);
      }
    }
  }

  async handleCancelClick(queueId, name, isStarted) {
    const penaltyMsg = isStarted ? '\n(A 20% penalty will apply to the refund)' : '';
    if (!confirm(`Are you sure you want to cancel the construction of ${name}?${penaltyMsg}`)) {
      return;
    }

    try {
      this.showNotification('System', `Cancelling ${name}...`, 'info');
      const result = await apiService.cancelBuild(queueId);
      
      if (result.message === 'Cancelled') {
        this.showNotification('Success', `${name} cancelled. ${result.refundApplied ? 'Resources refunded.' : ''}`, 'success');
        
        // Immediate sync to update resources and queue
        await this.syncUserDataFromServer();
      }
    } catch (error) {
      console.error('[UIManager.handleCancelClick] Error:', error);
      this.showNotification('Error', 'Failed to cancel: ' + error.message, 'error');
    }
  }
  
  updateQueueTimeDisplay(type, remaining, duration) {
    // Update the time display in UI elements for specific active queue type
    // We target only non-pending items to avoid simultaneous countdown bug
    const timeText = typeof remaining === 'number' ? this.formatBuildTime(remaining) : remaining;
    
    // 1. Update Time Text for active items only
    const timeDisplays = document.querySelectorAll(`[data-queue-type="${type}"]:not(.pending) .queue-time`);
    timeDisplays.forEach(el => el.textContent = timeText);

    // 2. Update Progress Bar for active items only
    const item = this.queueItems[type];
    if (item && item.duration > 0 && item.startTime) {
      const now = Date.now();
      const totalSeconds = (new Date(item.endTime) - new Date(item.startTime)) / 1000;
      const elapsed = (now - new Date(item.startTime)) / 1000;
      const percent = Math.min(100, Math.max(0, Math.floor((elapsed / totalSeconds) * 100)));
      
      const progressBars = document.querySelectorAll(`[data-queue-type="${type}"]:not(.pending) .queue-progress-bar`);
      progressBars.forEach(bar => {
        bar.style.width = `${percent}%`;
      });
    }
  }
  
  async loadQueueOnce() {
    try {
      const data = await apiService.getBuildQueue();
      this.hydrateQueueState(data);
      
      // Handle any already completed items from server
      if (data.completed && data.completed.length > 0) {
        for (const completed of data.completed) {
          this.handleBuildComplete(completed);
        }
      }
      
    } catch (err) {
      console.error('Failed to load queue:', err);
    }
  }
  
  async checkBuildComplete(queueId) {
    try {
      const result = await apiService.checkBuildComplete(queueId);
      
      if (result.completed) {
        this.handleBuildComplete(result);
        
        // Find which queue type was completed and clear it
        const queueType = result.type; // 'building', 'research', or 'ship'
        if (this.queueItems[queueType] && this.queueItems[queueType].id === queueId) {
          this.queueItems[queueType] = null;
        }
        
        if (result.snapshot) {
          gameState.syncFromServer(result.snapshot);
          this.hydrateQueueState(result.snapshot.queueState);
        } else {
          this.loadQueueOnce();
        }
      } else {
        // Not yet complete, update endTime from server
        // Find the queue item by id
        for (const type of ['building', 'research', 'ship']) {
          if (this.queueItems[type] && this.queueItems[type].id === queueId) {
            this.queueItems[type].endTime = result.endTime;
            this.queueItems[type].checking = false;
            break;
          }
        }
      }
    } catch (err) {
      console.error('Failed to check completion:', err);
      // Reset checking flag
      for (const type of ['building', 'research', 'ship']) {
        if (this.queueItems[type] && this.queueItems[type].id === queueId) {
          this.queueItems[type].checking = false;
          break;
        }
      }
    }
  }
  
  handleBuildComplete(completed) {
    const hasSnapshot = !!completed.snapshot;

    if (completed.snapshot) {
      gameState.syncFromServer(completed.snapshot);
      this.hydrateQueueState(completed.snapshot.queueState);
      this.refreshSyncedViews();
    } else if (completed.resources || completed.buildings || completed.fleet || completed.research) {
      if (completed.resources) {
        gameState.applyEconomySnapshot({ resources: completed.resources });
      }
      if (completed.buildings) {
        gameState.buildings = { ...gameState.buildings, ...completed.buildings };
      }
      if (completed.fleet) {
        gameState.fleet = { ...gameState.fleet, ...completed.fleet };
      }
      if (completed.research) {
        gameState.research = { ...gameState.research, ...completed.research };
      }
      gameState.recalculateDerivedState();
    }

    this.showNotification('Construction Complete', `${completed.name} completed!`, 'success');
    
    if (!hasSnapshot && completed.type === 'building' && !completed.buildings) {
      gameState.upgradeBuilding(completed.itemId);
      this.renderBuildingSwiper();
    } else if (!hasSnapshot && completed.type === 'research' && !completed.research) {
      gameState.upgradeResearch(completed.itemId);
      this.renderResearchSwiper();
    } else if (completed.type === 'ship') {
      this.renderShipyardSwiper();
      this.renderFleetVisual();
    }

    if (completed.type === 'building' && completed.buildings) {
      this.renderBuildingSwiper();
    }
    if (completed.type === 'research' && completed.research) {
      this.renderResearchSwiper();
    }
  }

  updateBuildProgress(build, progress) {
    // Update main queue UI
    const queueList = document.getElementById('queue-list');
    const queueSidebarList = document.getElementById('queue-list-sidebar');
    
    const percent = Math.floor(progress * 100);
    const timeText = this.formatBuildTime(Math.ceil(build.remaining));
    
    // Update main queue
    if (queueList) {
      const progressBar = queueList.querySelector('.queue-progress-bar');
      const timeDisplay = queueList.querySelector('.queue-time');
      
      if (progressBar) progressBar.style.width = percent + '%';
      if (timeDisplay) timeDisplay.textContent = timeText;
    }
    
    // Update sidebar queue
    if (queueSidebarList) {
      const progressBar = queueSidebarList.querySelector('.queue-progress-bar');
      const timeDisplay = queueSidebarList.querySelector('.queue-time');
      
      if (progressBar) progressBar.style.width = percent + '%';
      if (timeDisplay) timeDisplay.textContent = timeText;
    }
  }
  
  onBuildComplete(build) {
    if (!build) return;
    
    if (build.type === 'ship') {
      this.renderShipyardSwiper();
      this.renderFleetVisual();
    }
    
    // Check if queue is empty and hide containers
    const status = gameState.getQueueStatus();
    if (status.total === 0) {
      const queueContainer = document.getElementById('build-queue');
      if (queueContainer) queueContainer.classList.add('hidden');
      
      // Reset sidebar queue
      const queueSidebarEmpty = document.getElementById('queue-sidebar-empty');
      const queueSidebarList = document.getElementById('queue-list-sidebar');
      if (queueSidebarEmpty) queueSidebarEmpty.style.display = 'block';
      if (queueSidebarList) queueSidebarList.style.display = 'none';
    }
  }
  
  showNotification(title, message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = 'holo-notification ' + type;
    notification.innerHTML = '<div class="title">' + title + '</div><div class="message">' + message + '</div>';
    
    container.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100px)';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }
  
  hideModal() {
    if (this.modalOverlay) this.modalOverlay.classList.add('hidden');
  }
  
  // Auth Methods
  setAuthMode(isLogin) {
    this.isLoginMode = isLogin;
    const titleEl = document.querySelector('.auth-form-container h2');
    if (isLogin) {
      if (titleEl) titleEl.textContent = 'LOGIN';
      this.authSubmit.textContent = 'LOGIN';
      this.registerFields.style.display = 'none';
      this.authToggleText.textContent = "Don't have an account?";
      this.authToggleBtn.textContent = 'REGISTER';
    } else {
      if (titleEl) titleEl.textContent = 'REGISTER';
      this.authSubmit.textContent = 'REGISTER';
      this.registerFields.style.display = 'block';
      this.authToggleText.textContent = 'Already have an account?';
      this.authToggleBtn.textContent = 'LOGIN';
    }
  }
  
  toggleAuthMode() {
    this.setAuthMode(!this.isLoginMode);
  }
  
  async handleAuthSubmit(e) {
    e.preventDefault();
    console.log('Form submitted, isLoginMode:', this.isLoginMode);
    
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    
    console.log('Username:', username);
    
    if (!username || !password) {
      this.showNotification('Error', 'Please enter username and password', 'error');
      return;
    }
    
    try {
      if (this.isLoginMode) {
        console.log('Attempting login...');
        const data = await apiService.login(username, password);
        console.log('Login success:', data);
        
        // 로그인 성공 시 화면 전환
        this.authScreen.classList.add('hidden');
        this.uiLayer.classList.remove('hidden');
        console.log('Screen switched');
        
        // 서버에서 최신 사용자 데이터 동기화 (DB 기준)
        await this.syncUserDataFromServer();
        
        // 게임 초기화
        this.initializeDashboard();
        
        this.showNotification('Success', 'Welcome back, Commander!', 'success');
        this.updateUserDisplay(data.user);
        
        // Three.js 초기화 (한 번만)
        if (window.initGame && !window.gameInitialized) {
          window.gameInitialized = true;
          window.initGame();
        }
      } else {
        const email = document.getElementById('auth-email-reg').value;
        const confirmPassword = document.getElementById('auth-confirm-password').value;
        
        if (!email) {
          this.showNotification('Error', 'Please enter email for account recovery', 'error');
          return;
        }
        if (password !== confirmPassword) {
          this.showNotification('Error', 'Passwords do not match', 'error');
          return;
        }
        
        const data = await apiService.register(username, email, password);
        console.log('Register success:', data);
        
        // 회원가입 성공 시 화면 전환
        this.authScreen.classList.add('hidden');
        this.uiLayer.classList.remove('hidden');
        
        // 서버에서 최신 사용자 데이터 동기화
        await this.syncUserDataFromServer();
        
        // 게임 초기화
        this.initializeDashboard();
        
        this.showNotification('Success', 'Account created! Welcome, Commander!', 'success');
        this.updateUserDisplay(data.user);
        
        // Three.js 초기화
        if (window.initGame && !window.gameInitialized) {
          window.gameInitialized = true;
          window.initGame();
        }
      }
    } catch (err) {
      console.error('Auth error:', err);
      this.showNotification('Error', err.message, 'error');
    }
  }
  
  handleLogout() {
    apiService.logout();
    localStorage.removeItem('user');
    
    // UI 초기화
    this.userSection.innerHTML = `
      <button class="holo-btn-small" id="login-btn">
        <span class="icon">👤</span>
        <span class="label">LOGIN</span>
      </button>
    `;
    document.getElementById('login-btn')?.addEventListener('click', () => this.showLoginScreen());
    
    // 관리자 버튼 숨김
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) adminBtn.classList.add('hidden');
    
    // 로그인 화면으로 전환
    this.showLoginScreen();
    
    this.showNotification('Info', 'Logged out successfully', 'info');
  }
  
  async handleAdminSetup(e) {
    e.preventDefault();
    
    const username = document.getElementById('setup-username').value;
    const email = document.getElementById('setup-email').value;
    const password = document.getElementById('setup-password').value;
    const confirmPassword = document.getElementById('setup-confirm-password').value;
    
    if (!username || !email || !password) {
      this.showNotification('Error', 'Please fill in all fields', 'error');
      return;
    }
    
    if (password !== confirmPassword) {
      this.showNotification('Error', 'Passwords do not match', 'error');
      return;
    }
    
    if (password.length < 6) {
      this.showNotification('Error', 'Password must be at least 6 characters', 'error');
      return;
    }
    
    try {
      const data = await apiService.setupAdmin(username, email, password);
      console.log('Admin setup success:', data);
      
      this.hasAdmin = true;
      
      // Setup 화면 숨기고 대시보드 표시
      if (this.adminSetupScreen) this.adminSetupScreen.classList.add('hidden');
      this.showDashboard();
      
      // 게임 초기화
      this.initializeDashboard();
      
      this.showNotification('Success', 'Admin account created! Welcome, Commander!', 'success');
      this.updateUserDisplay(data.user);
      
      // 관리자 버튼 표시
      const adminBtn = document.getElementById('admin-btn');
      if (adminBtn) adminBtn.classList.remove('hidden');
      
      // Three.js 초기화
      if (window.initGame && !window.gameInitialized) {
        window.gameInitialized = true;
        window.initGame();
      }
      
    } catch (err) {
      console.error('Admin setup error:', err);
      this.showNotification('Error', err.message, 'error');
    }
  }
}
