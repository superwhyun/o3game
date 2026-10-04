/**
 * List + detail browser for catalog entities (buildings, research, ships,
 * defense). Everything shown is derived from the catalog, so new entities and
 * new categories appear automatically.
 */
import { catalog } from '../../data/catalog.js';
import { getShipThumbnail } from '../../three/ships/ShipThumbnails.js';
import { resolveModelSpec } from '../../three/ships/ShipModelFactory.js';
import { ShipViewer } from '../../three/ships/ShipViewer.js';
import { CATEGORY_LABELS, escapeHtml, formatDuration, TYPE_LABELS } from '../dom.js';
import { renderCosts, renderRequirements, renderSpecs, renderUnlocks } from './entityDetails.js';

const MAX_UNITS = 9999;
const STATUS_TEXT = { ready: '가능', short: '자원 부족', locked: '조건 미충족', busy: '진행 중' };

/**
 * @typedef {Object} BrowserTab
 * @property {string} key
 * @property {string} label
 * @property {'building'|'research'|'ship'|'defense'} type
 * @property {string} [category]
 */

export class EntityBrowser {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.root
   * @param {() => BrowserTab[]} options.tabs
   * @param {() => object} options.getState  gameState-like object
   * @param {(entity: object) => boolean} options.isInProgress
   * @param {(entity: object, count: number) => Promise<void>} options.onCommand
   * @param {boolean} [options.showModel]  show the 3D ship inspector
   */
  constructor({ root, tabs, getState, isInProgress, onCommand, showModel = false }) {
    this.root = root;
    this.getTabs = tabs;
    this.getState = getState;
    this.isInProgress = isInProgress;
    this.onCommand = onCommand;
    this.showModel = showModel;
    this.activeTab = null;
    this.selected = new Map(); // tab key -> entity id
    this.unitCount = 1;
    this.viewer = null;
    this.pending = false;
    this.buildSkeleton();
  }

  buildSkeleton() {
    this.root.classList.add('entity-browser');
    this.root.innerHTML = `
      <nav class="browser-tabs" role="tablist"></nav>
      <div class="browser-body">
        <ol class="entity-list" role="listbox" aria-label="항목 목록"></ol>
        <article class="entity-detail">
          ${this.showModel ? '<div class="detail-media"><span class="media-caption">TACTICAL VIEW · 드래그하여 회전</span></div>' : ''}
          <div class="detail-content"></div>
        </article>
      </div>`;
    this.tabsEl = this.root.querySelector('.browser-tabs');
    this.listEl = this.root.querySelector('.entity-list');
    this.contentEl = this.root.querySelector('.detail-content');
    this.mediaEl = this.root.querySelector('.detail-media');

    this.tabsEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      this.activeTab = button.dataset.tab;
      this.render();
    });
    this.listEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-entity]');
      if (!button) return;
      this.selected.set(this.activeTab, button.dataset.entity);
      this.unitCount = 1;
      this.render();
    });
    this.listEl.addEventListener('keydown', (event) => this.handleListKeys(event));
    this.contentEl.addEventListener('input', (event) => {
      if (!event.target.matches('.unit-count')) return;
      const value = Math.floor(Number(event.target.value));
      this.unitCount = Number.isFinite(value) ? Math.min(MAX_UNITS, Math.max(1, value)) : 1;
      this.renderDetail({ keepFocus: true });
    });
    this.contentEl.addEventListener('click', async (event) => {
      const button = event.target.closest('.cmd-btn[data-command]');
      if (!button || button.disabled || this.pending) return;
      this.pending = true;
      button.disabled = true;
      try {
        await this.onCommand(this.currentEntity(), this.unitCount);
      } finally {
        this.pending = false;
        this.render();
      }
    });
  }

  handleListKeys(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const items = this.entitiesForTab(this.currentTab());
    const index = items.findIndex((item) => item.id === this.selected.get(this.activeTab));
    const next = items[Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    this.selected.set(this.activeTab, next.id);
    this.unitCount = 1;
    this.render();
    this.listEl.querySelector(`[data-entity="${next.id}"]`)?.focus();
  }

  currentTab() {
    const tabs = this.getTabs();
    return tabs.find((tab) => tab.key === this.activeTab) || tabs[0];
  }

  entitiesForTab(tab) {
    if (!tab) return [];
    return catalog.list(tab.type, tab.category ? { category: tab.category } : {});
  }

  currentEntity() {
    const tab = this.currentTab();
    const items = this.entitiesForTab(tab);
    return items.find((item) => item.id === this.selected.get(tab?.key)) || items[0] || null;
  }

  /** Level for leveled types, owned count for units. */
  amountOf(entity, state) {
    if (entity.type === 'building') return state.buildings?.[entity.id] || 0;
    if (entity.type === 'research') return state.research?.[entity.id] || 0;
    if (entity.type === 'ship') return state.fleet?.[entity.id] || 0;
    return state.defense?.[entity.id] || 0;
  }

  evaluate(entity, state, count = 1) {
    const amount = this.amountOf(entity, state);
    const leveled = catalog.isLeveled(entity.type);
    const cost = catalog.cost(entity, leveled ? amount + 1 : count);
    const requirements = catalog.requirementStatus(entity, state);
    const locked = requirements.some((req) => !req.met);
    const affordable = Object.entries(cost).every(([resource, value]) => (state.resources?.[resource] || 0) >= value);
    const busy = leveled && this.isInProgress(entity);
    const status = locked ? 'locked' : busy ? 'busy' : affordable ? 'ready' : 'short';
    const duration = catalog.duration(entity, {
      level: amount + 1,
      count,
      buildings: state.buildings,
      serverSpeed: state.serverSpeed
    });
    return { amount, leveled, cost, requirements, status, duration };
  }

  render() {
    if (!catalog.loaded) {
      this.contentEl.innerHTML = '<p class="detail-muted">카탈로그를 불러오는 중…</p>';
      return;
    }
    const tabs = this.getTabs();
    if (!tabs.some((tab) => tab.key === this.activeTab)) this.activeTab = tabs[0]?.key || null;
    this.renderTabs(tabs);
    this.renderList();
    this.renderDetail();
  }

  renderTabs(tabs) {
    this.tabsEl.hidden = tabs.length < 2;
    this.tabsEl.innerHTML = tabs.map((tab) => `
      <button type="button" role="tab" class="browser-tab ${tab.key === this.activeTab ? 'is-active' : ''}"
        aria-selected="${tab.key === this.activeTab}" data-tab="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`).join('');
  }

  renderList() {
    const state = this.getState();
    const current = this.currentEntity();
    const scrollTop = this.listEl.scrollTop;
    const items = this.entitiesForTab(this.currentTab());

    this.listEl.innerHTML = items.map((entity) => {
      const { amount, leveled, status } = this.evaluate(entity, state);
      const isSelected = entity.id === current?.id;
      const glyph = this.showModel && entity.type === 'ship'
        ? `<img alt="" data-thumb="${escapeHtml(entity.id)}">`
        : `<span>${escapeHtml(entity.icon)}</span>`;
      return `<li>
        <button type="button" role="option" aria-selected="${isSelected}" tabindex="${isSelected ? 0 : -1}"
          class="entity-row status-${status} ${isSelected ? 'is-selected' : ''}" data-entity="${escapeHtml(entity.id)}">
          <span class="entity-glyph">${glyph}</span>
          <span class="entity-name">${escapeHtml(entity.name)}</span>
          <span class="entity-amount">${leveled ? `Lv ${amount}` : `${amount.toLocaleString('ko-KR')}척`}</span>
          <span class="entity-status">${STATUS_TEXT[status]}</span>
        </button>
      </li>`;
    }).join('') || '<li class="detail-muted">항목이 없습니다</li>';
    this.listEl.scrollTop = scrollTop;

    if (this.showModel) {
      for (const img of this.listEl.querySelectorAll('img[data-thumb]')) {
        const entity = catalog.get('ship', img.dataset.thumb);
        getShipThumbnail(resolveModelSpec(entity), entity.id)
          .then((url) => { img.src = url; })
          .catch((error) => console.warn('[EntityBrowser] thumbnail failed', entity.id, error));
      }
    }
  }

  renderDetail({ keepFocus = false } = {}) {
    const entity = this.currentEntity();
    if (!entity) {
      this.contentEl.innerHTML = '<p class="detail-muted">선택된 항목이 없습니다</p>';
      return;
    }
    const state = this.getState();
    const count = catalog.isLeveled(entity.type) ? 1 : this.unitCount;
    const info = this.evaluate(entity, state, count);
    const labels = TYPE_LABELS[entity.type];
    const categoryLabel = CATEGORY_LABELS[entity.category] || entity.category;
    const commandDisabled = info.status !== 'ready' || this.pending;

    this.contentEl.innerHTML = `
      <header class="detail-header">
        <p class="detail-kicker">${labels.hanja} · ${escapeHtml(categoryLabel || labels.title)}</p>
        <h3 class="detail-title">${escapeHtml(entity.name)}</h3>
        <p class="detail-amount">${info.leveled
          ? `현재 Lv ${info.amount} <span aria-hidden="true">→</span> Lv ${info.amount + 1}`
          : `보유 ${info.amount.toLocaleString('ko-KR')}`}</p>
      </header>
      ${entity.description ? `<p class="detail-desc">${escapeHtml(entity.description)}</p>` : ''}
      ${renderSpecs(entity, { level: info.amount, count })}
      <section class="detail-section"><h4>선행 조건</h4>${renderRequirements(info.requirements)}</section>
      <section class="detail-section"><h4>소요 자원</h4>${renderCosts(info.cost, state.resources || {})}</section>
      ${renderUnlocks(entity)}
      <footer class="detail-command">
        <span class="detail-time"><small>소요 시간</small>${formatDuration(info.duration)}</span>
        ${info.leveled ? '' : `<label class="unit-field"><small>수량</small>
          <input class="unit-count" type="number" min="1" max="${MAX_UNITS}" step="1" value="${count}" inputmode="numeric"></label>`}
        <button type="button" class="cmd-btn primary" data-command="${entity.type}" ${commandDisabled ? 'disabled' : ''}>
          ${info.status === 'ready' ? labels.action : STATUS_TEXT[info.status]}
        </button>
      </footer>`;

    if (keepFocus) {
      this.contentEl.querySelector('.unit-count')?.focus();
    }
    if (this.showModel) this.updateModel(entity);
  }

  updateModel(entity) {
    if (!this.mediaEl) return;
    this.mediaEl.hidden = entity.type !== 'ship';
    if (entity.type !== 'ship') return;
    this.viewer ??= new ShipViewer(this.mediaEl);
    this.viewer.show(resolveModelSpec(entity), entity.id);
  }
}
