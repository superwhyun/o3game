/**
 * Orbital chart of one star system, shared by the star-system view and the
 * fleet strike map. Draws a tilted orbit per planet slot with planets drifting
 * along them (inner orbits faster) and exposes hit-testing helpers for
 * pointer interactions.
 */
import { escapeHtml } from '../dom.js';

export const POSITION_COUNT = 15;
const VIEW = { width: 1000, height: 640, cx: 500, cy: 320 };
const ORBIT = { inner: 74, step: 26, tilt: 0.6 };
// Golden angle: consecutive orbits start ~137.5° apart, so neighbours never overlap.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BASE_SPEED = 0.15; // rad/s on the innermost orbit
const FRAME_MS = 33;
let nextChartId = 0;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Stable 0..1 hash so a system keeps its layout between visits. */
function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function orbitRadius(slot) {
  const rx = ORBIT.inner + slot * ORBIT.step;
  return { rx, ry: rx * ORBIT.tilt };
}

/** @returns {'own'|'other'|'empty'} */
export function relationOf(position) {
  if (!position?.occupied) return 'empty';
  return position.owner === 'self' ? 'own' : 'other';
}

export function planetNameOf(position) {
  if (!position?.occupied) return '미점령 행성';
  if (position.owner === 'self' || position.scouted) return position.planet?.name || '이름 미확인 행성';
  return '미정찰 행성';
}

export class OrbitChart {
  /**
   * @param {HTMLElement} container
   * @param {{ onSelect?: (slot: number) => void, label?: string }} [options]
   */
  constructor(container, { onSelect, label = '성계 궤도도' } = {}) {
    this.container = container;
    // SVG paint references resolve document-wide, even across hidden panels.
    this.paintPrefix = `orbit-chart-${++nextChartId}`;
    this.onSelect = onSelect;
    this.coords = null;
    this.positions = [];
    this.selected = null;
    this.highlight = null;
    this.frozen = false;
    this.frame = null;
    this.lastFrame = 0;
    this.startedAt = performance.now();
    this.pausedAt = null;

    container.classList.add('orbit-map');
    container.innerHTML = `
      <header class="orbit-caption"><strong></strong><span></span></header>
      <svg class="orbit-svg" viewBox="0 0 ${VIEW.width} ${VIEW.height}" role="group" aria-label="${escapeHtml(label)}"></svg>
      <div class="orbit-legend" aria-hidden="true">
        <span class="legend-own">아군</span><span class="legend-other">타 제국</span><span class="legend-pirate">해적</span><span class="legend-surveyed">정찰한 미점령 행성</span><span class="legend-empty">미정찰</span>
      </div>`;
    this.svg = container.querySelector('.orbit-svg');
    this.caption = container.querySelector('.orbit-caption');

    const pick = (event) => {
      const slot = event.target.closest('[data-slot]');
      if (slot) this.onSelect?.(Number(slot.dataset.slot));
    };
    this.svg.addEventListener('click', pick);
    this.svg.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      pick(event);
    });
  }

  /**
   * @param {{ galaxy: number, system: number }} coords
   * @param {object[]} positions  slots from GET /api/game/galaxy
   * @param {number|null} selected
   */
  setSystem(coords, positions, selected) {
    this.coords = coords;
    this.positions = positions;
    this.selected = selected;
    this.highlight = null;
    this.render();
    this.start();
  }

  setSelected(slot) {
    this.selected = slot;
    this.render();
  }

  /** Mark a slot during drag: state 'valid' | 'invalid' | null. */
  setHighlight(slot, state) {
    const next = slot && state ? { slot, state } : null;
    if (next?.slot === this.highlight?.slot && next?.state === this.highlight?.state) return;
    this.highlight = next;
    for (const el of this.slotEls || []) {
      const active = this.highlight && Number(el.dataset.slot) === this.highlight.slot;
      el.classList.toggle('is-drop-valid', Boolean(active && this.highlight.state === 'valid'));
      el.classList.toggle('is-drop-invalid', Boolean(active && this.highlight.state === 'invalid'));
    }
  }

  /** Slot number under a viewport point, or null. */
  slotAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY)?.closest?.('[data-slot]');
    return el && this.svg.contains(el) ? Number(el.dataset.slot) : null;
  }

  /** Viewport centre of a slot's planet, or null when not rendered. */
  slotCenter(slot) {
    const el = this.slotEls?.find((node) => Number(node.dataset.slot) === slot);
    const body = el?.querySelector('.slot-planet, .slot-marker');
    if (!body) return null;
    const rect = body.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /** Stop orbital motion (e.g. while dragging so targets stay put). */
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    this.pausedAt = performance.now();
  }

  thaw() {
    if (!this.frozen) return;
    this.startedAt += performance.now() - this.pausedAt;
    this.frozen = false;
    this.pausedAt = null;
  }

  elapsed() {
    return ((this.frozen ? this.pausedAt : performance.now()) - this.startedAt) / 1000;
  }

  render() {
    if (!this.coords) return;
    const { cx, cy } = VIEW;
    const { galaxy, system } = this.coords;

    const spokes = Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * Math.PI * 2;
      const { rx, ry } = orbitRadius(POSITION_COUNT + 0.6);
      return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(angle) * rx}" y2="${cy + Math.sin(angle) * ry}"/>`;
    }).join('');

    const orbits = this.positions.map((position) => {
      const { rx, ry } = orbitRadius(position.position);
      const classes = ['orbit', `orbit-${relationOf(position)}`, position.position === this.selected ? 'is-selected' : ''].join(' ');
      return `<ellipse class="${classes}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
    }).join('');

    // SVG paints in DOM order: draw the selected slot last so it sits on top.
    const drawOrder = [...this.positions].sort((a, b) => (a.position === this.selected) - (b.position === this.selected));
    const slots = drawOrder.map((position) => this.slotMarkup(position)).join('');

    this.svg.innerHTML = `
      <defs>
        <radialGradient id="${this.paintPrefix}-star-core"><stop offset="0" stop-color="#fff8e6"/><stop offset="0.45" stop-color="#f3d79a"/><stop offset="1" stop-color="#c8a96a" stop-opacity="0"/></radialGradient>
        <radialGradient id="${this.paintPrefix}-star-halo"><stop offset="0" stop-color="#e6cf98" stop-opacity="0.35"/><stop offset="1" stop-color="#e6cf98" stop-opacity="0"/></radialGradient>
        <radialGradient id="${this.paintPrefix}-planet-own" cx="0.35" cy="0.35"><stop offset="0" stop-color="#fbe9bd"/><stop offset="0.55" stop-color="#c8a96a"/><stop offset="1" stop-color="#5a4826"/></radialGradient>
        <radialGradient id="${this.paintPrefix}-planet-pirate" cx="0.35" cy="0.35"><stop offset="0" stop-color="#ffd2a4"/><stop offset="0.55" stop-color="#c76a45"/><stop offset="1" stop-color="#431f26"/></radialGradient>
        <radialGradient id="${this.paintPrefix}-planet-other" cx="0.35" cy="0.35"><stop offset="0" stop-color="#c9d9ee"/><stop offset="0.55" stop-color="#5f7fa8"/><stop offset="1" stop-color="#1b2840"/></radialGradient>
        <radialGradient id="${this.paintPrefix}-planet-empty" cx="0.35" cy="0.35"><stop offset="0" stop-color="#d1e2d8"/><stop offset="0.55" stop-color="#668c7e"/><stop offset="1" stop-color="#233e35"/></radialGradient>
      </defs>
      <g class="orbit-spokes">${spokes}</g>
      <circle class="star-halo" cx="${cx}" cy="${cy}" r="70" fill="url(#${this.paintPrefix}-star-halo)"/>
      <g class="orbits">${orbits}</g>
      <circle class="star-core" cx="${cx}" cy="${cy}" r="24" fill="url(#${this.paintPrefix}-star-core)"/>
      <g class="slots">${slots}</g>`;
    this.slotEls = [...this.svg.querySelectorAll('.slot')];

    this.caption.querySelector('strong').textContent = `星系 [${galaxy}:${system}]`;
    this.caption.querySelector('span').textContent = `궤도 ${POSITION_COUNT} · 점유 ${this.positions.filter((p) => p.occupied).length}`;
    this.setHighlight(this.highlight?.slot, this.highlight?.state);
    this.onRender?.();
    this.place(this.elapsed());
  }

  slotMarkup(position) {
    const relation = relationOf(position);
    const known = relation === 'own' || position.scouted;
    // Only our own live data or observed terrain may reveal a diameter.
    const diameter = Number(relation === 'own' ? position.planet?.diameter ?? position.survey?.diameter : position.survey?.diameter);
    const radius = known ? (Number.isFinite(diameter) && diameter > 0 ? diameter * 18 / 20000 : 12) : 6;
    const label = known && position.planet?.name
      ? `<text class="slot-label" y="${-radius - 12}">${escapeHtml(position.planet.name)}</text>
         <text class="slot-sublabel" y="${radius + 26}">${escapeHtml(position.planet.username)}</text>`
      : '';
    const visualRelation = position.planet?.isPirate ? 'pirate' : relation;
    const body = !known
      ? '<rect class="slot-marker" x="-5" y="-5" width="10" height="10" transform="rotate(45)"/>'
      : `<circle class="slot-planet planet-${visualRelation}" r="${radius}" fill="url(#${this.paintPrefix}-planet-${visualRelation})"/>
         <circle class="slot-atmo" r="${radius + 3}"/>`;
    const name = `${position.position}궤도 ${planetNameOf(position)}${position.scouted ? ' · 정찰 확인' : ''}`;
    return `<g class="slot slot-${relation} ${position.planet?.isPirate ? 'slot-pirate' : ''} ${position.position === this.selected ? 'is-selected' : ''}" data-slot="${position.position}"
        tabindex="0" role="button" aria-label="${escapeHtml(name)}">
        <circle class="slot-hit" r="${Math.max(radius + 12, 20)}"/>
        <circle class="slot-ring" r="${radius + 8}"/>
        ${body}${label}
      </g>`;
  }

  /** Position each slot without changing the observed diameter ratio. */
  place(time) {
    if (!this.slotEls || !this.coords) return;
    const { galaxy, system } = this.coords;
    const phase = hash01(`${galaxy}:${system}`) * Math.PI * 2;
    this.slotPoints = new Map();
    for (const el of this.slotEls) {
      const slot = Number(el.dataset.slot);
      const { rx, ry } = orbitRadius(slot);
      const angle = phase + slot * GOLDEN_ANGLE + (time * BASE_SPEED) / Math.sqrt(slot);
      this.slotPoints.set(slot, { x: VIEW.cx + Math.cos(angle) * rx, y: VIEW.cy + Math.sin(angle) * ry });
      el.setAttribute('transform', `translate(${(VIEW.cx + Math.cos(angle) * rx).toFixed(1)} ${(VIEW.cy + Math.sin(angle) * ry).toFixed(1)})`);
    }
    this.onPlace?.();
  }

  slotPoint(slot) { return this.slotPoints?.get(slot); }

  start() {
    if (this.frame || reducedMotion()) return;
    const loop = (now) => {
      this.frame = requestAnimationFrame(loop);
      if (!this.container.isConnected || this.container.offsetParent === null || document.body.classList.contains('esm-mode')) {
        this.stop();
        return;
      }
      if (this.frozen || now - this.lastFrame < FRAME_MS) return;
      this.lastFrame = now;
      this.place(this.elapsed());
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
