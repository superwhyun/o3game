import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small architectural parts, assembled into recognisable industrial dioramas.
class Kit {
  constructor(spec) {
    this.root = new THREE.Group();
    this.spec = spec;
    this.target = this.root;
    this.movers = [];
    const mat = (color, metalness = 0.45, roughness = 0.55, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
    this.m = {
      steel: mat(0x566c7a),
      wall: mat(0x99abb3, 0.25),
      dark: mat(0x202f40),
      gold: mat(0xc6a363, 0.7),
      ground: mat(0x172330, 0.15, 0.9),
      road: mat(0x354453, 0.1, 0.8),
      glass: mat(0x67bcc5, 0.3, 0.2),
      light: mat(0x6cdecd, 0.2, 0.4, {
        emissive: 0x2dc8b4,
        emissiveIntensity: spec.unbuilt ? 0 : 0.65,
      }),
      blue: mat(0x428edd, 0.3, 0.35, {
        emissive: 0x1c58b8,
        emissiveIntensity: 0.3,
      }),
      red: mat(0xba7157),
      crystal: mat(0x94ceec, 0.3, 0.25),
      solar: mat(0x18335d, 0.6, 0.27),
      field: mat(0x69cddd, 0.05, 0.15, {
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };
  }
  mesh(g, m, x = 0, y = 0, z = 0) {
    const o = new THREE.Mesh(g, this.m[m] || m);
    o.position.set(x, y, z);
    this.target.add(o);
    return o;
  }
  box(w, h, d, x = 0, y = 0, z = 0, m = 'steel') {
    return this.mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z);
  }
  cyl(r, h, x = 0, y = 0, z = 0, m = 'steel', top = r) {
    return this.mesh(new THREE.CylinderGeometry(top, r, h, 16), m, x, y, z);
  }
  ball(r, x, y, z, m = 'light') {
    return this.mesh(new THREE.SphereGeometry(r, 20, 12), m, x, y, z);
  }
  ring(r, t, x, y, z, m = 'gold', axis = 'z') {
    const o = this.mesh(new THREE.TorusGeometry(r, t, 8, 40), m, x, y, z);
    if (axis === 'y') o.rotation.x = Math.PI / 2;
    if (axis === 'x') o.rotation.y = Math.PI / 2;
    return o;
  }
  pipe(a, b, r = 0.06, m = 'gold') {
    const p = new THREE.Vector3(...a),
      q = new THREE.Vector3(...b),
      delta = q.clone().sub(p);
    const o = this.cyl(r, delta.length(), 0, 0, 0, m);
    o.position.copy(p.add(q).multiplyScalar(0.5));
    o.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    );
    return o;
  }
  building(x, z, w = 2, h = 1.4, d = 2, m = 'wall') {
    this.box(w, h, d, x, 0.35 + h / 2, z, m);
    this.box(w + 0.12, 0.18, d + 0.12, x, 0.35 + h + 0.09, z, 'dark');
    for (let i = 0; i < 3; i++)
      this.box(
        w * 0.18,
        0.22,
        0.035,
        x + (i - 1) * w * 0.28,
        0.35 + h * 0.7,
        z + d / 2 + 0.025,
        'light',
      );
    this.box(0.38, 0.6, 0.08, x, 0.65, z + d / 2 + 0.04, 'gold');
  }
  tower(x, z, h = 3, r = 0.38, m = 'steel') {
    this.cyl(r, h, x, 0.35 + h / 2, z, m);
    this.cyl(r * 1.15, 0.15, x, h + 0.35, z, 'gold');
    this.cyl(r * 0.85, 0.28, x, h + 0.5, z, 'dark');
  }
  tank(x, z, r = 0.75, h = 2, m = 'wall') {
    this.cyl(r, h, x, 0.35 + h / 2, z, m);
    this.ball(r, x, 0.35 + h, z, m).scale.y = 0.28;
    for (const y of [0.7, h]) this.cyl(r * 1.03, 0.08, x, y, z, 'gold');
    this.pipe([x, 0.6, z + r], [x, 0.6, z + r + 0.45], 0.09, 'light');
  }
  base(research = false) {
    if (research) {
      this.cyl(3.6, 0.2, 0, -0.12, 0, 'dark');
      this.cyl(3.65, 0.08, 0, -0.24, 0, 'gold');
      this.ring(3.2, 0.025, 0, 0.01, 0, 'blue', 'y');
      return;
    }
    this.box(10, 0.28, 8, 0, 0.05, 0, 'ground');
    this.box(10.1, 0.07, 8.1, 0, -0.13, 0, 'gold');
    this.box(8.8, 0.02, 0.5, 0, 0.2, 2.7, 'road');
    this.box(0.45, 0.02, 6, 3.9, 0.2, 0, 'road');
    for (let i = -4; i <= 4; i++)
      this.box(0.3, 0.025, 0.035, i, 0.23, 2.7, 'gold');
    for (let i = 0; i < 4; i++) {
      this.box(0.06, 0.45, 0.06, -4.6, 0.42, -3 + i * 2, 'gold');
      this.box(0.15, 0.08, 0.15, -4.6, 0.68, -3 + i * 2, 'light');
    }
  }
  arm(x, y, z) {
    this.cyl(0.28, 0.25, x, y, z, 'dark');
    this.pipe([x, y, z], [x + 0.5, y + 0.7, z], 0.13, 'gold');
    this.pipe([x + 0.5, y + 0.7, z], [x + 0.95, y + 0.65, z], 0.1, 'gold');
    this.box(0.25, 0.3, 0.2, x + 1, y + 0.5, z, 'dark');
  }
  panel(x, z, scale = 1) {
    this.cyl(0.08, 0.7, x, 0.6, z, 'gold');
    const p = this.box(1.5 * scale, 0.07, 1.1 * scale, x, 1, z, 'solar');
    p.rotation.x = -0.3;
    for (let i = -1; i <= 1; i++)
      this.box(
        1.42 * scale,
        0.025,
        0.025,
        x,
        1.05 + i * 0.1,
        z + i * 0.32 * scale,
        'glass',
      );
  }
  spinner(axis, speed, fn) {
    const g = new THREE.Group();
    g.userData.dynamic = true;
    this.root.add(g);
    const old = this.target;
    this.target = g;
    fn();
    this.target = old;
    this.movers.push({ g, axis, speed });
    return g;
  }
  finish() {
    // Merge static parts by material; large factories retain a small draw-call count.
    this.root.updateMatrixWorld(true);
    const groups = new Map(),
      remove = [];
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o.parent; p && p !== this.root; p = p.parent)
        if (p.userData.dynamic) return;
      const gs = groups.get(o.material) || [];
      const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
      gs.push(geometry);
      groups.set(o.material, gs);
      remove.push(o);
    });
    for (const o of remove) {
      o.removeFromParent();
      o.geometry.dispose();
    }
    for (const [material, gs] of groups) {
      const g = mergeGeometries(gs, false);
      gs.forEach((x) => x.dispose());
      if (g) this.root.add(new THREE.Mesh(g, material));
    }
    const assembly = this.root;
    const bounds = new THREE.Box3().setFromObject(assembly),
      center = bounds.getCenter(new THREE.Vector3());
    assembly.position.sub(center);
    const root = new THREE.Group();
    root.add(assembly);
    const radius = new THREE.Box3()
      .setFromObject(root)
      .getBoundingSphere(new THREE.Sphere()).radius;
    if (this.spec.unbuilt)
      for (const m of Object.values(this.m)) {
        m.color.lerp(new THREE.Color(0x386276), 0.7);
        m.emissiveIntensity = 0;
      }
    root.userData = {
      radius,
      spec: this.spec,
      update: (t) => {
        if (this.spec.unbuilt) return;
        for (const { g, axis, speed } of this.movers)
          g.rotation[axis] = t * speed;
      },
    };
    root.name = `${this.spec.kind}:${this.spec.archetype}:tier${this.spec.tier}`;
    return root;
  }
}

function mine(k, t, crystal) {
  k.cyl(1.65, 0.18, -1, 0.28, 0, 'dark');
  k.ring(1.65, 0.12, -1, 0.4, 0, 'gold', 'y');
  for (let i = 0; i < (crystal ? 5 : 3); i++) {
    const a = i * 2.4,
      r = crystal ? 0.8 : 0.6;
    const shard = k.cyl(
      0.28,
      crystal ? 1.9 : 0.4,
      -1 + Math.cos(a) * r,
      crystal ? 1.3 : 0.45,
      Math.sin(a) * r,
      crystal ? 'crystal' : 'steel',
      0.03,
    );
    shard.rotation.z = (i - 2) * 0.18;
  }
  for (let i = 0; i <= t; i++) {
    const x = -2.8 + i * 1.4;
    k.box(0.18, 2.5, 0.18, x, 1.6, -1.5, 'gold');
    k.box(0.18, 2.5, 0.18, x, 1.6, 1.5, 'gold');
    k.box(0.22, 0.22, 3.2, x, 2.8, 0, 'gold');
    k.pipe([x, 2.7, 0], [-1, 0.7, 0], 0.13, 'steel');
    k.box(0.5, 0.4, 0.5, x, 2.4, 0, 'dark');
  }
  k.box(3, 0.18, 0.6, 2, 0.55, 1, 'dark');
  for (let i = 0; i < 7; i++)
    k.cyl(0.09, 0.6, 0.8 + i * 0.4, 0.68, 1, 'gold').rotation.z = Math.PI / 2;
  k.building(2, -1, 2, 1.2 + t * 0.25, 2, crystal ? 'glass' : 'wall');
  if (t >= 1) k.building(-3, -2.6, 1.4, 1, 1);
  if (t >= 2) {
    k.tower(3, -2.5, 2.8);
    k.tank(1, -2.7, 0.5, 1.5);
  }
  if (t >= 3) {
    k.building(-0.5, -2.8, 2.1, 2, 1);
    k.pipe([-0.5, 2, -2.8], [2, 2, -1], 0.18, 'light');
  }
}
function synthesis(k, t) {
  for (let i = 0; i <= t; i++) {
    const x = -3 + i * 1.7;
    k.tower(x, 0, 2 + i * 0.3, 0.55, 'wall');
    k.ring(0.59, 0.055, x, 1.2, 0, 'light', 'y');
    k.pipe([x, 0.65, 0], [x, 0.65, -2], 0.12, 'gold');
    k.tank(x, -2, 0.45, 1.2);
  }
  k.building(2.5, 1, 1.8, 1.4 + t * 0.35, 1.5);
  if (t >= 2)
    for (let i = 0; i < 2; i++)
      k.cyl(0.6, 1.2, 2.5 + i * 0.9, 1, -2, 'steel', 0.4);
  if (t >= 3) {
    k.pipe([-3, 2.3, 0], [2.5, 2.3, 0], 0.13, 'light');
    k.building(0, 1.8, 2, 1, 1);
  }
}
function solar(k, t) {
  const columns = 3 + t,
    rows = 2 + (t >= 2 ? 1 : 0);
  for (let x = 0; x < columns; x++)
    for (let z = 0; z < rows; z++) k.panel(-3.5 + x * 1.5, -2 + z * 1.65, 0.8);
  k.building(2.9, 1.6, 1.3, 1 + t * 0.2, 1.2);
  if (t >= 1) {
    k.tower(3, -1.5, 2 + t * 0.35, 0.2);
    k.ball(0.35, 3, 2.8 + t * 0.35, -1.5, 'light');
  }
  if (t >= 3) {
    k.ring(0.9, 0.08, 3, 3.7, -1.5, 'gold', 'y');
    k.tank(-3.7, 1.8, 0.4, 1.1);
  }
}
function fusion(k, t) {
  k.cyl(2, 0.65, -0.8, 0.7, 0, 'dark');
  k.ring(1.45, 0.42, -0.8, 1.2, 0, 'steel', 'y');
  k.ring(1.45, 0.09, -0.8, 1.55, 0, 'light', 'y');
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    k.box(
      0.3,
      0.8,
      0.3,
      -0.8 + Math.cos(a) * 1.45,
      1.4,
      Math.sin(a) * 1.45,
      'gold',
    );
  }
  k.building(2.6, 0, 1.6, 1.6 + t * 0.3, 2);
  for (let i = 0; i <= t; i++) {
    k.tower(-3.3 + i * 1.3, -2.4, 1.5 + t * 0.25, 0.4);
    k.pipe([-3.3 + i * 1.3, 0.6, -2.4], [-0.8, 0.6, 0], 0.1, 'blue');
  }
  if (t >= 2) {
    k.box(4.5, 0.25, 0.25, -0.8, 2.5, -1.8, 'wall');
    k.box(0.3, 2.4, 0.3, -2.9, 1.4, -1.8, 'wall');
    k.box(0.3, 2.4, 0.3, 1.3, 1.4, -1.8, 'wall');
  }
  if (t >= 3) {
    k.mesh(
      new THREE.SphereGeometry(2.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      'field',
      -0.8,
      0.4,
      0,
    );
  }
}
function factory(k, t, nano) {
  k.building(-1, -0.5, 4, 1.5 + t * 0.45, 3, nano ? 'glass' : 'wall');
  k.box(4, 0.16, 0.65, -0.5, 0.65, 1.5, 'dark');
  for (let i = 0; i < 3 + t; i++) {
    k.arm(-2 + i * 0.95, 0.8, 1);
    k.box(0.35, 0.2, 0.35, -1.8 + i * 0.95, 0.8, 1.55, 'steel');
  }
  for (let i = 0; i <= t; i++) {
    k.building(2.7, -2 + i * 1.2, 1.2, 1.3, 1, nano ? 'dark' : 'steel');
    k.pipe([2.7, 1.2, -2 + i * 1.2], [1, 1.2, -0.5], 0.07, 'light');
  }
  if (nano) {
    k.cyl(0.75, 1.3, -1, 2.5 + t * 0.45, -0.5, 'field');
    k.ball(0.48, -1, 2.8 + t * 0.45, -0.5, 'light');
    for (const h of [2, 2.7, 3.3])
      k.ring(0.8, 0.09, -1, h + t * 0.45, -0.5, 'gold', 'y');
  }
  if (t >= 2) k.tower(-3.5, -2.3, 3 + t * 0.3, 0.25);
  if (t >= 3) {
    k.building(-3.4, 0, 1, 2.8, 1);
    k.pipe([-3.4, 2.4, 0], [-1, 2.4, 0], 0.14, 'gold');
  }
}
function dock(k, t) {
  const rows = t >= 2 ? 2 : 1;
  for (let row = 0; row < rows; row++) {
    const z = row ? -1.6 : 0.6;
    k.box(6, 0.2, 1.8, -0.4, 0.35, z, 'dark');
    // Unfinished keel on the drydock, distinct from a warehouse.
    const hull = k.mesh(
      new THREE.CylinderGeometry(0.5, 0.18, 3.9, 4),
      'steel',
      -0.5,
      0.9,
      z,
    );
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = Math.PI / 4;
    for (let i = 0; i < 3; i++) {
      const x = -2.5 + i * 2;
      k.box(0.13, 2 + t * 0.2, 0.13, x, 1.4, z - 0.9, 'gold');
      k.box(0.13, 2 + t * 0.2, 0.13, x, 1.4, z + 0.9, 'gold');
      k.box(0.2, 0.18, 2.2, x, 2.4 + t * 0.2, z, 'gold');
      k.pipe([x, 2.3 + t * 0.2, z], [x, 1.2, z], 0.04, 'dark');
    }
  }
  k.building(3, 0, 1.3, 1.7 + t * 0.4, 2.5);
  if (t >= 1) k.building(-2, -2.8, 3, 1.3, 1);
  if (t >= 3) {
    k.box(6.6, 0.24, 0.2, -0.5, 3.4, -0.5, 'light');
    k.tower(3, -2.7, 3.8, 0.3);
  }
}
function laboratory(k, t) {
  k.building(0, 0, 2.6, 1.8 + t * 0.4, 2.4, 'wall');
  k.mesh(
    new THREE.SphereGeometry(1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    'glass',
    0,
    2.2 + t * 0.4,
    0,
  );
  for (let i = 0; i <= t; i++) {
    const a = Math.PI * 0.35 + i * Math.PI * 0.55,
      x = Math.cos(a) * 3,
      z = Math.sin(a) * 2.5;
    k.building(x, z, 1.3, 1.2 + i * 0.2, 1.2);
    k.pipe([0, 1, z * 0.1], [x, 1, z], 0.12, 'light');
  }
  if (t >= 2) {
    k.tower(-3, -2, 3.5, 0.25);
    k.ring(0.5, 0.05, -3, 3.9, -2, 'gold');
  }
  if (t >= 3) {
    k.building(1.7, -2.2, 1.2, 4, 1.2, 'glass');
    k.ball(0.4, 1.7, 4.6, -2.2, 'light');
  }
}
function storage(k, t, crystal) {
  for (let i = 0; i <= t; i++) {
    const x = -3 + i * 1.8;
    k.building(
      x,
      0,
      1.5,
      1.5 + (t >= 2 ? 0.8 : 0),
      2.7,
      crystal ? 'glass' : 'steel',
    );
    k.box(1.55, 0.12, 2.8, x, 1.9 + (t >= 2 ? 0.8 : 0), 0, 'gold');
    if (crystal) {
      k.cyl(0.72, 0.8, x, 2.3 + (t >= 2 ? 0.8 : 0), 0, 'crystal', 0.12);
      k.ring(0.8, 0.045, x, 1.9 + (t >= 2 ? 0.8 : 0), 0, 'gold', 'y');
    }
    for (let j = 0; j < 3; j++)
      k.box(
        0.55,
        0.4,
        0.5,
        x,
        0.55 + j * 0.42,
        1.55,
        crystal ? 'crystal' : 'dark',
      );
  }
  k.building(2.8, -2.3, 1.2, 1.3 + t * 0.4, 1);
  if (t >= 2) {
    k.box(7, 0.15, 0.15, 0, 3.2, -1.6, 'gold');
    for (const x of [-3, 3]) k.box(0.12, 3, 0.12, x, 1.7, -1.6, 'gold');
  }
  if (t >= 3) {
    k.pipe([-3, 2.8, -1.6], [3, 2.8, -1.6], 0.08, 'light');
    k.arm(3, 0.6, 1.5);
  }
}
function tanks(k, t) {
  for (let i = 0; i <= t; i++) {
    const x = -3 + i * 1.8;
    k.tank(x, 0, 0.7, 2 + t * 0.25);
    k.tank(x, -2, 0.4, 1.2);
    k.pipe([x, 0.6, 0], [x, 0.6, -2], 0.1, 'blue');
  }
  k.building(2.8, 1.8, 1.4, 1.2 + t * 0.2, 1);
  if (t >= 2) k.pipe([-3, 2.7, 0], [2.5, 2.7, 0], 0.12, 'gold');
  if (t >= 3) {
    k.box(8, 0.1, 0.3, 0, 0.5, 1.3, 'dark');
    k.tower(3, -2.5, 3.7, 0.3);
  }
}
export const BUILDERS = {
  // Civil facilities reuse established structural models and tier behavior.
  housing: (k, t) => storage(k, t, false),
  hydroponicFarm: synthesis,
  cultureCenter: laboratory,
  school: laboratory,
  clinic: laboratory,
  metalMine: (k, t) => mine(k, t, false),
  crystalMine: (k, t) => mine(k, t, true),
  deuteriumSynthesizer: synthesis,
  solarPlant: solar,
  fusionReactor: fusion,
  robotFactory: (k, t) => factory(k, t, false),
  shipyard: dock,
  researchLab: laboratory,
  naniteFactory: (k, t) => factory(k, t, true),
  metalStorage: (k, t) => storage(k, t, false),
  crystalStorage: (k, t) => storage(k, t, true),
  deuteriumTank: tanks,
};

function optical(k, ion = false) {
  k.box(5, 0.18, 0.8, 0, 0.3, 0, 'dark');
  k.box(1.2, 0.9, 1, -2, 0.85, 0, 'wall');
  for (let i = 0; i < 3; i++) {
    k.box(0.1, 1.3, 1.3, -0.7 + i * 0.8, 1, 0, 'gold');
    k.ring(0.4, 0.07, -0.7 + i * 0.8, 1, 0, ion ? 'gold' : 'glass', 'x');
  }
  k.pipe([-1.8, 1, 0], [2.2, 1, 0], ion ? 0.055 : 0.025, ion ? 'blue' : 'red');
  k.box(0.15, 1.6, 1.4, 2.3, 1, 0, 'steel');
  if (ion) {
    for (let i = 0; i < 4; i++) {
      k.ring(0.65, 0.14, -0.8 + i * 0.65, 1, 0, 'steel', 'x');
      k.pipe(
        [-0.8 + i * 0.65, 0.4, -0.8],
        [-0.8 + i * 0.65, 1.5, -0.8],
        0.075,
        'light',
      );
    }
    k.tank(-2, -1.25, 0.3, 0.7);
  }
}
function engine(k, kind) {
  k.cyl(0.65, 2.7, 0, 1.1, 0, 'steel').rotation.z = Math.PI / 2;
  const n = k.cyl(0.8, 1.1, 1.8, 1.1, 0, 'dark', 0.35);
  n.rotation.z = -Math.PI / 2;
  k.pipe([-1.5, 1.1, 0], [1.8, 1.1, 0], 0.23, kind === 0 ? 'red' : 'light');
  for (let i = 0; i < 3; i++)
    k.ring(
      0.76,
      0.1,
      -0.9 + i * 0.8,
      1.1,
      0,
      kind === 0 ? 'gold' : 'blue',
      'x',
    );
  k.box(3.5, 0.15, 1.5, 0, 0.2, 0, 'dark');
  for (const x of [-1, 1]) k.box(0.2, 0.5, 0.3, x, 0.5, 0, 'gold');
  if (kind === 0) {
    k.tank(-1.7, -1, 0.3, 0.8);
    k.pipe([-1.7, 1, -1], [-1, 1, 0], 0.09, 'gold');
  }
  if (kind === 2) {
    for (const x of [-1.2, 1]) k.ring(1.4, 0.12, x, 1.35, 0, 'gold', 'x');
    k.ball(0.48, 0, 1.1, 0, 'blue');
  }
}
export const EXPERIMENTS = {
  urbanPlanning: k => EXPERIMENTS.terraforming(k),
  agriculturalTechnology: k => EXPERIMENTS.energyTechnology(k),
  educationTechnology: k => EXPERIMENTS.computerTechnology(k),
  medicalTechnology: k => EXPERIMENTS.energyTechnology(k),
  socialPolicy: k => EXPERIMENTS.computerTechnology(k),
  terraforming(k) {
    k.ball(1.25, 0, 1.45, 0, 'blue');
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      const patch = k.ball(
        0.35,
        Math.cos(a),
        1.7 + Math.sin(a) * 0.3,
        Math.sin(a) * 0.6,
        'light',
      );
      patch.scale.set(1, 0.4, 0.7);
      k.tower(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0.8, 0.14);
      k.pipe(
        [Math.cos(a) * 2.2, 0.6, Math.sin(a) * 2.2],
        [0, 0.5, 0],
        0.035,
        'gold',
      );
    }
    k.ring(1.65, 0.045, 0, 1.4, 0, 'gold', 'y');
    k.mesh(
      new THREE.SphereGeometry(1.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      'field',
      0,
      0.25,
      0,
    );
  },
  energyTechnology(k) {
    k.cyl(0.7, 1.7, 0, 1.05, 0, 'steel');
    k.ball(0.65, 0, 2, 0, 'light');
    for (let i = 0; i < 3; i++)
      k.ring(1 + i * 0.5, 0.055, 0, 0.4, 0, 'gold', 'y');
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      k.tower(Math.cos(a) * 2, Math.sin(a) * 2, 1.2, 0.18);
      k.pipe(
        [0, 0.5, 0],
        [Math.cos(a) * 2, 0.5, Math.sin(a) * 2],
        0.045,
        'light',
      );
    }
  },
  laserTechnology: (k) => optical(k),
  ionTechnology: (k) => optical(k, true),
  plasmaTechnology(k) {
    k.box(3, 0.25, 2, 0, 0.2, 0, 'dark');
    k.cyl(0.8, 2, 0, 1.4, 0, 'field');
    k.ball(0.55, 0, 1.4, 0, 'red');
    for (const y of [0.5, 1, 1.8, 2.4]) k.ring(0.9, 0.12, 0, y, 0, 'gold', 'y');
    for (const x of [-1, 1]) k.pipe([x, 0.4, 0], [x, 2.5, 0], 0.09, 'steel');
  },
  combustionDrive: (k) => engine(k, 0),
  impulseDrive: (k) => engine(k, 1),
  hyperspaceDrive: (k) => engine(k, 2),
  hyperspaceTechnology(k) {
    for (const x of [-1.8, 1.8]) {
      k.box(0.15, 3.2, 0.15, x, 1.6, -1, 'gold');
      k.box(0.15, 3.2, 0.15, x, 1.6, 1, 'gold');
    }
    for (const y of [0.2, 3.1]) k.box(3.8, 0.12, 2, 0, y, 0, 'gold');
    for (let i = 0; i < 5; i++) {
      k.pipe(
        [-1.6, 0.6 + i * 0.45, -0.9],
        [1.6, 0.6 + i * 0.45, -0.9],
        0.012,
        'blue',
      );
    }
    k.spinner('y', 0.2, () => {
      k.ring(1, 0.07, 0, 1.5, 0, 'light');
      k.ball(0.24, 0, 1.5, 0, 'glass');
    });
  },
  espionageTechnology(k) {
    k.tower(-0.8, 0, 1.5, 0.25);
    const dish = k.mesh(
      new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      'wall',
      -0.8,
      2.1,
      0,
    );
    dish.rotation.z = -0.65;
    k.pipe([-0.8, 2, 0], [-0.2, 2.8, 0], 0.05, 'gold');
    for (let i = 0; i < 3; i++)
      k.box(0.6, 0.9, 0.12, 1 + i * 0.5, 0.9, 0.6, 'glass').rotation.x = -0.25;
    k.ball(0.17, 2.2, 1.8, -0.9, 'red');
    k.ring(0.4, 0.02, 2.2, 1.8, -0.9, 'light');
  },
  computerTechnology(k) {
    for (let i = 0; i < 4; i++) {
      const x = -1.8 + i * 1.2;
      k.box(0.8, 2.4, 0.8, x, 1.3, 0, 'dark');
      for (let j = 0; j < 6; j++) {
        k.box(0.65, 0.18, 0.06, x, 0.4 + j * 0.33, 0.44, 'steel');
        k.box(0.15, 0.08, 0.07, x + 0.15, 0.45 + j * 0.33, 0.48, 'light');
      }
      k.pipe([x, 0.3, 0], [x, 0.3, 1.8], 0.06, 'blue');
    }
    k.box(4.5, 0.12, 0.5, 0, 0.3, 1.8, 'gold');
  },
  astrophysics(k) {
    k.tower(-1, 0, 1.3, 0.3);
    const tube = k.cyl(0.5, 2.2, -1, 2, 0, 'wall', 0.6);
    tube.rotation.z = -0.6;
    k.ball(0.42, -1.6, 2.9, 0, 'glass');
    k.spinner('y', 0.12, () => {
      k.ball(0.25, 1.5, 1.4, 0, 'gold');
      for (const r of [0.65, 1, 1.4])
        k.ring(r, 0.025, 1.5, 1.4, 0, 'blue', 'y');
      k.ball(0.12, 2.5, 1.4, 0, 'light');
    });
  },
  gravitonTechnology(k) {
    k.spinner('y', 0.14, () => {
      k.ring(1.6, 0.1, 0, 1.8, 0, 'steel');
      k.ring(1.45, 0.07, 0, 1.8, 0, 'gold', 'x');
    });
    k.ring(1.3, 0.07, 0, 1.8, 0, 'blue', 'y');
    k.ball(0.5, 0, 1.8, 0, 'dark');
    for (const x of [-1.5, 1.5]) k.box(0.3, 1.6, 0.3, x, 0.8, 0, 'steel');
  },
  weaponsTechnology(k) {
    k.box(2, 0.3, 1.4, -1, 0.4, 0, 'dark');
    k.cyl(0.55, 0.7, -1, 0.9, 0, 'steel');
    k.box(1.3, 0.55, 0.75, -1, 1.4, 0, 'wall');
    k.pipe([-0.8, 1.4, 0], [1, 1.4, 0], 0.14, 'gold');
    k.box(0.3, 2, 1.8, 2, 1.2, 0, 'red');
    k.ring(0.5, 0.03, 1.82, 1.4, 0, 'gold', 'x');
  },
  shieldingTechnology(k) {
    k.cyl(1.5, 0.18, 0, 0.2, 0, 'steel');
    k.cyl(0.4, 0.8, 0, 0.65, 0, 'gold');
    k.ball(0.24, 0, 1.2, 0, 'light');
    k.mesh(
      new THREE.SphereGeometry(1.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      'field',
      0,
      0.4,
      0,
    );
    for (const r of [0.6, 1, 1.5]) k.ring(r, 0.025, 0, 0.43, 0, 'light', 'y');
    k.pipe([2.5, 0.5, 0], [2.5, 1.6, 0], 0.2, 'dark');
    k.ball(0.16, 1.8, 1.3, 0, 'red');
  },
  armorTechnology(k) {
    for (let i = 0; i < 4; i++) {
      const plate = k.box(
        0.25,
        1.9,
        1.8,
        -0.6 + i * 0.45,
        1.35,
        0,
        i % 2 ? 'gold' : 'steel',
      );
      plate.rotation.z = -0.2;
    }
    k.box(4, 0.18, 2.1, 0, 0.25, 0, 'dark');
    k.pipe([-2.5, 1.3, 0], [-1.2, 1.3, 0], 0.15, 'red');
    k.box(0.35, 1, 0.6, -2.5, 0.9, 0, 'wall');
  },
};
export function createEntityModel(spec) {
  const k = new Kit(spec);
  k.base(spec.kind === 'research');
  if (spec.kind === 'building')
    (BUILDERS[spec.archetype] || laboratory)(k, spec.tier || 0);
  else (EXPERIMENTS[spec.archetype] || EXPERIMENTS.energyTechnology)(k);
  return k.finish();
}
export function disposeEntityModel(root) {
  const geometries = new Set(),
    materials = new Set();
  root?.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) materials.add(o.material);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}
