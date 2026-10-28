import * as THREE from 'three';

/**
 * Procedural monster look. `spec` is the validated `model` of a monster type:
 * { body: 'orb'|'worm'|'crab'|'manta', color: '#rrggbb', eyes, spikes, tentacles, seed }.
 * Every field is optional. The group exposes `userData.radius` for the thumbnail camera.
 */
const DEFAULTS = { body: 'orb', color: '#7a3f9d', eyes: 3, spikes: 6, tentacles: 4, seed: 1 };

function rng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createMonsterModel(input = {}) {
  const spec = { ...DEFAULTS, ...input };
  const random = rng(spec.seed + 1);
  const base = new THREE.Color(spec.color);
  const skin = new THREE.MeshStandardMaterial({ color: base, roughness: 0.55, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.45), roughness: 0.7 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc24a, emissiveIntensity: 1.4 });
  const group = new THREE.Group();
  const add = (geometry, material, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); group.add(mesh); return mesh; };

  let reach = 1; // furthest distance from the centre, for framing
  let eyeRing = 0.9, eyeY = 0.1;

  if (spec.body === 'worm') {
    for (let i = 0; i < 9; i += 1) {
      const radius = 0.55 - i * 0.04;
      add(new THREE.SphereGeometry(radius, 20, 14), i % 2 ? dark : skin, -2 + i * 0.5, Math.sin(i * 0.7) * 0.3, 0);
    }
    add(new THREE.SphereGeometry(0.62, 22, 16), skin, 2.4, 0.1, 0);
    reach = 2.9; eyeRing = 0.5; eyeY = 0.25;
    group.position.x = 0;
  } else if (spec.body === 'crab') {
    const shell = add(new THREE.SphereGeometry(1, 24, 16), skin); shell.scale.set(1.3, 0.55, 1);
    for (const side of [-1, 1]) {
      const arm = add(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 10), dark, side * 1.5, 0.2, 0.6); arm.rotation.set(0.9, 0, side * 0.7);
      const claw = add(new THREE.ConeGeometry(0.36, 0.9, 12), skin, side * 1.95, 0.45, 1.15); claw.rotation.set(1.57, 0, side * 0.3);
    }
    for (let i = 0; i < 6; i += 1) {
      const side = i < 3 ? -1 : 1; const leg = add(new THREE.CylinderGeometry(0.05, 0.09, 1.1, 8), dark, side * 1.2, -0.25, ((i % 3) - 1) * 0.5); leg.rotation.z = side * 1.1;
    }
    reach = 2.4; eyeRing = 0.6; eyeY = 0.3;
  } else if (spec.body === 'manta') {
    const body = add(new THREE.SphereGeometry(1, 24, 12), skin); body.scale.set(2.2, 0.28, 1.6);
    const tail = add(new THREE.ConeGeometry(0.1, 2.4, 8), dark, -2.9, 0, 0); tail.rotation.z = 1.57;
    reach = 3.1; eyeRing = 0.7; eyeY = 0.2;
  } else {
    add(new THREE.SphereGeometry(1, 28, 20), skin);
    reach = 1.4;
  }

  // Spikes on the upper hemisphere.
  for (let i = 0; i < spec.spikes; i += 1) {
    const theta = random() * Math.PI * 2, phi = Math.acos(0.15 + random() * 0.85);
    const direction = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    const length = 0.5 + random() * 0.5;
    const spike = add(new THREE.ConeGeometry(0.12, length, 8), dark);
    spike.position.copy(direction).multiplyScalar(spec.body === 'orb' ? 1.0 : 0.6).add(new THREE.Vector3(0, spec.body === 'orb' ? 0 : 0.15, 0));
    spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    reach = Math.max(reach, spike.position.length() + length);
  }
  // Tentacles hanging below.
  for (let i = 0; i < spec.tentacles; i += 1) {
    const angle = (i / Math.max(1, spec.tentacles)) * Math.PI * 2;
    const x = Math.cos(angle) * 0.7, z = Math.sin(angle) * 0.7;
    for (let s = 0; s < 4; s += 1) add(new THREE.SphereGeometry(0.16 - s * 0.025, 10, 8), dark, x * (1 + s * 0.2), -0.8 - s * 0.38, z * (1 + s * 0.2));
    reach = Math.max(reach, 2.2);
  }
  // Eyes on the front face.
  for (let i = 0; i < spec.eyes; i += 1) {
    const angle = spec.eyes === 1 ? 0 : (i / (spec.eyes - 1) - 0.5) * 1.6;
    add(new THREE.SphereGeometry(0.13, 12, 10), glow, Math.sin(angle) * eyeRing * 0.8, eyeY + (i % 2) * 0.14, Math.cos(angle) * eyeRing);
  }

  group.userData.radius = reach;
  group.userData.update = () => {};
  return group;
}

export function disposeMonsterModel(root) {
  const geometries = new Set(), materials = new Set();
  root?.traverse((o) => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

/** Thumbnail data URL via the shared offscreen renderer (queued, cached). */
export async function monsterThumbnail(spec = {}) {
  const { getModelThumbnail } = await import('../entities/ModelThumbnails.js');
  return getModelThumbnail({ kind: 'monster', ...spec }, `monster-${spec.seed ?? 1}`, (s) => createMonsterModel(s), disposeMonsterModel);
}
