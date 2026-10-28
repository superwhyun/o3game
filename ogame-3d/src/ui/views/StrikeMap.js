/**
 * Fleet strike map: pick a system, build a strike group, then drag the squad
 * token onto a planet. A course arrow (with ETA) follows the pointer; dropping
 * on a valid target opens a confirmation card that launches the fleet.
 * Selecting a planet with a click/keyboard opens the same card (no drag needed).
 */
import { travelSeconds } from '../../data/fleetMath.js';
import { escapeHtml, formatAmount, formatDuration } from '../dom.js';
import { createDragArrow } from './dragArrow.js';
import { OrbitChart, relationOf } from './OrbitChart.js';
import { FleetRoster } from './FleetRoster.js';
import { bindSystemNav, clampCoords } from './systemNav.js';

const MISSION_LABEL = { attack: '공격', transport: '수송', colonize: '식민지 개척', recycle: '잔해 수거', monster: '괴수 공격' };
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
  constructor({ root, fetchSystem, getHome, getFormations, isPending, onManage, onLaunch }) {
    this.root = root;
    this.fetchSystem = fetchSystem;
    this.getHome = getHome;
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
          <label class="coord-field"><span>은하</span><input data-nav="galaxy" type="number" min="1" max="9" inputmode="numeric"></label>
          <span class="coord-sep" aria-hidden="true">:</span>
          <label class="coord-field"><span>성계</span><input data-nav="system" type="number" min="1" max="499" inputmode="numeric"></label>
          <button class="nav-arrow" data-nav="next" aria-label="다음 성계">▶</button>
          <button class="holo-btn-small" data-nav="home">본거지</button>
        </div>
      </header>
      <div class="strike-body">
        <div class="orbit-host"></div>
        <aside class="strike-side">
          <section class="squad-host"></section>
          <section class="strike-confirm" hidden aria-live="polite"></section>
        </aside>
      </div>`;

    const control = (name) => root.querySelector(`[data-nav="${name}"]`);
    this.nav = bindSystemNav(
      { prev: control('prev'), next: control('next'), galaxy: control('galaxy'), system: control('system'), home: control('home') },
      { current: () => this.coords, home: () => this.getHome(), go: (coords) => this.show(coords) }
    );
    this.chart = new OrbitChart(root.querySelector('.orbit-host'), {
      label: '작전 지도',
      onSelect: (slot) => this.openConfirm(slot)
    });
    this.squad = new FleetRoster(root.querySelector('.squad-host'), {
      getFormations, isPending, onManage,
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
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.positions = [];
      this.showConfirmMessage(`성계 정보를 불러오지 못했습니다: ${error.message}`);
    } finally {
      if (requestId === this.requestId) this.root.classList.remove('is-loading');
    }
  }

  /** Re-read owned ships (after sync / launch). */
  refresh() {
    if (this.drag) return;
    this.squad.render();
    if (this.target && !this.launching) {
      if (!this.squad.formation || this.confirmFormation?.id !== this.squad.formation.id || this.confirmFormation?.revision !== this.squad.formation.revision) this.closeConfirm();
      else this.drawConfirmArrow();
    }
  }

  isHomeSlot(slot) {
    const home = this.getHome();
    return home.galaxy === this.coords?.galaxy && home.system === this.coords?.system && home.planet === slot;
  }

  /** Missions the selected formation could fly to this slot, mirroring the server rules. */
  missionsFor(position) {
    const ships = this.squad.formation?.ships || {};
    const missions = [];
    if (position.monster) missions.push('monster');
    else if (!position.occupied) { if (ships.colonyShip > 0) missions.push('colonize'); }
    else if (!this.isHomeSlot(position.position)) {
      if (relationOf(position) === 'other') missions.push('attack');
      missions.push('transport');
    }
    if (position.debris && ships.recycler > 0) missions.push('recycle');
    return missions;
  }

  /** Same rule as the server: something must be there to act on, and it differs from the origin. */
  evaluateTarget(slot) {
    const position = this.positions.find((p) => p.position === slot);
    if (!position) return { valid: false, reason: '목표 없음' };
    const relation = position.monster ? 'monster' : relationOf(position);
    const missions = this.missionsFor(position);
    if (missions.length) return { valid: true, position, relation, mission: missions[0], missions };
    if (position.monster) return { valid: false, reason: '괴수를 공격할 함대를 선택하십시오' };
    if (!position.occupied) return { valid: false, reason: position.debris ? '잔해를 수거하려면 수확선이 포함된 함대를 선택하십시오' : '미점령 행성 — 식민선이 포함된 함대를 선택하십시오' };
    if (this.isHomeSlot(slot)) return { valid: false, reason: '출발지(본거지)입니다' };
    return { valid: false, reason: '목표 없음' };
  }

  eta(slot) {
    const { slowestSpeed } = this.squad.profile();
    if (!slowestSpeed) return null;
    return travelSeconds(this.getHome(), { ...this.coords, planet: slot }, slowestSpeed);
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
      const name = verdict.position.planet?.name || `${slot}궤도`;
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
    const slot = this.target;
    const verdict = this.evaluateTarget(slot);
    const selectedMission = this.confirmEl.querySelector('[name="mission"]')?.value;
    const cargo = Object.fromEntries([...this.confirmEl.querySelectorAll('[data-cargo]')].map(el=>[el.dataset.cargo,el.value]));
    const position = this.positions.find((p) => p.position === slot);
    const coordText = `[${this.coords.galaxy}:${this.coords.system}:${slot}]`;
    const title = position?.monster ? escapeHtml(position.monster.name) : position?.planet ? escapeHtml(position.planet.name) : '미점령 행성';
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

    const mission = verdict.missions.includes(selectedMission) ? selectedMission : verdict.mission;
    const profile = this.squad.profile();
    const eta = this.eta(slot);
    const ready = profile.ships > 0 && !this.squad.isPending(this.squad.selectedId);
    this.confirmArrow = ready ? { slot, label: `${MISSION_LABEL[mission]} · ${position.monster?.name || position.planet?.name || '미점령 행성'}` } : null;
    this.drawConfirmArrow();

    const kicker = position.monster ? '괴수 출현 · 도착 시 위치를 다시 확인'
      : verdict.relation === 'empty' ? '개척 가능 · 도착 시 점령 상태 재확인'
      : verdict.relation === 'other' ? '타 제국' : '아군';
    const monsterRows = position.monster ? `
        <div class="spec-row"><dt>괴수 체력</dt><dd>${Number(position.monster.hpPercent).toFixed(1)}%</dd></div>
        <div class="spec-row"><dt>CGC 보상 풀</dt><dd>${escapeHtml(position.monster.pool)} CGC</dd></div>
        <div class="spec-row"><dt>내 기여</dt><dd>${formatAmount(position.monster.mine?.damage || 0)}</dd></div>` : '';
    const debrisRows = position.debris ? `
        <div class="spec-row"><dt>전투 잔해</dt><dd>금속 ${formatAmount(position.debris.metal)} · 수정 ${formatAmount(position.debris.crystal)}</dd></div>` : '';
    this.confirmEl.innerHTML = `
      <p class="detail-kicker">${coordText} · ${kicker}</p>
      <h4 class="slot-detail-title">${title}</h4>
      <dl class="spec-list single">
        ${position.planet ? `<div class="spec-row"><dt>사령관</dt><dd>${escapeHtml(position.planet.username || '없음')}</dd></div>` : ''}
        ${monsterRows}${debrisRows}
        <div class="spec-row"><dt>${escapeHtml(this.squad.formation?.name || '함대')}</dt><dd>${ready ? `${formatAmount(profile.ships)}척 · 공격력 ${formatAmount(profile.attack)}` : '미편성'}</dd></div>
        <div class="spec-row"><dt>도착 예정</dt><dd>${eta ? formatDuration(eta) : '—'}</dd></div>
      </dl>
      <label class="field confirm-mission">임무
        <select name="mission">
          ${verdict.missions.map((value) => `<option value="${value}" ${value === mission ? 'selected' : ''}>${MISSION_LABEL[value]}</option>`).join('')}
        </select>
      </label>
      ${mission === 'colonize' ? '<p class="detail-muted">도착 시 식민선 1척으로 개척합니다. 적재 자원과 나머지 함선은 새 식민지에 배치되며 함대는 그곳에 정착합니다. 정찰 보고서에서 지형과 사용 가능 면적을 먼저 확인할 수 있습니다.</p>' : ''}
      ${mission === 'monster' ? '<p class="detail-muted">괴수는 정해진 시각에 다른 성계로 이동합니다. 도착했을 때 이미 떠났다면 전투 없이 귀환합니다. CGC 보상은 지갑을 연결한 상태에서 입힌 피해량에 비례합니다.</p>' : ''}
      ${mission === 'recycle' ? '<p class="detail-muted">수확선만 잔해를 수거하며 먼저 도착한 함대가 먼저 가져갑니다. 적재량을 넘는 잔해는 남습니다.</p>' : ''}
      ${['monster', 'recycle'].includes(mission) ? '' : `<details class="combat-cargo"><summary>자원 적재</summary><div class="field-row cols-3">${[['metal','금속'],['crystal','수정'],['deuterium','중수소']].map(([id,label])=>`<label class="field">${label}<input type="number" data-cargo="${id}" min="0" step="1" value="${escapeHtml(cargo[id] || '0')}" inputmode="numeric"></label>`).join('')}</div></details>`}
      <div class="confirm-actions">
        <button type="button" class="cmd-btn" data-confirm="cancel" ${this.launching?'disabled':''}>취소</button>
        <button type="button" class="cmd-btn primary" data-confirm="launch" ${ready && !this.launching ? '' : 'disabled'}>
          ${this.launching ? '출격 처리 중…' : ready ? '출격' : '출격할 함대를 선택하십시오'}
        </button>
      </div>`;
  }

  async launch() {
    const verdict = this.evaluateTarget(this.target);
    const formation = this.confirmFormation;
    if (!verdict.valid || !formation || this.squad.profile().ships === 0 || this.launching || this.squad.isPending(formation.id)) return;
    const destination = { ...this.coords, planet: this.target };
    const mission = this.confirmEl.querySelector('[name="mission"]')?.value || verdict.mission;
    const monster = mission === 'monster' ? verdict.position.monster : null;
    const expectedTargetPlanetId = ['monster', 'recycle', 'colonize'].includes(mission) ? null : verdict.position.planet?.id || null;
    const cargo = Object.fromEntries([...this.confirmEl.querySelectorAll('[data-cargo]')].map(el=>[el.dataset.cargo,Number(el.value)]));
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
    } catch {
      // onLaunch reports the error; keep the card open so the player can adjust.
    } finally {
      this.launching = false;
      if (this.target) this.renderConfirm();
    }
  }
}
