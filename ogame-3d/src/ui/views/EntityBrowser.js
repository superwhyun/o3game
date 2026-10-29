/**
 * List + detail browser for catalog entities (buildings, research, ships,
 * defense). Everything shown is derived from the catalog, so new entities and
 * new categories appear automatically.
 */
import { catalog } from '../../data/catalog.js';
import { renderAreaWarning } from './areaWarning.js';
import {
  getModelThumbnail,
  thumbnailStats,
} from '../../three/entities/ModelThumbnails.js';
import {
  createEntityModel,
  disposeEntityModel,
} from '../../three/entities/EntityModels.js';
import {
  createShipModel,
  disposeShipModel,
} from '../../three/ships/ShipModelFactory.js';
import { acquireViewer } from '../../three/entities/ModelViewer.js';
import {
  visualSpec,
  visualKey,
  buildingTier,
  BUILDING_TIERS,
  RESEARCH_EXHIBITS,
} from '../../three/entities/visualRules.js';
import { resolveModelSpec } from '../../three/ships/ShipModelFactory.js';

import {
  CATEGORY_LABELS,
  escapeHtml,
  formatDuration,
  formatAmount,
  TYPE_LABELS,
} from '../dom.js';
import {
  renderCosts,
  renderRequirements,
  renderSpecs,
  renderUnlocks,
} from './entityDetails.js';

const MAX_UNITS = 9999;
const STATUS_TEXT = { ready: '가능', short: '자원 부족', locked: '조건 미충족', busy: '진행 중', area: '면적 부족', max: '최대 레벨' };

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
  constructor({ root, tabs, getState, isInProgress, onCommand, onDemolish, onDetails, showModel = false }) {
    this.root = root;
    this.getTabs = tabs;
    this.getState = getState;
    this.isInProgress = isInProgress;
    this.onCommand = onCommand;
    this.onDemolish = onDemolish;
    this.onDetails = onDetails;
    this.showModel = showModel;
    this.activeTab = null;
    this.selected = new Map(); // tab key -> entity id
    this.unitCount = 1;
    this.viewer = null;
    this.pending = false;
    this.detailCollapsed = root.id === 'buildings-browser';
    this.previewTier = null;
    this.buildSkeleton();
    this.modelViewport = window.matchMedia('(max-width: 700px)');
    window.addEventListener('uiModeChanged', () => { const entity = this.currentEntity(); if (entity && this.showModel) this.updateModel(entity); });
    this.modelViewport.addEventListener('change', () => {
      const entity = this.currentEntity();
      if (entity && this.showModel) this.updateModel(entity);
    });
  }

  buildSkeleton() {
    this.root.classList.add('entity-browser');
    this.root.innerHTML = `
      <nav class="browser-tabs" role="tablist"></nav>
      <div class="browser-body">
        <ol class="entity-list" aria-label="항목 목록"></ol>
        <article class="entity-detail">
          <button type="button" class="detail-panel-toggle" aria-expanded="false"></button>
          <div class="detail-heading">
            <div class="detail-intro"></div>
            ${this.showModel ? `<div class="detail-media">
              <div class="model-stage"><div class="model-fallback" hidden></div><span class="media-caption"></span></div>
            </div>` : ''}
          </div>
          ${this.showModel ? `<div class="model-tier"><span class="model-tier-label" aria-live="polite"></span><button type="button" data-model-action="preview">다음 외형</button></div>` : ''}
          <div class="detail-content"></div>
        </article>
      </div>`;
    this.detailToggle = this.root.querySelector('.detail-panel-toggle');
    this.detailToggle.addEventListener('click', () => {
      this.detailCollapsed = !this.detailCollapsed;
      this.updateDetailToggle();
    });
    this.updateDetailToggle();
    this.tabsEl = this.root.querySelector('.browser-tabs');
    this.listEl = this.root.querySelector('.entity-list');
    this.contentEl = this.root.querySelector('.detail-content');
    this.introEl = this.root.querySelector('.detail-intro');
    this.mediaEl = this.root.querySelector('.detail-media');
    this.root.querySelector('.model-tier')?.addEventListener('click', (e) => {
      const action = e.target.closest('[data-model-action]')?.dataset
        .modelAction;
      if (action) this.modelAction(action);
    });

    this.tabsEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      this.previewTier = null;
      this.activeTab = button.dataset.tab;
      this.render();
    });
    this.listEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-entity]');
      if (!button || event.target.closest('[data-command]')) return;
      this.previewTier = null;
      this.selected.set(this.activeTab, button.dataset.entity);
      this.unitCount = 1;
      this.render();
    });
    this.listEl.addEventListener('keydown', (event) =>
      this.handleListKeys(event),
    );
    this.root.addEventListener('input', (event) => {
      if (!event.target.matches('.unit-count')) return;
      const value = Math.floor(Number(event.target.value));
      this.unitCount = Number.isFinite(value)
        ? Math.min(MAX_UNITS, Math.max(1, value))
        : 1;
      this.renderDetail({ keepFocus: event.isTrusted });
    });
    this.root.addEventListener('click', async (event) => {
      if (event.target.closest('[data-details]')) {
        event.preventDefault();
        this.renderDetail();
        this.onDetails?.(this.fullDetailsHtml);
        return;
      }
      const button = event.target.closest('.cmd-btn[data-command]');
      if (!button || button.disabled || this.pending) return;
      const entity = button.dataset.commandEntity
        ? catalog.get(this.currentTab().type, button.dataset.commandEntity)
        : this.currentEntity();
      if (!entity) return;
      const info = this.evaluate(entity, this.getState(), button.dataset.commandEntity ? 1 : this.unitCount);
      if (button.dataset.command === 'demolish') {
        if (!this.onDemolish || info.amount <= 0 || this.isInProgress(entity)) return;
      } else if (info.status !== 'ready') return;
      this.pending = true;
      this.render();
      try {
        if (button.dataset.command === 'demolish') await this.onDemolish(entity);
        else await this.onCommand(entity, button.dataset.commandEntity ? 1 : this.unitCount);
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
    const index = items.findIndex(
      (item) => item.id === this.selected.get(this.activeTab),
    );
    const next =
      items[
        Math.min(
          items.length - 1,
          Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)),
        )
      ];
    if (!next) return;
    this.previewTier = null;
    this.selected.set(this.activeTab, next.id);
    this.unitCount = 1;
    this.render();
    this.listEl.querySelector(`[data-entity="${next.id}"]`)?.focus();
  }

  currentTab() {
    const tabs = this.getTabs();
    return tabs.find((tab) => tab.key === this.activeTab) || tabs[0];
  }

  selectEntity(id) {
    const entity = catalog.get(this.currentTab()?.type, id);
    if (!entity) return;
    const tab = this.getTabs().find(tab => tab.type === entity.type && (!tab.category || tab.category === entity.category));
    if (!tab) return;
    this.activeTab = tab.key;
    this.selected.set(tab.key, id);
    this.render();
    this.listEl.querySelector(`[data-entity="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  entitiesForTab(tab) {
    if (!tab) return [];
    return catalog.list(
      tab.type,
      tab.category ? { category: tab.category } : {},
    );
  }

  currentEntity() {
    const tab = this.currentTab();
    const items = this.entitiesForTab(tab);
    return (
      items.find((item) => item.id === this.selected.get(tab?.key)) ||
      items[0] ||
      null
    );
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
    const locked = requirements.some((req) => !req.met) || (entity.type === 'research' && state.researchInfrastructure?.labsBusy);
    const affordable = Object.entries(cost).every(
      ([resource, value]) => (state.resources?.[resource] || 0) >= value,
    );
    const busy = leveled && this.isInProgress(entity);
    const noArea = entity.type === 'building' && (state.planet?.area?.available ?? Infinity) < 1;
    const maxed = entity.id === 'terraforming' && (amount >= 30 || (state.planets?.length > 0 && state.planets.every(p => p.area?.usablePercent >= 100)));
    const status = maxed ? 'max' : locked ? 'locked' : busy ? 'busy' : noArea ? 'area' : affordable ? 'ready' : 'short';
    const duration = catalog.duration(entity, {
      level: amount + 1,
      count,
      buildings: entity.type === 'research' ? { ...state.buildings, researchLab: catalog.researchNetwork(entity, state).effectiveLevel } : state.buildings,
      serverSpeed: state.serverSpeed,
    });
    return { amount, leveled, cost, requirements, status, duration };
  }

  render() {
    if (!catalog.loaded) {
      this.contentEl.innerHTML =
        '<p class="detail-muted">카탈로그를 불러오는 중…</p>';
      return;
    }
    const tabs = this.getTabs();
    if (!tabs.some((tab) => tab.key === this.activeTab))
      this.activeTab = tabs[0]?.key || null;
    this.renderTabs(tabs);
    this.renderList();
    this.renderDetail();
  }

  renderTabs(tabs) {
    this.tabsEl.hidden = tabs.length < 2;
    this.tabsEl.innerHTML = tabs
      .map(
        (tab) => `
      <button type="button" role="tab" class="browser-tab ${tab.key === this.activeTab ? 'is-active' : ''}"
        aria-selected="${tab.key === this.activeTab}" data-tab="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`,
      )
      .join('');
  }

  renderList() {
    const state = this.getState();
    const current = this.currentEntity();
    const scrollTop = this.listEl.scrollTop;
    const items = this.entitiesForTab(this.currentTab());

    this.listEl.innerHTML =
      items
        .map((entity) => {
          const { amount, leveled, status, duration } = this.evaluate(entity, state);
          const isSelected = entity.id === current?.id;
          const glyph =
            this.showModel && entity.type !== 'defense'
              ? `<img alt="" data-thumb="${escapeHtml(entity.id)}">`
              : `<span>${escapeHtml(entity.icon)}</span>`;
          if (leveled) {
            const name = escapeHtml(entity.name);
            const disabled = this.pending || status !== 'ready';
            const demolishDisabled = this.pending || amount <= 0 || this.isInProgress(entity);
            return `<li class="entity-row has-actions status-${status} ${isSelected ? 'is-selected' : ''}">
              <button type="button" class="entity-select" aria-pressed="${isSelected}" tabindex="${isSelected ? 0 : -1}" data-entity="${escapeHtml(entity.id)}">
                <span class="entity-glyph">${glyph}</span>
                <span class="entity-name">${name}</span>
                <span class="entity-status">${STATUS_TEXT[status]}</span>
              </button>
              <div class="entity-row-actions">
                <span class="entity-row-time" title="소요 시간 ${formatDuration(duration)}" aria-label="소요 시간 ${formatDuration(duration)}">${formatDuration(duration)}</span>
                <button type="button" class="cmd-btn entity-action" data-command="${entity.type}" data-command-entity="${escapeHtml(entity.id)}" aria-label="${name} ${entity.type === 'building' ? '건설' : '연구'}" title="${name} Lv ${amount + 1} · ${STATUS_TEXT[status]}" ${disabled ? 'disabled' : ''}>+</button>
                ${entity.type === 'building' && this.onDemolish ? `<button type="button" class="cmd-btn entity-action" data-command="demolish" data-command-entity="${escapeHtml(entity.id)}" aria-label="${name} 1레벨 철거" title="1레벨 철거 · 1칸 회수" ${demolishDisabled ? 'disabled' : ''}>−</button>` : ''}
              </div>
              <span class="entity-amount">Lv ${amount}</span>
            </li>`;
          }
          return `<li>
        <button type="button" role="option" aria-selected="${isSelected}" tabindex="${isSelected ? 0 : -1}"
          class="entity-row status-${status} ${isSelected ? 'is-selected' : ''}" data-entity="${escapeHtml(entity.id)}">
          <span class="entity-glyph">${glyph}</span>
          <span class="entity-name">${escapeHtml(entity.name)}</span>
          <span class="entity-amount">${leveled ? `Lv ${amount}` : `${amount.toLocaleString('ko-KR')}척`}</span>
          <span class="entity-status">${STATUS_TEXT[status]}</span>
        </button>
      </li>`;
        })
        .join('') || '<li class="detail-muted">항목이 없습니다</li>';
    this.listEl.scrollTop = scrollTop;

    if (this.showModel) {
      for (const img of this.listEl.querySelectorAll('img[data-thumb]')) {
        const entity = catalog.get(this.currentTab().type, img.dataset.thumb);
        const spec = this.modelSpec(entity, this.amountOf(entity, state));
        const [create, dispose] = this.modelFunctions(entity);
        getModelThumbnail(spec, visualKey(entity, spec), create, dispose)
          .then((url) => {
            if (img.isConnected) img.src = url;
          })
          .catch(() => {
            if (img.isConnected)
              img.replaceWith(
                Object.assign(document.createElement('span'), {
                  textContent: entity.icon,
                }),
              );
          });
      }
    }
  }

  renderDetail({ keepFocus = false } = {}) {
    this.contentEl.parentElement
      .querySelector(':scope > .detail-command')
      ?.remove();
    const entity = this.currentEntity();
    if (!entity) {
      this.introEl.innerHTML = '';
      this.contentEl.innerHTML =
        '<p class="detail-muted">선택된 항목이 없습니다</p>';
      return;
    }
    const state = this.getState();
    const count = catalog.isLeveled(entity.type) ? 1 : this.unitCount;
    const info = this.evaluate(entity, state, count);
    const unitCost = info.leveled ? {} : this.evaluate(entity, state, 1).cost;
    const affordable = Math.max(1, Math.min(MAX_UNITS, ...Object.entries(unitCost)
      .filter(([, cost]) => cost > 0).map(([id, cost]) => Math.floor((state.resources[id] || 0) / cost))));
    const labels = TYPE_LABELS[entity.type];
    const categoryLabel = CATEGORY_LABELS[entity.category] || entity.category;
    const commandDisabled = info.status !== 'ready' || this.pending;
    const specs = renderSpecs(entity, { level: info.amount, count, modifiers: state.planet?.productionModifiers, energyState: state.planet?.energyState });
    const staffing = state.planet?.populationState?.jobs?.[entity.id];
    const network = entity.type === 'research' ? catalog.researchNetwork(entity, state) : null;
    const networkInfo = network ? `<p class="effect-description research-linked-labs">${network.eligible ? `연결 연구소 ${network.labs.length}곳 · 합산 Lv ${network.effectiveLevel}<br>${network.labs.map(lab => `${escapeHtml(lab.name)} Lv ${lab.level}`).join(' + ')}` : `이 행성에 연구소 Lv ${network.requiredLevel} 필요`}${state.researchInfrastructure?.labsBusy ? '<br>연구소 작업 완료 후 연구 가능' : ''}</p>` : '';
    const staffingInfo = staffing ? `<p class="effect-description">인력 ${staffing.assigned.toFixed(1)} / ${formatAmount(staffing.required)} · 가동 ${Math.round(staffing.ratio * 100)}%${!entity.effects?.production ? '' : ` · 생산 효율 ${Math.round(staffing.ratio * state.planet.populationState.productionMultiplier * 100)}%`}</p>` : '';
    const effects = info.leveled
      ? `<section class="detail-section detail-effects"><h4>효과</h4>${specs || `<p class="effect-description">${escapeHtml(entity.description || '효과 설명이 없습니다.')}</p>`}${staffingInfo}${networkInfo}</section>`
      : '';

    const intro = `
      <header class="detail-header">
        <p class="detail-kicker">${labels.hanja} · ${escapeHtml(categoryLabel || labels.title)}</p>
        <h3 class="detail-title">${escapeHtml(entity.name)}</h3>
        <p class="detail-amount">${
          info.leveled
            ? `현재 Lv ${info.amount} <span aria-hidden="true">→</span> Lv ${info.amount + 1}`
            : `보유 ${info.amount.toLocaleString('ko-KR')}`
        }</p>
      </header>
      ${entity.description ? `<p class="detail-desc">${escapeHtml(entity.description)}</p>` : ''}`;
    const supplement = `
      ${entity.type === 'research' && RESEARCH_EXHIBITS[entity.id] ? `<section class="research-exhibit-note"><h4>연구 대상</h4><p>${escapeHtml(RESEARCH_EXHIBITS[entity.id][0])}</p><small>${escapeHtml(RESEARCH_EXHIBITS[entity.id][1])}</small></section>` : ''}
      ${info.leveled ? '' : specs}
      ${entity.type === 'building' ? `<p class="detail-muted">사용 ${info.amount}칸 → ${info.amount + 1}칸 · 추가 1칸 · 남은 ${state.planet?.area?.available ?? '—'}칸</p>` : ''}`;
    this.introEl.innerHTML = intro;
    const requirements = `<section class="detail-section"><h4>선행 조건</h4>${renderRequirements(info.requirements)}</section>`;
    const costs = `<section class="detail-section"><h4>소요 자원</h4>${renderCosts(info.cost, state.resources || {})}</section>`;
    const unlocks = renderUnlocks(entity);
    this.fullDetailsHtml = `${intro}${supplement}${effects}${requirements}${costs}${unlocks}
      <section class="detail-section"><h4>소요 시간</h4><p>${formatDuration(info.duration)}${info.leveled ? '' : ` · ${count.toLocaleString('ko-KR')}개 기준`}</p></section>`;
    const visibleEffects = entity.type === 'building'
      ? effects.replace('detail-effects"', 'detail-effects has-more"').replace('<h4>효과</h4>', '<header class="detail-effects-heading"><h4>효과</h4><button type="button" class="cmd-btn detail-more" data-details>자세히 보기</button></header>')
      : effects;
    this.updateDetailToggle(entity);
    this.contentEl.innerHTML = `
      <div class="detail-full-only">${supplement}</div>
      ${visibleEffects}${requirements}${costs}${entity.type === 'building' ? renderAreaWarning(state) : ''}
      <div class="detail-full-only">${unlocks}</div>
      <footer class="detail-command ${info.leveled ? 'is-leveled' : ''}">
        ${info.leveled ? '' : `<span class="detail-time"><small>소요 시간</small>${formatDuration(info.duration)}</span>`}
        ${entity.type === 'building' ? '' : '<button type="button" class="cmd-btn detail-more" data-details>자세히 보기</button>'}
        ${
          info.leveled
            ? ''
            : `<label class="unit-field"><small>수량</small>
          <input class="unit-count" type="number" min="1" max="${affordable}" step="1" value="${count}" inputmode="numeric"></label>`
        }
        ${info.leveled ? '' : `<button type="button" class="cmd-btn primary" data-command="${entity.type}" ${commandDisabled ? 'disabled' : ''}>
          ${info.status === 'ready' ? labels.action : STATUS_TEXT[info.status]}
        </button>`}
      </footer>`;

    // A direct child keeps sticky commands visible even when the model fills a mobile screen.
    const command = this.contentEl.querySelector('.detail-command');
    if (entity.type === 'building') command?.remove();
    else if (command) this.contentEl.after(command);
    if (keepFocus) {
      this.root.querySelector('.unit-count')?.focus();
    }
    if (this.showModel) this.updateModel(entity);
  }

  updateDetailToggle(entity) {
    this.root.classList.toggle('detail-panel-collapsed', this.detailCollapsed);
    this.detailToggle.setAttribute('aria-expanded', String(!this.detailCollapsed));
    this.detailToggle.textContent = this.detailCollapsed
      ? `▴ ${entity?.name || '건물'} 상세 펼치기`
      : '▾ 건물 상세 접기';
  }

  modelMetrics() {
    return this.viewer
      ? {
          running: this.viewer.running,
          memory: { ...this.viewer.renderer.info.memory },
          render: { ...this.viewer.renderer.info.render },
          thumbnails: thumbnailStats(),
        }
      : null;
  }
  modelSpec(entity, amount, preview = null) {
    return entity.type === 'ship'
      ? resolveModelSpec(entity)
      : visualSpec(entity, amount, preview);
  }
  modelFunctions(entity) {
    return entity.type === 'ship'
      ? [createShipModel, disposeShipModel]
      : [createEntityModel, disposeEntityModel];
  }
  modelAction(action) {
    if (action === 'preview') {
      const entity = this.currentEntity(),
        level = this.amountOf(entity, this.getState());
      this.previewTier =
        this.previewTier === null ? Math.min(3, buildingTier(level) + 1) : null;
      this.updateModel(entity);
      return;
    }
  }
  updateModel(entity) {
    if (!this.mediaEl) return;
    const mobile = this.modelViewport.matches || document.documentElement.dataset.uiMode === 'simple';
    this.mediaEl.hidden = mobile || entity.type === 'defense';
    if (mobile) { this.viewer?.stop(); return; }
    if (entity.type === 'defense' || this.root.closest('.hidden')) return;
    const amount = this.amountOf(entity, this.getState());
    if (
      this.lastModelEntity !== entity.id ||
      this.lastActualTier !== buildingTier(amount)
    )
      this.previewTier = null;
    this.lastModelEntity = entity.id;
    this.lastActualTier = buildingTier(amount);
    const spec = this.modelSpec(entity, amount, this.previewTier),
      key = visualKey(entity, spec);
    const [create, dispose] = this.modelFunctions(entity);
    const stage = this.mediaEl.querySelector('.model-stage'),
      fallback = this.mediaEl.querySelector('.model-fallback');
    const isPreview = this.previewTier !== null;
    this.mediaEl.dataset.modelKey = key;
    this.mediaEl.dataset.tier = String(spec.tier ?? 0);
    this.mediaEl.dataset.preview = String(isPreview);
    this.mediaEl.querySelector('.media-caption').textContent =
      entity.type === 'building'
        ? isPreview
          ? '外観 · 다음 구간 설계 미리보기'
          : amount === 0
            ? '設計 · 미건설 시설'
            : `施設 · 현재 Lv ${amount}`
        : entity.type === 'research'
          ? `実験 · 개념 모형 · ${amount === 0 ? '미연구' : `Lv ${amount}`}`
          : 'TACTICAL VIEW · 함선 모형';
    const tierEl = this.root.querySelector('.model-tier');
    tierEl.hidden = entity.type !== 'building';
    if (entity.type === 'building') {
      const current = buildingTier(amount),
        tier = BUILDING_TIERS[spec.tier];
      const next = BUILDING_TIERS[current + 1];
      tierEl.querySelector('.model-tier-label').textContent =
        `${tier.name} · Lv ${tier.min}${tier.max === Infinity ? ' 이상' : `~${tier.max}`} ${isPreview ? '· 미리보기' : next ? `· 다음 외형 Lv ${next.min} (${next.min - amount}레벨 남음)` : '· 최종 외형'}`;
      const button = tierEl.querySelector('[data-model-action="preview"]');
      button.disabled = !next;
      button.textContent = isPreview ? '현재 외형' : '다음 외형';
    }
    const displayFallback = (lost) => {
      if (this.mediaEl.dataset.modelKey !== key) return;
      fallback.hidden = !lost;
      if (lost) {
        fallback.textContent =
          '3D 표시를 사용할 수 없습니다. 정지 모형으로 표시합니다.';
        getModelThumbnail(spec, key, create, dispose)
          .then((url) => {
            if (!fallback.hidden && this.mediaEl.dataset.modelKey === key) {
              const img = new Image();
              img.src = url;
              img.alt = entity.name + ' 모형';
              fallback.prepend(img);
            }
          })
          .catch(() => {
            if (this.mediaEl.dataset.modelKey === key)
              fallback.textContent =
                entity.icon +
                ' ' +
                entity.name +
                ' · 3D 표시를 사용할 수 없습니다.';
          });
      }
    };
    try {
      this.viewer = acquireViewer(stage);
      this.viewer.onFailure = displayFallback;
      this.viewer.show(spec, key, create, dispose);
      this.viewer.setInteractive(false);
      displayFallback(this.viewer.lost);
      this.viewer.start();
    } catch (error) {
      console.warn('[EntityBrowser] model fallback', entity.id, error);
      displayFallback(true);
    }
  }
}
