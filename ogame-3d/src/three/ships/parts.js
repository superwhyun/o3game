/**
 * Reusable ship parts. Convention: the ship's nose points to +X, up is +Y,
 * starboard is +Z. Hull builders work at a nominal length of ~4 units.
 */
import * as THREE from 'three';

let glowTexture = null;

/** Deterministic PRNG so the same ship id always gets the same greebles. */
export function seededRandom(seed = 'ship') {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function mesh(geometry, material, { position, rotation, scale } = {}) {
  const object = new THREE.Mesh(geometry, material);
  if (position) object.position.set(...position);
  if (rotation) object.rotation.set(...rotation);
  if (scale) object.scale.set(...scale);
  return object;
}

export function box(w, h, d, material, position, rotation) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, { position, rotation });
}

/**
 * Extrude a top-view outline (points in X/Z) upward by `height`.
 * @param {[number, number][]} outline  [x, z] points, counter-clockwise
 */
export function extrudeOutline(outline, height, material, { bevel = 0.03, y = 0 } = {}) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    steps: 1
  });
  // Shape lives in XY; rotate so the outline lies in XZ and extrusion goes +Y.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height + y, 0);
  return new THREE.Mesh(geometry, material);
}

/**
 * Lathe a radius profile along the X axis.
 * @param {[number, number][]} profile  [x, radius] from aft to bow
 */
export function latheAlongX(profile, material, { segments = 36, flatten = 1 } = {}) {
  const points = profile.map(([x, radius]) => new THREE.Vector2(Math.max(radius, 0.0001), x));
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.rotateZ(-Math.PI / 2);
  geometry.scale(1, flatten, 1);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function glowSprite(color, size) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false
  }));
  sprite.scale.setScalar(size);
  sprite.userData.baseScale = size;
  return sprite;
}

/**
 * A single engine nozzle facing -X with an emissive core and glow sprite.
 */
export function engine(materials, radius, length = radius * 1.6) {
  const group = new THREE.Group();
  const bell = new THREE.CylinderGeometry(radius * 0.82, radius, length, 20, 1, true);
  bell.rotateZ(Math.PI / 2);
  group.add(mesh(bell, materials.nozzle));

  const collar = new THREE.TorusGeometry(radius * 0.96, radius * 0.12, 8, 24);
  collar.rotateY(Math.PI / 2);
  group.add(mesh(collar, materials.trim, { position: [-length / 2, 0, 0] }));

  const core = new THREE.CircleGeometry(radius * 0.8, 20);
  core.rotateY(-Math.PI / 2);
  group.add(mesh(core, materials.glow, { position: [-length * 0.35, 0, 0] }));

  const glow = glowSprite(materials.colors.glow, radius * 4.2);
  glow.position.set(-length * 0.75, 0, 0);
  group.add(glow);
  group.userData.glows = [glow];
  return group;
}

/**
 * Arrange `count` engines in a row / grid / ring on the YZ plane at x.
 */
export function engineCluster(materials, { count, radius, x, layout = 'row', spread = 1 }) {
  const group = new THREE.Group();
  const glows = [];
  const positions = [];
  const gap = radius * 2.3 * spread;

  if (layout === 'ring' && count > 2) {
    const ringRadius = gap * 0.75;
    if (count > 4) positions.push([0, 0]);
    const outer = count > 4 ? count - 1 : count;
    for (let i = 0; i < outer; i++) {
      const angle = (i / outer) * Math.PI * 2 + Math.PI / 2;
      positions.push([Math.sin(angle) * ringRadius, Math.cos(angle) * ringRadius]);
    }
  } else if (layout === 'grid' && count > 3) {
    const cols = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      positions.push([(row - 0.5) * gap * 0.9, (col - (cols - 1) / 2) * gap]);
    }
  } else {
    for (let i = 0; i < count; i++) positions.push([0, (i - (count - 1) / 2) * gap]);
  }

  for (const [y, z] of positions) {
    const unit = engine(materials, radius);
    unit.position.set(x, y, z);
    glows.push(...unit.userData.glows);
    group.add(unit);
  }
  group.userData.glows = glows;
  return group;
}

/** Small surface boxes that sell scale. */
export function greebles(materials, rng, { count, x: [x0, x1], z: [z0, z1], y, size = 0.08 }) {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const w = size * (0.6 + rng() * 1.6);
    const h = size * (0.3 + rng() * 0.8);
    const d = size * (0.6 + rng() * 1.2);
    const part = mesh(geometry, rng() > 0.7 ? materials.trim : materials.detail, {
      position: [x0 + rng() * (x1 - x0), y + h / 2, z0 + rng() * (z1 - z0)],
      scale: [w, h, d]
    });
    group.add(part);
  }
  return group;
}

/** Grid of emissive gun ports / windows on a plane facing `facing` ('x' or 'z'). */
export function portGrid(material, { rows, cols, width, height, x, y, z, facing = 'x', size = 0.035 }) {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(size, size, size);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = cols === 1 ? 0 : (c / (cols - 1) - 0.5) * width;
      const v = rows === 1 ? 0 : (r / (rows - 1) - 0.5) * height;
      const position = facing === 'x' ? [x, y + v, z + u] : [x + u, y + v, z];
      group.add(mesh(geometry, material, { position }));
    }
  }
  return group;
}

/** Collect glow sprites from parts so the model can animate them. */
export function collectGlows(root) {
  const glows = [];
  root.traverse((object) => {
    if (object.userData?.glows) glows.push(...object.userData.glows);
  });
  return [...new Set(glows)];
}
