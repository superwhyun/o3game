import { ResourceTradeView } from './views/ResourceTradeView.js';
import './resource-trade.css';
import { AccountSettingsView } from './views/AccountSettingsView.js';
import { applyDisplayMode, renderGraphics } from './views/displayModes.js';
import { RecordHistoryView } from './views/RecordHistoryView.js';
import { DirectColonyView } from './views/DirectColonyView.js';
import { AdminUserDetailsView } from './views/AdminUserDetailsView.js';
import { AiPlayersView } from './views/AiPlayersView.js';
import { battleOutcome, reportIsRead } from './views/battleReports.js';
import { ImprovementRequestsView } from './views/ImprovementRequestsView.js';
import { renderAreaWarning } from './views/areaWarning.js';
import { createRequestId } from '../utils/requestId.js';
import './population.css';
import './command-controls.css';
import { renderPopulationDetails, POPULATION_SETTING_LABELS } from './views/populationDetails.js';
import './planet-area.css';
import { ScoutController } from './views/ScoutController.js';
import { ScoutReportsView } from './views/ScoutReportsView.js';
import './scout.css';
import './entity-model.css';
import { stopInspector, disposeInspector } from '../three/entities/ModelViewer.js';
import { disposeThumbnails } from '../three/entities/ModelThumbnails.js';
import { io } from 'socket.io-client';
import { SERVER_URL } from '../services/serverUrl.js';
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
const MAX_NOTIFICATIONS = 1;
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
    this.populationRefreshTimer = setInterval(async () => {
      if (document.hidden || !apiService.isAuthenticated() || this.populationRefreshing) return;
      this.populationRefreshing = true;
      try {
        await this.syncUserDataFromServer({ minAge: 30000 });

      }
      finally { this.populationRefreshing = false; }
    }, 30000);
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
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.querySelectorAll('.panel-queue-section').forEach(section => {
        section.open = false;
      });
    }
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
    this.updateImprovementNavigation(user.isAdmin);
    
    this.userSection.innerHTML = `
      <div class="user-info">
        <span class="username">${escapeHtml(user.username)}</span>
        <button class="holo-btn-small" id="logout-btn" title="로그아웃">퇴청</button>
      </div>
    `;
    
    document.getElementById('logout-btn')?.addEventListener('click', () => this.handleLogout());
  }
  
  updateImprovementNavigation(isAdmin) {
    const label = isAdmin ? '개선 요청' : '개선 제안';
    document.querySelector('#improvements-btn .label').textContent = label;
    document.getElementById('improvements-title').textContent = label;
  }

  // Sync user data from server (prevents client-side cheating)
  syncUserDataFromServer({ minAge = 0 } = {}) {
    if (!apiService.isAuthenticated() || apiService.rateLimitedUntil > Date.now()) return Promise.resolve();
    const token = apiService.token;
    if (this.userSyncToken === token && this.userSyncPromise) return this.userSyncPromise;
    if (this.lastUserSyncToken === token && Date.now() - (this.lastUserSyncAt || 0) < minAge) return Promise.resolve();
    this.userSyncToken = token;
    const request = this.performUserSync(token);
    this.userSyncPromise = request;
    const clear = () => { if (this.userSyncPromise === request) this.userSyncPromise = null; };
    request.then(clear, clear);
    return request;
  }

  async performUserSync(token) {
    try {
      // Fetch latest user data from server
      const userData = await apiService.getCurrentUser();
      if (apiService.token !== token) return;
      
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
      this.lastUserSyncToken = token;
      this.lastUserSyncAt = Date.now();
      void this.syncBattleReports(false, { minAge: 60000 });
      
      // If admin panel is open, refresh stats to sync speed, etc.
      if (this.currentView === 'admin' && document.getElementById('tab-dashboard')?.classList.contains('active')) {
        this.loadAdminStatistics();
      }
      
      console.log('[syncUserDataFromServer] Synced. GameState resources:', gameState.resources);

      this.updateImprovementNavigation(userData.isAdmin);
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
    applyDisplayMode(gameState.preferences?.uiMode);
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
    const controls = document.getElementById('command-controls');
    const sidebar = document.querySelector('.holo-sidebar.left');
    const userMenu = document.getElementById('user-section');
    const accountFooter = document.querySelector('.sidebar-account');
    const header = document.querySelector('.holo-header');
    const narrowLayout = window.matchMedia('(max-width: 1200px)');
    const placeControls = () => {
      if (!controls || !sidebar || !header) return;
      // The sidebar becomes bottom navigation on small screens.
      if (narrowLayout.matches) {
        header.append(controls);
        if (userMenu) controls.append(userMenu);
      } else {
        sidebar.prepend(controls);
        if (userMenu && accountFooter) accountFooter.append(userMenu);
      }
    };
    placeControls();
    narrowLayout.addEventListener('change', placeControls);

    
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
      trade: document.getElementById('trade-panel'),
      battleRecords: document.getElementById('battle-records-panel'),
      scoutRecords: document.getElementById('scout-records-panel'),
      improvements: document.getElementById('improvements-panel'),
      accountSettings: document.getElementById('account-settings-panel'),
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
    const energyCell = document.querySelector('[data-resource="energy"]');
    energyCell.setAttribute('role', 'button');
    energyCell.tabIndex = 0;
    energyCell.setAttribute('aria-label', '에너지 생산·소비 상세 보기');
    const showEnergy = () => this.showModal(`<div class="modal-header"><h2>에너지 현황</h2></div><div class="energy-details"><p>생산 ${formatAmount(gameState.energyProduction)}</p>${(gameState.planet.energyState?.sources || []).map(source => `<p>${escapeHtml(source.name || source.id)}${source.id === 'solarSatellite' ? ` ${formatAmount(source.count)}기 × ${formatAmount(source.perUnit)}` : ''}: <strong>${formatAmount(source.amount)}</strong></p>`).join('')}<p>소비 ${formatAmount(gameState.energyConsumption)}</p><p>잔여 ${formatAmount(gameState.energyProduction - gameState.energyConsumption)}</p></div>`);
    energyCell.addEventListener('click', showEnergy);
    energyCell.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); showEnergy(); } });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-open-entity]');
      if (!button) return;
      this.hideModal();
      this.switchView(button.dataset.entityView);
      this.getBrowser(button.dataset.entityView)?.selectEntity(button.dataset.openEntity);
    });
    document.getElementById('combat-missions')?.addEventListener('click', async event => {
      if (event.target.closest('[data-open-battle-records]')) { this.switchView('battleRecords'); return; }
      const button = event.target.closest('[data-recall]');
      if (!button) return;
      const account = gameState.userId;
      button.disabled = true;
      try {
        const { snapshot } = await apiService.recallFleet(button.dataset.recall);
        if (account !== gameState.userId) return;
        if (snapshot) gameState.syncFromServer(snapshot);
        this.renderFleet();
        this.showNotification('함대 귀환', '임무를 취소했습니다. 지금까지 비행한 시간만큼 이동한 뒤 복귀합니다.', 'info');
      } catch (error) {
        if (account === gameState.userId) { this.showNotification('귀환 요청', error.message, 'error'); void this.syncMilitaryState(); }
      } finally { button.disabled = false; }
    });
    document.getElementById('battle-records-refresh')?.addEventListener('click', () => this.getRecordHistory('battle').load());
    document.getElementById('battle-records-more')?.addEventListener('click', () => this.syncBattleReports(true));
    for (const root of [document.getElementById('battle-records-list')]) {
      root?.addEventListener('click', async event => {
        const button = event.target.closest('[data-report-read]');
        if (!button) return;
        const account = gameState.userId;
        button.disabled = true;
        try {
          await apiService.markBattleReportRead(button.closest('[data-report-id]').dataset.reportId);
          if (account === gameState.userId) {
            const report = this.battleReports?.find(item => String(item._id) === button.closest('[data-report-id]').dataset.reportId);
            if (report) report[String(report.attacker.userId) === String(account) ? 'attackerRead' : 'defenderRead'] = true;
            this.renderBattleRecords();
            await this.syncBattleReports();
          }
        } catch (error) {
          if (account === gameState.userId) this.showNotification('전투 기록', error.message, 'error');
        } finally { button.disabled = false; }
      });
    }
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
    document.getElementById('resource-trade-form')?.addEventListener('submit', event => { event.preventDefault(); this.submitResourceTrade(); });
    this.modalClose.addEventListener('click', () => this.hideModal());
    this.modalOverlay.addEventListener('keydown', event => {
      if (!this.pendingModalConfirmation) return;
      if (event.key === 'Escape') { event.preventDefault(); this.hideModal(); }
      if (event.key === 'Tab') {
        const buttons = [...this.modalOverlay.querySelectorAll('button:not([disabled])')];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    document.getElementById('scout-records-refresh')?.addEventListener('click', () => this.getRecordHistory('scout').load());
    document.getElementById('planet-rename')?.addEventListener('click', () => this.showPlanetRename());
    document.getElementById('planet-development')?.addEventListener('click', () => this.showPlanetDevelopment());
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
  
  switchView(view, options = {}) {
    if (view !== this.currentView && this.currentView === 'fleet' && this.formationView && !this.formationView.guard(() => this.switchView(view, options))) return;
    this.galaxyView?.nav.close?.();
    this.strikeMap?.nav.close?.();
    stopInspector();
    this.currentView = view;
    if(view!=='galaxy')this.galaxyView?.setActive(false);
    if(view!=='combat')this.strikeMap?.setActive(false);
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
    if (view === 'galaxy') { this.renderGalaxy(options.target); this.syncMilitaryState(); }
    if (view === 'fleet' || view === 'combat') { this.renderFleet(); this.syncMilitaryState(); }
    if (view === 'buildings') this.renderBuildingSwiper();
    if (view === 'research') this.renderResearchSwiper();
    if (view === 'shipyard') this.renderShipyardSwiper();
    if (view === 'trade') this.renderTradeQuote();
    if (view === 'battleRecords') { void this.getRecordHistory('battle').show(); }
    if (view === 'scoutRecords') { void this.getRecordHistory('scout').show(); }
    if (view === 'accountSettings') {
      this.accountSettingsView ||= new AccountSettingsView(document.getElementById('account-settings-content'), {
        api: apiService,
        onMode: mode => { gameState.preferences = { uiMode: mode }; applyDisplayMode(mode); },
        onToken: () => { this.militarySocket?.disconnect(); this.militarySocket = null; this.syncMilitarySocket(); void this.syncUserDataFromServer(); }
      });
      void this.accountSettingsView.show();
    }
    if (view === 'dashboard') { applyDisplayMode(gameState.preferences?.uiMode); renderGraphics(document.getElementById('mode-graphics'), gameState); }
    if (view === 'admin') this.initAdminPanel();
    if (view === 'improvements') {
      this.improvementsView ||= new ImprovementRequestsView(document.getElementById('improvements-content'), apiService, () => adminService.isAdmin());
      this.improvementsView.show();
    }
    
    // Refresh queue display to apply view-based filtering immediately
    this.updateBuildQueueUI(
      this.queueItems.building,
      this.queueItems.research,
      this.queueItems.ship,
      this.lastPendingQueue
    );
  }
  
  updateResourceDisplay() {
    if (this.currentView === 'dashboard') renderGraphics(document.getElementById('mode-graphics'), gameState);
    this.renderPopulation();
    if (this.currentView === 'trade') this.renderTradeQuote();
    const { resources, productionRates, energyProduction, energyConsumption, storage } = gameState;
    const round1 = (num) => Math.round(num * 10) / 10;

    for (const resource of ['metal', 'crystal', 'deuterium']) {
      const el = this.resourceElements[resource];
      if (!el.count) continue;
      const rate = round1(productionRates[resource]);
      const pct = storage[resource] ? Math.min((resources[resource] / storage[resource]) * 100, 100) : 0;
      el.count.textContent = GameData.formatNumber(round1(resources[resource]));
      el.rate.textContent = (rate >= 0 ? '+' : '') + GameData.formatNumber(rate) + '/h';
      const cell = el.count.closest('[data-resource]');
      if (cell) cell.title = `${cell.querySelector('.resource-name').textContent.trim()} ${formatAmount(resources[resource])} · 생산 ${el.rate.textContent} · 저장 ${formatAmount(storage[resource])}`;
      if (el.fill) el.fill.textContent = `${pct.toFixed(1)}%`;
      el.ring?.style.setProperty('--fill', (pct / 100).toFixed(4));
      el.ring?.closest('[data-resource]')?.classList.toggle('is-full', pct >= 99.5);
    }

    const energy = this.resourceElements.energy;
    const storageWarnings = document.getElementById('storage-warnings');
    const full = ['metal', 'crystal', 'deuterium'].filter(id => storage[id] > 0 && resources[id] >= storage[id]);
    const stores = { metal: ['금속', 'metalStorage'], crystal: ['수정', 'crystalStorage'], deuterium: ['중수소', 'deuteriumTank'] };
    storageWarnings.hidden = !full.length;
    const warningHtml = full.map(id => `<span>${stores[id][0]} 저장 한도 도달 · 추가 생산분 저장 안 됨 <button type="button" class="holo-btn-small" data-open-entity="${stores[id][1]}" data-entity-view="buildings">저장고 건설</button></span>`).join('');
    if (storageWarnings.innerHTML !== warningHtml) storageWarnings.innerHTML = warningHtml;
    if (energy.count) {
      const energyDiff = round1(energyProduction - energyConsumption);
      energy.count.textContent = (energyDiff >= 0 ? '+' : '') + GameData.formatNumber(energyDiff);
      energy.rate.textContent = '생산 ' + GameData.formatNumber(round1(energyProduction)) + ' · 소비 ' + GameData.formatNumber(round1(energyConsumption));
      const cell = energy.count.closest('[data-resource]');
      if (cell) cell.title = `에너지 생산 ${formatAmount(energyProduction)} · 소비 ${formatAmount(energyConsumption)}`;
      energy.count.closest('[data-resource]')?.classList.toggle('is-negative', energyDiff < 0);
      const usage = energyProduction > 0 ? Math.min((energyConsumption / energyProduction) * 100, 100) : 100;
      energy.ring?.style.setProperty('--fill', (usage / 100).toFixed(4));
    }
  }
  
  renderTradeQuote() {
    const root = document.getElementById('resource-trade-form');
    if (!root) return null;
    this.tradeView ??= new ResourceTradeView({ root, getState: () => gameState, isPending: () => Boolean(this.tradePending) });
    return this.tradeView.render();
  }

  async submitResourceTrade() {
    if (this.tradePending) return;
    const input = this.renderTradeQuote();
    if (!input) return;
    const planetId = gameState.planet.id;
    this.tradePending = true;
    this.renderTradeQuote();
    const message = document.getElementById('trade-message');
    message.textContent = '교환 중…';
    try {
      const result = await apiService.exchangeResources(planetId, input.from, input.to, input.amount);
      gameState.syncFromServer(result.snapshot);
      if (result.snapshot.queueState) this.hydrateQueueState(result.snapshot.queueState);
      this.refreshSyncedViews();
      message.textContent = `교환 완료 · 받은 자원 ${formatAmount(result.quote.received)}`;
      this.addActivityLog(`자원 교환 — ${input.from} ${input.amount} → ${input.to} ${result.quote.received}`);
    } catch (error) {
      message.textContent = `교환 실패: ${error.message}`;
    } finally {
      this.tradePending = false;
      this.renderTradeQuote();
    }
  }

  renderPopulation() {
    const p = gameState.planet.populationState;
    if (!p) {
      for (const id of ['header-population-count', 'header-population-housing', 'food-count', 'food-rate']) {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
      }
      for (const id of ['header-population-meter', 'food-ring']) document.getElementById(id)?.style.setProperty('--fill', '0');
      document.querySelector('[data-resource="food"]')?.classList.remove('is-negative', 'is-full');
      const overview = document.getElementById('dashboard-population');
      if (overview) overview.textContent = '인구 정보를 불러오는 중입니다.';
      return;
    }
    const rate = Math.round(p.foodNet * 10) / 10;
    const food = gameState.resources.food || 0;
    const foodCapacity = p.foodCapacity || 0;
    const foodFill = foodCapacity > 0 ? Math.min(1, Math.max(0, food / foodCapacity)) : 0;
    document.getElementById('header-population-count').textContent = GameData.formatNumber(p.count);
    document.getElementById('header-population-housing').textContent = `주거 ${GameData.formatNumber(Math.floor(p.housing))}`;
    document.getElementById('header-population-meter').style.setProperty('--fill', String(p.housing > 0 ? Math.min(1, p.count / p.housing) : 0));
    document.querySelector('[data-resource="population"]').title = `인구 ${formatAmount(p.count)} / 주거 ${formatAmount(p.housing)} · 취업 ${formatAmount(p.employed)} · 행복 ${Math.round(p.happiness)} · 지식 ${Math.round(p.knowledge || 0)}`;
    document.getElementById('food-count').textContent = GameData.formatNumber(Math.round(food * 10) / 10);
    document.getElementById('food-rate').textContent = `${rate >= 0 ? '+' : ''}${GameData.formatNumber(rate)}/h`;
    document.getElementById('food-ring').style.setProperty('--fill', String(foodFill));
    document.getElementById('food-fill').textContent = `${(foodFill * 100).toFixed(1)}%`;
    const foodCell = document.querySelector('[data-resource="food"]');
    foodCell.title = `식량 ${formatAmount(food)} / 저장 ${formatAmount(foodCapacity)} · 생산 ${formatAmount(p.foodProduction)}/h · 소비 ${formatAmount(p.foodConsumption)}/h · 수지 ${rate >= 0 ? '+' : ''}${GameData.formatNumber(rate)}/h`;
    foodCell.classList.toggle('is-negative', rate < 0);
    foodCell.classList.toggle('is-full', foodFill >= .995);
    const overview = document.getElementById('dashboard-population');
    if (overview) overview.innerHTML = renderPopulationDetails(gameState);
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
    const order = { building: ['resources', 'manufacturing', 'population'], research: ['population', 'planet', 'combat', 'drive'] }[type];
    const categories = catalog.categories(type);
    if (order) categories.sort((a, b) => {
      const rank = category => order.includes(category) ? order.indexOf(category) : order.length;
      return rank(a) - rank(b);
    });
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

    const isActive = (type) => (entity) => (type === 'building' && entity.id === 'researchLab' && gameState.researchInfrastructure?.researchBusy) || [this.queueItems[type], ...this.lastPendingQueue].filter(Boolean).some(item => item.type === type && item.itemId === entity.id && (type === 'research' || String(item.planetId ?? 0) === String(gameState.currentPlanet ?? 0)));
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

    this.browsers[view] = new EntityBrowser({
      root, getState: () => gameState, ...configs[view],
      onDetails: content => {
        this.showModal(`<div class="modal-header"><h2>상세 정보</h2></div><div class="entity-full-details">${content}</div>`);
        this.modalClose?.focus();
      }
    });
    return this.browsers[view];
  }

  renderBuildingSwiper() {
    this.getBrowser('buildings')?.render();
  }

  renderResearchSwiper() {
    const network = document.getElementById('research-network-summary');
    const labs = gameState.researchInfrastructure;
    if (network) network.textContent = `사용자 공통 연구 · 연구망 Lv ${labs?.networkLevel || 0} · 현재 연구소 Lv ${labs?.originLabLevel || 0} · 최대 ${(labs?.networkLevel || 0) + 1}곳 연결`;
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
    if(!this.scoutClock)this.scoutClock=setInterval(()=>{this.galaxyScoutView?.tick();if(this.currentView==='galaxy'&&!document.hidden)this.galaxyView?.traffic.tick();},1000);
    return this.scouts;
  }
  updateScoutUI() {
    if (!this.scouts || !apiService.isAuthenticated()) return;
    if (this.currentView === 'galaxy' && this.scouts.target && this.galaxyView?.scoutEl) {
      this.galaxyScoutView ??= new ScoutReportsView(this.galaxyView.scoutEl,{controller:this.scouts,state:gameState,onNavigate:view=>this.switchView(view),onMissions:()=>this.switchView('combat'),onCoordinate:target=>this.showGalaxyTarget(target)});
      const position=this.galaxyView.data?.positions.find(p=>p.position===this.galaxyView.selected);
      if(position)this.galaxyScoutView.render(position);
    }
  }
  async showGalaxyTarget(target) {
    this.switchView('galaxy', { target });
    if (this.currentView !== 'galaxy') return;
    await this.galaxyLoad;
    if (this.currentView === 'galaxy' && this.galaxyView.data && this.galaxyView.coords.galaxy === target.galaxy && this.galaxyView.coords.system === target.system)
      this.galaxyView.select(target.planet);
  }

  showDirectColony(destination) {
    const planet = gameState.planet;
    const assigned = gameState.fleetFormations.filter(f => f.status === 'ready' && String(f.originPlanetId) === String(planet.id))
      .reduce((n,f) => n + (f.ships?.colonyShip || 0), 0);
    if ((gameState.fleet.colonyShip || 0) - assigned < 1) {
      this.showNotification('식민선 필요', '미배정 식민선이 없습니다. 식민선을 건조하거나 편성된 함대에서 보내십시오.', 'error');
      return;
    }
    this.showModal('<div class="direct-colony"></div>');
    new DirectColonyView(document.getElementById('modal-content').querySelector('.direct-colony'), {
      state:gameState, destination, onLaunch:order=>this.launchFleetOrder(order), onClose:()=>this.hideModal(),
      isPending:Boolean(this.pendingOrders()[`colony:${planet.id}`]),
    });
  }

  renderGalaxy(target) {
    const root = document.getElementById('galaxy-holo');
    if (!root) return;
    this.galaxyView ??= new GalaxyView({
      root,
      controls: {
        prev: document.getElementById('galaxy-prev'),
        next: document.getElementById('galaxy-next'),
        galaxy: document.getElementById('galaxy-input'),
        system: document.getElementById('system-input'),
        home: document.getElementById('galaxy-home'),
        apply: document.getElementById('galaxy-apply')
      },
      onSelect: (position, coords) => {
        const scouts=this.getScoutController();
        void scouts.selectTarget({...coords,planet:position.position});
        this.updateScoutUI();
      },
      onMissions: () => this.switchView('combat'),
      getAccount: () => apiService.token,
      fetchTraffic: (galaxy, system, options) => apiService.getGalaxyTraffic(galaxy, system, options),
      fetchSystem: (galaxy, system) => apiService.getGalaxySystem(galaxy, system),
      getHome: () => ({ galaxy: gameState.planet.galaxy, system: gameState.planet.system }),
      getPlanets: () => gameState.planets,
      onColonize: target => this.showDirectColony(target),
      onTarget: (target) => {
        this.pendingFleetTarget = target;
        this.switchView('combat');
        this.showNotification('작전 목표 지정', `[${target.galaxy}:${target.system}:${target.planet}] 를 함대 작전 목표로 지정했습니다.`, 'success');
      }
    });
    this.galaxyLoad = this.galaxyView.show(target);
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
    const order = {...input,requestId: input.requestId || createRequestId()};
    const pending = this.pendingOrders();
    const pendingId = order.formationId || `colony:${order.originPlanetId}`;
    if (pending[pendingId]) throw Object.assign(new Error("출격 결과를 확인 중입니다."), {status:409});
    pending[pendingId] = order;
    this.persistPending();
    this.renderFleet();
    try {
      const result = await apiService.launchFleet(order);
      delete pending[pendingId];this.persistPending();
      if (result.snapshot) gameState.syncFromServer(result.snapshot);
      else await this.syncMilitaryState();
      this.pendingFleetTarget = null;
      this.refreshSyncedViews();
      this.showNotification('함대 출격', `${result.fleet.formationName} · ${order.mission === 'colonize' ? '식민지 개척' : order.mission === 'attack' ? '공격' : order.mission === 'deploy' ? '이동' : '수송'} 임무를 시작했습니다.`, 'success');
      return result;
    } catch (error) {
      if (error.status && error.status < 500) {
        delete pending[pendingId];this.persistPending();
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
  async syncMilitaryState({ event = false } = {}) {
    if (document.hidden) { if (event) this.militaryDirty = true; return; }
    event ||= Boolean(this.militaryDirty);
    if (this.militarySyncing || !apiService.isAuthenticated() || !catalog.loaded || apiService.rateLimitedUntil > Date.now()) return;
    // Merge timer, focus and socket refresh triggers into at most one batch per 3 seconds.
    const syncKey = apiService.token;
    if (this.militarySyncKey === syncKey && Date.now() - (this.lastMilitarySync || 0) < 3000) return;
    this.militaryDirty = false;
    this.militarySyncKey = syncKey;
    this.lastMilitarySync = Date.now();
    if(this.currentView==='galaxy' && !document.hidden)void this.galaxyView?.refreshTraffic();
    if(this.currentView==='combat' && !document.hidden)void this.strikeMap?.refreshTraffic();
    this.militarySyncing=true;
    try {
      const origin = gameState.planet.id;
      await this.syncUserDataFromServer({ minAge: event ? 0 : 15000 });
      if (origin && origin !== gameState.planet.id) { this.strikeMap?.endDrag(); this.strikeMap?.closeConfirm(); }
      await this.recoverPendingOrders();
      await this.syncBattleReports(false, { minAge: event ? 0 : 60000 });
      const scoutsVisible = this.currentView === 'galaxy';
      if (event || scoutsVisible) await this.getScoutController().refresh(
        this.currentView === 'galaxy' ? this.getScoutController().target : null,
        { minAge: event ? 0 : 30000 });
      if (this.currentView === 'galaxy' && !document.hidden) await this.galaxyView?.refreshMap({ background: !event });
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
      },15000);
      document.addEventListener('visibilitychange',()=>{
        this.galaxyView?.setActive(!document.hidden && this.currentView==='galaxy');
        this.strikeMap?.setActive(!document.hidden && this.currentView==='combat');
        if(!document.hidden && (this.militaryDirty || ['fleet','combat','galaxy'].includes(this.currentView)))this.syncMilitaryState();
      });
      window.addEventListener('focus',()=>{if(['fleet','combat','galaxy'].includes(this.currentView))this.syncMilitaryState();});
      document.getElementById('fleet-to-combat')?.addEventListener('click',()=>this.switchView('combat'));

    }
    if(this.militarySocket?.authToken===apiService.token && this.militarySocket.active)return;
    this.militarySocket?.disconnect();
    const socket=io(SERVER_URL,{transports:['websocket']});
    socket.authToken=apiService.token;this.militarySocket=socket;
    socket.on('connect',()=>socket.emit('authenticate',socket.authToken));
    socket.on('authenticated',()=>this.syncMilitaryState());
    socket.on('fleetStateChanged',()=>this.syncMilitaryState({ event: true }));
    socket.on('serverSpeedChanged', () => { void this.syncUserDataFromServer(); });
    socket.on('gameConfigUpdated', () => { void this.syncUserDataFromServer(); });
  }

  getRecordHistory(type) {
    this.recordHistories ||= {};
    return this.recordHistories[type] ||= new RecordHistoryView(document.getElementById(type === 'scout' ? 'scout-records-content' : 'battle-records-list'), {
      api: apiService, state: gameState, type,
      onCoordinate: target => this.showGalaxyTarget(target),
      onChanged: () => { if (type === 'battle') void this.syncBattleReports(); }
    });
  }

  renderBattleRecords() {
    const badge = document.getElementById('battle-unread-count');
    badge.textContent = this.battleUnreadCount ? `(${this.battleUnreadCount})` : '';
    badge.hidden = !this.battleUnreadCount;
    document.getElementById('battle-records-more').hidden = true;
  }

  async syncBattleReports(append = false, { minAge = 0 } = {}) {
    if (!apiService.isAuthenticated()) return;
    const account = gameState.userId;
    if (!append && this.lastBattleAccount === account && Date.now() - (this.lastBattleSyncAt || 0) < minAge) return;
    if (this.battleAccount !== account) {
      this.battleAccount = account;
      this.battleReports = [];
      this.battleNotified = new Set();
      this.battleNextCursor = null;
      this.battleUnreadCount = 0;
      this.battleHistoryExpanded = false;
      this.renderBattleRecords();
    }
    if (this.battleLoading === account) return;
    this.battleLoading = account;
    const status = document.getElementById('battle-records-status');
    status.textContent = '전투 기록을 불러오는 중…';
    try {
      const result = await apiService.getBattleReports(append ? this.battleNextCursor : null);
      if (account !== gameState.userId) return;
      if (!append) { this.lastBattleAccount = account; this.lastBattleSyncAt = Date.now(); }
      const previous = this.battleReports || [];
      const all = append ? [...previous, ...result.reports] : this.battleHistoryExpanded ? [...result.reports, ...previous.filter(item => !result.reports.some(report => String(report._id) === String(item._id)))] : result.reports;
      this.battleReports = [...new Map(all.map(report => [String(report._id), report])).values()];
      if (append || !this.battleHistoryExpanded) this.battleNextCursor = result.nextCursor;
      if (append) this.battleHistoryExpanded = true;
      this.battleUnreadCount = result.unreadCount || 0;
      const fresh = result.reports.filter(report => !reportIsRead(report, account) && !this.battleNotified.has(String(report._id)));
      for (const report of fresh) this.battleNotified.add(String(report._id));
      if (fresh.length && !append) {
        const latest = fresh[0];
        const loot = latest.result?.loot || {};
        this.showNotification(`새 전투 기록 ${fresh.length}건 · ${battleOutcome(latest, account)}`, `${String(latest.attacker?.userId) === String(account) ? '약탈' : '약탈당한'} 금속 ${formatAmount(loot.metal)}, 수정 ${formatAmount(loot.crystal)}, 중수소 ${formatAmount(loot.deuterium)} · 전투 기록 메뉴에서 확인`, 'info');
      }
      this.renderBattleRecords();
      status.textContent = '';
    } catch (error) {
      if (account === gameState.userId) status.textContent = error.message;
    } finally { if (this.battleLoading === account) this.battleLoading = null; }
  }

  renderStrikeMap() {
    const root=document.getElementById('strike-map');if(!root)return;
    this.strikeMap ??= new StrikeMap({
      root,fetchSystem:(galaxy,system)=>apiService.getGalaxySystem(galaxy,system),
      fetchTraffic: (galaxy, system) => apiService.getGalaxyTraffic(galaxy, system),
      getAccount: () => gameState.userId,
      getSpeedSettings: () => ({ serverSpeed: gameState.serverSpeed, flightSpeedMultiplier: gameState.flightSpeedMultiplier }),
      getHome:()=>({...gameState.planet}),
      getPlanets: () => gameState.planets,
      getResources: () => gameState.resources,
      getDevelopment: () => ({ terraformLevel: gameState.research.terraforming || 0, bonusFields: gameState.areaSettings.bonusUsableFields }),
      onScout: target => { void this.showGalaxyTarget(target); },
      getFormations:()=>gameState.fleetFormations.filter(f=>f.status==='ready'&&String(f.originPlanetId)===String(gameState.planet.id)&&profileOf(f.ships).ships>0),
      isPending:id=>Boolean(this.pendingOrders()[id]),
      getBase: id => gameState.planets.find(p => String(p._id) === String(id)),
      onManage:()=>this.switchView('fleet'),
      onLaunch:order=>this.launchFleetOrder(order)
    });
    if(this.currentView!=='combat'){this.strikeMap.refresh();return;}
    this.strikeMap.setActive(!document.hidden);
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
    root.innerHTML=`<header class="mission-section-heading"><div><p class="fleet-eyebrow">ACTIVE MISSIONS</p><h3>전체 행성의 진행 중인 임무 <span>${gameState.fleetMovements.length}</span></h3></div><small id="military-sync-status" role="status">서버 상태 동기화</small></header><div class="mission-card-grid">${gameState.fleetMovements.map(m=>`<article class="mission-card" data-movement="${escapeHtml(m.id)}"><div class="mission-card-top"><div class="mission-ships">${shipImages(m.fleet,2)}</div><div><strong>${escapeHtml(m.formationName || '기존 임무')}</strong><span class="fleet-status">${m.status==='returning'?'귀환 중':'진군 중'}</span></div><b data-mission-countdown></b></div><div class="mission-route"><span>[${m.origin.galaxy}:${m.origin.system}:${m.origin.planet}]</span><span>${m.status==='returning'?'←':'→'}</span><span>[${m.destination.galaxy}:${m.destination.system}:${m.destination.planet}]</span></div><progress max="1" value="0" aria-label="임무 진행률"></progress><div class="mission-card-bottom"><span>${m.mission==='colonize'?'식민지 개척':m.mission==='spy'?'정찰':m.mission==='attack'?'공격':m.mission==='deploy'?'이동':'수송'} · ${formatAmount(profileOf(m.fleet).ships)}척${m.colonists ? ` · 인구 ${formatAmount(m.colonists)}명` : ""}</span><small>${m.notice?escapeHtml(m.notice):m.status==='returning'?'귀환 완료 후 다시 출격할 수 있습니다.':'목표 행성으로 이동하고 있습니다.'}</small></div>${m.status === 'flying' ? `<button class="cmd-btn mission-recall" data-recall="${escapeHtml(m.id)}">임무 취소 · 귀환</button>` : ''}${m.battleReportId ? '<button class="cmd-btn" data-open-battle-records>전투 결과 보기</button>' : ''}</article>`).join('')||'<div class="mission-empty">아직 진행 중인 임무가 없습니다. 위에서 함대를 선택해 출격하십시오.</div>'}</div>`;
    fillThumbnails(root);this.tickCombatMissions();
    if(!this.missionCountdownTimer)this.missionCountdownTimer=setInterval(()=>{if(this.currentView==='combat')this.tickCombatMissions();},1000);
  }
  tickCombatMissions() {
    const now=Date.now()+(gameState.serverOffset || 0);
    for(const movement of gameState.fleetMovements) {
      const row=[...document.querySelectorAll('[data-movement]')].find(el=>el.dataset.movement===movement.id);if(!row)continue;
      const end=new Date(movement.status==='returning'?movement.returnTime:movement.arrivalTime).getTime();
      const duration = movement.status === 'returning' && movement.returnStartTime ? new Date(movement.returnTime) - new Date(movement.returnStartTime) : new Date(movement.arrivalTime) - new Date(movement.startTime);
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
    if (this.demolitionPending) return;
    const name = catalog.get('building', buildingId)?.name || buildingId;
    const level = gameState.buildings[buildingId] || 0;
    if (level < 1) return;
    const account = gameState.userId;
    const planetId = gameState.planet.id;
    const planetIndex = String(gameState.currentPlanet ?? 0);
    const entity = catalog.get('building', buildingId);
    const nextStorage = { ...gameState.storage };
    for (const [resource, rule] of Object.entries(entity?.effects?.storage || {})) {
      nextStorage[resource] = Math.max(gameState.defaultStorage?.[resource] ?? 10000, evaluateEffect(rule, Math.max(0, level - 1)));
    }
    const labels = { metal: '금속', crystal: '수정', deuterium: '중수소', food: '식량' };
    const loss = Object.entries(nextStorage).filter(([key, cap]) => gameState.resources[key] > cap)
      .map(([key, cap]) => `${labels[key] || key} ${formatAmount(gameState.resources[key] - cap)}`).join(', ');
    this.demolitionPending = true;
    try {
      const confirmed = await this.confirmBuildingDemolition(name, level, loss);
      if (!confirmed) return;
      if (account !== gameState.userId || planetId !== gameState.planet.id || level !== (gameState.buildings[buildingId] || 0)) {
        this.showNotification('철거 취소', '행성이나 건물 상태가 변경되었습니다. 다시 확인해 주세요.', 'info');
        return;
      }
      const result = await apiService.demolishBuilding(buildingId, planetIndex);
      gameState.syncFromServer(result.snapshot); this.hydrateQueueState(result.snapshot.queueState); this.refreshSyncedViews();
      this.showNotification('철거 예약', name, 'success');
    } catch (error) {
      if (account !== gameState.userId) return;
      this.showNotification('명령 실패', error.message, 'error');
      await this.syncUserDataFromServer();
    } finally { this.demolitionPending = false; }
  }

  confirmBuildingDemolition(name, level, loss) {
    this.showModal(`<section id="demolition-confirmation" aria-labelledby="demolition-title">
      <div class="modal-header"><h2 id="demolition-title">건물 철거 확인</h2></div>
      <p><strong>${escapeHtml(name)}</strong> Lv ${level} → Lv ${level - 1}</p>
      <p>철거 완료 시 면적 1칸을 회수합니다. 자원은 환급되지 않습니다.</p>
      ${loss ? `<p class="area-warning">저장 한도 감소 예상 손실: ${escapeHtml(loss)}</p>` : ''}
      <div class="confirm-actions"><button type="button" class="cmd-btn" data-demolition-cancel>취소</button><button type="button" class="cmd-btn primary" data-demolition-confirm>철거 예약</button></div>
    </section>`);
    return new Promise(resolve => {
      this.pendingModalConfirmation = resolve;
      const cancel = document.querySelector('[data-demolition-cancel]');
      cancel.addEventListener('click', () => this.hideModal());
      document.querySelector('[data-demolition-confirm]').addEventListener('click', () => {
        const settle = this.pendingModalConfirmation;
        this.pendingModalConfirmation = null;
        this.hideModal();
        settle?.(true);
      }, { once: true });
      cancel.focus();
    });
  }

  showPlanetRename() {
    const planetId = gameState.planet.id;
    if (!planetId) return;
    this.showModal(`<div class="modal-header"><h2>콜로니 이름 변경</h2></div>
      <form id="planet-rename-form" class="planet-rename-form">
        <label class="field" for="planet-rename-input">새 이름
          <input id="planet-rename-input" name="name" type="text" value="${escapeHtml(gameState.planet.name)}" required autocomplete="off" aria-describedby="planet-rename-hint planet-rename-error">
        </label>
        <p id="planet-rename-hint" class="detail-muted">1~30자로 입력해 주세요.</p>
        <p id="planet-rename-error" class="area-warning" role="alert"></p>
        <div class="planet-rename-actions">
          <button type="button" class="cmd-btn" id="planet-rename-cancel">취소</button>
          <button type="submit" class="cmd-btn primary">저장</button>
        </div>
      </form>`);
    const form = document.getElementById('planet-rename-form');
    const input = form.elements.name;
    const errorEl = document.getElementById('planet-rename-error');
    document.getElementById('planet-rename-cancel').addEventListener('click', () => {
      this.hideModal(); document.getElementById('planet-rename')?.focus();
    });
    input.focus(); input.select();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name || [...name].length > 30 || /[\u0000-\u001f\u007f]/u.test(name)) {
        errorEl.textContent = '콜로니 이름은 한 줄로 1~30자를 입력해 주세요.';
        input.focus(); return;
      }
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      submit.disabled = true; submit.textContent = '저장 중…'; errorEl.textContent = '';
      try {
        const result = await apiService.renamePlanet(planetId, name);
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
        this.refreshSyncedViews();
        // A different modal may have been opened while the request was running.
        if (form.isConnected) {
          this.hideModal(); document.getElementById('planet-rename')?.focus();
        }
        this.showNotification('이름 변경', `${result.name}(으)로 변경했습니다.`, 'success');
      } catch (error) {
        errorEl.textContent = error.message;
      } finally {
        submit.disabled = false; submit.textContent = '저장';
      }
    });
  }

  showPlanetDevelopment() {
    if (!gameState.planet.area) return;
    this.renderPlanetArea();
    this.showModal(`<div class="modal-header"><h2>행성 개발 현황</h2></div>
      <section id="planet-development-details" class="planet-area">${this.planetAreaDetails}</section>
      <div class="planet-abandon-entry"><button type="button" class="cmd-btn" id="planet-abandon-open" ${(gameState.planets || []).length < 2 ? 'disabled' : ''}>행성 포기</button><p class="detail-muted">${(gameState.planets || []).length < 2 ? '마지막 행성은 포기할 수 없습니다.' : '개발 수준에 따른 해적 거점으로 전환됩니다. 소탕 전에는 다시 개척할 수 없습니다.'}</p></div>`);
    document.getElementById('planet-abandon-open')?.addEventListener('click', () => this.showPlanetAbandon());
    this.modalClose?.focus();
  }

  showPlanetAbandon() {
    const planet = { ...gameState.planet };
    if (!planet.id || (gameState.planets || []).length < 2) return;
    this.showModal(`<section class="planet-abandon" aria-labelledby="planet-abandon-title">
      <div class="modal-header"><h2 id="planet-abandon-title">행성 포기</h2></div>
      <p><strong>${escapeHtml(planet.name)}</strong> [${planet.galaxy}:${planet.system}:${planet.planet}]의 소유권을 해제합니다.</p>
      <p class="area-warning">자원·인구·함선·방어시설·함대 편성은 승계되지 않습니다. 건물 개발 수준으로 해적 레벨을 정하고 표준 병력과 시설로 전환됩니다. 해적 병력은 상한까지 재건되며, 완전히 소탕해야 빈 행성으로 돌아갑니다. 되돌릴 수 없습니다.</p>
      <p class="detail-muted">완료한 공통 연구와 다른 행성의 자산은 유지됩니다. 이 행성의 작업이나 출발·접근 함대가 진행 중이면 포기할 수 없습니다. 연구소가 있는 행성은 공통 연구가 끝난 뒤 포기할 수 있습니다. 필요한 함선과 자원은 먼저 옮겨 주세요.</p>
      <form id="planet-abandon-form" class="planet-rename-form">
        <label class="field" for="planet-abandon-name">확인을 위해 행성 이름을 입력하세요.
          <input id="planet-abandon-name" name="confirmationName" type="text" autocomplete="off" required maxlength="30" placeholder="${escapeHtml(planet.name)}">
        </label>
        <p id="planet-abandon-error" class="area-warning" role="alert"></p>
        <div class="planet-rename-actions"><button type="button" class="cmd-btn" id="planet-abandon-cancel">취소</button><button type="submit" class="cmd-btn danger" disabled>행성 포기 확정</button></div>
      </form>
    </section>`);
    const form = document.getElementById('planet-abandon-form');
    const input = form.elements.confirmationName;
    const submit = form.querySelector('[type="submit"]');
    const errorEl = document.getElementById('planet-abandon-error');
    let busy = false;
    input.addEventListener('input', () => { submit.disabled = busy || input.value.trim() !== planet.name; });
    document.getElementById('planet-abandon-cancel').addEventListener('click', () => this.hideModal());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || input.value.trim() !== planet.name) return;
      if (String(gameState.planet.id) !== String(planet.id)) { errorEl.textContent = '선택한 행성이 변경되었습니다. 다시 확인해 주세요.'; return; }
      const account = gameState.userId;
      busy = true; submit.disabled = true; input.disabled = true; errorEl.textContent = '';
      try {
        const result = await apiService.abandonPlanet(planet.id, input.value.trim());
        if (account !== gameState.userId) return;
        gameState.syncFromServer(result.snapshot);
        this.hydrateQueueState(result.snapshot.queueState);
        this.refreshSyncedViews();
        if (form.isConnected) this.hideModal();
        this.showNotification('행성 포기', result.abandonedPlanet?.pirateLevel ? `${planet.name}이 해적 Lv.${result.abandonedPlanet.pirateLevel} 거점으로 전환됐습니다.` : `${planet.name}을 포기했습니다.`, 'info');
      } catch (error) {
        if (account !== gameState.userId) return;
        if (!error.status || error.status >= 500) {
          await this.syncUserDataFromServer();
          if (!(gameState.planets || []).some(p => String(p.id || p._id) === String(planet.id))) { if (form.isConnected) this.hideModal(); return; }
        }
        errorEl.textContent = error.message;
      } finally {
        busy = false; input.disabled = false; submit.disabled = input.value.trim() !== planet.name;
      }
    });
    input.focus();
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
    const development = document.getElementById('planet-development');
    if (development) development.disabled = !area;
    if (!area) return;
    const bonus = value => `${value >= 1 ? '+' : ''}${Math.round((value - 1) * 100)}%`;
    const level = gameState.research.terraforming || 0;
    const nextPercent = Math.min(100, area.baseUsablePercent + (level + 1) * 2);
    const nextUsable = Math.min(area.total, Math.floor(area.total * nextPercent / 100 + 1e-9) + (area.bonusUsable || 0));
    const html = `<div class="area-heading"><strong>${escapeHtml(gameState.planet.name)} · 개발 현황</strong><span>전체 ${area.total}칸</span></div>
      <p>가용률 <b>${area.usablePercent}%</b> · 기본 ${area.baseUsablePercent}% + 테라포밍 ${level * 2}%p (상한 100%)</p>
      ${area.bonusUsable ? `<p>추가 개발 공간 +${area.bonusUsable}칸 · 전체 면적 이내 적용</p>` : ''}
      <progress max="${Math.max(1, area.usable)}" value="${Math.min(area.usable, area.used + area.reserved)}" aria-label="건설 가능 면적 사용량"></progress>
      <p>사용 ${area.used}칸 · 예약 ${area.reserved}칸 · 건설 가능 ${area.usable}칸 · <b>남은 ${area.available}칸</b></p>${renderAreaWarning(gameState)}
      ${area.overCapacity ? '<p class="area-warning">면적 한도 초과: 기존 시설은 유지됩니다. 철거로 공간을 확보해 주세요.</p>' : ''}
      <p>금속 ${bonus(modifiers?.metal ?? 1)} · 크리스털 ${bonus(modifiers?.crystal ?? 1)} · 중수소 ${bonus(modifiers?.deuterium ?? 1)} · 태양광 ${bonus(modifiers?.solar ?? 1)}</p>
      <p class="detail-muted">건설·업그레이드마다 1칸 사용. ${level < 30 ? `테라포밍 다음 단계: ${nextPercent}% / ${nextUsable}칸 (+${nextUsable - area.usable}칸)` : '테라포밍 최대 레벨'}</p>`;
    this.planetAreaDetails = html;
    const summary = `${gameState.planet.name} · 전체 ${area.total}칸 · 남은 ${area.available}칸 · 예약 ${area.reserved}칸 · 가용률 ${area.usablePercent}%`;
    if (development) {
      development.title = summary + ' · 자세히 보기';
      development.setAttribute('aria-label', '행성 개발 현황 · ' + summary);
      development.classList.toggle('area-warning', area.overCapacity || area.available <= 0);
    }
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('planet-development-rate', `${area.usablePercent}%`);
    setText('planet-development-free', `${formatAmount(area.available)}칸`);
    setText('planet-development-reserved', `예약 ${area.reserved}칸`);
    setText('planet-development-summary', summary);
    const meter = document.getElementById('planet-development-meter');
    if (meter) meter.style.setProperty('--fill', Math.min(1, (area.used + area.reserved) / Math.max(1, area.usable)));
    const details = document.getElementById('planet-development-details');
    if (details) details.innerHTML = html;
  }

  updatePlanetInfo() {
    this.renderPlanetArea();
    const environment = gameState.planet.environment;
    const visual = document.getElementById('planet-visual');
    if (visual) {
      visual.dataset.environment = environment?.type || 'tropical';
      visual.setAttribute('aria-label', `${environment?.name || '열대 행성'} · ${environment?.description || '바다와 숲이 발달한 행성'}`);
      visual.title = environment?.description || '';
    }
    const environmentLabel = document.getElementById('planet-environment');
    if (environmentLabel) environmentLabel.textContent = environment?.name || '열대 행성';
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
    // The panel persists across navigation; bind its events only once.
    if (!this.adminHandlersBound) {
      this.adminHandlersBound = true;
      this.setupAdminTabs();
      this.setupAdminEvents();
    }
    
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
        this.showUserGroup(this.adminUserKind || 'human');
        break;
      case 'ai':
        document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.toggle('active', el.id === 'tab-users'));
        this.showUserGroup('bot');
        break;
      case 'ai-load':
        if (!this.aiPlayersView) this.aiPlayersView = new AiPlayersView(document.getElementById('tab-ai'));
        this.aiPlayersView.load();
        break;
      case 'settings':
        this.loadPopulationSettings();
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
  
  async loadPopulationSettings() {
    const fields = document.getElementById('population-settings-fields');
    if (!fields) return;
    try {
      const config = await adminService.getConfig();
      const flightInput = document.getElementById('setting-flight-speed');
      const flightSpeed = config.fleetSettings?.flightSpeedMultiplier ?? 1;
      const speeds = [...new Set([0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, flightSpeed])].sort((a,b) => a-b);
      flightInput.innerHTML = speeds.map(speed => `<option value="${speed}" ${speed === flightSpeed ? 'selected' : ''}>${speed}배${speed === 1 ? ' · 기본' : ''}</option>`).join('');
      flightInput.disabled = false;
      document.getElementById('flight-settings-message').textContent = '';
      const areaInput = document.getElementById('setting-bonus-usable-fields');
      areaInput.value = config.areaSettings?.bonusUsableFields ?? 40;
      areaInput.disabled = false;
      document.getElementById('area-settings-message').textContent = '';
      fields.innerHTML = Object.entries(POPULATION_SETTING_LABELS).map(([key, label]) => `<div class="setting-item"><label for="population-setting-${key}">${label}</label><input id="population-setting-${key}" name="${key}" type="number" min="${['growthHours', 'foodConsumptionPerPopulation'].includes(key) ? '0.01' : '0'}" step="any" required value="${Number(config.populationSettings?.[key] ?? 0)}"></div>`).join('');
      document.getElementById('population-settings-message').textContent = '';
    } catch (error) {
      document.getElementById('population-settings-message').textContent = `불러오기 실패: ${error.message}`;
      document.getElementById('area-settings-message').textContent = `불러오기 실패: ${error.message}`;
    }
  }

  setupAdminEvents() {
    const flightForm = document.getElementById('flight-settings-form');
    if (flightForm && !flightForm.dataset.bound) {
      flightForm.dataset.bound = 'true';
      flightForm.addEventListener('submit', async event => {
        event.preventDefault();
        const input = flightForm.elements.namedItem('flightSpeedMultiplier');
        const message = document.getElementById('flight-settings-message'), submit = flightForm.querySelector('button[type="submit"]');
        const value = Number(input.value);
        if (input.disabled || !Number.isFinite(value) || value < .1 || value > 100) { message.textContent = '설정을 불러온 뒤 이동 배율을 선택하세요.'; return; }
        submit.disabled = true;
        try {
          await adminService.updateConfig({ fleetSettings: { flightSpeedMultiplier: value } });
          message.textContent = `이동 배율 ${value}배로 저장했습니다. 새 출격부터 적용됩니다.`;
          await this.syncUserDataFromServer();
        } catch (error) { message.textContent = `저장 실패: ${error.message}`; }
        finally { submit.disabled = false; }
      });
    }
    const areaForm = document.getElementById('area-settings-form');
    if (areaForm && !areaForm.dataset.bound) {
      areaForm.dataset.bound = 'true';
      areaForm.addEventListener('submit', async event => {
        event.preventDefault();
        const input = areaForm.elements.namedItem('bonusUsableFields');
        const message = document.getElementById('area-settings-message');
        const value = Number(input.value);
        if (input.disabled || !Number.isSafeInteger(value) || value < 0) {
          message.textContent = '설정을 불러온 뒤 0 이상의 정수를 입력해 주세요.';
          return;
        }
        const submit = areaForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await adminService.updateConfig({ areaSettings: { bonusUsableFields: value } });
          message.textContent = `추가 가용면적을 행성당 ${value}칸으로 저장했습니다.`;
          await this.syncUserDataFromServer();
        } catch (error) { message.textContent = `저장 실패: ${error.message}`; }
        finally { submit.disabled = false; }
      });
    }
    const populationForm = document.getElementById('population-settings-form');
    if (populationForm && !populationForm.dataset.bound) {
      populationForm.dataset.bound = 'true';
      populationForm.addEventListener('submit', async event => {
        event.preventDefault();
        const message = document.getElementById('population-settings-message');
        const submit = populationForm.querySelector('button[type="submit"]');
        const values = Object.fromEntries(Object.keys(POPULATION_SETTING_LABELS).map(key => [key, Number(populationForm.elements.namedItem(key)?.value)]));
        if (Object.values(values).some(value => !Number.isFinite(value))) { message.textContent = '설정을 먼저 불러와 주세요.'; return; }
        submit.disabled = true;
        try {
          await adminService.updateConfig({ populationSettings: values });
          message.textContent = '인구 설정을 저장했습니다.';
          await this.syncUserDataFromServer();
        } catch (error) { message.textContent = `저장 실패: ${error.message}`; }
        finally { submit.disabled = false; }
      });
    }
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
    
  }
  
  showUserGroup(kind) {
    this.adminUserKind = kind === 'bot' ? 'bot' : 'human';
    const root = document.getElementById('tab-users');
    if (!this.userGroupBound) {
      root.addEventListener('click', event => {
        const button = event.target.closest('[data-user-kind]');
        if (button) this.showUserGroup(button.dataset.userKind);
      });
      this.userGroupBound = true;
    }
    root.querySelectorAll('[data-user-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.userKind === this.adminUserKind)));
    document.getElementById('users-human-section').hidden = this.adminUserKind !== 'human';
    document.getElementById('tab-ai').hidden = this.adminUserKind !== 'bot';
    if (this.adminUserKind === 'bot') this.loadAdminTabData('ai-load');
    else this.loadUsers();
  }

  async loadUsers(page = 1) {
    const search = document.getElementById('user-search')?.value || '';
    const pageSize = parseInt(document.getElementById('users-page-size')?.value || '50');
    const tbody = document.getElementById('users-tbody');
    const showingEl = document.getElementById('users-showing');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;"><span class="loading-spinner">↻</span> Loading users...</td></tr>';
    
    try {
      const data = await adminService.getUsers(page, pageSize, search, 'human');
      
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
            <div class="user-name"><button class="user-detail-link" data-user-detail="${this.escapeHtml(user._id)}">${this.escapeHtml(user.username)}</button></div>
            <div class="user-email" title="${this.escapeHtml(user.email || '')}">${this.escapeHtml(user.email || '')}</div>
          </td>
          <td class="col-status">
            <span class="user-status ${user.isOnline ? 'online' : 'offline'}">${user.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </td>
          <td class="col-planets">${user.planets?.length || 1}</td>
          <td class="col-resources">
            <div class="user-resources">
              ${this.renderUserResources(user._id, resources)}
            </div>
          </td>
          <td class="col-lastlogin">${user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}</td>
          <td class="col-actions">
            <div class="user-actions">
              <button onclick="window.editUser('${user._id}')">Edit</button>
              <button onclick="window.viewUser('${user._id}')">상세</button>
              <button class="delete" onclick="window.deleteUser('${user._id}')">Delete</button>
            </div>
          </td>
        </tr>
      `}).join('');
      
      if (!tbody.dataset.detailBound) {
        tbody.dataset.detailBound = 'true';
        tbody.addEventListener('click', event => { const button = event.target.closest('[data-user-detail]'); if (button) this.viewUserDetails(button.dataset.userDetail); });
      }
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
    num = Math.floor(num);
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
    this.pendingModalConfirmation?.(false);
    this.pendingModalConfirmation = null;
    const modalContent = document.getElementById('modal-content');
    if (!this.modalOverlay || !modalContent) return;

    modalContent.innerHTML = content;
    this.modalOverlay.classList.remove('hidden');
  }

  async viewUserDetails(userId) {
    this.showModal('<div class="admin-user-detail"></div>');
    const root = document.querySelector('#modal-content .admin-user-detail');
    if (root) await new AdminUserDetailsView(root, adminService, userId).load();
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
      const planets = user.gameSnapshot?.planets || user.planets || [];
      const selectedPlanet = planets[user.currentPlanet] || planets[0] || { resources: {} };
      const resources = selectedPlanet.resources || {};
      const energyText = planet => Number.isFinite(planet?.energyState?.balance) ? formatAmount(planet.energyState.balance) : '자동 계산';
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
            ${['metal', 'crystal', 'deuterium', 'food'].map((resource) => `<div class="form-group"><label for="admin-user-${resource}">${resource.toUpperCase()}</label><input id="admin-user-${resource}" name="${resource}" type="number" min="0" step="1" value="${Math.ceil(Number(resources[resource] || 0))}"></div>`).join('')}
          </div>
          <div class="form-group"><label>ENERGY · 자동 계산</label><output id="admin-user-energy">${escapeHtml(energyText(selectedPlanet))}</output><p class="detail-muted">시설 상태에 따라 계산되며 직접 수정할 수 없습니다.</p></div>
          <button class="holo-action-btn" type="submit">SAVE USER</button>
        </form>`);

      const form = document.getElementById('admin-user-edit-form');
      const planetSelect = document.getElementById('admin-user-planet');
      planetSelect?.addEventListener('change', () => {
        const nextResources = planetResources[Number(planetSelect.value)] || {};
        document.getElementById('admin-user-energy').textContent = energyText(planets[Number(planetSelect.value)]);
        ['metal', 'crystal', 'deuterium', 'food'].forEach((resource) => {
          const input = form?.elements.namedItem(resource);
          if (input) input.value = Math.ceil(Number(nextResources[resource] || 0));
        });
      });
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const updatedResources = Object.fromEntries(['metal', 'crystal', 'deuterium', 'food'].map((resource) => [resource, Number(formData.get(resource))]));
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
  
  renderUserResources(userId, resources) {
    return [
      ['metal', 'res-m', '⚙️', '금속'],
      ['crystal', 'res-c', '💎', '수정'],
      ['deuterium', 'res-d', '💧', '중수소'],
    ].map(([type, color, icon, name]) => `
      <span class="user-resource ${color}">
        <span title="${name}">${icon} ${this.formatNumber(resources[type] || 0)}</span>
        <button class="res-btn ${type}" onclick="window.addResource('${this.escapeHtml(userId)}', '${type}')" title="${name} 5,000 추가" aria-label="${name} 5,000 추가">+</button>
      </span>
    `).join('');
  }

  // Update resource display for a specific user in the table
  updateUserResourceDisplay(userId, resources) {
    const row = document.querySelector(`tr[data-user-id="${userId}"]`);
    if (!row) return;
    
    const resCell = row.querySelector('.col-resources .user-resources');
    if (resCell) {
      resCell.innerHTML = this.renderUserResources(userId, resources);
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
        const count = section.querySelector('.panel-queue-count');
        if (count) count.textContent = `${types.filter(type => activeByType[type]).length + pendingItems.length}건`;
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
    const now = Date.now() + (gameState.serverOffset || 0);
    
    // Update each active queue type
    for (const type of ['building', 'research', 'ship', 'defense']) {
      const item = this.queueItems[type];
      if (!item || !item.endTime) continue;
      
      const remaining = Math.max(0, Math.ceil((new Date(item.endTime) - now) / 1000));
      
      // Update UI with remaining time and actual duration for this type
      this.updateQueueTimeDisplay(type, remaining, item.duration);
      
      // If completed, check with server
      if (remaining === 0 && !item.checking && !document.hidden && apiService.isAuthenticated()
          && Date.now() >= (item.nextCheckAt || 0) && Date.now() >= (apiService.rateLimitedUntil || 0)) {
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
    if (!apiService.isAuthenticated()) return;
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
            this.queueItems[type].nextCheckAt = Date.now() + 5000;
            break;
          }
        }
      }
    } catch (err) {
      console.error('Failed to check completion:', err);
      // Reset checking flag
      for (const type of ['building', 'research', 'ship', 'defense']) {
        if (this.queueItems[type] && this.queueItems[type].id === queueId) {
          const item = this.queueItems[type];
          item.checking = false;
          item.checkFailures = (item.checkFailures || 0) + 1;
          item.nextCheckAt = Math.max(apiService.rateLimitedUntil || 0, Date.now() + Math.min(60000, 5000 * 2 ** Math.min(item.checkFailures - 1, 4)));
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
    if (!container || window.matchMedia('(max-width: 768px)').matches) return;
    
    const notification = document.createElement('div');
    notification.className = 'holo-notification ' + type;
    notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = title;
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.textContent = message;
    const close = document.createElement('button');
    close.className = 'notification-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '알림 닫기');
    close.addEventListener('click', () => notification.remove());
    notification.append(titleEl, messageEl, close);
    notification.title = `${title} · ${message}`;
    
    container.appendChild(notification);
    while (container.children.length > MAX_NOTIFICATIONS) container.firstElementChild.remove();
    
    setTimeout(() => {
      notification.classList.add('is-leaving');
      setTimeout(() => notification.remove(), 300);
    }, type === 'error' ? 5000 : 2500);
  }
  
  hideModal() {
    this.pendingModalConfirmation?.(false);
    this.pendingModalConfirmation = null;
    const returnTo = this.modalOverlay?.querySelector('.entity-full-details')
      ? this.browsers[this.currentView]?.root.querySelector('[data-details]') : null;
    if (this.modalOverlay) this.modalOverlay.classList.add('hidden');
    returnTo?.focus();
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
    this.galaxyView?.nav.close?.();
    this.strikeMap?.nav.close?.();
    this.strikeMap?.endDrag();this.strikeMap?.closeConfirm();
    if (this.formationView) { this.formationView.dirty = false; this.formationView.selectedId = null; this.formationView.draft = null; this.formationView.signature = null; }
    this.battleAccount = null;
    this.battleReports = [];
    this.battleUnreadCount = 0;
    this.battleNextCursor = null;
    this.renderBattleRecords();
    this.scouts?.reset();
    this.improvementsView?.reset();
    if (this.currentView === 'improvements') this.switchView('dashboard');
    this.galaxyView?.setActive(false);this.galaxyView?.trafficController.reset();
    this.strikeMap?.setActive(false);this.strikeMap?.trafficController.reset();
    this.hideModal();
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
    
    applyDisplayMode('detailed');
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
