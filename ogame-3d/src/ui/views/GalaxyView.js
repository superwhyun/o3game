/**
 * Star-system view: orbital chart with a selected-planet detail card.
 */
import { escapeHtml, formatAmount } from '../dom.js';
import { FleetTrafficController } from './FleetTrafficController.js';
import { FleetTrafficLayer } from './FleetTrafficLayer.js';
import { OrbitChart, relationOf, planetNameOf } from './OrbitChart.js';
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
  constructor({ root, controls, fetchSystem, getHome, getPlanets = () => [], onTarget, onColonize, onSelect, fetchTraffic, getAccount = () => null, onMissions }) {
    this.root = root;
    this.fetchSystem = fetchSystem;
    this.getHome = getHome;
    this.getAccount = getAccount;
    this.onTarget = onTarget;
    this.onColonize = onColonize;
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
    this.detailEl = this.root.querySelector('.slot-detail');
    this.statusEl = document.createElement('p');
    this.statusEl.className = 'galaxy-error';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.hidden = true;
    this.detailEl.before(this.statusEl);
    this.scoutEl = this.root.querySelector('.scout-panel');
    this.nav = bindSystemNav(controls, {
      current: () => this.coords,
      home: () => this.getHome(),
      getPlanets,
      go: (coords) => this.show(coords)
    });

    this.detailEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!this.coords || !this.selected) return;
      const target = { ...this.coords, planet: this.selected };
      if (action === 'target') this.onTarget(target);
      if (action === 'colonize') this.onColonize?.(target);
    });
  }

  /** @param {{ galaxy: number, system: number }} [coords] defaults to the last viewed or home system */
  async show(coords = this.coords || this.getHome()) {
    const next = clampCoords(coords);
    const account = this.getAccount();
    const sameSystem = this.dataAccount === account && this.coords?.galaxy === next.galaxy && this.coords?.system === next.system;
    if (!this.coords || this.coords.galaxy !== next.galaxy || this.coords.system !== next.system) this.selected = null;
    this.coords = next;
    this.setActive(true);
    this.trafficController.setSystem(next);
    this.nav.sync(next);

    const requestId = ++this.requestId;
    this.root.classList.add('is-loading');
    this.loading = true;
    this.statusEl.hidden = true;
    try {
      const data = await this.fetchSystem(next.galaxy, next.system);
      if (requestId !== this.requestId) return; // a newer request superseded this one
      this.data = data;
      this.dataAccount = account;
      this.lastFetchAt = Date.now();
      if (Number.isInteger(coords.planet) && coords.planet >= 1 && coords.planet <= 15) this.selected = coords.planet;
      this.selected ??= data.positions.find((p) => p.owner === 'self')?.position
        ?? data.positions.find((p) => p.occupied)?.position
        ?? null;
      this.chart.setSystem(next, data.positions, this.selected);
      this.renderDetail();
      if (this.fetchTraffic) await this.trafficController.refresh();
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.statusEl.textContent = `성계 정보를 불러오지 못했습니다: ${error.message}`;
      this.statusEl.hidden = false;
      if (!sameSystem || !this.data) {
        this.data = null;
        this.chart.setSystem(next, [], null);
        this.detailEl.innerHTML = '';
      }
    } finally {
      if (requestId === this.requestId) { this.loading = false; this.root.classList.remove('is-loading'); }
    }
  }

  setActive(active) {
    this.trafficController.setActive(active);
    if(active) this.chart.start(); else this.chart.stop();
  }

  async refreshMap({ background = false } = {}) {
    if (!this.coords || !this.data || this.loading || this.mapRefreshing || (background && Date.now() - (this.lastFetchAt || 0) < 30000)) return;
    const requestId = this.requestId;
    const coords = this.coords;
    this.mapRefreshing = true;
    try {
      const data = await this.fetchSystem(coords.galaxy, coords.system);
      if (requestId !== this.requestId) return;
      this.lastFetchAt = Date.now();
      this.statusEl.hidden = true;
      if (JSON.stringify(data.positions) === JSON.stringify(this.data?.positions)) return;
      this.data = data;
      this.chart.setSystem(coords, data.positions, this.selected);
      this.renderDetail();
    } catch (error) {
      if (requestId === this.requestId) { this.statusEl.textContent = `갱신 대기 · ${error.message}`; this.statusEl.hidden = false; }
      throw error;
    } finally { this.mapRefreshing = false; }
  }

  refreshTraffic() { return this.trafficController.refresh(); }

  select(slot) {
    this.selected = slot;
    this.chart.setSelected(slot);
    this.renderDetail();
  }

  renderDetail() {
    const position = this.data.positions.find((p) => p.position === this.selected);
    if (!position) {
      this.detailEl.innerHTML = '<p class="detail-muted">궤도를 선택하십시오.</p>';
      return;
    }
    const relation = relationOf(position);
    const { galaxy, system } = this.coords;
    const monsterAction = '<button type="button" class="cmd-btn primary" data-action="target">괴수 공격 목표 지정</button>';
    const action = position.monster ? monsterAction : {
      own: '<button type="button" class="cmd-btn" disabled>아군 행성</button>',
      other: '<button type="button" class="cmd-btn primary" data-action="target">공격 · 함대운용</button>',
      empty: '<button type="button" class="cmd-btn primary" data-action="colonize">식민선 보내기</button><button type="button" class="cmd-btn" data-action="target">개척 함대 선택</button>'
    }[relation];
    const extra = `${position.monster ? `
        <div class="spec-row"><dt>괴수</dt><dd>${escapeHtml(position.monster.name)}</dd></div>
        <div class="spec-row"><dt>체력</dt><dd>${Number(position.monster.hpPercent).toFixed(1)}%</dd></div>
        <div class="spec-row"><dt>CGC 보상 풀</dt><dd>${escapeHtml(position.monster.pool)} CGC</dd></div>
        <div class="spec-row"><dt>이벤트 종료</dt><dd>${new Date(position.monster.endsAt).toLocaleString('ko-KR')}</dd></div>` : ''}${position.debris ? `
        <div class="spec-row"><dt>전투 잔해</dt><dd>금속 ${formatAmount(position.debris.metal)} · 수정 ${formatAmount(position.debris.crystal)}</dd></div>` : ''}`;

    this.detailEl.innerHTML = `
      <p class="detail-kicker">[${galaxy}:${system}:${position.position}] · 제${position.position}궤도</p>
      <h3 class="slot-detail-title">${position.monster ? escapeHtml(position.monster.name) : escapeHtml(planetNameOf(position))}</h3>
      <dl class="spec-list single">
        <div class="spec-row"><dt>관계</dt><dd class="rel-${relation}">${position.planet?.isPirate ? `해적 거점 · Lv.${position.planet.pirateLevel}` : RELATION_LABEL[relation]}</dd></div>
        ${position.planet ? `
          <div class="spec-row"><dt>사령관</dt><dd>${escapeHtml(position.planet.username)}</dd></div>
          <div class="spec-row"><dt>통신</dt><dd>${position.planet.isOnline ? '접속 중' : '부재'}</dd></div>` : ''}
        ${extra}
      </dl>
      <div class="slot-detail-actions">${action}</div>`;
    this.onSelect?.(position, this.coords);
  }
}
