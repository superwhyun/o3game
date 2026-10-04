import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export function createStudio(renderer) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = pmrem.fromScene(room, 0.04);
  scene.environment = target.texture;
  scene.userData.environmentTarget = target;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x151d26, 1.3));
  const key = new THREE.DirectionalLight(0xfff1d6, 3);
  key.position.set(4, 5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb8ff, 2);
  rim.position.set(-5, 3, -4);
  scene.add(rim);
  return scene;
}
export function disposeStudio(scene) {
  scene.userData.environmentTarget?.dispose();
}
