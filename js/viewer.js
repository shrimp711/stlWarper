import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const state = {
  scene: null,
  renderer: null,
  camera: null,
  controls: null,
  originalMesh: null,
  compensatedMesh: null,
  container: null,
};

function fitCameraToObject(camera, controls, object, offset = 1.25) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxSize = Math.max(size.x, size.y, size.z, 1);
  const fov = camera.fov * (Math.PI / 180);
  const distance = Math.abs((maxSize * 0.5) / Math.tan(fov * 0.5)) * offset;

  camera.position.set(center.x + distance * 0.8, center.y + distance * 0.55, center.z + distance * 0.8);
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function onResize() {
  if (!state.container || !state.renderer || !state.camera) {
    return;
  }
  const width = state.container.clientWidth;
  const height = state.container.clientHeight;
  state.renderer.setSize(width, height);
  state.camera.aspect = width / Math.max(height, 1);
  state.camera.updateProjectionMatrix();
}

export function initViewer(container) {
  state.container = container;
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xf4fbff);

  const width = Math.max(container.clientWidth, 10);
  const height = Math.max(container.clientHeight, 10);

  state.camera = new THREE.PerspectiveCamera(46, width / height, 0.01, 1000);
  state.camera.position.set(120, 90, 130);

  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  state.renderer.setPixelRatio(window.devicePixelRatio || 1);
  state.renderer.setSize(width, height);
  container.appendChild(state.renderer.domElement);

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;

  const hemi = new THREE.HemisphereLight(0xf8fcff, 0xdde4e6, 1.0);
  state.scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(90, 120, 40);
  state.scene.add(key);

  const fill = new THREE.DirectionalLight(0xfff2db, 0.45);
  fill.position.set(-70, 60, -40);
  state.scene.add(fill);

  const grid = new THREE.GridHelper(240, 24, 0x95abb5, 0xc9d9df);
  grid.position.y = 0;
  state.scene.add(grid);

  window.addEventListener('resize', onResize);

  function animate() {
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
    requestAnimationFrame(animate);
  }
  animate();
}

export function setOriginalGeometry(geometry) {
  if (state.originalMesh) {
    state.scene.remove(state.originalMesh);
    state.originalMesh.geometry.dispose();
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x4f7894,
    metalness: 0.08,
    roughness: 0.62,
    transparent: true,
    opacity: 0.55,
  });

  state.originalMesh = new THREE.Mesh(geometry, material);
  state.originalMesh.castShadow = false;
  state.originalMesh.receiveShadow = false;
  state.scene.add(state.originalMesh);

  fitCameraToObject(state.camera, state.controls, state.originalMesh);
}

export function setCompensatedGeometry(geometry) {
  if (state.compensatedMesh) {
    state.scene.remove(state.compensatedMesh);
    state.compensatedMesh.geometry.dispose();
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xd95f18,
    metalness: 0.07,
    roughness: 0.5,
    transparent: true,
    opacity: 0.9,
  });

  state.compensatedMesh = new THREE.Mesh(geometry, material);
  state.compensatedMesh.castShadow = false;
  state.compensatedMesh.receiveShadow = false;
  state.scene.add(state.compensatedMesh);

  fitCameraToObject(state.camera, state.controls, state.compensatedMesh);
}

export function buildExportMesh(compensatedGeometry) {
  const exportMaterial = new THREE.MeshBasicMaterial();
  return new THREE.Mesh(compensatedGeometry, exportMaterial);
}
