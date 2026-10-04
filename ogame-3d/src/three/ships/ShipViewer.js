/**
 * Interactive 3D ship inspector shown in the shipyard detail pane.
 * One renderer is reused for every ship; it only animates while visible.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createShipModel, disposeShipModel } from './ShipModelFactory.js';

const GRID_COLOR = 0xc8a96a;
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function createStudio(renderer) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1408, 0.6));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
  key.position.set(4, 5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb8ff, 1.6);
  rim.position.set(-5, 1.5, -4);
  scene.add(rim);
  return scene;
}

function createTacticalFloor() {
  const group = new THREE.Group();
  const grid = new THREE.PolarGridHelper(1, 12, 4, 64, GRID_COLOR, GRID_COLOR);
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  group.add(grid);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.995, 1.0, 96),
    new THREE.MeshBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  return group;
}

export class ShipViewer {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.model = null;
    this.modelKey = null;
    this.running = false;
    this.visible = false;
    this.frame = null;
    this.startTime = performance.now();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'ship-viewer-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = createStudio(this.renderer);
    this.floor = createTacticalFloor();
    this.scene.add(this.floor);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotate = !prefersReducedMotion();
    this.controls.autoRotateSpeed = 0.9;
    this.controls.maxPolarAngle = Math.PI * 0.62;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.visible ? this.start() : this.stop();
    });
    this.intersectionObserver.observe(container);
    this.resize();
  }

  /**
   * @param {object} spec  resolved model spec
   * @param {string} key   entity id (seed + change detection)
   */
  show(spec, key) {
    if (this.modelKey === key && this.model) return;
    if (this.model) {
      this.scene.remove(this.model);
      disposeShipModel(this.model);
    }
    this.model = createShipModel(spec, key);
    this.modelKey = key;
    this.scene.add(this.model);

    const radius = this.model.userData.radius;
    this.floor.scale.setScalar(radius * 1.15);
    this.floor.position.y = -radius * 0.55;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.78;
    this.camera.position.set(distance * 0.62, distance * 0.36, distance * 0.7).normalize().multiplyScalar(distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = radius * 1.4;
    this.controls.maxDistance = distance * 2;
    this.controls.update();
    this.renderOnce();
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderOnce();
  }

  renderOnce() {
    if (this.model) this.model.userData.update((performance.now() - this.startTime) / 1000);
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.running || !this.visible) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.renderOnce();
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.controls.dispose();
    if (this.model) disposeShipModel(this.model);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
