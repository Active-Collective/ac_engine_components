import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

let selected: THREE.Object3D | null = null;
let bbox: THREE.BoxHelper | null = null;
let controls: TransformControls | null = null;
const models: THREE.Object3D[] = [];
const rootMap = new Map<THREE.Object3D, THREE.Object3D>();
export let world: OBC.World;

function loadGltf(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return loader.loadAsync(url);
}

export async function bootstrap() {
  const container = document.getElementById("viewer") as HTMLDivElement;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;

  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.SimpleCamera(components);

  components.init();
  world.scene.setup();
  world.camera.controls.setLookAt(5, 5, 5, 0, 0, 0);

  const grids = components.get(OBC.Grids);
  const grid = grids.create(world);
  grid.config.primarySize = 1;

  const casters = components.get(OBC.Raycasters);
  const caster = casters.get(world);

  function selectObject(obj: THREE.Object3D | null) {
    if (bbox) {
      world.scene.three.remove(bbox);
      bbox = null;
    }

    if (!obj) {
      controls?.detach();
      selected = null;
      return;
    }

    const root = rootMap.get(obj) ?? obj;
    selected = root;

    if (!controls) {
      controls = new TransformControls(
        world.camera.three,
        world.renderer.three.domElement,
      );
      controls.setMode("translate");
      controls.showZ = false;
      controls.addEventListener("dragging-changed", ev => {
        world.camera.controls.enabled = !ev.value;
      });
      controls.addEventListener("change", () => {
        bbox?.update();
      });
      world.scene.three.add(controls);
    }

    controls.attach(root);
    bbox = new THREE.BoxHelper(root, 0x00ff00);
    world.scene.three.add(bbox);
  }

  async function addModel(url: string, position: THREE.Vector3) {
    const gltf = await loadGltf(url);
    gltf.scene.position.copy(position);
    gltf.scene.traverse(obj => {
      rootMap.set(obj, gltf.scene);
      if (obj instanceof THREE.Object3D) obj.name ||= "unit";
    });
    world.scene.three.add(gltf.scene);
    models.push(gltf.scene);
    return gltf.scene;
  }

  const urls = [
    "/packages/core/assets/unit1.glb",
    "/packages/core/assets/unit2.glb",
    "/packages/core/assets/unit3.glb",
    "/packages/core/assets/unit4.glb",
  ];
  for (let i = 0; i < urls.length; i++) {
    await addModel(urls[i], new THREE.Vector3(i * 2, 0, 0));
  }

  world.renderer.three.domElement.addEventListener("pointerdown", () => {
    if (controls && (controls as any).dragging) return;
    const result = caster.castRay(models);
    if (result) {
      selectObject(result.object as THREE.Object3D);
    } else {
      selectObject(null);
    }
  });

  window.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "r" && selected) {
      selected.rotateY(Math.PI / 2);
      bbox?.update();
    }
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.glb$|\.gltf$/i)) {
      alert("Invalid file type");
      return;
    }
    const url = URL.createObjectURL(file);
    const obj = await addModel(url, new THREE.Vector3(models.length * 2, 0, 0));
    selectObject(obj);
  });
}

bootstrap();
