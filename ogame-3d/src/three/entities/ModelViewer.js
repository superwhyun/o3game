import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStudio, disposeStudio } from './Studio.js';
const reduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** One inspector can be reattached between browsers without creating contexts. */
export class ModelViewer {
  constructor(container) {
    this.model = null;
    this.modelKey = null;
    this.running = false;
    this.frame = null;
    this.startTime = performance.now();
    this.rotation = !reduced();
    this.lost = false;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        window.matchMedia('(max-width: 700px)').matches ? 1.5 : 2,
      ),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'ship-viewer-canvas';
    this.renderer.domElement.setAttribute(
      'aria-label',
      '3D 모형: 아래 버튼으로 회전 및 확대',
    );
    this.scene = createStudio(this.renderer);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.minPolarAngle = 0.2;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.visible ? this.start() : this.stop();
    });
    this.onVisibility = () => (document.hidden ? this.stop() : this.start());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.onMotion = () => {
      this.rotation = !reduced();
      this.controls.autoRotate = this.rotation;
      this.renderOnce();
    };
    this.motionQuery.addEventListener('change', this.onMotion);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.stop();
      this.onFailure?.(true);
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.onFailure?.(false);
      this.resize();
      this.start();
    });
    this.attach(container);
  }
  attach(container) {
    this.stop();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.resizeObserver.observe(container);
    this.intersectionObserver.observe(container);
    this.visible = container.getBoundingClientRect().width > 0;
    this.resize();
    this.start();
  }
  show(spec, key, create, dispose) {
    if (this.modelKey === key && this.model) return;
    const model = create(spec, key); // Keep old model if construction fails.
    if (this.model) {
      this.scene.remove(this.model);
      this.disposeModel(this.model);
    }
    this.model = model;
    this.disposeModel = dispose;
    this.modelKey = key;
    this.scene.add(model);
    this.spec = spec;
    this.resetCamera();
    this.renderOnce();
  }
  resetCamera() {
    if (!this.model) return;
    const r = Math.max(0.1, this.model.userData.radius);
    // Fit both the horizontal and vertical FOV, including tall/mobile frames.
    const fov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const angle = Math.min(fov, Math.atan(Math.tan(fov) * this.camera.aspect));
    const d = (r / Math.sin(angle)) * 1.08;
    this.camera.position.set(0.65, 0.52, 0.8).normalize().multiplyScalar(d);
    this.camera.near = d / 100;
    this.camera.far = d * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = r * 1.5;
    this.controls.maxDistance = d * 2;
    this.controls.update();
  }
  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h || this.lost) return;
    const aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.lastAspect !== aspect) {
      this.lastAspect = aspect;
      this.resetCamera();
    }
    this.renderOnce();
  }
  setInteractive(enabled) {
    this.interactive = enabled;
    this.controls.enabled = enabled;
    this.controls.autoRotate = this.rotation && !reduced();
    this.renderer.domElement.style.touchAction = enabled ? 'none' : 'pan-y';
    this.renderer.domElement.style.pointerEvents = enabled ? 'auto' : 'none';
  }
  action(action) {
    if (action === 'rotate') {
      this.rotation = !this.rotation;
      this.controls.autoRotate = this.rotation && !reduced();
    } else if (action === 'reset') this.resetCamera();
    else if (action === 'left' || action === 'right') {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        action === 'left' ? -0.35 : 0.35,
      );
      this.camera.position.copy(this.controls.target).add(offset);
    } else if (action === 'in' || action === 'out') {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const length = THREE.MathUtils.clamp(
        offset.length() * (action === 'in' ? 0.85 : 1.15),
        this.controls.minDistance,
        this.controls.maxDistance,
      );
      this.camera.position
        .copy(this.controls.target)
        .add(offset.setLength(length));
    }
    this.controls.update();
    this.renderOnce();
  }
  renderOnce() {
    if (this.lost) return;
    this.model?.userData.update?.(
      reduced() ? 0 : (performance.now() - this.startTime) / 1000,
    );
    this.renderer.render(this.scene, this.camera);
  }
  start() {
    if (this.running || !this.visible || this.lost || document.hidden) return;
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
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motionQuery.removeEventListener('change', this.onMotion);
    this.controls.dispose();
    if (this.model) this.disposeModel(this.model);
    disposeStudio(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
let shared;
export function acquireViewer(container) {
  if (!shared) shared = new ModelViewer(container);
  else if (shared.container !== container) shared.attach(container);
  return shared;
}
export function stopInspector() {
  shared?.stop();
}
export function disposeInspector() {
  shared?.dispose();
  shared = null;
}
export function inspectorStats() {
  return shared
    ? { running: shared.running, key: shared.modelKey, ...shared.renderer.info }
    : null;
}
