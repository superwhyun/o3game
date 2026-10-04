/**
 * Procedural hull archetypes. Each builder returns a THREE.Group at a nominal
 * length of ~4 units with the nose toward +X. Builders may register
 * `group.userData.spinners` ([{ object, axis, speed }]) for animation.
 */
import * as THREE from 'three';
import {
  box,
  engine,
  engineCluster,
  extrudeOutline,
  greebles,
  latheAlongX,
  mesh,
  portGrid
} from './parts.js';

/** Alliance-style battleship: long blunt-nosed slab, engine block aft. */
function wedge(m, spec, rng) {
  const group = new THREE.Group();
  const engines = spec.engines ?? 3;
  const flagship = Boolean(spec.flagship);

  // Lower hull — widest at mid-aft, blunt bow face.
  group.add(extrudeOutline(
    [[2.0, -0.26], [1.2, -0.34], [-0.2, -0.46], [-1.7, -0.44], [-2.0, -0.38],
      [-2.0, 0.38], [-1.7, 0.44], [-0.2, 0.46], [1.2, 0.34], [2.0, 0.26]],
    0.3, m.hull, { y: -0.3 }
  ));
  // Upper deck — narrower, shorter.
  group.add(extrudeOutline(
    [[1.6, -0.18], [0.4, -0.27], [-1.6, -0.3], [-1.6, 0.3], [0.4, 0.27], [1.6, 0.18]],
    0.16, m.trim, { y: 0.03 }
  ));
  // Bow cannon face.
  group.add(box(0.08, 0.3, 0.5, m.detail, [2.03, -0.14, 0]));
  group.add(portGrid(m.lights, { rows: 3, cols: 6, width: 0.38, height: 0.18, x: 2.08, y: -0.14, z: 0 }));
  // Side sponsons with port rows.
  for (const side of [-1, 1]) {
    group.add(box(2.4, 0.16, 0.12, m.trim, [-0.2, -0.2, side * 0.5]));
    group.add(portGrid(m.lights, { rows: 1, cols: 14, width: 2.0, height: 0, x: -0.2, y: -0.2, z: side * 0.565, facing: 'z', size: 0.025 }));
  }
  // Bridge tower.
  group.add(box(0.42, 0.22, 0.22, m.trim, [-0.9, 0.3, 0]));
  group.add(box(0.3, 0.04, 0.23, m.glass, [-0.84, 0.36, 0]));
  group.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), m.detail, { position: [-1.05, 0.55, 0] }));
  // Keel fin.
  group.add(box(1.8, 0.14, 0.04, m.detail, [-0.6, -0.38, 0]));
  // Engine block + nozzles.
  group.add(box(0.5, 0.48, 0.86, m.trim, [-1.95, -0.06, 0]));
  group.add(engineCluster(m, {
    count: engines,
    radius: engines > 3 ? 0.13 : 0.16,
    x: -2.32,
    layout: engines > 3 ? 'grid' : 'row'
  }));
  group.add(greebles(m, rng, { count: 26, x: [-1.5, 1.4], z: [-0.2, 0.2], y: 0.19, size: 0.06 }));

  if (flagship) {
    // Tall dorsal fin and outrigger wings mark a flagship.
    group.add(extrudeOutline([[-0.4, -0.02], [-1.6, -0.02], [-1.8, 0.02], [-0.5, 0.02]], 0.01, m.accent, { y: 0.19 }));
    const fin = new THREE.Shape([new THREE.Vector2(-0.3, 0), new THREE.Vector2(-1.7, 0), new THREE.Vector2(-1.5, 0.55), new THREE.Vector2(-0.9, 0.5)]);
    const finGeometry = new THREE.ExtrudeGeometry(fin, { depth: 0.04, bevelEnabled: false });
    finGeometry.translate(0, 0.19, -0.02);
    group.add(mesh(finGeometry, m.hull));
    for (const side of [-1, 1]) {
      group.add(box(1.2, 0.05, 0.4, m.hull, [-1.0, -0.1, side * 0.75], [0, 0, 0]));
    }
  }
  return group;
}

/** Empire-style warship: smooth tapered spindle with flanking sponsons. */
function lance(m, spec, rng) {
  const group = new THREE.Group();
  const engines = spec.engines ?? 3;
  const heavy = spec.sponsons === 'heavy';

  const body = latheAlongX(
    [[-2.0, 0.24], [-1.85, 0.36], [-1.1, 0.44], [0, 0.4], [0.9, 0.3], [1.6, 0.16], [2.1, 0.0]],
    m.hull, { flatten: 0.6 }
  );
  group.add(body);

  // Gold trim band and dorsal ridge.
  const band = new THREE.TorusGeometry(0.405, 0.018, 8, 48);
  band.rotateY(Math.PI / 2);
  band.scale(1, 0.6, 1);
  group.add(mesh(band, m.accent, { position: [0.05, 0, 0] }));
  group.add(box(2.6, 0.02, 0.04, m.accent, [-0.35, 0.262, 0]));

  // Bridge blister.
  const blister = new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  blister.scale(1.8, 0.8, 1);
  group.add(mesh(blister, m.hull, { position: [-0.7, 0.2, 0] }));
  group.add(box(0.18, 0.03, 0.2, m.glass, [-0.55, 0.3, 0]));

  // Flanking sponsons on swept pylons.
  const podRadius = heavy ? 0.24 : 0.17;
  for (const side of [-1, 1]) {
    const pod = latheAlongX(
      [[-1.3, 0.1], [-1.15, podRadius], [0.2, podRadius * 0.95], [0.9, podRadius * 0.4], [1.15, 0]],
      m.hull, { flatten: 0.75, segments: 24 }
    );
    pod.position.set(-0.5, -0.04, side * (heavy ? 0.72 : 0.62));
    pod.rotation.y = side * -0.05;
    group.add(pod);

    const pylon = extrudeOutline([[0.2, 0], [-1.0, 0], [-1.2, side * 0.6], [-0.2, side * 0.6]], 0.03, m.trim, { bevel: 0.01, y: -0.06 });
    group.add(pylon);

    const podEngine = engine(m, podRadius * 0.6);
    podEngine.position.set(-1.92, -0.04, side * (heavy ? 0.72 : 0.62));
    group.add(podEngine);

    if (heavy) {
      group.add(box(0.9, 0.12, 0.16, m.detail, [-0.3, -0.24, side * 0.35]));
      group.add(portGrid(m.lights, { rows: 1, cols: 5, width: 0.7, height: 0, x: -0.3, y: -0.31, z: side * 0.35, facing: 'z', size: 0.03 }));
    }
  }

  group.add(engineCluster(m, { count: engines, radius: 0.13, x: -2.12, layout: 'ring', spread: 0.85 }));
  group.add(greebles(m, rng, { count: 10, x: [-1.6, -0.9], z: [-0.12, 0.12], y: 0.22, size: 0.04 }));
  return group;
}

/** Single-seat fighter. 'swept' = four forward fins (Imperial), default = delta (Alliance). */
function fighter(m, spec) {
  const group = new THREE.Group();
  group.add(latheAlongX([[-1.6, 0.18], [-1.2, 0.3], [0.3, 0.28], [1.3, 0.12], [1.9, 0]], m.hull, { flatten: 0.8, segments: 24 }));

  const canopy = new THREE.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(2, 0.9, 1);
  group.add(mesh(canopy, m.glass, { position: [0.45, 0.16, 0] }));

  if (spec.wings === 'swept') {
    for (let i = 0; i < 4; i++) {
      const fin = extrudeOutline([[0.6, 0], [-0.6, 0], [-0.9, 0.95], [-0.2, 0.95]], 0.03, i % 2 ? m.trim : m.hull, { bevel: 0.01 });
      const holder = new THREE.Group();
      holder.add(fin);
      holder.rotation.x = Math.PI / 4 + (i * Math.PI) / 2;
      group.add(holder);
    }
  } else {
    for (const side of [-1, 1]) {
      group.add(extrudeOutline([[0.4, 0], [-1.3, 0], [-1.4, side * 1.15], [-0.9, side * 1.15]], 0.04, m.hull, { y: -0.05 }));
      group.add(box(0.5, 0.05, 0.06, m.accent, [-1.15, -0.02, side * 1.1]));
    }
    const tail = new THREE.Shape([new THREE.Vector2(-0.6, 0), new THREE.Vector2(-1.5, 0), new THREE.Vector2(-1.55, 0.6), new THREE.Vector2(-1.2, 0.6)]);
    const tailGeometry = new THREE.ExtrudeGeometry(tail, { depth: 0.04, bevelEnabled: false });
    tailGeometry.translate(0, 0.12, -0.02);
    group.add(mesh(tailGeometry, m.trim));
  }

  const thruster = engine(m, 0.17);
  thruster.position.set(-1.72, 0, 0);
  group.add(thruster);
  return group;
}

/** Cargo hauler: spine with container pods; `arms` adds salvage claws. */
function freighter(m, spec) {
  const group = new THREE.Group();
  const pods = Math.max(1, spec.pods ?? 2);

  group.add(box(3.4, 0.16, 0.16, m.trim, [-0.1, 0, 0]));
  group.add(extrudeOutline([[1.95, -0.16], [1.5, -0.3], [1.1, -0.3], [1.1, 0.3], [1.5, 0.3], [1.95, 0.16]], 0.34, m.hull, { y: -0.17 }));
  group.add(box(0.06, 0.06, 0.4, m.glass, [1.62, 0.12, 0]));

  const columns = Math.ceil(pods / 2);
  const span = 2.0;
  for (let i = 0; i < pods; i++) {
    const column = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const x = 0.8 - (columns === 1 ? span / 2 : (column / (columns - 1)) * span);
    const container = new THREE.Group();
    container.add(box(0.62, 0.36, 0.36, m.hull));
    container.add(box(0.64, 0.05, 0.37, m.accent, [0, 0.1, 0]));
    container.add(box(0.05, 0.37, 0.37, m.detail, [0.25, 0, 0]));
    container.add(box(0.05, 0.37, 0.37, m.detail, [-0.25, 0, 0]));
    container.position.set(x, 0, side * 0.27);
    group.add(container);
  }

  group.add(box(0.5, 0.42, 0.62, m.trim, [-1.75, 0, 0]));
  group.add(engineCluster(m, { count: pods > 2 ? 3 : 2, radius: 0.14, x: -2.1 }));

  if (spec.arms) {
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.add(box(0.8, 0.07, 0.07, m.detail, [0.4, 0, 0]));
      arm.add(box(0.3, 0.07, 0.07, m.accent, [0.85, 0, -side * 0.08], [0, side * 0.6, 0]));
      arm.position.set(1.9, 0, side * 0.24);
      arm.rotation.y = side * -0.35;
      group.add(arm);
    }
  }
  return group;
}

/** Colony ship: spine, command sphere and rotating habitat ring. */
function colony(m) {
  const group = new THREE.Group();
  const spine = new THREE.CylinderGeometry(0.1, 0.1, 3.6, 12);
  spine.rotateZ(Math.PI / 2);
  group.add(mesh(spine, m.trim));
  group.add(mesh(new THREE.SphereGeometry(0.36, 24, 16), m.hull, { position: [1.75, 0, 0] }));
  group.add(box(0.05, 0.06, 0.34, m.glass, [2.07, 0.08, 0]));

  const ring = new THREE.Group();
  const torus = new THREE.TorusGeometry(0.95, 0.12, 12, 48);
  torus.rotateY(Math.PI / 2);
  ring.add(mesh(torus, m.hull));
  ring.add(portGrid(m.lights, { rows: 1, cols: 1, width: 0, height: 0, x: 0, y: 0.95, z: 0, size: 0.06 }));
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6);
    spoke.rotateX((i * Math.PI) / 4);
    ring.add(mesh(spoke, m.detail));
  }
  ring.position.x = 0.3;
  group.add(ring);

  for (const z of [-0.26, 0.26]) {
    group.add(mesh(new THREE.SphereGeometry(0.22, 16, 12), m.trim, { position: [-1.1, 0, z] }));
  }
  group.add(engineCluster(m, { count: 3, radius: 0.13, x: -1.85, layout: 'ring', spread: 0.8 }));
  group.userData.spinners = [{ object: ring, axis: 'x', speed: 0.35 }];
  return group;
}

/** Espionage probe: faceted core, dish and antenna. */
function probe(m) {
  const group = new THREE.Group();
  const core = new THREE.OctahedronGeometry(0.7, 0);
  core.scale(1.3, 0.8, 0.8);
  group.add(mesh(core, m.hull));
  const dish = new THREE.ConeGeometry(0.55, 0.22, 24, 1, true);
  dish.rotateZ(-Math.PI / 2);
  group.add(mesh(dish, m.accent, { position: [0.95, 0, 0] }));
  const antenna = new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6);
  group.add(mesh(antenna, m.detail, { position: [-0.2, 0.9, 0] }));
  group.add(mesh(new THREE.SphereGeometry(0.05, 8, 8), m.lights, { position: [-0.2, 1.6, 0] }));
  const thruster = engine(m, 0.14);
  thruster.position.set(-0.95, 0, 0);
  group.add(thruster);
  group.userData.spinners = [{ object: group, axis: 'x', speed: 0.6 }];
  return group;
}

/** Solar satellite: hex core with two broad panel wings. */
function satellite(m) {
  const group = new THREE.Group();
  const core = new THREE.CylinderGeometry(0.32, 0.32, 0.7, 6);
  group.add(mesh(core, m.hull));
  for (const side of [-1, 1]) {
    group.add(box(0.06, 0.06, 0.6, m.detail, [0, 0, side * 0.6]));
    const wing = new THREE.Group();
    wing.add(box(1.0, 0.03, 1.5, m.panel));
    for (let i = -2; i <= 2; i++) wing.add(box(1.02, 0.04, 0.02, m.trim, [0, 0, i * 0.3]));
    wing.add(box(0.02, 0.04, 1.52, m.trim));
    wing.position.set(0, 0, side * 1.65);
    wing.rotation.x = side * 0.15;
    group.add(wing);
  }
  group.add(mesh(new THREE.SphereGeometry(0.06, 8, 8), m.lights, { position: [0, 0.4, 0] }));
  return group;
}

/** Fortress: liquid-metal sphere with an equatorial trench (Iserlohn-like). */
function fortress(m, spec, rng) {
  const group = new THREE.Group();
  group.add(mesh(new THREE.SphereGeometry(1.9, 96, 64), m.hull));

  const trench = new THREE.TorusGeometry(1.9, 0.07, 12, 128);
  trench.rotateX(Math.PI / 2);
  group.add(mesh(trench, m.detail));
  for (let i = 0; i < 48; i++) {
    const angle = (i / 48) * Math.PI * 2;
    group.add(mesh(new THREE.BoxGeometry(0.04, 0.03, 0.04), m.lights, {
      position: [Math.cos(angle) * 1.96, 0, Math.sin(angle) * 1.96]
    }));
  }

  // Turret domes scattered over the surface.
  const dome = new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < 22; i++) {
    const normal = new THREE.Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.9, rng() * 2 - 1).normalize();
    if (Math.abs(normal.y) < 0.12) continue;
    const turret = mesh(dome, m.trim);
    turret.position.copy(normal.clone().multiplyScalar(1.88));
    turret.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    group.add(turret);
  }
  group.userData.spinners = [{ object: group, axis: 'y', speed: 0.05 }];
  return group;
}

export const HULLS = { wedge, lance, fighter, freighter, colony, probe, satellite, fortress };
