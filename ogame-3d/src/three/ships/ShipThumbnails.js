/**
 * Renders small still images of ship models for lists, using one shared
 * offscreen renderer. Results are cached per entity id + spec.
 */
import * as THREE from 'three';
import { createShipModel, disposeShipModel } from './ShipModelFactory.js';
import { createStudio } from './ShipViewer.js';

const WIDTH = 168;
const HEIGHT = 104;

let renderer = null;
let scene = null;
let camera = null;
const cache = new Map();
let queue = Promise.resolve();

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = createStudio(renderer);
  camera = new THREE.PerspectiveCamera(28, WIDTH / HEIGHT, 0.05, 200);
}

function renderNow(spec, key) {
  ensureRenderer();
  const model = createShipModel(spec, key);
  model.userData.update(0.4);
  scene.add(model);

  const radius = model.userData.radius;
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.62;
  camera.position.set(0.55, 0.42, 0.72).normalize().multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
  camera.near = distance / 100;
  camera.far = distance * 10;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  scene.remove(model);
  disposeShipModel(model);
  return url;
}

/**
 * @param {object} spec resolved model spec
 * @param {string} key  entity id
 * @returns {Promise<string>} data URL
 */
export function getShipThumbnail(spec, key) {
  const cacheKey = `${key}:${JSON.stringify(spec)}`;
  if (!cache.has(cacheKey)) {
    // Serialize renders and yield between them so lists stay responsive.
    const job = queue.then(() => new Promise((resolve, reject) => {
      const run = () => {
        try {
          resolve(renderNow(spec, key));
        } catch (error) {
          reject(error);
        }
      };
      (window.requestIdleCallback || ((cb) => setTimeout(cb, 16)))(run);
    }));
    queue = job.catch(() => undefined);
    cache.set(cacheKey, job);
  }
  return cache.get(cacheKey);
}
