// src/utils/thumbnail.ts
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const thumbSize = { width: 160, height: 120 };
const loader = new GLTFLoader();

/**
 * Laadt een glTF-model en rendert een off-screen thumbnail.
 * @param url – URL naar .gltf/.glb bestand
 * @returns data URL van een PNG
 */
export async function generateThumbnail(url: string): Promise<string> {
  // 1) Laad model
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;

  // 2) Off-screen scene en renderer
  const scene    = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(thumbSize.width, thumbSize.height);
  renderer.setClearColor(0x000000, 0);

  // 3) Voeg model toe en center
  scene.add(root);
  const box    = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);

  // 4) Bereken bounding sphere radius
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = sphere.radius;

  // 5) Zet up een OrthographicCamera voor isometrie
  const aspect = thumbSize.width / thumbSize.height;
  const d = radius * 1.5;  // bepaalt zoom-factor
  const camera = new THREE.OrthographicCamera(
    -d * aspect, d * aspect,
     d,       -d,
    -1000,    1000
  );

  // 6) Positioneer camera in de richting (1,1,1) genormaliseerd
  const dir = new THREE.Vector3(1, 1, 1).normalize();
  camera.position.copy(dir.clone().multiplyScalar(d));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  // 7) Voeg wat basislicht toe
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(1, 1, 1);
  scene.add(ambient, dirLight);

  // 8) Render en DataURL terug
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL("image/png");
  renderer.dispose();

  return dataURL;
}
