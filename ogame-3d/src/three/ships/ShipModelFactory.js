/**
 * Builds a 3D ship model from a catalog `model` spec, e.g.
 *   { hull: 'wedge', faction: 'alliance', scale: 2, engines: 4 }
 * Ships without a spec get one inferred from their category and stats, so a
 * newly added catalog ship always has a model.
 */
import * as THREE from 'three';
import { HULLS } from './hulls.js';
import { getMaterials } from './palette.js';
import { collectGlows, seededRandom } from './parts.js';

const DEFAULT_FACTION = { wedge: 'alliance', fighter: 'alliance', lance: 'empire', fortress: 'fortress' };

/**
 * @param {{ id?: string, category?: string, stats?: object, model?: object|null }} entity
 * @returns {{ hull: string, faction: string, scale: number }}
 */
export function resolveModelSpec(entity = {}) {
  if (entity.model?.hull && HULLS[entity.model.hull]) {
    return { faction: DEFAULT_FACTION[entity.model.hull] || 'civil', scale: 1, ...entity.model };
  }

  const stats = entity.stats || {};
  let hull;
  if (entity.category === 'civil') {
    hull = stats.cargo > 0 ? 'freighter' : 'probe';
  } else if ((stats.hull || 0) < 15000) {
    hull = 'fighter';
  } else if ((stats.hull || 0) < 80000) {
    hull = 'wedge';
  } else if ((stats.hull || 0) < 1000000) {
    hull = 'lance';
  } else {
    hull = 'fortress';
  }
  const scale = Math.min(4, Math.max(0.5, Math.log10(Math.max(stats.hull || 1000, 1000)) - 2.6));
  return { hull, faction: DEFAULT_FACTION[hull] || 'civil', scale, engines: 3 };
}

/**
 * @param {object} spec  resolved model spec
 * @param {string} [seed] stable seed (entity id) for surface detail
 * @returns {THREE.Group} root with userData { spec, radius, update(t) }
 */
export function createShipModel(spec, seed = spec.hull) {
  const build = HULLS[spec.hull] || HULLS.wedge;
  const faction = spec.hull === 'fortress' ? 'fortress' : spec.faction;
  const materials = getMaterials(faction, spec.colors);
  const hull = build(materials, spec, seededRandom(seed));

  const root = new THREE.Group();
  root.name = `ship:${seed}`;
  root.add(hull);

  const bounds = new THREE.Box3().setFromObject(hull);
  const center = bounds.getCenter(new THREE.Vector3());
  hull.position.sub(center);
  const sphere = new THREE.Box3().setFromObject(hull).getBoundingSphere(new THREE.Sphere());

  const glows = collectGlows(root);
  const spinners = hull.userData.spinners || [];
  root.userData = {
    spec,
    radius: sphere.radius,
    update(time) {
      for (const [index, glow] of glows.entries()) {
        const flicker = 0.92 + Math.sin(time * 18 + index * 1.7) * 0.05 + Math.sin(time * 7.3 + index) * 0.03;
        glow.scale.setScalar(glow.userData.baseScale * flicker);
      }
      for (const { object, axis, speed } of spinners) {
        object.rotation[axis] = time * speed;
      }
    }
  };
  return root;
}

/** Free geometries owned by a model (materials/textures are shared). */
export function disposeShipModel(root) {
  root?.traverse((object) => {
    if (object.isSprite) object.material.dispose();
    else if (object.geometry) object.geometry.dispose();
  });
}
