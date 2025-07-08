import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

let selected: THREE.Object3D | null = null;
export let world: OBC.World;

async function loadGltf(url: string) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

async function addModel(url: string) {
  const scene = await loadGltf(url);
  world.scene.three.add(scene);
  selected = scene;
}

(async () => {
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

  await addModel("/assets/unit1.glb");

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "r" && selected) {
      selected.rotateY(Math.PI / 2);
    }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.gl(b|tf)$/i)) {
      alert("Invalid file type");
      return;
    }
    const url = URL.createObjectURL(file);
    if (selected) world.scene.three.remove(selected);
    await addModel(url);
  });
})();
