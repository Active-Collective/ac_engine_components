import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FragmentsGroup } from '@thatopen/fragments';
import { loadIfc } from '../src/ifc/loader';

const thumbSize = { width: 160, height: 120 };
const gltfLoader = new GLTFLoader();
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/lqY5WQAAAABJRU5ErkJggg==';

/**
 * Generate a thumbnail for a given model source. The source can be a URL to a
 * glTF/IFC file or an already loaded THREE.Object3D.
 */
export async function generateThumbnail(source: string | THREE.Object3D): Promise<string> {
  let root: THREE.Object3D;

  try {
    if (typeof source === 'string') {
      if (/\.ifc(zip)?$/i.test(source)) {
        console.log(`[IFC] thumbnail load ${source}`);
        const { root: r } = await loadIfc(source);
        root = r;
      } else {
        const gltf = await gltfLoader.loadAsync(source);
        root = gltf.scene;
      }
    } else {
      root = source;
    }
  } catch (error) {
    console.warn(`[IFC] thumbnail failed for ${source}`, error);
    return PLACEHOLDER;
  }

  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(thumbSize.width, thumbSize.height);
  renderer.setClearColor(0x000000, 0);

  let clone: THREE.Object3D;
  if (root instanceof FragmentsGroup && typeof (root as any).cloneGroup === 'function') {
    try {
      clone = (root as any).cloneGroup();
    } catch {
      clone = root.clone(true);
    }
  } else {
    clone = root.clone(true);
  }
  scene.add(clone);

  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  clone.position.sub(center);

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = sphere.radius;
  const aspect = thumbSize.width / thumbSize.height;
  const d = radius * 1.5;
  const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, -1000, 1000);
  const dir = new THREE.Vector3(1, 1, 1).normalize();
  camera.position.copy(dir.clone().multiplyScalar(d));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(1, 1, 1);
  scene.add(ambient, dirLight);

  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL('image/png');
  renderer.dispose();

  return dataURL;
}
