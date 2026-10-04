import * as THREE from 'three';
import { createStudio, disposeStudio } from './Studio.js';
let renderer, scene, camera;
let queue = Promise.resolve(),
  bytes = 0;
const cache = new Map();
const MAX_COUNT = 96,
  MAX_BYTES = 48 * 1024 * 1024;
function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(224, 144, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = createStudio(renderer);
  camera = new THREE.PerspectiveCamera(32, 224 / 144, 0.05, 200);
}
function trim() {
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_COUNT && bytes <= MAX_BYTES) break;
    if (entry.size) {
      bytes -= entry.size;
      cache.delete(key);
    }
  }
}
function render(spec, key, create, dispose) {
  ensureRenderer();
  const model = create(spec, key);
  scene.add(model);
  try {
    model.userData.update?.(0);
    const r = Math.max(0.1, model.userData.radius),
      d = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.03;
    camera.position.set(0.65, 0.52, 0.8).normalize().multiplyScalar(d);
    camera.lookAt(0, 0, 0);
    camera.near = d / 100;
    camera.far = d * 10;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    scene.remove(model);
    dispose(model);
  }
}
export function getModelThumbnail(spec, key, create, dispose) {
  const cacheKey = `${spec.kind || 'ship'}:${key}:${JSON.stringify(spec)}`;
  if (cache.has(cacheKey)) {
    const entry = cache.get(cacheKey);
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    return entry.job;
  }
  const entry = { size: 0 };
  entry.job = queue
    .then(
      () =>
        new Promise((resolve, reject) => {
          (window.requestIdleCallback || ((cb) => setTimeout(cb, 16)))(
            () => {
              try {
                resolve(render(spec, key, create, dispose));
              } catch (e) {
                reject(e);
              }
            },
            { timeout: 250 },
          );
        }),
    )
    .then((url) => {
      entry.size = url.length * 2;
      bytes += entry.size;
      trim();
      return url;
    })
    .catch((error) => {
      cache.delete(cacheKey);
      throw error;
    });
  queue = entry.job.catch(() => undefined);
  cache.set(cacheKey, entry);
  return entry.job;
}
export function thumbnailStats() {
  return { entries: cache.size, bytes, contexts: renderer ? 1 : 0 };
}
export function disposeThumbnails() {
  if (scene) disposeStudio(scene);
  renderer?.dispose();
  renderer = scene = camera = null;
  cache.clear();
  bytes = 0;
}
