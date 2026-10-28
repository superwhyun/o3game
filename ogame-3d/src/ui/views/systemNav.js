import '../system-navigation.css';

/**
 * Galaxy/system navigation controls (prev / next / number inputs / home),
 * shared by the star-system view and the fleet strike map.
 */
let navSequence = 0;

export const GALAXY_MAX = 9;
export const SYSTEM_MAX = 499;

export function clampCoords({ galaxy, system }) {
  return {
    galaxy: Math.min(GALAXY_MAX, Math.max(1, Math.floor(galaxy) || 1)),
    system: Math.min(SYSTEM_MAX, Math.max(1, Math.floor(system) || 1))
  };
}

/** Next/previous system, wrapping across galaxies. */
export function stepCoords({ galaxy, system }, delta) {
  let nextGalaxy = galaxy;
  let nextSystem = system + delta;
  if (nextSystem < 1) {
    nextGalaxy = galaxy > 1 ? galaxy - 1 : GALAXY_MAX;
    nextSystem = SYSTEM_MAX;
  } else if (nextSystem > SYSTEM_MAX) {
    nextGalaxy = galaxy < GALAXY_MAX ? galaxy + 1 : 1;
    nextSystem = 1;
  }
  return { galaxy: nextGalaxy, system: nextSystem };
}

/**
 * @param {{ prev?: HTMLElement, next?: HTMLElement, galaxy: HTMLInputElement, system: HTMLInputElement, home?: HTMLElement, apply?: HTMLElement }} controls
 * @param {{ current: () => object, home: () => object, go: (coords: object) => void }} handlers
 * @returns {{ sync: (coords: object) => void }}
 */
export function bindSystemNav(controls, { current, home, go, getPlanets = () => [] }) {
  const root = controls.system.closest('.galaxy-nav');
  root.classList.add('system-nav');
  // Coordinates are one navigation control, rather than generic quantity steppers.
  const galaxy = document.createElement('select');
  galaxy.id = controls.galaxy.id;
  if (controls.galaxy.dataset.nav) galaxy.dataset.nav = controls.galaxy.dataset.nav;
  galaxy.setAttribute('aria-label', '은하');
  for (let n = 1; n <= GALAXY_MAX; n++) galaxy.add(new Option(`${n} 은하`, n));
  galaxy.value = controls.galaxy.value || 1;
  controls.galaxy = galaxy;
  const system = controls.system;
  system.dataset.touchSkip = 'true';
  system.setAttribute('aria-label', '성계');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'system-location';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', '좌표 선택');
  const picker = document.createElement('div');
  picker.className = 'system-picker';
  picker.id = `system-picker-${++navSequence}`;
  trigger.setAttribute('popovertarget', picker.id);
  picker.setAttribute('popover', 'auto');
  picker.setAttribute('aria-label', '이동할 성계 선택');
  picker.innerHTML = `<header><strong>이동할 성계</strong><button type="button" data-picker-close aria-label="좌표 선택 닫기">×</button></header><div class="system-picker-fields"><label data-galaxy-field>은하</label><label data-system-field>성계</label></div><input type="range" min="1" max="${SYSTEM_MAX}" step="1" aria-label="성계 슬라이더"><div class="system-range-labels"><span>1</span><span>${SYSTEM_MAX}</span></div><section class="system-shortcuts"><span>내 행성</span><div></div></section><footer></footer>`;
  picker.querySelector('[data-galaxy-field]').append(galaxy);
  picker.querySelector('[data-system-field]').append(system);
  const applyButton = controls.apply || document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'system-apply';
  applyButton.textContent = '이 성계로 이동';
  controls.apply = applyButton;
  picker.querySelector('footer').append(applyButton);
  for (const [button, text] of [[controls.prev, '‹'], [controls.next, '›'], [controls.home, '내 행성']]) {
    if (!button) continue;
    button.type = 'button';
    button.className = button === controls.home ? 'system-home' : 'system-arrow';
    button.textContent = text;
  }
  root.replaceChildren(...[controls.prev, trigger, controls.next, controls.home, picker].filter(Boolean));
  let dirty = false;
  const range = picker.querySelector('input[type=range]');
  const close = () => { if (picker.matches(':popover-open')) picker.hidePopover(); };
  const navigate = coords => { dirty = false; close(); go(coords); };
  const apply = () => navigate(clampCoords({ galaxy: Number(galaxy.value), system: Number(system.value) }));
  controls.prev?.addEventListener('click', () => navigate(stepCoords(current() || home(), -1)));
  controls.next?.addEventListener('click', () => navigate(stepCoords(current() || home(), 1)));
  controls.home?.addEventListener('click', () => navigate(home()));
  applyButton.addEventListener('click', apply);
  picker.querySelector('[data-picker-close]').addEventListener('click', close);
  picker.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(picker.matches(':popover-open'))));
  const positionPicker = () => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(340, innerWidth - 24);
    picker.style.width = `${width}px`;
    picker.style.left = `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`;
    picker.style.top = `${Math.min(rect.bottom + 8, Math.max(12, innerHeight - picker.offsetHeight - 12))}px`;
  };
  trigger.addEventListener('click', event => {
    event.preventDefault();
    if (picker.matches(':popover-open')) { close(); return; }
    const coords = current() || home();
    if (!dirty) { galaxy.value = coords.galaxy; system.value = coords.system; }
    range.value = system.value;
    const shortcuts = picker.querySelector('.system-shortcuts div');
    shortcuts.replaceChildren();
    const planets = getPlanets();
    picker.querySelector('.system-shortcuts').hidden = !planets.length;
    for (const planet of planets) {
      const button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('span');
      name.textContent = planet.name;
      const coordinate = document.createElement('small');
      coordinate.textContent = `[${planet.galaxy}:${planet.system}:${planet.planet}]`;
      button.append(name, coordinate);
      button.addEventListener('click', () => navigate(planet));
      shortcuts.append(button);
    }
    picker.showPopover();
    positionPicker();
    trigger.setAttribute('aria-expanded', 'true');
  });
  window.addEventListener('resize', close);
  // Dismiss when switching views or scrolling the original navigation out of sight.
  document.addEventListener('scroll', event => {
    if (!picker.matches(':popover-open') || picker.contains(event.target)) return;
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) close();
    else positionPicker();
  }, true);

  for (const input of [galaxy, system]) {
    input.addEventListener('input', () => { dirty = true; range.value = system.value; });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
    });
  }
  range.addEventListener('input', () => { dirty = true; system.value = range.value; });
  return {
    close,
    sync({ galaxy: g, system: s }) {
      trigger.textContent = `${g} 은하 · ${s} 성계`;
      trigger.setAttribute('aria-label', `좌표 선택 · ${g} 은하 ${s} 성계`);
      if (dirty) return;
      galaxy.value = g;
      system.value = s;
      range.value = s;
    }
  };
}
