/**
 * Galaxy/system navigation controls (prev / next / number inputs / home),
 * shared by the star-system view and the fleet strike map.
 */
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
 * @param {{ prev?: HTMLElement, next?: HTMLElement, galaxy: HTMLInputElement, system: HTMLInputElement, home?: HTMLElement }} controls
 * @param {{ current: () => object, home: () => object, go: (coords: object) => void }} handlers
 * @returns {{ sync: (coords: object) => void }}
 */
export function bindSystemNav(controls, { current, home, go }) {
  controls.prev?.addEventListener('click', () => go(stepCoords(current() || home(), -1)));
  controls.next?.addEventListener('click', () => go(stepCoords(current() || home(), 1)));
  controls.home?.addEventListener('click', () => go(home()));
  for (const input of [controls.galaxy, controls.system]) {
    input?.addEventListener('change', () => go(clampCoords({
      galaxy: Number(controls.galaxy.value),
      system: Number(controls.system.value)
    })));
  }
  return {
    sync({ galaxy, system }) {
      controls.galaxy.value = galaxy;
      controls.system.value = system;
    }
  };
}
