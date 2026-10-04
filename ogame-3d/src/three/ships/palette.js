/**
 * Faction paint schemes for procedural ships.
 * alliance — muted grey-green hulls (Free Planets Alliance look)
 * empire   — white/silver hulls with gold trim (Galactic Empire look)
 * civil    — weathered tan hulls with hazard accents
 */
import * as THREE from 'three';

export const FACTIONS = {
  alliance: { hull: 0x7f8c80, trim: 0x515d55, detail: 0x2e3631, accent: 0xb9c4b2, glow: 0x9cc9ff, light: 0xffe2a8 },
  empire: { hull: 0xdfe2e7, trim: 0x96a1b0, detail: 0x4b5564, accent: 0xc8a96a, glow: 0xb2e0ff, light: 0xfff1c8 },
  civil: { hull: 0x948b7d, trim: 0x625e57, detail: 0x3a3833, accent: 0xd09a45, glow: 0xffc98a, light: 0xffe0a0 },
  fortress: { hull: 0xc3cad3, trim: 0x7d8794, detail: 0x3b4350, accent: 0xc8a96a, glow: 0x9fd0ff, light: 0xfff1c8 }
};

const cache = new Map();

/**
 * Shared material set for a faction. Materials are cached and shared between
 * models, so callers must never dispose them.
 * @param {string} faction
 * @param {Partial<typeof FACTIONS.alliance>} [overrides] hex colors
 */
export function getMaterials(faction = 'alliance', overrides = {}) {
  const key = `${faction}:${JSON.stringify(overrides)}`;
  if (cache.has(key)) return cache.get(key);

  const colors = { ...(FACTIONS[faction] || FACTIONS.alliance), ...overrides };
  const isFortress = faction === 'fortress';
  const materials = {
    colors,
    hull: new THREE.MeshStandardMaterial({
      color: colors.hull,
      metalness: isFortress ? 1 : 0.55,
      roughness: isFortress ? 0.22 : 0.42
    }),
    trim: new THREE.MeshStandardMaterial({ color: colors.trim, metalness: 0.6, roughness: 0.5 }),
    detail: new THREE.MeshStandardMaterial({ color: colors.detail, metalness: 0.45, roughness: 0.7 }),
    accent: new THREE.MeshStandardMaterial({ color: colors.accent, metalness: 0.85, roughness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x16222f,
      metalness: 0.9,
      roughness: 0.1,
      emissive: new THREE.Color(colors.glow),
      emissiveIntensity: 0.25
    }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x23272d, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ color: colors.glow, toneMapped: false }),
    lights: new THREE.MeshBasicMaterial({ color: colors.light, toneMapped: false }),
    panel: new THREE.MeshStandardMaterial({
      color: 0x1a2740,
      metalness: 0.7,
      roughness: 0.25,
      emissive: new THREE.Color(0x24406b),
      emissiveIntensity: 0.35
    })
  };
  cache.set(key, materials);
  return materials;
}
