/**
 * Full-viewport overlay that draws a curved, arrow-headed course line between
 * two viewport points, with an optional label at its apex.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const CURVE = 0.22; // control-point offset as a fraction of the line length

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export function createDragArrow() {
  const svg = el('svg', { class: 'course-overlay', 'aria-hidden': 'true' });
  const defs = el('defs');
  for (const state of ['valid', 'invalid', 'idle']) {
    const marker = el('marker', {
      id: `course-head-${state}`, viewBox: '0 0 12 12', refX: '9', refY: '6',
      markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse'
    });
    marker.appendChild(el('path', { d: 'M1,1 L11,6 L1,11 L4,6 Z', class: `course-head course-${state}` }));
    defs.appendChild(marker);
  }
  const glow = el('path', { class: 'course-glow' });
  const line = el('path', { class: 'course-line' });
  const origin = el('circle', { class: 'course-origin', r: '6' });
  const labelGroup = el('g', { class: 'course-label' });
  const labelBg = el('rect', { rx: '2', ry: '2' });
  const labelText = el('text');
  labelGroup.append(labelBg, labelText);
  svg.append(defs, glow, line, origin, labelGroup);
  svg.style.display = 'none';
  document.body.appendChild(svg);

  return {
    /**
     * @param {{x:number,y:number}} from
     * @param {{x:number,y:number}} to
     * @param {'valid'|'invalid'|'idle'} state
     * @param {string} [label]
     * @param {{top:number,right:number,bottom:number,left:number}|null} [clipRect] Chart preview bounds.
     */
    update(from, to, state = 'idle', label = '', clipRect = null) {
      svg.style.display = '';
      svg.style.clipPath = clipRect
        ? `inset(${Math.max(0, clipRect.top)}px ${Math.max(0, innerWidth - clipRect.right)}px ${Math.max(0, innerHeight - clipRect.bottom)}px ${Math.max(0, clipRect.left)}px)`
        : '';
      svg.dataset.state = state;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      // Bow the course perpendicular to the line, always towards the top of the screen.
      let nx = -dy / length;
      let ny = dx / length;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const cx = (from.x + to.x) / 2 + nx * length * CURVE;
      const cy = (from.y + to.y) / 2 + ny * length * CURVE;
      const d = `M${from.x},${from.y} Q${cx},${cy} ${to.x},${to.y}`;
      line.setAttribute('d', d);
      glow.setAttribute('d', d);
      line.setAttribute('marker-end', `url(#course-head-${state})`);
      origin.setAttribute('cx', from.x);
      origin.setAttribute('cy', from.y);

      labelGroup.style.display = label ? '' : 'none';
      if (label) {
        // Apex of a quadratic Bézier sits halfway between the chord midpoint and the control point.
        const ax = (from.x + to.x) / 4 + cx / 2;
        const ay = (from.y + to.y) / 4 + cy / 2;
        labelText.textContent = label;
        labelText.setAttribute('x', ax);
        labelText.setAttribute('y', ay - 14);
        const box = labelText.getBBox();
        labelBg.setAttribute('x', box.x - 10);
        labelBg.setAttribute('y', box.y - 5);
        labelBg.setAttribute('width', box.width + 20);
        labelBg.setAttribute('height', box.height + 10);
      }
    },
    hide() {
      svg.style.display = 'none';
    },
    destroy() {
      svg.remove();
    }
  };
}
