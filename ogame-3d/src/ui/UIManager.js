import './planet-area.css';
import { ScoutController } from './views/ScoutController.js';
import { ScoutReportsView } from './views/ScoutReportsView.js';
import './scout.css';
import './entity-model.css';
import { stopInspector, disposeInspector } from '../three/entities/ModelViewer.js';
import { disposeThumbnails } from '../three/entities/ModelThumbnails.js';
import { io } from 'socket.io-client';
import { FleetFormationView } from './views/FleetFormationView.js';
import { profileOf, shipImages, fillThumbnails } from './views/fleetCards.js';
import * as THREE from 'three';
import { gameState } from '../core/GameState.js';
import * as GameData from '../data/gameData.js';
import { adminService } from '../services/AdminService.js';
import { apiService } from '../services/ApiService.js';
import { TechTreeManager } from './TechTreeManager.js';
import { catalog, evaluateEffect } from '../data/catalog.js';
import { EntityBrowser } from './views/EntityBrowser.js';
import { GalaxyView } from './views/GalaxyView.js';
import { StrikeMap } from './views/StrikeMap.js';
import { CATEGORY_LABELS, escapeHtml, formatAmount, formatDuration, TYPE_LABELS } from './dom.js';
import { getShipThumbnail } from '../three/ships/ShipThumbnails.js';
import { resolveModelSpec } from '../three/ships/ShipModelFactory.js';

const BROWSER_REFRESH_MS = 4000;
const MAX_NOTIFICATIONS = 4;
// Calendar flavor: 2026 AD is shown as 宇宙暦 796.
const SPACE_ERA_OFFSET = 1230;

export class UIManager {
  constructor(spaceScene) {
    this.spaceScene = spaceScene;
    this.currentView = 'dashboard';
    window.addEventListener('pagehide', e => { if(!e.persisted){disposeInspector();disposeThumbnails();} });
    this.currentCategory = 'resources';
    this.currentShipType = 'civil';
    this.resourceChart = null;
    this.chartData = { labels: [], metal: [], crystal: [], deuterium: [] };
    this.browsers = {};
    this.browserRefreshTimer = null;
    this.activityLog = [];
    this.queueCountdown = null;  // Local countdown timer
    this.queueItems = {
      building: null,
      research: null,
      ship: null,
      defense: null
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
    this.startBrowserRefresh();
    this.startMilitarySync();
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
        <span class="username">${escapeHtml(user.username)}</span>
        <button class="holo-btn-small" id="logout-btn" title="로그아웃">퇴청</button>
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
      
      // Entity catalog drives every list; refetch when the server revision changes.
      if (!catalog.loaded || (userData.entityConfigRevision && userData.entityConfigRevision !== catalog.revision)) {
        await catalog.load(apiService);
      }

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

      // 🔐 Check Admin access again after sync
      const adminBtn = document.getElementById('admin-btn');
      if (adminBtn) {
        if (adminService.isAdmin()) {
          adminBtn.classList.remove('hidden');
        } else {
          adminBtn.classList.add('hidden');
        }
      }
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
    this.queueItems.defense = queueState.defense || null;
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
      combat: document.getElementById('combat-panel'),
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
    this.esmToggleBtn = document.getElementById('esm-toggle');
    this.esmStatusText = this.esmToggleBtn?.querySelector('.status-text');
  }
  
  bindEvents() {
    this.navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.switchView(view);
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

    // ESM Toggle
    this.esmToggleBtn?.addEventListener('click', () => this.toggleEnergySavingMode());
    
    // Load ESM state
    this.initEnergySavingMode();
  }
  
  setupGameStateListeners() {
    gameState.on('fleetStateChanged', () => { this.renderFleet(); this.updateScoutUI(); });
    gameState.on('resourceChanged', () => this.updateResourceDisplay());
    gameState.on('productionUpdated', () => { 
      this.updateResourceDisplay(); 
      this.updateDashboardMetrics(); 
    });
    gameState.on('buildingUpgraded', ({ buildingId }) => {
      const building = GameData.BUILDINGS[buildingId];
      this.showNotification('Construction Complete', building?.name + ' upgraded!', 'success');
      this.addActivityLog('건설 완료 — ' + building?.name);
      this.renderBuildingSwiper();
      this.updateDashboardMetrics();
      if (this.spaceScene) this.spaceScene.createExplosion(new THREE.Vector3(0, 0, 4), 1.5);
    });
    gameState.on('researchCompleted', ({ researchId }) => {
      const research = GameData.RESEARCH[researchId];
      this.showNotification('Research Complete', research?.name + ' researched!', 'success');
      this.addActivityLog('연구 완료 — ' + research?.name);
      this.renderResearchSwiper();
    });
    
    // Build queue listeners removed - using local countdown instead
    // See loadQueueOnce() and startLocalCountdown() methods
  }
  
  startClock() {
    const dateEl = document.getElementById('system-date');
    const timeEl = document.getElementById('system-time');
    const updateTime = () => {
      const now = new Date();
      if (timeEl) timeEl.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':');
      if (dateEl) {
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        dateEl.textContent = `宇宙暦 ${now.getFullYear() - SPACE_ERA_OFFSET}.${month}.${day}`;
      }
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  initEnergySavingMode() {
    const esmEnabled = localStorage.getItem('esm_enabled') === 'true';
    if (esmEnabled) {
      this.applyEnergySavingMode(true);
    }
  }

  toggleEnergySavingMode() {
    const isEnabled = document.body.classList.contains('esm-mode');
    this.applyEnergySavingMode(!isEnabled);
  }

  applyEnergySavingMode(enabled) {
    if (enabled) {
      document.body.classList.add('esm-mode');
      if (this.esmStatusText) this.esmStatusText.textContent = '절전';
      localStorage.setItem('esm_enabled', 'true');
    } else {
      document.body.classList.remove('esm-mode');
      if (this.esmStatusText) this.esmStatusText.textContent = '표준';
      localStorage.setItem('esm_enabled', 'false');
    }

    // Update SpaceScene if available
    if (this.spaceScene) {
      this.spaceScene.setEnergySavingMode(enabled);
    }
    
    // Throttle UI updates
    if (enabled) {
      console.log('🐢 UI throttling enabled for battery saving');
    }
  }
  
  switchView(view) {
    if (view !== this.currentView && this.currentView === 'fleet' && this.formationView && !this.formationView.guard(() => this.switchView(view))) return;
    stopInspector();
    this.currentView = view;
    this.navButtons.forEach(button => button.classList.toggle('active', button.dataset.view === view));
    Object.values(this.panels).forEach(panel => {
      if (panel) panel.classList.add('hidden');
    });
    if (this.panels[view]) {
      this.panels[view].classList.remove('hidden');
    }

    // 🔋 Battery saving: Pause 3D scene when in admin mode or other full-screen overlays
    if (this.spaceScene) {
      if (view === 'admin' || view === 'galaxy') {
        this.spaceScene.pause();
      } else {
        this.spaceScene.resume();
      }
    }

    if (view !== 'combat') { this.strikeMap?.endDrag(); this.strikeMap?.closeConfirm(); }
    if (view === 'galaxy') { this.renderGalaxy(); this.syncMilitaryState(); }
    if (view === 'fleet' || view === 'combat') { this.renderFleet(); this.syncMilitaryState(); }
    if (view === 'buildings') this.renderBuildingSwiper();
    if (view === 'research') this.renderResearchSwiper();
    if (view === 'shipyard') this.renderShipyardSwiper();
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
    const { resources, productionRates, energyProduction, energyConsumption, storage } = gameState;
    const round1 = (num) => Math.round(num * 10) / 10;

    for (const resource of ['metal', 'crystal', 'deuterium']) {
      const el = this.resourceElements[resource];
      if (!el.count) continue;
      const rate = round1(productionRates[resource]);
      const pct = storage[resource] ? Math.min((resources[resource] / storage[resource]) * 100, 100) : 0;
      el.count.textContent = GameData.formatNumber(round1(resources[resource]));
      el.rate.textContent = (rate >= 0 ? '+' : '') + GameData.formatNumber(rate) + '/h';
      if (el.fill) el.fill.textContent = `${pct.toFixed(1)}%`;
      el.ring?.style.setProperty('--fill', (pct / 100).toFixed(4));
      el.ring?.closest('[data-resource]')?.classList.toggle('is-full', pct >= 99.5);
    }

    const energy = this.resourceElements.energy;
    if (energy.count) {
      const energyDiff = round1(energyProduction - energyConsumption);
      energy.count.textContent = (energyDiff >= 0 ? '+' : '') + GameData.formatNumber(energyDiff);
      energy.rate.textContent = GameData.formatNumber(round1(energyProduction)) + '/' + GameData.formatNumber(round1(energyConsumption));
      energy.count.closest('[data-resource]')?.classList.toggle('is-negative', energyDiff < 0);
      const usage = energyProduction > 0 ? Math.min((energyConsumption / energyProduction) * 100, 100) : 100;
      energy.ring?.style.setProperty('--fill', (usage / 100).toFixed(4));
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
            { label: '금속', data: this.chartData.metal, borderColor: GameData.RESOURCES.metal.color, borderWidth: 1.5, tension: 0.3, pointRadius: 0 },
            { label: '수정', data: this.chartData.crystal, borderColor: GameData.RESOURCES.crystal.color, borderWidth: 1.5, tension: 0.3, pointRadius: 0 },
            { label: '중수소', data: this.chartData.deuterium, borderColor: GameData.RESOURCES.deuterium.color, borderWidth: 1.5, tension: 0.3, pointRadius: 0 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { align: 'end', labels: { color: '#a9b2c2', boxWidth: 12, boxHeight: 2, font: { family: 'IBM Plex Sans KR', size: 13 } } } },
          scales: {
            x: { display: false },
            y: { border: { display: false }, grid: { color: 'rgba(200,169,106,0.08)' }, ticks: { color: '#7e8a9e', font: { family: 'IBM Plex Sans KR', size: 12 } } }
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
  
  // ─── Entity browsers (buildings / research / shipyard) ──────────────────────
  // Method names are kept from the former swiper carousels; many callers use them.

  categoryTabs(type) {
    const categories = catalog.categories(type);
    if (categories.length < 2) return [{ key: type, label: TYPE_LABELS[type].title, type }];
    return categories.map((category) => ({
      key: `${type}:${category}`,
      label: CATEGORY_LABELS[category] || category,
      type,
      category
    }));
  }

  getBrowser(view) {
    if (this.browsers[view]) return this.browsers[view];
    const root = document.getElementById(`${view}-browser`);
    if (!root) return null;

    const isActive = (type) => (entity) => [this.queueItems[type], ...this.lastPendingQueue].filter(Boolean).some(item => item.type === type && item.itemId === entity.id && (entity.id === 'terraforming' || String(item.planetId ?? 0) === String(gameState.currentPlanet ?? 0)));
    const configs = {
      buildings: {
        showModel: true,
        tabs: () => this.categoryTabs('building'),
        isInProgress: isActive('building'),
        onCommand: (entity) => this.startConstruction(entity.id),
        onDemolish: (entity) => this.demolishBuilding(entity.id)
      },
      research: {
        showModel: true,
        tabs: () => [{ key: 'research:all', label: '전체', type: 'research' }, ...this.categoryTabs('research')
          .filter((tab) => tab.category)],
        isInProgress: isActive('research'),
        onCommand: (entity) => this.startResearch(entity.id)
      },
      shipyard: {
        tabs: () => [...this.categoryTabs('ship'), { key: 'defense', label: CATEGORY_LABELS.defense, type: 'defense' }],
        isInProgress: () => false,
        onCommand: (entity, count) => this.buildShip(entity.id, count, entity.type),
        showModel: true
      }
    };

    this.browsers[view] = new EntityBrowser({ root, getState: () => gameState, ...configs[view] });
    return this.browsers[view];
  }

  renderBuildingSwiper() {
    this.getBrowser('buildings')?.render();
  }

  renderResearchSwiper() {
    this.getBrowser('research')?.render();
  }

  renderShipyardSwiper() {
    this.getBrowser('shipyard')?.render();
  }

  /** Keep affordability / status fresh while a browser is on screen. */
  startBrowserRefresh() {
    if (this.browserRefreshTimer) return;
    const viewToBrowser = { buildings: 'buildings', research: 'research', shipyard: 'shipyard' };
    this.browserRefreshTimer = setInterval(() => {
      const view = viewToBrowser[this.currentView];
      if (!view || document.hidden) return;
      if (document.activeElement?.closest?.('.entity-browser .unit-count')) return;
      this.browsers[view]?.render();
    }, BROWSER_REFRESH_MS);
  }
  
  async startConstruction(buildingId) {
    try {
      const result = await apiService.startBuilding(buildingId, String(gameState.currentPlanet ?? 0));
      if (result.snapshot) {
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
      }
      this.showNotification('건설 명령', `${result.queueItem.name} Lv ${result.queueItem.level}`, 'success');
      this.addActivityLog(`건설 명령 — ${result.queueItem.name} Lv ${result.queueItem.level}`);
      this.refreshSyncedViews();
    } catch (err) {
      this.showNotification('명령 실패', err.message, 'error');
      await this.syncUserDataFromServer();
    }
  }
  
  async startResearch(researchId) {
    try {
      const result = await apiService.startResearch(researchId, String(gameState.currentPlanet ?? 0));
      if (result.snapshot) {
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
      }
      this.showNotification('연구 개시', `${result.queueItem.name} Lv ${result.queueItem.level}`, 'success');
      this.addActivityLog(`연구 개시 — ${result.queueItem.name} Lv ${result.queueItem.level}`);
      this.refreshSyncedViews();
    } catch (err) {
      this.showNotification('명령 실패', err.message, 'error');
      await this.syncUserDataFromServer();
    }
  }
  
  async buildShip(shipId, count = 1, entityType = 'ship') {
    try {
      const result = await apiService.buildShip(shipId, count, String(gameState.currentPlanet ?? 0), entityType);
      if (result.snapshot) {
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
      }
      const label = entityType === 'defense' ? '배치 명령' : '건조 명령';
      this.showNotification(label, `${result.queueItem.name} ×${result.queueItem.count || count}`, 'success');
      this.addActivityLog(`${label} — ${result.queueItem.name} ×${result.queueItem.count || count}`);
      this.renderShipyardSwiper();
    } catch (err) {
      this.showNotification('명령 실패', err.message, 'error');
      await this.syncUserDataFromServer();
    }
  }
  
  formatBuildTime(seconds) {
    return formatDuration(seconds);
  }
  
  getScoutController() {
    this.scouts ??= new ScoutController({api:apiService,state:gameState,notify:(...args)=>this.showNotification(...args),onChange:()=>this.updateScoutUI()});
    return this.scouts;
  }
  updateScoutUI() {
    if (!this.scouts || !apiService.isAuthenticated()) return;
    if (this.galaxyView?.scoutEl) {
      this.galaxyScoutView ??= new ScoutReportsView(this.galaxyView.scoutEl,{controller:this.scouts,state:gameState,onNavigate:view=>this.switchView(view),onMissions:()=>this.switchView('combat')});
      const position=this.galaxyView.data?.positions.find(p=>p.position===this.galaxyView.selected);
      if(position)this.galaxyScoutView.render(position);
    }
    const root=document.getElementById('scout-reports-content');
    if(root){this.scoutHistoryView ??= new ScoutReportsView(root,{controller:this.scouts,state:gameState,onNavigate:view=>this.switchView(view),onMissions:()=>this.switchView('combat')});this.scoutHistoryView.render();}
  }
  renderGalaxy() {
    const root = document.getElementById('galaxy-holo');
    if (!root) return;
    this.galaxyView ??= new GalaxyView({
      root,
      controls: {
        prev: document.getElementById('galaxy-prev'),
        next: document.getElementById('galaxy-next'),
        galaxy: document.getElementById('galaxy-input'),
        system: document.getElementById('system-input'),
        home: document.getElementById('galaxy-home')
      },
      onSelect: (position, coords) => {
        const scouts=this.getScoutController();
        void scouts.selectTarget({...coords,planet:position.position});
        this.updateScoutUI();
      },
      fetchTraffic: (galaxy, system) => apiService.getGalaxyTraffic(galaxy, system),
      fetchSystem: (galaxy, system) => apiService.getGalaxySystem(galaxy, system),
      getHome: () => ({ galaxy: gameState.planet.galaxy, system: gameState.planet.system }),
      onTarget: (target) => {
        this.pendingFleetTarget = target;
        this.switchView('combat');
        this.showNotification('작전 목표 지정', `[${target.galaxy}:${target.system}:${target.planet}] 를 함대 작전 목표로 지정했습니다.`, 'success');
      }
    });
    this.galaxyView.show();
  }
  
  renderFleet() {
    const root = document.getElementById('formation-view');
    if (!root || !catalog.loaded) return;
    this.formationView ??= new FleetFormationView(root, {
      getState: () => gameState,
      create: () => this.formationMutation(() => apiService.createFormation(gameState.planet.id)),
      save: (id,input) => this.formationMutation(() => apiService.saveFormation(id,input)),
      remove: (id,revision) => this.formationMutation(() => apiService.deleteFormation(id,revision)),
      onCombat: () => this.switchView('combat')
    });
    this.formationView.render();
    this.renderStrikeMap();
    this.renderCombatMissions();
  }

  async formationMutation(action) {
    try {
      const result = await action();
      if (result.snapshot) gameState.syncFromServer(result.snapshot);
      this.refreshSyncedViews();
      return result;
    } catch (error) {
      await this.syncMilitaryState();
      throw error;
    }
  }

  pendingOrders() {
    const key = `oogame.pendingFleet.${gameState.userId}`;
    if (this.pendingKey !== key) {
      this.pendingKey = key;
      try { this.pendingFleetOrders = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { this.pendingFleetOrders = {}; }
    }
    return this.pendingFleetOrders;
  }
  persistPending() { sessionStorage.setItem(this.pendingKey,JSON.stringify(this.pendingFleetOrders)); }
  async launchFleetOrder(input) {
    const order = {...input,requestId: input.requestId || crypto.randomUUID()};
    const pending = this.pendingOrders();
    pending[order.formationId] = order;
    this.persistPending();
    this.renderFleet();
    try {
      const result = await apiService.launchFleet(order);
      delete pending[order.formationId];this.persistPending();
      if (result.snapshot) gameState.syncFromServer(result.snapshot);
      else await this.syncMilitaryState();
      this.pendingFleetTarget = null;
      this.refreshSyncedViews();
      this.showNotification('함대 출격', `${result.fleet.formationName} · ${order.mission === 'colonize' ? '식민지 개척' : order.mission === 'attack' ? '공격' : '수송'} 임무를 시작했습니다.`, 'success');
      return result;
    } catch (error) {
      if (error.status && error.status < 500) {
        delete pending[order.formationId];this.persistPending();
        this.showNotification('출격 실패',error.message,'error');
        await this.syncMilitaryState();
      } else {
        this.showNotification('출격 결과 확인 중','연결이 복구되면 동일 요청으로 결과를 확인합니다.','info');
      }
      this.renderFleet();
      throw error;
    }
  }
  async recoverPendingOrders() {
    if (this.recoveringOrders) return;
    const pending=this.pendingOrders();
    if (!Object.keys(pending).length) return;
    this.recoveringOrders=true;
    try {
      for (const [id,order] of Object.entries(pending)) {
        const known=gameState.fleetMovements.find(m=>m.requestId===order.requestId);
        if(known){delete pending[id];continue;}
        try {await apiService.getFleetRequest(order.requestId);delete pending[id];}
        catch(error){
          if(error.status===404) {
            try {const result=await apiService.launchFleet(order);delete pending[id];if(result.snapshot)gameState.syncFromServer(result.snapshot);}
            catch(retry){if(retry.status && retry.status<500){delete pending[id];this.showNotification('출격 확인',retry.message,'error');}}
          }
        }
      }
      this.persistPending();this.renderFleet();
    } finally {this.recoveringOrders=false;}
  }
  async syncMilitaryState() {
    if (this.militarySyncing || !apiService.isAuthenticated() || !catalog.loaded) return;
    this.militarySyncing=true;
    try {
      const {snapshot}=await apiService.getFleetFormations();
      const origin=gameState.planet.id;
      gameState.syncFromServer(snapshot);
      if(origin && origin!==gameState.planet.id){this.strikeMap?.endDrag();this.strikeMap?.closeConfirm();}
      this.renderFleet();
      await this.recoverPendingOrders();
      await this.getScoutController().refresh();
    } catch(error) {
      const status=document.getElementById('military-sync-status');
      if(status)status.textContent='연결 확인 중 · 표시된 상태가 최신이 아닐 수 있습니다.';
    } finally {this.militarySyncing=false;}
  }
  startMilitarySync() {
    if(!this.militaryTimer) {
      this.militaryTimer=setInterval(()=>{
        if(document.hidden || !['fleet','combat','galaxy'].includes(this.currentView) || !apiService.isAuthenticated())return;
        this.syncMilitaryState();
      },8000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden && ['fleet','combat','galaxy'].includes(this.currentView))this.syncMilitaryState();});
      window.addEventListener('focus',()=>{if(['fleet','combat','galaxy'].includes(this.currentView))this.syncMilitaryState();});
      document.getElementById('fleet-to-combat')?.addEventListener('click',()=>this.switchView('combat'));
      document.getElementById('manual-combat-target')?.addEventListener('submit',event=>{
        event.preventDefault();const fields=new FormData(event.target);
        this.strikeMap.show({galaxy:Number(fields.get('galaxy')),system:Number(fields.get('system'))},{targetSlot:Number(fields.get('planet'))});
      });
      document.getElementById('scout-reports')?.addEventListener('toggle',event=>{if(event.target.open)void this.getScoutController().refresh();});
      if(!this.scoutClock)this.scoutClock=setInterval(()=>{this.galaxyScoutView?.tick();this.scoutHistoryView?.tick();},1000);
      document.getElementById('combat-reports')?.addEventListener('toggle',async event=>{
        if(!event.target.open)return;
        const root=event.target.querySelector('.movement-log');
        try {const {reports}=await apiService.getBattleReports();root.innerHTML=reports.slice(0,10).map(r=>`<div class="log-row">${escapeHtml(new Date(r.battleTime).toLocaleString('ko-KR'))} · ${{attacker:'공격측 승리',defender:'방어측 승리',draw:'무승부'}[r.result?.winner] || '전투 완료'}</div>`).join('')||'<p>전투 기록이 없습니다.</p>';} catch(error){root.textContent=error.message;}
      });
    }
    if(this.militarySocket?.authToken===apiService.token && this.militarySocket.active)return;
    this.militarySocket?.disconnect();
    const socket=io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3000',{transports:['websocket']});
    socket.authToken=apiService.token;this.militarySocket=socket;
    socket.on('connect',()=>socket.emit('authenticate',socket.authToken));
    socket.on('authenticated',()=>this.syncMilitaryState());
    socket.on('fleetStateChanged',()=>this.syncMilitaryState());
  }

  renderStrikeMap() {
    const root=document.getElementById('strike-map');if(!root)return;
    this.strikeMap ??= new StrikeMap({
      root,fetchSystem:(galaxy,system)=>apiService.getGalaxySystem(galaxy,system),
      getHome:()=>({...gameState.planet}),
      getFormations:()=>gameState.fleetFormations.filter(f=>f.status==='ready'&&String(f.originPlanetId)===String(gameState.planet.id)&&profileOf(f.ships).ships>0),
      isPending:id=>Boolean(this.pendingOrders()[id]),
      onManage:()=>this.switchView('fleet'),
      onLaunch:order=>this.launchFleetOrder(order)
    });
    if(this.currentView!=='combat'){this.strikeMap.refresh();return;}
    const target=this.pendingFleetTarget;
    if(target && target!==this.strikeTargetShown){this.strikeTargetShown=target;this.strikeMap.show(target,{targetSlot:target.planet});}
    else if(!this.strikeMap.coords)this.strikeMap.show();
    else this.strikeMap.refresh();
  }

  renderCombatMissions() {
    const root=document.getElementById('combat-missions');if(!root)return;
    const signature = JSON.stringify(gameState.fleetMovements.map(({remaining, ...movement}) => movement));
    if (signature === this.missionSignature) { this.tickCombatMissions(); return; }
    this.missionSignature = signature;
    root.innerHTML=`<header class="mission-section-heading"><div><p class="fleet-eyebrow">ACTIVE MISSIONS</p><h3>진행 중인 임무 <span>${gameState.fleetMovements.length}</span></h3></div><small id="military-sync-status" role="status">서버 상태 동기화</small></header><div class="mission-card-grid">${gameState.fleetMovements.map(m=>`<article class="mission-card" data-movement="${escapeHtml(m.id)}"><div class="mission-card-top"><div class="mission-ships">${shipImages(m.fleet,2)}</div><div><strong>${escapeHtml(m.formationName || '기존 임무')}</strong><span class="fleet-status">${m.status==='returning'?'귀환 중':'진군 중'}</span></div><b data-mission-countdown></b></div><div class="mission-route"><span>[${m.origin.galaxy}:${m.origin.system}:${m.origin.planet}]</span><span>${m.status==='returning'?'←':'→'}</span><span>[${m.destination.galaxy}:${m.destination.system}:${m.destination.planet}]</span></div><progress max="1" value="0" aria-label="임무 진행률"></progress><div class="mission-card-bottom"><span>${m.mission==='colonize'?'식민지 개척':m.mission==='spy'?'정찰':m.mission==='attack'?'공격':'수송'} · ${formatAmount(profileOf(m.fleet).ships)}척</span><small>${m.notice?escapeHtml(m.notice):m.status==='returning'?'귀환 완료 후 다시 출격할 수 있습니다.':'목표 행성으로 이동하고 있습니다.'}</small></div></article>`).join('')||'<div class="mission-empty">아직 진행 중인 임무가 없습니다. 위에서 함대를 선택해 출격하십시오.</div>'}</div>`;
    fillThumbnails(root);this.tickCombatMissions();
    if(!this.missionCountdownTimer)this.missionCountdownTimer=setInterval(()=>{if(this.currentView==='combat')this.tickCombatMissions();},1000);
  }
  tickCombatMissions() {
    const now=Date.now()+(gameState.serverOffset || 0);
    for(const movement of gameState.fleetMovements) {
      const row=[...document.querySelectorAll('[data-movement]')].find(el=>el.dataset.movement===movement.id);if(!row)continue;
      const end=new Date(movement.status==='returning'?movement.returnTime:movement.arrivalTime).getTime();
      const duration=new Date(movement.arrivalTime)-new Date(movement.startTime);
      const remaining=Math.max(0,Math.ceil((end-now)/1000));
      row.querySelector('[data-mission-countdown]').textContent=remaining?formatDuration(remaining):'도착 처리 중';
      row.querySelector('progress').value=duration?Math.min(1,Math.max(0,1-(end-now)/duration)):1;
    }
  }

  createFleetNumberField(name, label, value, min, max = '') {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    wrapper.textContent = label;

    const input = document.createElement('input');
    input.type = 'number';
    input.name = name;
    input.value = String(value);
    input.min = String(min);
    input.step = '1';
    if (max !== '') input.max = String(max);
    wrapper.appendChild(input);

    return { wrapper, input };
  }
  
  /** Roster card with a rendered 3D thumbnail of the ship. */
  createShipCard(shipId, count) {
    const entity = catalog.get('ship', shipId);
    const item = document.createElement('li');
    item.className = 'ship-card';
    const img = document.createElement('img');
    img.alt = '';
    const name = document.createElement('span');
    name.className = 'ship-card-name';
    name.textContent = entity?.name || shipId;
    const amount = document.createElement('span');
    amount.className = 'ship-card-count';
    amount.textContent = `${count.toLocaleString('ko-KR')}척`;
    item.append(img, name, amount);
    if (entity) {
      getShipThumbnail(resolveModelSpec(entity), shipId)
        .then((url) => { img.src = url; })
        .catch((error) => console.warn('[UIManager] thumbnail failed', shipId, error));
    }
    return item;
  }

  renderFleetVisual() {
    const totalEl = document.getElementById('total-ships');
    const breakdownEl = document.getElementById('fleet-breakdown');
    if (!totalEl || !breakdownEl) return;
    
    const owned = Object.entries(gameState.fleet).filter(([, count]) => count > 0);
    totalEl.textContent = owned.reduce((sum, [, count]) => sum + count, 0).toLocaleString('ko-KR');

    breakdownEl.replaceChildren();
    if (owned.length === 0) {
      breakdownEl.innerHTML = '<p class="detail-muted">편성된 함선 없음</p>';
      return;
    }
    const list = document.createElement('ul');
    list.className = 'roster-list compact';
    for (const [shipId, count] of owned) list.appendChild(this.createShipCard(shipId, count));
    breakdownEl.appendChild(list);
  }
  
  async demolishBuilding(buildingId) {
    const name = catalog.get('building', buildingId)?.name || buildingId;
    const level = gameState.buildings[buildingId] || 0;
    const entity = catalog.get('building', buildingId);
    const nextStorage = { ...gameState.storage };
    for (const [resource, rule] of Object.entries(entity?.effects?.storage || {})) {
      // Same storage rule as the server; show losses before ordering demolition.
      nextStorage[resource] = Math.max(gameState.defaultStorage?.[resource] ?? 10000, evaluateEffect(rule, Math.max(0, level - 1)));
    }
    const loss = Object.entries(nextStorage).filter(([key, cap]) => gameState.resources[key] > cap)
      .map(([key, cap]) => `${key} ${formatAmount(gameState.resources[key] - cap)}`).join(', ');
    if (!window.confirm(`${name} Lv ${level} → ${level - 1} 철거를 예약합니다. 완료 시 1칸 회수, 자원 환급 없음.${loss ? ` 저장 한도 감소 예상 손실: ${loss}` : ''}`)) return;
    try {
      const result = await apiService.demolishBuilding(buildingId, String(gameState.currentPlanet ?? 0));
      gameState.syncFromServer(result.snapshot); this.hydrateQueueState(result.snapshot.queueState); this.refreshSyncedViews();
      this.showNotification('철거 예약', name, 'success');
    } catch (error) { this.showNotification('명령 실패', error.message, 'error'); await this.syncUserDataFromServer(); }
  }

  renderPlanetArea() {
    const area = gameState.planet.area;
    const modifiers = gameState.planet.productionModifiers;
    const select = document.getElementById('planet-select');
    if (select && document.activeElement !== select) {
      select.innerHTML = (gameState.planets || []).map((p, index) => `<option value="${index}" ${index === gameState.currentPlanet ? 'selected' : ''}>${escapeHtml(p.name)} [${p.galaxy}:${p.system}:${p.planet}]</option>`).join('');
    }
    if (select && !select.onchange) select.onchange = async () => {
      select.disabled = true;
      try {
        const result = await apiService.selectPlanet(select.value);
        gameState.syncFromServer(result.snapshot); this.hydrateQueueState(result.snapshot.queueState); this.refreshSyncedViews();
      } catch (error) { this.showNotification('선택 실패', error.message, 'error'); }
      finally { select.disabled = false; select.blur(); this.renderPlanetArea(); }
    };
    if (!area) return;
    const bonus = value => `${value >= 1 ? '+' : ''}${Math.round((value - 1) * 100)}%`;
    const level = gameState.research.terraforming || 0;
    const nextPercent = Math.min(100, area.baseUsablePercent + (level + 1) * 2);
    const nextUsable = Math.floor(area.total * nextPercent / 100 + 1e-9);
    const html = `<div class="area-heading"><strong>${escapeHtml(gameState.planet.name)} · 개발 현황</strong><span>전체 ${area.total}칸</span></div>
      <p>가용률 <b>${area.usablePercent}%</b> · 기본 ${area.baseUsablePercent}% + 테라포밍 ${level * 2}%p (상한 100%)</p>
      <progress max="${Math.max(1, area.usable)}" value="${Math.min(area.usable, area.used + area.reserved)}" aria-label="건설 가능 면적 사용량"></progress>
      <p>사용 ${area.used}칸 · 예약 ${area.reserved}칸 · 건설 가능 ${area.usable}칸 · <b>남은 ${area.available}칸</b></p>
      ${area.overCapacity ? '<p class="area-warning">면적 한도 초과: 기존 시설은 유지됩니다. 철거로 공간을 확보해 주세요.</p>' : ''}
      <p>금속 ${bonus(modifiers?.metal ?? 1)} · 크리스털 ${bonus(modifiers?.crystal ?? 1)} · 중수소 ${bonus(modifiers?.deuterium ?? 1)} · 태양광 ${bonus(modifiers?.solar ?? 1)}</p>
      <p class="detail-muted">건설·업그레이드마다 1칸 사용. ${level < 30 ? `테라포밍 다음 단계: ${nextPercent}% / ${nextUsable}칸 (+${nextUsable - area.usable}칸)` : '테라포밍 최대 레벨'}</p>`;
    for (const id of ['building-area', 'research-area']) {
      const el = document.getElementById(id);
      if (!el) continue;
      const previous = el.querySelector('.area-details');
      const open = previous ? previous.open : !window.matchMedia('(max-width: 700px)').matches;
      el.innerHTML = `<details class="area-details" ${open ? 'open' : ''}>
        <summary>행성 개발 현황 · 남은 ${area.available}칸 · 가용률 ${area.usablePercent}%</summary>
        <div class="area-expanded">${html}</div>
      </details>`;
    }
  }

  updatePlanetInfo() {
    this.renderPlanetArea();
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
    
    if (this.activityLog.length === 0) {
      container.innerHTML = '<p class="detail-muted">기록된 사건이 없습니다.</p>';
      return;
    }
    container.innerHTML = this.activityLog.map(log => 
      '<div class="log-entry"><span class="timestamp">[' + log.timestamp + ']</span><span class="message">' + escapeHtml(log.message) + '</span></div>'
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
      // Entity Config Manager is now part of Tech Tree
      this.entityConfigManager = true; // Flag to prevent multiple logs

    
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
      case 'techtree':
        if (!this.techTreeManager) {
          this.techTreeManager = new TechTreeManager();
          this.techTreeManager.init();
        } else {
          this.techTreeManager.load();
        }
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
        badge.textContent = data.pagination.total || 0;
        badge.style.display = data.pagination.total > 0 ? 'inline-flex' : 'none';
      }
      
      // Update showing text
      if (showingEl && data.pagination) {
        const start = (page - 1) * pageSize + 1;
        const end = Math.min(page * pageSize, data.pagination.total);
        showingEl.textContent = `Showing ${start}-${end} of ${data.pagination.total} users`;
      }
      
      if (data.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-faint);">No users found</td></tr>';
        return;
      }
      
      tbody.innerHTML = data.users.map(user => {
        const planet = user.planets?.[0];
        const resources = planet?.resources || {};
        
        return `
        <tr data-user-id="${user._id}">
          <td class="col-username">
            <div class="user-name">${user.username}</div>
            <div class="user-email">${user.email || ''}</div>
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
  
  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);
  }

  formatDate(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
  }

  showModal(content) {
    const modalContent = document.getElementById('modal-content');
    if (!this.modalOverlay || !modalContent) return;

    modalContent.innerHTML = content;
    this.modalOverlay.classList.remove('hidden');
  }

  async viewUserDetails(userId) {
    try {
      const user = await adminService.getUser(userId);
      const planets = user.planets || [];
      const planetRows = planets.map((planet, index) => {
        const resources = planet.resources || {};
        return `<div class="admin-user-planet">
          <strong>${this.escapeHtml(planet.name || `Planet ${index + 1}`)}</strong>
          <span>[${planet.galaxy ?? '-'}:${planet.system ?? '-'}:${planet.planet ?? '-'}]</span>
          <span>⚙️ ${this.formatNumber(resources.metal || 0)} · 💎 ${this.formatNumber(resources.crystal || 0)} · 💧 ${this.formatNumber(resources.deuterium || 0)}</span>
        </div>`;
      }).join('') || '<p>No planets found.</p>';

      this.showModal(`<div class="modal-header"><h2>USER DETAILS</h2></div>
        <div class="modal-body admin-user-modal">
          <dl class="admin-user-details">
            <div><dt>Username</dt><dd>${this.escapeHtml(user.username)}</dd></div>
            <div><dt>Email</dt><dd>${this.escapeHtml(user.email)}</dd></div>
            <div><dt>Status</dt><dd>${user.isOnline ? 'Online' : 'Offline'}${user.isBanned ? ' · Banned' : ''}</dd></div>
            <div><dt>Role</dt><dd>${this.escapeHtml(user.adminRole || 'Player')}</dd></div>
            <div><dt>Rank / Points</dt><dd>${user.rank ?? 0} / ${this.formatNumber(user.points ?? 0)}</dd></div>
            <div><dt>Joined</dt><dd>${this.formatDate(user.createdAt)}</dd></div>
            <div><dt>Last login</dt><dd>${this.formatDate(user.lastLogin)}</dd></div>
          </dl>
          <h3>PLANETS</h3>
          <div class="admin-user-planets">${planetRows}</div>
        </div>`);
    } catch (err) {
      this.showNotification('Error', err.message, 'error');
    }
  }
  
  renderPagination(pagination, currentPage) {
    const container = document.getElementById('user-pagination');
    if (!container || !pagination) return;
    
    let html = '';
    for (let i = 1; i <= pagination.pages; i++) {
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
    try {
      const user = await adminService.getUser(userId);
      const planets = user.planets || [];
      const selectedPlanet = planets[user.currentPlanet] || planets[0] || { resources: {} };
      const resources = selectedPlanet.resources || {};
      const planetResources = planets.map((planet) => planet.resources || {});
      const planetOptions = planets.map((planet, index) =>
        `<option value="${index}" ${planet === selectedPlanet ? 'selected' : ''}>${this.escapeHtml(planet.name || `Planet ${index + 1}`)}</option>`
      ).join('');

      this.showModal(`<div class="modal-header"><h2>EDIT USER: ${this.escapeHtml(user.username)}</h2></div>
        <form class="modal-body admin-user-modal" id="admin-user-edit-form">
          <div class="admin-user-toggle-row">
            <label><input type="checkbox" name="isBanned" ${user.isBanned ? 'checked' : ''}> Ban user</label>
            <label><input type="checkbox" name="isAdmin" ${user.isAdmin ? 'checked' : ''}> Administrator</label>
          </div>
          <div class="form-group"><label for="admin-user-ban-reason">BAN REASON</label>
            <input id="admin-user-ban-reason" name="banReason" maxlength="500" value="${this.escapeHtml(user.banReason || '')}"></div>
          <div class="form-group"><label for="admin-user-role">ADMIN ROLE</label>
            <select id="admin-user-role" name="adminRole">
              <option value="support" ${user.adminRole === 'support' ? 'selected' : ''}>Support</option>
              <option value="moderator" ${user.adminRole === 'moderator' ? 'selected' : ''}>Moderator</option>
              <option value="superadmin" ${user.adminRole === 'superadmin' ? 'selected' : ''}>Superadmin</option>
            </select></div>
          <h3>PLANET RESOURCES</h3>
          <div class="form-group"><label for="admin-user-planet">PLANET</label><select id="admin-user-planet" name="planetIndex">${planetOptions}</select></div>
          <div class="admin-user-resource-grid">
            ${['metal', 'crystal', 'deuterium', 'energy'].map((resource) => `<div class="form-group"><label for="admin-user-${resource}">${resource.toUpperCase()}</label><input id="admin-user-${resource}" name="${resource}" type="number" min="0" step="1" value="${Number(resources[resource] || 0)}"></div>`).join('')}
          </div>
          <button class="holo-action-btn" type="submit">SAVE USER</button>
        </form>`);

      const form = document.getElementById('admin-user-edit-form');
      const planetSelect = document.getElementById('admin-user-planet');
      planetSelect?.addEventListener('change', () => {
        const nextResources = planetResources[Number(planetSelect.value)] || {};
        ['metal', 'crystal', 'deuterium', 'energy'].forEach((resource) => {
          const input = form?.elements.namedItem(resource);
          if (input) input.value = Number(nextResources[resource] || 0);
        });
      });
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const updatedResources = Object.fromEntries(['metal', 'crystal', 'deuterium', 'energy'].map((resource) => [resource, Number(formData.get(resource))]));
        if (Object.values(updatedResources).some((value) => !Number.isSafeInteger(value) || value < 0)) {
          this.showNotification('Error', 'Resources must be non-negative whole numbers.', 'error');
          return;
        }

        try {
          await adminService.updateUser(userId, {
            isBanned: formData.get('isBanned') === 'on',
            banReason: String(formData.get('banReason') || '').trim(),
            isAdmin: formData.get('isAdmin') === 'on',
            adminRole: formData.get('isAdmin') === 'on' ? formData.get('adminRole') : null,
            planetIndex: Number(formData.get('planetIndex')),
            resources: updatedResources
          });
          this.hideModal();
          this.showNotification('Success', 'User updated', 'success');
          this.loadUsers();
        } catch (err) {
          this.showNotification('Error', err.message, 'error');
        }
      });
    } catch (err) {
      this.showNotification('Error', err.message, 'error');
    }
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
    
    const defense = this.queueItems.defense;
    // Count all active + pending items
    const activeCount = [building, research, ship, defense].filter(Boolean).length;
    const total = activeCount + (pendingQueue?.length || 0);
    
    if (total === 0) {
      // Clear panel cards too: a completed queue must not leave a stale cancel button.
      if(queueList) queueList.innerHTML = '';
      if(queueSidebarList) queueSidebarList.innerHTML = '';
      for(const id of ['buildings-panel-queue','research-panel-queue','shipyard-panel-queue']) {
        const panelQueue = document.getElementById(id);
        if(panelQueue) {panelQueue.innerHTML = ''; const section=panelQueue.closest('.panel-queue-section'); if(section)section.style.display='none';}
      }
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
        timeText = `대기 · ${this.formatBuildTime(item.duration)}`;
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
    else if (this.currentView === 'shipyard') filterType = ['ship', 'defense'];
    const matches = (type) => !filterType || filterType === type || (Array.isArray(filterType) && filterType.includes(type));
    
    // Update Sidebars (Global view with conditional filtering)
    let globalHtml = '';
    
    // Add active items if they match filter
    if (matches('building')) globalHtml += renderQueueItem(building);
    if (matches('research')) globalHtml += renderQueueItem(research);
    if (matches('ship')) globalHtml += renderQueueItem(ship);
    if (matches('defense')) globalHtml += renderQueueItem(defense);
    
    // Add pending items if they match filter
    pendingQueue?.forEach(item => {
      if (matches(item.type)) {
        globalHtml += renderQueueItem(item, true);
      }
    });
    
    if (queueList) queueList.innerHTML = globalHtml;
    if (queueSidebarList) queueSidebarList.innerHTML = globalHtml;
    if (queueSidebarEmpty) queueSidebarEmpty.style.display = globalHtml ? 'none' : 'block';
    if (queueSidebarList) queueSidebarList.style.display = globalHtml ? 'block' : 'none';

    // Update Per-Panel Queues (Filtered view)
    const activeByType = { building, research, ship, defense };
    const renderPanelQueue = (types, containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      
      const pendingItems = pendingQueue?.filter(item => types.includes(item.type)) || [];
      
      let panelHtml = '';
      types.forEach(type => {
        if (activeByType[type]) panelHtml += renderQueueItem(activeByType[type]);
      });
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

    renderPanelQueue(['building'], 'buildings-panel-queue');
    renderPanelQueue(['research'], 'research-panel-queue');
    renderPanelQueue(['ship', 'defense'], 'shipyard-panel-queue');
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
    for (const type of ['building', 'research', 'ship', 'defense']) {
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
        for (const type of ['building', 'research', 'ship', 'defense']) {
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
      for (const type of ['building', 'research', 'ship', 'defense']) {
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

    const completedLabel = { building: '건설 완료', research: '연구 완료', ship: '건조 완료', defense: '배치 완료' }[completed.type] || '작업 완료';
    this.showNotification(completedLabel, `${completed.name}${completed.level ? ` Lv ${completed.level}` : ''}${completed.count ? ` ×${completed.count}` : ''}`, 'success');
    this.addActivityLog(`${completedLabel} — ${completed.name}`);
    
    if (!hasSnapshot && completed.type === 'building' && !completed.buildings) {
      gameState.upgradeBuilding(completed.itemId);
      this.renderBuildingSwiper();
    } else if (!hasSnapshot && completed.type === 'research' && !completed.research) {
      gameState.upgradeResearch(completed.itemId);
      this.renderResearchSwiper();
    } else if (completed.type === 'ship' || completed.type === 'defense') {
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
    notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = title;
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.textContent = message;
    notification.append(titleEl, messageEl);
    
    container.appendChild(notification);
    while (container.children.length > MAX_NOTIFICATIONS) container.firstElementChild.remove();
    
    setTimeout(() => {
      notification.classList.add('is-leaving');
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
      if (titleEl) titleEl.textContent = '사령부 접속';
      this.authSubmit.textContent = '접속';
      this.registerFields.style.display = 'none';
      this.authToggleText.textContent = '아직 임관하지 않으셨습니까?';
      this.authToggleBtn.textContent = '신규 등록';
    } else {
      if (titleEl) titleEl.textContent = '신규 등록';
      this.authSubmit.textContent = '등록';
      this.registerFields.style.display = 'block';
      this.authToggleText.textContent = '이미 계정이 있으십니까?';
      this.authToggleBtn.textContent = '접속';
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
        
        this.showNotification('접속 완료', '귀환을 환영합니다, 사령관.', 'success');
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
        
        this.showNotification('임관 완료', '새 사령관의 부임을 환영합니다.', 'success');
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
    if (this.formationView && !this.formationView.guard(() => this.handleLogout())) return;
    this.militarySocket?.disconnect();
    this.strikeMap?.endDrag();this.strikeMap?.closeConfirm();
    if (this.formationView) { this.formationView.dirty = false; this.formationView.selectedId = null; this.formationView.draft = null; this.formationView.signature = null; }
    this.scouts?.reset();
    apiService.logout();
    localStorage.removeItem('user');
    
    // UI 초기화
    this.userSection.innerHTML = `
      <button class="holo-btn-small" id="login-btn">로그인</button>
    `;
    document.getElementById('login-btn')?.addEventListener('click', () => this.showLoginScreen());
    
    // 관리자 버튼 숨김
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) adminBtn.classList.add('hidden');
    
    // 로그인 화면으로 전환
    this.showLoginScreen();
    
    this.showNotification('퇴청', '안전하게 로그아웃되었습니다.', 'info');
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
      
      // 서버 데이터/카탈로그 동기화 후 게임 초기화
      await this.syncUserDataFromServer();
      this.initializeDashboard();
      
      this.showNotification('설정 완료', '관리자 계정이 생성되었습니다.', 'success');
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
