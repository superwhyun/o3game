/**
 * Star-system view: orbital chart plus a slot list and a detail card.
 */
import { escapeHtml } from '../dom.js';
import { FleetTrafficController } from './FleetTrafficController.js';
import { FleetTrafficLayer } from './FleetTrafficLayer.js';
import { OrbitChart, relationOf } from './OrbitChart.js';
import { bindSystemNav, clampCoords } from './systemNav.js';

const RELATION_LABEL = { own: '아군', other: '타 제국', empty: '미점령 행성' };

export class GalaxyView {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.root
   * @param {{ prev: HTMLElement, next: HTMLElement, galaxy: HTMLInputElement, system: HTMLInputElement, home: HTMLElement }} options.controls
   * @param {(galaxy: number, system: number) => Promise<object>} options.fetchSystem
   * @param {() => { galaxy: number, system: number }} options.getHome
   * @param {(target: { galaxy: number, system: number, planet: number }) => void} options.onTarget
   */
  constructor({ root, controls, fetchSystem, getHome, onTarget, onSelect, fetchTraffic, getAccount = () => null, onMissions }) {
    this.root = root;
    this.fetchSystem = fetchSystem;
    this.getHome = getHome;
    this.onTarget = onTarget;
    this.onSelect = onSelect;
    this.fetchTraffic = fetchTraffic;
    this.coords = null;
    this.data = null;
    this.selected = null;
    this.requestId = 0;

    this.root.innerHTML = `
      <div class="galaxy-chart-column"><div class="orbit-host"></div><section class="traffic-host"></section></div>
      <aside class="orbit-side">
        <article class="slot-detail" aria-live="polite"></article>
        <section class="scout-panel" aria-label="정찰 정보"></section>
        <ol class="slot-list" aria-label="궤도 목록"></ol>
      </aside>`;
    this.chart = new OrbitChart(this.root.querySelector('.orbit-host'), { onSelect: (slot) => this.select(slot) });
    this.traffic = new FleetTrafficLayer(this.chart, {
      controlsRoot: this.root.querySelector('.traffic-host'),
      onSelect: route => this.trafficController.select(route),
      onMore: () => this.trafficController.loadMore(),
      onMissions,
    });
    this.trafficController = new FleetTrafficController({
      fetchTraffic, getAccount,
      onData: data => this.traffic.update(data), onStatus: error => this.traffic.setStatus(error),
      onDetails: (rows, cursor, error) => this.traffic.showMovements(rows, cursor, error),
      onReset: () => this.traffic.reset(),
    });
    this.listEl = this.root.querySelector('.slot-list');
    this.detailEl = this.root.querySelector('.slot-detail');
    this.scoutEl = this.root.querySelector('.scout-panel');
    this.nav = bindSystemNav(controls, {
      current: () => this.coords,
      home: () => this.getHome(),
      go: (coords) => this.show(coords)
    });

    this.listEl.addEventListener('click', (event) => {
      const row = event.target.closest('[data-slot]');
      if (row) this.select(Number(row.dataset.slot));
    });
    this.detailEl.addEventListener('click', (event) => {
      if (!event.target.closest('[data-action="target"]') || !this.coords || !this.selected) return;
      this.onTarget({ ...this.coords, planet: this.selected });
    });
  }

  /** @param {{ galaxy: number, system: number }} [coords] defaults to the last viewed or home system */
  async show(coords = this.coords || this.getHome()) {
    const next = clampCoords(coords);
    if (!this.coords || this.coords.galaxy !== next.galaxy || this.coords.system !== next.system) this.selected = null;
    this.coords = next;
    this.setActive(true);
    this.trafficController.setSystem(next);
    this.nav.sync(next);

    const requestId = ++this.requestId;
    this.root.classList.add('is-loading');
    try {
      const data = await this.fetchSystem(next.galaxy, next.system);
      if (requestId !== this.requestId) return; // a newer request superseded this one
      this.data = data;
      this.selected ??= data.positions.find((p) => p.owner === 'self')?.position
        ?? data.positions.find((p) => p.occupied)?.position
        ?? null;
      this.chart.setSystem(next, data.positions, this.selected);
      this.renderList();
      this.renderDetail();
      if (this.fetchTraffic) await this.trafficController.refresh();
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.data = null;
      this.listEl.innerHTML = '';
      this.detailEl.innerHTML = `<p class="galaxy-error">성계 정보를 불러오지 못했습니다: ${escapeHtml(error.message)}</p>`;
    } finally {
      if (requestId === this.requestId) this.root.classList.remove('is-loading');
    }
  }

  setActive(active) {
    this.trafficController.setActive(active);
    if(active) this.chart.start(); else this.chart.stop();
  }

  refreshTraffic() { return this.trafficController.refresh(); }

  select(slot) {
    this.selected = slot;
    this.chart.setSelected(slot);
    this.renderList();
    this.renderDetail();
  }

  renderList() {
    this.listEl.innerHTML = this.data.positions.map((position) => {
      const relation = relationOf(position);
      const title = position.planet ? escapeHtml(position.planet.name) : '미점령 행성';
      const owner = position.planet ? escapeHtml(position.planet.username) : '';
      return `<li><button type="button" class="slot-row slot-${relation} ${position.position === this.selected ? 'is-selected' : ''}"
          data-slot="${position.position}" aria-pressed="${position.position === this.selected}">
          <span class="slot-index">${position.position}</span>
          <span class="slot-name">${title}</span>
          <span class="slot-owner">${owner}</span>
        </button></li>`;
    }).join('');
  }

  renderDetail() {
    const position = this.data.positions.find((p) => p.position === this.selected);
    if (!position) {
      this.detailEl.innerHTML = '<p class="detail-muted">궤도를 선택하십시오.</p>';
      return;
    }
    const relation = relationOf(position);
    const { galaxy, system } = this.coords;
    const action = {
      own: '<button type="button" class="cmd-btn" disabled>아군 행성</button>',
      other: '<button type="button" class="cmd-btn primary" data-action="target">작전 목표 지정</button>',
      empty: '<button type="button" class="cmd-btn primary" data-action="target">개척 함대 선택</button>'
    }[relation];

    this.detailEl.innerHTML = `
      <p class="detail-kicker">[${galaxy}:${system}:${position.position}] · 제${position.position}궤도</p>
      <h3 class="slot-detail-title">${position.planet ? escapeHtml(position.planet.name) : '미점령 행성'}</h3>
      <dl class="spec-list single">
        <div class="spec-row"><dt>관계</dt><dd class="rel-${relation}">${RELATION_LABEL[relation]}</dd></div>
        ${position.planet ? `
          <div class="spec-row"><dt>사령관</dt><dd>${escapeHtml(position.planet.username)}</dd></div>
          <div class="spec-row"><dt>통신</dt><dd>${position.planet.isOnline ? '접속 중' : '부재'}</dd></div>` : ''}
      </dl>
      <div class="slot-detail-actions">${action}</div>`;
    this.onSelect?.(position, this.coords);
  }
}
