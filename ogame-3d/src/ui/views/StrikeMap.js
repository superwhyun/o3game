/**
 * Fleet strike map: pick a system, build a strike group, then drag the squad
 * token onto a planet. A course arrow (with ETA) follows the pointer; dropping
 * on a valid target opens a confirmation card that launches the fleet.
 * Selecting a planet with a click/keyboard opens the same card (no drag needed).
 */
import { bindCargoControls } from '../CargoControls.js';
import { travelSeconds } from '../../data/fleetMath.js';
import { recommendedCargo, surveyArea, surveyName } from '../../data/colonyPreparation.js';
import { escapeHtml, formatAmount, formatDuration } from '../dom.js';
import { createDragArrow } from './dragArrow.js';
import { OrbitChart, relationOf, planetNameOf } from './OrbitChart.js';
import { FleetTrafficController } from './FleetTrafficController.js';
import { FleetTrafficLayer } from './FleetTrafficLayer.js';
import { FleetRoster } from './FleetRoster.js';
import { bindSystemNav, clampCoords } from './systemNav.js';

const MISSION_LABEL = { deploy: '이동', transport: '수송', attack: '공격', colonize: '식민지 개척' };
const EDGE_SCROLL_ZONE = 72; // px from the scroller edge where dragging scrolls
const EDGE_SCROLL_MAX = 18; // px per frame at the very edge

/** Nearest ancestor that actually scrolls vertically. */
function scrollParent(node) {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

export class StrikeMap {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.root
   * @param {(galaxy: number, system: number) => Promise<object>} options.fetchSystem
   * @param {() => { galaxy: number, system: number, planet: number }} options.getHome  origin planet
   * @param {() => Record<string, number>} options.getOwnedFleet
   * @param {(order: { mission: string, fleet: object, destination: object }) => Promise<void>} options.onLaunch
   */
  constructor({ root, fetchSystem, fetchTraffic = async () => ({ routes: [], total: 0, serverTime: new Date().toISOString() }), getAccount = () => null, getHome, getFormations, isPending, onManage, onLaunch, getBase = () => null, getPlanets = () => [], getResources = () => ({}), getDevelopment = () => ({ terraformLevel: 0, bonusFields: 40 }), onScout = () => {}, getSpeedSettings = () => ({}) }) {
    this.root = root;
    this.fetchSystem = fetchSystem;
    this.getHome = getHome;
    this.getResources = getResources;
    this.getDevelopment = getDevelopment;
    this.onScout = onScout;
    this.getSpeedSettings = getSpeedSettings;
    this.onLaunch = onLaunch;
    this.coords = null;
    this.positions = [];
    this.target = null; // slot number of the pending confirmation
    this.drag = null;
    this.requestId = 0;
    this.launching = false;

    root.classList.add('strike-map');
    root.innerHTML = `
      <header class="strike-head">
        <h3 class="block-title">작전 지도 <small>作戰地圖</small></h3>
        <div class="galaxy-nav">
          <button class="nav-arrow" data-nav="prev" aria-label="이전 성계">◀</button>
          <label class="coord-field"><span>은하</span><input data-nav="galaxy" data-touch-skip="true" type="number" min="1" max="9" inputmode="numeric"></label>
          <span class="coord-sep" aria-hidden="true">:</span>
          <label class="coord-field"><span>성계</span><input data-nav="system" data-touch-skip="true" type="number" min="1" max="499" inputmode="numeric"></label>
          <button class="nav-arrow" data-nav="next" aria-label="다음 성계">▶</button>
          <button type="button" class="holo-btn-small" data-nav="apply">이동</button>
          <button class="holo-btn-small" data-nav="home">본거지</button>
        </div>
      </header>
      <div class="strike-body">
        <div class="orbit-host"></div>
        <aside class="strike-side">
          <section class="strike-confirm" hidden aria-live="polite"></section>
          <section class="squad-host"></section>
        </aside>
      </div>`;

    const control = (name) => root.querySelector(`[data-nav="${name}"]`);
    this.nav = bindSystemNav(
      { prev: control('prev'), next: control('next'), galaxy: control('galaxy'), system: control('system'), home: control('home'), apply: control('apply') },
      { current: () => this.coords, home: () => this.getHome(), getPlanets,
        go: coords => {
          const origin = this.getHome();
          const sameOrigin = coords.galaxy === origin.galaxy && coords.system === origin.system && coords.planet === origin.planet;
          return this.show(coords, { targetSlot: sameOrigin ? null : coords.planet || null });
        }
      }
    );
    this.chart = new OrbitChart(root.querySelector('.orbit-host'), {
      label: '작전 지도',
      onSelect: (slot) => this.openConfirm(slot)
    });
    this.traffic = new FleetTrafficLayer(this.chart, { overlayOnly: true });
    this.trafficController = new FleetTrafficController({ fetchTraffic, getAccount,
      onData: data => this.traffic.update(data), onStatus: error => this.traffic.setStatus(error),
      onReset: () => this.traffic.reset(),
    });
    this.squad = new FleetRoster(root.querySelector('.squad-host'), {
      getFormations, isPending, onManage, getBase, getShortages: () => this.getHome().fleetSupport?.shortages || [],
      onChange: () => { if (this.target) { this.confirmFormation = this.squad.formation ? { ...this.squad.formation } : null; this.renderConfirm(); } }
    });
    this.confirmEl = root.querySelector('.strike-confirm');
    this.arrow = createDragArrow();

    this.bindDrag();
    this.confirmArrow = null;
    const redraw = () => {
      if (this.confirmArrow && !this.drag) this.drawConfirmArrow();
    };
    document.addEventListener('scroll', redraw, { capture: true, passive: true });
    window.addEventListener('resize', redraw);
    this.confirmEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-confirm]')?.dataset.confirm;
      if (action === 'launch') this.launch();
      if (action === 'cancel') this.closeConfirm();
      if (action === 'scout') this.onScout({ ...this.coords, planet: this.target });
      if (action === 'recommend') {
        const input = this.confirmEl.querySelector('[name="colonists"]');
        if (!input?.reportValidity()) return;
        const cargo = recommendedCargo(this.getResources(), this.squad.profile().cargoCapacity, Number(input.value));
        for (const el of this.confirmEl.querySelectorAll('[data-cargo]')) el.value = cargo[el.dataset.cargo];
        this.confirmEl.querySelector('.combat-cargo').open = true;
        this.cargoControls?.sync();
        this.updateCargoWarning();
      }
    });
    this.confirmEl.addEventListener('change', (event) => {
      if (event.target.matches('[name="mission"]')) this.renderConfirm();
    });
    this.confirmEl.addEventListener('input', () => this.updateCargoWarning());
  }

  /**
   * @param {{ galaxy: number, system: number }} [coords] defaults to last viewed / home system
   * @param {{ targetSlot?: number }} [options] open the confirmation for this slot once loaded
   */
  async show(coords = this.coords || this.getHome(), { targetSlot = null } = {}) {
    if (this.launching) return;
    this.endDrag();
    const next = clampCoords(coords);
    this.coords = next;
    this.setActive(true);
    this.trafficController.setSystem(next);
    this.nav.sync(next);
    this.squad.render();
    this.closeConfirm();

    const requestId = ++this.requestId;
    this.root.classList.add('is-loading');
    try {
      const data = await this.fetchSystem(next.galaxy, next.system);
      if (requestId !== this.requestId) return;
      this.positions = data.positions;
      this.chart.setSystem(next, data.positions, targetSlot);
      if (targetSlot) this.openConfirm(targetSlot);
      await this.refreshTraffic();
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.positions = [];
      this.showConfirmMessage(`성계 정보를 불러오지 못했습니다: ${error.message}`);
    } finally {
      if (requestId === this.requestId) this.root.classList.remove('is-loading');
    }
  }

  setActive(active) {
    this.trafficController.setActive(active);
    if (active) this.chart.start(); else this.chart.stop();
  }

  refreshTraffic() { return this.trafficController.refresh(); }

  /** Re-read owned ships (after sync / launch). */
  refresh() {
    if (this.drag) return;
    this.squad.render();
    if (this.target && !this.launching) {
      if (!this.squad.formation || this.confirmFormation?.id !== this.squad.formation.id || this.confirmFormation?.revision !== this.squad.formation.revision) this.closeConfirm();
      else if (this.confirmSpeedSettings !== JSON.stringify(this.getSpeedSettings()) || this.confirmSupply !== JSON.stringify(this.getHome().fleetSupport?.shortages || [])) this.renderConfirm();
      else this.drawConfirmArrow();
    }
  }

  isHomeSlot(slot) {
    const home = this.getHome();
    return home.galaxy === this.coords?.galaxy && home.system === this.coords?.system && home.planet === slot;
  }

  /** Same rule as the server: a planet must exist there and differ from the origin. */
  evaluateTarget(slot) {
    const position = this.positions.find((p) => p.position === slot);
    if (!position) return { valid: false, reason: '목표 없음' };
    if (!position.occupied) return this.squad.formation?.ships?.colonyShip > 0
      ? { valid: true, position, relation: 'empty', mission: 'colonize' }
      : { valid: false, reason: '미점령 행성 — 식민선이 포함된 함대를 선택하십시오' };
    if (this.isHomeSlot(slot)) return { valid: false, reason: '출발지(본거지)입니다' };
    const relation = relationOf(position);
    return { valid: true, position, relation, mission: relation === 'other' ? 'attack' : 'deploy' };
  }

  eta(slot) {
    const { slowestSpeed } = this.squad.profile();
    if (!slowestSpeed) return null;
    return travelSeconds(this.getHome(), { ...this.coords, planet: slot }, slowestSpeed, 100, this.getSpeedSettings());
  }

  /** Arrow start: the home planet when it is on this map, otherwise the token. */
  courseOrigin() {
    const home = this.getHome();
    if (home.galaxy === this.coords?.galaxy && home.system === this.coords?.system) {
      const point = this.chart.slotCenter(home.planet);
      if (point) return point;
    }
    const rect = this.squad.token.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  bindDrag() {
    const token = this.squad.root;
    token.addEventListener('pointerdown', (event) => {
      const card = event.target.closest('[data-combat-fleet]');
      if (!card || card.disabled || event.button > 0 || !this.coords || this.launching) return;
      this.squad.select(card.dataset.combatFleet);
      event.preventDefault();
      token.setPointerCapture(event.pointerId);
      this.closeConfirm();
      this.chart.freeze();
      this.drag = { pointerId: event.pointerId, slot: null, valid: false, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
      document.body.classList.add('is-plotting-course');
      this.updateDrag(event.clientX, event.clientY);
      this.startEdgeScroll();
    });
    token.addEventListener('pointermove', (event) => {
      if (this.drag?.pointerId !== event.pointerId) return;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.updateDrag(event.clientX, event.clientY);
    });
    token.addEventListener('pointerup', (event) => {
      if (this.drag?.pointerId !== event.pointerId) return;
      const { slot, valid, startX, startY } = this.drag;
      this.endDrag();
      if (valid && Math.hypot(event.clientX-startX,event.clientY-startY)>6) this.openConfirm(slot);
    });
    token.addEventListener('pointercancel', () => this.endDrag());
    token.addEventListener('lostpointercapture', () => this.drag && this.endDrag());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.drag) this.endDrag();
    });
  }

  updateDrag(x, y) {
    const slot = this.chart.slotAt(x, y);
    const verdict = slot ? this.evaluateTarget(slot) : null;
    this.drag.slot = slot;
    this.drag.valid = Boolean(verdict?.valid);
    this.chart.setHighlight(slot, verdict ? (verdict.valid ? 'valid' : 'invalid') : null);

    const origin = this.courseOrigin();
    if (verdict?.valid) {
      const end = this.chart.slotCenter(slot) || { x, y };
      const eta = this.eta(slot);
      const name = planetNameOf(verdict.position);
      this.arrow.update(origin, end, 'valid', `${MISSION_LABEL[verdict.mission]} · ${name}${eta ? ` · ${formatDuration(eta)}` : ''}`);
    } else {
      this.arrow.update(origin, { x, y }, verdict ? 'invalid' : 'idle', verdict?.reason || '목표 행성에 놓으십시오');
    }
  }

  /**
   * While dragging near the top/bottom of the scrolling panel, scroll it so a
   * target that is off-screen (e.g. the map above the token on phones) comes into reach.
   */
  startEdgeScroll() {
    const scroller = scrollParent(this.root);
    if (!scroller) return;
    const tick = () => {
      if (!this.drag) return;
      const rect = scroller.getBoundingClientRect();
      const fromTop = this.drag.y - rect.top;
      const fromBottom = rect.bottom - this.drag.y;
      let delta = 0;
      if (fromTop < EDGE_SCROLL_ZONE) delta = -EDGE_SCROLL_MAX * (1 - Math.max(0, fromTop) / EDGE_SCROLL_ZONE);
      else if (fromBottom < EDGE_SCROLL_ZONE) delta = EDGE_SCROLL_MAX * (1 - Math.max(0, fromBottom) / EDGE_SCROLL_ZONE);
      if (delta) {
        const before = scroller.scrollTop;
        scroller.scrollTop += delta;
        if (scroller.scrollTop !== before) this.updateDrag(this.drag.x, this.drag.y);
      }
      this.edgeScrollFrame = requestAnimationFrame(tick);
    };
    this.edgeScrollFrame = requestAnimationFrame(tick);
  }

  endDrag() {
    if (this.edgeScrollFrame) cancelAnimationFrame(this.edgeScrollFrame);
    this.edgeScrollFrame = null;
    this.drag = null;
    document.body.classList.remove('is-plotting-course');
    this.chart.setHighlight(null, null);
    this.arrow.hide();
    this.chart.thaw();
  }

  openConfirm(slot) {
    if (this.launching || this.drag) return;
    this.confirmFormation = this.squad.formation ? { ...this.squad.formation } : null;
    this.target = slot;
    this.chart.setSelected(slot);
    this.chart.freeze();
    this.renderConfirm();
    // On narrow layouts the card sits below the map; bring it into view (no-op when visible).
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.confirmEl.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }

  /** Course line for the open confirmation; redrawn on scroll/resize since it is in viewport space. */
  drawConfirmArrow() {
    const end = this.confirmArrow && this.chart.slotCenter(this.confirmArrow.slot);
    if (!end || this.root.offsetParent === null) {
      this.arrow.hide();
      return;
    }
    this.arrow.update(this.courseOrigin(), end, 'valid', this.confirmArrow.label);
  }

  closeConfirm() {
    this.confirmFormation = null;
    this.confirmArrow = null;
    this.target = null;
    this.confirmEl.hidden = true;
    this.arrow.hide();
    this.chart.thaw();
  }

  showConfirmMessage(message) {
    this.confirmEl.hidden = false;
    this.confirmEl.innerHTML = `<p class="galaxy-error">${escapeHtml(message)}</p>`;
  }

  renderConfirm() {
    this.confirmSpeedSettings = JSON.stringify(this.getSpeedSettings());
    this.confirmSupply = JSON.stringify(this.getHome().fleetSupport?.shortages || []);
    const slot = this.target;
    const verdict = this.evaluateTarget(slot);
    const selectedMission = this.confirmEl.querySelector('[name="mission"]:checked, [name="mission"][type="hidden"]')?.value;
    const cargo = Object.fromEntries([...this.confirmEl.querySelectorAll('[data-cargo]')].map(el=>[el.dataset.cargo,el.value]));
    const enteredColonists = this.confirmEl.querySelector('[name="colonists"]')?.value;
    const position = this.positions.find((p) => p.position === slot);
    const coordText = `[${this.coords.galaxy}:${this.coords.system}:${slot}]`;
    const title = escapeHtml(planetNameOf(position));
    this.confirmEl.hidden = false;

    if (!verdict.valid) {
      this.confirmArrow = null;
      this.arrow.hide();
      this.confirmEl.innerHTML = `
        <p class="detail-kicker">${coordText}</p>
        <h4 class="slot-detail-title">${title}</h4>
        <p class="detail-muted">${escapeHtml(verdict.reason)}</p>
        <div class="confirm-actions"><button type="button" class="cmd-btn" data-confirm="cancel">닫기</button></div>`;
      return;
    }

    const pirate = !!position.planet?.isPirate;
    const mission = verdict.relation === 'empty' ? 'colonize' : verdict.relation === 'other' ? 'attack' : ['deploy', 'transport'].includes(selectedMission) ? selectedMission : 'deploy';
    const profile = this.squad.profile();
    const eta = this.eta(slot);
    const availablePopulation = Math.max(0, Math.floor(this.getHome().population?.count ?? this.getHome().populationState?.count ?? 0));
    const colonists = enteredColonists ?? Math.min(10, availablePopulation);
    const crewShortage = (this.squad.formation?.crew || 0) < (this.squad.formation?.requiredCrew || 0);
    const shortages = this.getHome().fleetSupport?.shortages || [];
    const blockedSupplies = shortages.filter(key => mission !== 'deploy' || key !== 'food');
    const supplyShortage = blockedSupplies.length > 0;
    const supplyNames = blockedSupplies.map(key => ({food:'식량',metal:'금속',deuterium:'중수소'})[key] || key).join('·');
    const ready = !crewShortage && !supplyShortage && profile.ships > 0 && !this.squad.isPending(this.squad.selectedId) && (mission !== 'colonize' || availablePopulation > 0);
    const survey = position.survey?.total != null && position.survey?.baseUsablePercent != null ? position.survey : null;
    const development = this.getDevelopment();
    const surveyInfo = survey ? `<section class="colony-survey"><h5>정찰된 지형</h5><p>${escapeHtml(surveyName(survey))} · ${formatAmount(survey.diameter)}km · ${survey.minTemp}~${survey.maxTemp}°C</p><p>전체 ${survey.total}칸 · 초기 ${surveyArea(survey, 0, development.bonusFields)}칸 · 내 테라포밍 적용 ${surveyArea(survey, development.terraformLevel, development.bonusFields)}칸</p><small>${escapeHtml(new Date(survey.observedAt).toLocaleString('ko-KR'))} 관측 · 현재 점령 상태는 달라질 수 있습니다.</small></section>` : '<p class="detail-muted">지형 정보 미확인 · 정찰하면 개척 면적을 확인할 수 있습니다.</p><button type="button" class="holo-btn-small" data-confirm="scout">정찰하러 가기</button>';
    this.confirmArrow = ready ? { slot, label: `${MISSION_LABEL[mission]} · ${planetNameOf(position)}` } : null;
    this.drawConfirmArrow();

    this.confirmEl.innerHTML = `
      <p class="detail-muted">출발 ${escapeHtml(this.getHome().name)} [${this.getHome().galaxy}:${this.getHome().system}:${this.getHome().planet}]</p>
      <p class="detail-kicker">${coordText} · ${verdict.relation === 'empty' ? '개척 가능 · 도착 시 점령 상태 재확인' : verdict.relation === 'other' ? (pirate ? '해적 거점 · 소탕 후 개척 가능' : '타 제국') : '아군'}</p>
      <h4 class="slot-detail-title">${title}</h4>
      <dl class="spec-list single">
        <div class="spec-row"><dt>사령관</dt><dd>${escapeHtml(position.planet?.username || '없음')}</dd></div>
        <div class="spec-row"><dt>${escapeHtml(this.squad.formation?.name || '함대')}</dt><dd>${profile.ships ? `${formatAmount(profile.ships)}척 · 공격력 ${formatAmount(profile.attack)}` : '미편성'}</dd></div>
        <div class="spec-row"><dt>도착 예정</dt><dd>${eta ? formatDuration(eta) : '—'}</dd></div>
      </dl>
      <p class="detail-muted">승무원 ${formatAmount(this.squad.formation?.crew || 0)}명 / 필요 ${formatAmount(this.squad.formation?.requiredCrew || 0)}명 · 귀환 후에도 함대에 남습니다.</p>
      ${crewShortage || supplyShortage ? `<p class="area-warning">${crewShortage ? '승무원 부족 · 함대 편성에서 충원하십시오.' : `${supplyNames} 고갈 · 보급을 확보하십시오.${shortages.includes('food') && verdict.relation === 'own' ? ' 식량이 부족해도 이동은 가능합니다.' : ''}`}</p>` : ''}
      ${mission === 'deploy' && shortages.includes('food') ? '<p class="area-warning">식량 고갈 · 기지 이동은 가능합니다. 도착지의 식량 수지를 확인하세요.</p>' : ''}
      ${verdict.relation === 'own' ? `<div class="mission-choice" role="group" aria-label="내 행성 임무">${['deploy', 'transport'].map(id => `<label><input type="radio" name="mission" value="${id}" ${mission === id ? 'checked' : ''} ${this.launching ? 'disabled' : ''}><span>${MISSION_LABEL[id]}</span></label>`).join('')}</div>` : `<input type="hidden" name="mission" value="${mission}"><p class="mission-kind">${MISSION_LABEL[mission]}</p>`}
      <p class="mission-explanation">${{deploy:'함선·승무원과 적재 자원이 목적지에 남습니다. 도착 후 유지비는 목적지에서 발생합니다.',transport:'자원만 내려놓고 함대와 승무원은 출발지로 돌아옵니다.',attack:'전투 후 생존 함대가 귀환합니다. 약탈량은 적재 공간에 따라 결정됩니다.',colonize:'빈 행성을 개척합니다. 도착 시 점령 상태를 다시 확인합니다.'}[mission]}</p>
      ${mission === 'colonize' ? `<label class="field">개척 인구 (명)<input name="colonists" type="number" min="1" max="${Math.min(availablePopulation, profile.cargoCapacity)}" step="1" value="${escapeHtml(colonists)}" inputmode="numeric" required ${this.launching ? 'disabled' : ''}></label><p class="detail-muted">출발 행성 인구 ${formatAmount(availablePopulation)}명 · 1명당 적재 공간 1칸. 탑승 인구는 출발 시 차감되며 개척 실패·임무 취소 시 귀환합니다.</p><p class="detail-muted">도착 시 식민선 1척으로 개척합니다. 인구·적재 자원·나머지 함선은 새 식민지에 정착합니다. 많은 인구를 보내면 주거·식량 부족이 생길 수 있습니다.</p>` : ''}
      ${mission !== 'attack' ? `<details class="combat-cargo" ${mission === 'transport' || mission === 'deploy' ? 'open' : ''}><summary>자원 적재</summary><div class="field-row cols-3">${[['metal','금속'],['crystal','수정'],['deuterium','중수소']].map(([id,label])=>`<label class="field">${label}<input type="number" data-cargo="${id}" min="0" step="1" value="${escapeHtml(cargo[id] || '0')}" inputmode="numeric"></label>`).join('')}</div></details>` : ''}
      ${mission === 'colonize' ? `<button type="button" class="holo-btn-small" data-confirm="recommend" ${this.launching ? 'disabled' : ''}>추천 적재</button><p class="colony-cargo-warning" role="status"></p>${surveyInfo}` : ''}
      <div class="confirm-actions">
        <button type="button" class="cmd-btn" data-confirm="cancel" ${this.launching?'disabled':''}>취소</button>
        <button type="button" class="cmd-btn primary" data-confirm="launch" ${ready && !this.launching ? '' : 'disabled'}>
          ${this.launching ? '출격 처리 중…' : crewShortage ? '승무원이 부족합니다' : supplyShortage ? '보급이 부족합니다' : ready ? mission === 'deploy' ? '함대 이동' : mission === 'transport' ? '수송 출발' : '출격' : mission === 'colonize' && !availablePopulation ? '탑승할 인구가 없습니다' : '출격할 함대를 선택하십시오'}
        </button>
      </div>`;
    this.cargoControls = bindCargoControls(this.confirmEl.querySelector('.combat-cargo'), {
      capacity: profile.cargoCapacity,
      stock: this.getResources(),
      population: () => mission === 'colonize' ? Number(this.confirmEl.querySelector('[name="colonists"]')?.value || 0) : 0,
      disabled: this.launching,
    });
    this.confirmEl.querySelector('[name="colonists"]')?.addEventListener('input', () => this.cargoControls?.sync());
    this.updateCargoWarning();
  }

  updateCargoWarning() {
    const warning = this.confirmEl.querySelector('.colony-cargo-warning');
    if (!warning) return;
    const sum = [...this.confirmEl.querySelectorAll('[data-cargo]')].reduce((n, el) => n + Number(el.value || 0), 0);
    warning.textContent = sum === 0 ? '자원 없이 출격하면 새 식민지에서 초기 건설이 어렵습니다. 추천 적재 또는 본거지 재보급을 준비하세요.' : '';
  }

  async launch() {
    const verdict = this.evaluateTarget(this.target);
    const formation = this.confirmFormation;
    if (!verdict.valid || !formation || this.squad.profile().ships === 0 || this.launching || this.squad.isPending(formation.id)) return;
    const destination = { ...this.coords, planet: this.target };
    const mission = this.confirmEl.querySelector('[name="mission"]:checked, [name="mission"][type="hidden"]')?.value || verdict.mission;
    const expectedTargetPlanetId = verdict.position.planet?.id || null;
    const cargo = Object.fromEntries([...this.confirmEl.querySelectorAll('[data-cargo]')].map(el=>[el.dataset.cargo,Number(el.value)]));
    const colonistsInput = this.confirmEl.querySelector('[name="colonists"]');
    if (colonistsInput && !colonistsInput.reportValidity()) return;
    const colonists = mission === 'colonize' ? Number(colonistsInput?.value) : 0;
    this.launchError = '';
    this.launching = true;
    this.renderConfirm();
    try {
      await this.onLaunch({
        mission, cargo, colonists, formationId: formation.id, expectedRevision: formation.revision,
        originPlanetId: this.getHome().id, expectedTargetPlanetId, destination
      });
      this.squad.render();
      this.closeConfirm();
    } catch (error) {
      this.launchError = error.message || '출격하지 못했습니다. 입력값을 확인해 주세요.';
    } finally {
      this.launching = false;
      if (this.target) this.renderConfirm();
      if (this.launchError && this.target) this.confirmEl.insertAdjacentHTML('beforeend', `<p class="galaxy-error" role="alert">${escapeHtml(this.launchError)}</p>`);
    }
  }
}
