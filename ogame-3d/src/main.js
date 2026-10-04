import * as GameData from './data/gameData.js';
import { gameState } from './core/GameState.js';
import { SpaceScene } from './core/SpaceScene.js';
import { UIManager } from './ui/UIManager.js';

window.GameData = GameData;
window.gameState = gameState;

class CosmicEmpire {
  constructor() {
    this.spaceScene = null;
    this.initialized = false;
  }
  
  async init() {
    try {
      console.log('Initializing Cosmic Empire 3D - Holographic Interface');
      
      const container = document.getElementById('canvas-container');
      if (!container) throw new Error('Canvas container not found');
      
      this.spaceScene = new SpaceScene(container);
      
      // Use existing global uiManager instead of creating new one
      if (window.uiManager) {
        window.uiManager.spaceScene = this.spaceScene;
      }
      
      this.setupKeyboardShortcuts();
      
      this.initialized = true;
      console.log('Cosmic Empire 3D Ready');
      
      setTimeout(() => {
        console.log('[Before showWelcomeSequence] GameState resources:', gameState.resources);
        this.showWelcomeSequence();
        console.log('[After showWelcomeSequence] GameState resources:', gameState.resources);
      }, 1000);
      
    } catch (error) {
      console.error('Failed to initialize:', error);
      this.showError('Game initialization failed. Please refresh.');
    }
  }
  
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Skip shortcuts if user is typing in an input field
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'SELECT' ||
        activeElement.contentEditable === 'true'
      );
      
      if (isInputFocused) return;
      
      const viewMap = {
        '1': 'dashboard',
        '2': 'buildings',
        '3': 'research',
        '4': 'shipyard',
        '5': 'galaxy',
        '6': 'fleet',
        '7': 'combat'
      };
      
      if (viewMap[e.key]) {
        const btn = document.querySelector('[data-view="' + viewMap[e.key] + '"]');
        if (btn) btn.click();
      }
      
      if (e.key === 'Escape') {
        if (window.uiManager) window.uiManager.hideModal();
      }
    });
  }
  
  showWelcomeSequence() {
    window.uiManager?.showNotification('통신 회선 개통', '은하의 역사가 또 한 페이지 넘어갑니다. 사령관, 지휘를 시작하십시오.', 'success');
  }
  
  showError(message) {
    const container = document.getElementById('notification-container');
    if (container) {
      const notification = document.createElement('div');
      notification.className = 'holo-notification error';
      notification.innerHTML = '<div class="title">오류</div><div class="message"></div>';
      notification.querySelector('.message').textContent = message;
      container.appendChild(notification);
    }
  }
}

// Global UIManager for auth handling
window.uiManager = null;

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  
  // UIManager는 항상 초기화 (로그인 화면 처리용)
  window.uiManager = new UIManager(null);
  await window.uiManager.init();
  
  // 로그인 된 상태에서만 3D 씬 초기화
  if (token) {
    const game = new CosmicEmpire();
    game.init();
  }
});

// 로그인 후 3D 씬 초기화 함수
window.initGame = () => {
  if (window.gameInitialized) {
    console.log('[initGame] Already initialized, skipping...');
    return;
  }
  window.gameInitialized = true;
  const game = new CosmicEmpire();
  game.init();
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.uiManager) {
    window.uiManager.syncUserDataFromServer();
  }
});

document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('#canvas-container')) e.preventDefault();
});

export { CosmicEmpire };
