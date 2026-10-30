/**
 * Fleet strike map: pick a system, build a strike group, then drag the squad
 * token onto a planet. A course arrow (with ETA) follows the pointer; dropping
 * on a valid target opens a confirmation card that launches the fleet.
 * Selecting a planet with a click/keyboard opens the same card (no drag needed).
 */
import { bindCargoControls } from '../CargoControls.js';
import { travelSeconds } from '../../data/fleetMath.js';
import { escapeHtml, formatAmount, formatDuration } from '../dom.js';
import { createDragArrow } from './dragArrow.js';
import { OrbitChart, relationOf, planetNameOf } from './OrbitChart.js';
import { FleetTrafficController } from './FleetTrafficController.js';
import { FleetTrafficLayer } from './FleetTrafficLayer.js';
import { FleetRoster } from './FleetRoster.js';
import { bindSystemNav, clampCoords } from './systemNav.js';

const MISSION_LABEL = { deploy: '이동', transport: '수송', attack: '공격', recycle: '잔해 수거', monster: '괴수 공격' };
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
  constructor({ root, fetchSystem, fetchTraffic = async () => ({ routes: [], total: 0, serverTime: new Date().toISOString() }), getAccount = () => null, getHome, getFormations, isPending, onManage, onLaunch, getBase = () => null, getPlanets = () => [], getResources = () => ({}), getSpeedSettings = () => ({}) }) {
    this.root = root;
    this.fetchSystem = fetchSystem;
    this.getHome = getHome;
    this.getResources = getResources;
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
    });
    this.confirmEl.addEventListener('change', (event) => {
      if (event.target.matches('[name="mission"]')) this.renderConfirm();
    });
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
      const formation = this.squad.formation;
      if (this.confirmFormation?.id !== formation?.id || this.confirmFormation?.revision !== formation?.revision) this.closeConfirm();
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
    // Wreckage can be collected by recyclers wherever it lies, in addition to the slot's usual mission.
    const extras = position.debris && this.squad.formation?.ships?.recycler > 0 ? ['recycle'] : [];
    if (position.monster) return { valid: true, position, relation: 'monster', mission: 'monster', extras };
    if (!position.occupied) {
      if (extras.length) return { valid: true, position, relation: 'empty', mission: 'recycle', extras };
      return { valid: false, reason: position.debris ? '잔해를 수거하려면 수확선이 포함된 함대를 선택하십시오' : '미점령 행성 — 성계도의 식민선 보내기로 개척하십시오' };
    }
    if (this.isHomeSlot(slot)) return { valid: false, reason: '출발지(본거지)입니다' };
    const relation = relationOf(position);
    return { valid: true, position, relation, mission: relation === 'other' ? 'attack' : 'deploy', extras };
  }

  eta(slot) {
    const { slowestSpeed } = this.squad.profile();
    if (!slowestSpeed) return null;
    return travelSeconds(this.getHome(), { ...this.coords, planet: slot }, slowestSpeed, 100, this.getSpeedSettings());
  }

  /** Keep mobile previews inside the chart; dragging still starts at the fleet. */
  courseOrigin() {
    const home = this.getHome();
    if (home.galaxy === this.coords?.galaxy && home.system === this.coords?.system) {
      const point = this.chart.slotCenter(home.planet);
      if (point) return point;
    }
    if (!this.drag && window.matchMedia('(max-width: 900px)').matches) {
      const rect = this.chart.svg.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.bottom - 20 };
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
    let clipRect = null;
    if (window.matchMedia('(max-width: 900px)').matches) {
      const chart = this.chart.svg.getBoundingClientRect();
      const scroller = scrollParent(this.root)?.getBoundingClientRect();
      clipRect = {
        top: Math.max(0, chart.top, scroller?.top ?? 0),
        right: Math.min(innerWidth, chart.right, scroller?.right ?? innerWidth),
        bottom: Math.min(innerHeight, chart.bottom, scroller?.bottom ?? innerHeight),
        left: Math.max(0, chart.left, scroller?.left ?? 0),
      };
    }
    if (clipRect && (clipRect.bottom <= clipRect.top || clipRect.right <= clipRect.left)) {
      this.arrow.hide();
      return;
    }
    this.arrow.update(this.courseOrigin(), end, 'valid', this.confirmArrow.label, clipRect);
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
    const selectedMission = this.confirmEl.querySelector('[name="mission"]:checked, [name="mission"][type="hidden"], select[name="mission"]')?.value;
    const cargo = Object.fromEntries([...this.confirmEl.querySelectorAll('[data-cargo]')].map(el=>[el.dataset.cargo,el.value]));
    const position = this.positions.find((p) => p.position === slot);
    const coordText = `[${this.coords.galaxy}:${this.coords.system}:${slot}]`;
    const title = position?.monster ? escapeHtml(position.monster.name) : escapeHtml(planetNameOf(position));
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
    const extras = verdict.extras || [];
    const base = verdict.relation === 'monster' ? 'monster' : verdict.mission === 'recycle' ? 'recycle' : verdict.relation === 'other' ? 'attack' : ['deploy', 'transport'].includes(selectedMission) ? selectedMission : 'deploy';
    const mission = selectedMission === 'recycle' && extras.includes('recycle') ? 'recycle' : base;
    const choices = verdict.relation === 'own' ? ['deploy', 'transport', ...extras] : [verdict.mission, ...extras];
    const profile = this.squad.profile();
    const eta = this.eta(slot);
    const crewShortage = (this.squad.formation?.crew || 0) < (this.squad.formation?.requiredCrew || 0);
    const shortages = this.getHome().fleetSupport?.shortages || [];
    const blockedSupplies = shortages.filter(key => mission !== 'deploy' || key !== 'food');
    const supplyShortage = blockedSupplies.length > 0;
    const supplyNames = blockedSupplies.map(key => ({food:'식량',metal:'금속',deuterium:'중수소'})[key] || key).join('·');
    const ready = !crewShortage && !supplyShortage && profile.ships > 0 && !this.squad.isPending(this.squad.selectedId);

    this.confirmArrow = ready ? { slot, label: `${MISSION_LABEL[mission]} · ${position.monster?.name || planetNameOf(position)}` } : null;
    this.drawConfirmArrow();

    const kicker = position.monster ? '괴수 출현 · 도착 시 위치를 다시 확인'
      : verdict.relation === 'empty' ? '미점령 궤도'
      : verdict.relation === 'other' ? (pirate ? '해적 거점 · 소탕 후 개척 가능' : '타 제국') : '아군';
    const monsterRows = position.monster ? `
        <div class="spec-row"><dt>괴수 체력</dt><dd>${Number(position.monster.hpPercent).toFixed(1)}%</dd></div>
        <div class="spec-row"><dt>CGC 보상 풀</dt><dd>${escapeHtml(position.monster.pool)} CGC</dd></div>
        <div class="spec-row"><dt>내 기여</dt><dd>${formatAmount(position.monster.mine?.damage || 0)}</dd></div>` : '';
    const debrisRows = position.debris ? `
        <div class="spec-row"><dt>전투 잔해</dt><dd>금속 ${formatAmount(position.debris.metal)} · 수정 ${formatAmount(position.debris.crystal)}</dd></div>` : '';
    this.confirmEl.innerHTML = `
      <p class="detail-muted">출발 ${escapeHtml(this.getHome().name)} [${this.getHome().galaxy}:${this.getHome().system}:${this.getHome().planet}]</p>
      <p class="detail-kicker">${coordText} · ${kicker}</p>
      <h4 class="slot-detail-title">${title}</h4>
      <dl class="spec-list single">
        ${position.planet || !position.monster ? `<div class="spec-row"><dt>사령관</dt><dd>${escapeHtml(position.planet?.username || '없음')}</dd></div>` : ''}
        ${monsterRows}${debrisRows}
        <div class="spec-row"><dt>${escapeHtml(this.squad.formation?.name || '함대')}</dt><dd>${profile.ships ? `${formatAmount(profile.ships)}척 · 공격력 ${formatAmount(profile.attack)}` : '미편성'}</dd></div>
        <div class="spec-row"><dt>도착 예정</dt><dd>${eta ? formatDuration(eta) : '—'}</dd></div>
      </dl>
      <p class="detail-muted">승무원 ${formatAmount(this.squad.formation?.crew || 0)}명 / 필요 ${formatAmount(this.squad.formation?.requiredCrew || 0)}명 · 귀환 후에도 함대에 남습니다.</p>
      ${crewShortage || supplyShortage ? `<p class="area-warning">${crewShortage ? '승무원 부족 · 함대 편성에서 충원하십시오.' : `${supplyNames} 고갈 · 보급을 확보하십시오.${shortages.includes('food') && verdict.relation === 'own' ? ' 식량이 부족해도 이동은 가능합니다.' : ''}`}</p>` : ''}
      ${mission === 'deploy' && shortages.includes('food') ? '<p class="area-warning">식량 고갈 · 기지 이동은 가능합니다. 도착지의 식량 수지를 확인하세요.</p>' : ''}
      ${extras.length || verdict.relation === 'monster' ? `<label class="field confirm-mission">임무<select name="mission" ${this.launching ? 'disabled' : ''}>${choices.map((id) => `<option value="${id}" ${mission === id ? 'selected' : ''}>${MISSION_LABEL[id]}</option>`).join('')}</select></label>` : verdict.relation === 'own' ? `<div class="mission-choice" role="group" aria-label="내 행성 임무">${['deploy', 'transport'].map(id => `<label><input type="radio" name="mission" value="${id}" ${mission === id ? 'checked' : ''} ${this.launching ? 'disabled' : ''}><span>${MISSION_LABEL[id]}</span></label>`).join('')}</div>` : `<input type="hidden" name="mission" value="${mission}"><p class="mission-kind">${MISSION_LABEL[mission]}</p>`}
      ${mission === 'monster' ? '<p class="detail-muted">괴수는 정해진 시각에 다른 성계로 이동합니다. 도착했을 때 이미 떠났다면 전투 없이 귀환합니다. CGC 보상은 지갑을 연결한 상태에서 입힌 피해량에 비례합니다.</p>' : ''}
      ${mission === 'recycle' ? '<p class="detail-muted">수확선만 잔해를 수거하며 먼저 도착한 함대가 먼저 가져갑니다. 적재량을 넘는 잔해는 남습니다.</p>' : ''}
      ${['monster', 'recycle'].includes(mission) ? '' : `<p class="mission-explanation">${{deploy:'함선·승무원과 적재 자원이 목적지에 남습니다. 도착 후 유지비는 목적지에서 발생합니다.',transport:'자원만 내려놓고 함대와 승무원은 출발지로 돌아옵니다.',attack:'전투 후 생존 함대가 귀환합니다. 약탈량은 적재 공간에 따라 결정됩니다.'}[mission]}</p>`}
      ${['attack', 'monster', 'recycle'].includes(mission) ? '' : `<details class="combat-cargo" ${mission === 'transport' || mission === 'deploy' ? 'open' : ''}><summary>자원 적재</summary><div class="field-row cols-3">${[['metal','금속'],['crystal','수정'],['deuterium','중수소']].map(([id,label])=>`<label class="field">${label}<input type="number" data-cargo="${id}" min="0" step="1" value="${escapeHtml(cargo[id] || '0')}" inputmode="numeric"></label>`).join('')}</div></details>`}
      <div class="confirm-actions">
        <button type="button" class="cmd-btn" data-confirm="cancel" ${this.launching?'disabled':''}>취소</button>
        <button type="button" class="cmd-btn primary" data-confirm="launch" ${ready && !this.launching ? '' : 'disabled'}>
          ${this.launching ? '출격 처리 중…' : crewShortage ? '승무원이 부족합니다' : supplyShortage ? '보급이 부족합니다' : ready ? mission === 'deploy' ? '함대 이동' : mission === 'transport' ? '수송 출발' : '출격' : '출격할 함대를 선택하십시오'}
        </button>
      </div>`;
    this.cargoControls = bindCargoControls(this.confirmEl.querySelector('.combat-cargo'), {
      capacity: profile.cargoCapacity,
      stock: this.getResources(),
      disabled: this.launching,
    });
  }

  async launch() {
    const verdict = this.evaluateTarget(this.target);
    const formation = this.confirmFormation;
    if (!verdict.valid || !formation || this.squad.profile().ships === 0 || this.launching || this.squad.isPending(formation.id)) return;
    const destination = { ...this.coords, planet: this.target };
    const mission = this.confirmEl.querySelector('[name="mission"]:checked, [name="mission"][type="hidden"], select[name="mission"]')?.value || verdict.mission;
    const monster = mission === 'monster' ? verdict.position.monster : null;
    const expectedTargetPlanetId = ['monster', 'recycle'].includes(mission) ? null : verdict.position.planet?.id || null;
    const cargo = Object.fromEntries([...this.confirmEl.querySelectorAll('[data-cargo]')].map(el=>[el.dataset.cargo,Number(el.value)]));
    this.launchError = '';
    this.launching = true;
    this.renderConfirm();
    try {
      await this.onLaunch({
        // A monster fight is an attack on the event, not on a planet.
        mission: monster ? 'attack' : mission, cargo, formationId: formation.id, expectedRevision: formation.revision,
        originPlanetId: this.getHome().id, ...(monster ? { target: { type: 'monster', eventId: monster.eventId } } : { expectedTargetPlanetId }), destination
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
