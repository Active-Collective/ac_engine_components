import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { analyzeGroup, renderSidebar, unitInfoMap } from "./sidebar";

let selected: THREE.Object3D | null = null;
let subSelected: THREE.Mesh | null = null;
let bbox: THREE.BoxHelper | null = null;
let subBox: THREE.BoxHelper | null = null;
let hoverBox: THREE.BoxHelper | null = null;
let controls: TransformControls | null = null;
let dragHandle: THREE.Mesh | null = null;
let isDraggingHandle = false;
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();
const rootMap = new Map<THREE.Object3D, THREE.Object3D>();

export let world: OBC.World;
let bboxer: OBC.BoundingBoxer;
let totalWidth = 0;
let totalHeight = 0;
let loadedCount = 0;
let verticalSnap = 1;
const tempBox = new THREE.Box3();
const tempSize = new THREE.Vector3();

function applyVariant(target: THREE.Object3D, mat: THREE.Material) {
  target.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      const mesh = obj as THREE.Mesh;
      if (!mesh.userData.originalMaterial) {
        mesh.userData.originalMaterial = mesh.material as THREE.Material;
      }
      const oldMat = mesh.material as THREE.Material;
      if (oldMat !== mesh.userData.originalMaterial) oldMat.dispose();
      mesh.material = mat.clone();
      mesh.material.needsUpdate = true;
    }
  });
}

function resetMaterial(target: THREE.Object3D) {
  target.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      const mesh = obj as THREE.Mesh;
      const original = mesh.userData.originalMaterial as THREE.Material | undefined;
      if (original && mesh.material !== original) {
        (mesh.material as THREE.Material).dispose();
        mesh.material = original;
      }
    }
  });
}

function attachHandle(root: THREE.Object3D) {
  bboxer.reset();
  root.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) bboxer.addMesh(o);
  });
  const b = bboxer.get();
  const dims = OBC.BoundingBoxer.getDimensions(b);
  bboxer.reset();

  const size = Math.max(dims.width, dims.depth, dims.height) * 0.05;
  if (!dragHandle) {
    dragHandle = new THREE.Mesh(
      new THREE.SphereGeometry(size, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
  } else {
    dragHandle.geometry.dispose();
    dragHandle.geometry = new THREE.SphereGeometry(size, 16, 16);
  }

  const center = b.getCenter(new THREE.Vector3());
  const top = b.max.y + dims.height * 0.1;
  center.y = top;
  root.worldToLocal(center);

  dragHandle.position.copy(center);
  dragHandle.visible = true;
  root.add(dragHandle);
  world.meshes.add(dragHandle);
}

function detachHandle() {
  if (dragHandle && dragHandle.parent) dragHandle.parent.remove(dragHandle);
  if (dragHandle) world.meshes.delete(dragHandle);
}

function loadGltf(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return loader.loadAsync(url);
}

export async function bootstrap() {
  const container = document.getElementById("viewer") as HTMLDivElement;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;
  const palette = document.getElementById("palette") as HTMLDivElement;
  const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;
  const library = document.getElementById("library") as HTMLDivElement;
  const libItems = document.getElementById("libItems") as HTMLDivElement;
  const snapInput = document.getElementById("snapSize") as HTMLInputElement;
  const snapHeightInput = document.getElementById("snapHeight") as HTMLInputElement;
  const gridColorInput = document.getElementById("gridColor") as HTMLInputElement;
  const bgInput = document.getElementById("bgColor") as HTMLInputElement;

  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.SimpleCamera(components);

  components.init();
  world.scene.setup();
  world.camera.controls.setLookAt(5, 5, 5, 0, 0, 0);

  world.renderer.three.outputEncoding = THREE.sRGBEncoding;
  const pmrem = new THREE.PMREMGenerator(world.renderer.three);
  new THREE.TextureLoader().load("/assets/ozone.jpg", tex => {
    const env = pmrem.fromEquirectangular(tex).texture;
    world.scene.three.environment = env;
    tex.dispose();
    pmrem.dispose();
  });

  bboxer = components.get(OBC.BoundingBoxer);

  const grids = components.get(OBC.Grids);
  const grid = grids.create(world);
  grid.config.primarySize = 1;
  const gridPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  snapInput.value = String(grid.config.primarySize);
  snapHeightInput.value = String(verticalSnap);
  gridColorInput.value = `#${grid.config.color.getHexString()}`;
  bgInput.value = "#000000";
  snapInput.addEventListener("change", () => {
    const v = parseFloat(snapInput.value) || 1;
    grid.config.primarySize = v;
    if (controls) controls.translationSnap = v;
  });
  snapHeightInput.addEventListener("change", () => {
    const v = parseFloat(snapHeightInput.value) || 1;
    verticalSnap = v;
  });
  gridColorInput.addEventListener("change", () => {
    grid.config.color = new THREE.Color(gridColorInput.value);
  });
  bgInput.addEventListener("change", () => {
    world.renderer.three.setClearColor(bgInput.value);
  });

  const casters = components.get(OBC.Raycasters);
  const caster = casters.get(world);

  const libUrls = [
    new URL("../core/assets/unit1.glb", import.meta.url).href,
    new URL("../core/assets/unit2.glb", import.meta.url).href,
    new URL("../core/assets/unit3.glb", import.meta.url).href,
    new URL("../core/assets/unit4.glb", import.meta.url).href,
  ];

  libUrls.forEach(u => {
    const item = document.createElement("div");
    item.className = "lib-item";
    item.draggable = true;
    item.dataset.url = u;
    item.addEventListener("dragstart", ev => {
      ev.dataTransfer?.setData("text", u);
    });
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const label = document.createElement("span");
    label.textContent = u.split("/").pop() || u;
    item.appendChild(thumb);
    item.appendChild(label);
    libItems.appendChild(item);
  });

  function clearHover() {
    if (hoverBox) {
      world.scene.three.remove(hoverBox);
      hoverBox = null;
    }
  }

  function setHover(obj: THREE.Object3D | null) {
    clearHover();
    if (!obj) return;
    const root = rootMap.get(obj) ?? obj;
    if (root === selected) return;
    hoverBox = new THREE.BoxHelper(root, 0xffff00);
    world.scene.three.add(hoverBox);
  }

  function selectObject(obj: THREE.Object3D | null) {
    if (bbox) {
      world.scene.three.remove(bbox);
      bbox = null;
    }
    detachHandle();

    if (!obj) {
      controls?.detach();
      detachHandle();
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
      controls.showY = false;
      controls.translationSnap = grid.config.primarySize;
      controls.addEventListener("dragging-changed", ev => {
        world.camera.controls.enabled = !ev.value;
      });
      controls.addEventListener("change", () => {
        if (!controls) return;
        const p = controls.object.position;
        const size = grid.config.primarySize;
        p.set(
          Math.round(p.x / size) * size,
          p.y,
          Math.round(p.z / size) * size,
        );
        bbox?.update();
        subBox?.update();
        detachHandle();
        attachHandle(controls.object as THREE.Object3D);
      });
      world.scene.three.add(controls);
    }

    controls.attach(root);
    bbox = new THREE.BoxHelper(root, 0x00ff00);
    world.scene.three.add(bbox);
    attachHandle(root);
  }

  function selectSubObject(mesh: THREE.Mesh | null) {
    if (subBox) {
      world.scene.three.remove(subBox);
      subBox = null;
    }
    subSelected = mesh;
    if (mesh) {
      subBox = new THREE.BoxHelper(mesh, 0xffff00);
      world.scene.three.add(subBox);
    }
  }

  async function addModel(url: string, position = new THREE.Vector3()) {
    const gltf = await loadGltf(url);

    gltf.scene.updateMatrixWorld(true);
    bboxer.reset();
    gltf.scene.traverse(obj => {
      rootMap.set(obj, gltf.scene);
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        bboxer.addMesh(obj);
        world.meshes.add(obj);
        if (!obj.userData.originalMaterial) {
          obj.userData.originalMaterial = obj.material;
        }
      }
      if (obj instanceof THREE.Object3D) obj.name ||= "unit";
    });
    const bounds = bboxer.get();
    const dims = OBC.BoundingBoxer.getDimensions(bounds);
    bboxer.reset();

    gltf.scene.position.set(
      position.x - bounds.min.x,
      position.y - bounds.min.y,
      position.z - bounds.min.z,
    );
    world.scene.three.add(gltf.scene);
    const info = analyzeGroup(gltf.scene, url);
    unitInfoMap.set(gltf.scene, info);
    renderSidebar();
    totalWidth += dims.width;
    totalHeight += dims.height;
    loadedCount++;
    const avg = totalWidth / loadedCount;
    const hAvg = totalHeight / loadedCount;
    grid.config.primarySize = avg;
    verticalSnap = hAvg;
    if (controls) controls.translationSnap = avg;
    snapInput.value = String(avg);
    snapHeightInput.value = String(hAvg);
    return { object: gltf.scene, width: dims.width };
  }

  const loadUrls = [
    new URL("../core/assets/unit1.glb", import.meta.url).href,
    new URL("../core/assets/unit2.glb", import.meta.url).href,
    new URL("../core/assets/unit3.glb", import.meta.url).href,
    new URL("../core/assets/unit4.glb", import.meta.url).href,
  ];
  let offset = 0;
  for (const url of loadUrls) {
    const { width } = await addModel(url, new THREE.Vector3(offset, 0, 0));
    offset += width;
  }

  world.renderer.three.domElement.addEventListener("pointermove", ev => {
    if (isDraggingHandle && selected) {
      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      caster.three.setFromCamera(ndc, world.camera.three);
      const point = new THREE.Vector3();
      caster.three.ray.intersectPlane(dragPlane, point);
      point.sub(dragOffset);
      const size = grid.config.primarySize;
      point.x = Math.round(point.x / size) * size;
      point.z = Math.round(point.z / size) * size;
      selected.position.x = point.x;
      selected.position.z = point.z;
      bbox?.update();
      controls?.updateMatrixWorld(true);
      return;
    }
    if (controls && (controls as any).dragging) return;
    const result = caster.castRay();
    if (result) setHover(result.object as THREE.Object3D);
    else clearHover();
  });

  world.renderer.three.domElement.addEventListener("pointerdown", ev => {
    if (controls && (controls as any).dragging) return;
    const result = caster.castRay();
    if (!result) {
      selectObject(null);
      selectSubObject(null);
      return;
    }

    if (result.object === dragHandle) {
      isDraggingHandle = true;
      const point = new THREE.Vector3();
      dragPlane.set(new THREE.Vector3(0, 1, 0), -selected!.position.y);
      caster.three.ray.intersectPlane(dragPlane, point);
      dragOffset.copy(point).sub(selected!.position);
      world.camera.controls.enabled = false;
      return;
    }

    if (ev.button === 2) {
      if (result.object instanceof THREE.Mesh) {
        selectSubObject(result.object as THREE.Mesh);
      }
    } else {
      selectObject(result.object as THREE.Object3D);
      selectSubObject(null);
    }
  });

  world.renderer.three.domElement.addEventListener("pointerup", () => {
    if (isDraggingHandle) {
      isDraggingHandle = false;
      world.camera.controls.enabled = true;
    }
  });

  world.renderer.three.domElement.addEventListener("contextmenu", ev => {
    ev.preventDefault();
  });

  container.addEventListener("dragover", e => e.preventDefault());
  container.addEventListener("drop", async ev => {
    ev.preventDefault();
    const url = ev.dataTransfer?.getData("text");
    if (!url) return;
    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    caster.three.setFromCamera(ndc, world.camera.three);
    const point = new THREE.Vector3();
    caster.three.ray.intersectPlane(gridPlane, point);
    const size = grid.config.primarySize;
    point.x = Math.round(point.x / size) * size;
    point.z = Math.round(point.z / size) * size;
    const { object } = await addModel(url, point);
    selectObject(object);
  });

  window.addEventListener("keydown", e => {
    if (!selected) return;

    const step = grid.config.primarySize;
    const vstep = verticalSnap;

    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        selected.position.z -= step;
        break;
      case "ArrowDown":
      case "s":
      case "S":
        selected.position.z += step;
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        selected.position.x -= step;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        selected.position.x += step;
        break;
      case "q":
      case "Q":
        selected.position.y += vstep;
        break;
      case "e":
      case "E":
        selected.position.y -= vstep;
        break;
      case "r":
      case "R":
        selected.rotateY(Math.PI / 2);
        break;
      default:
        return;
    }

    selected.position.x = Math.round(selected.position.x / step) * step;
    selected.position.y = Math.round(selected.position.y / vstep) * vstep;
    selected.position.z = Math.round(selected.position.z / step) * step;

    selected.updateMatrixWorld();
    controls?.updateMatrixWorld(true);
    bbox?.update();
    subBox?.update();
    detachHandle();
    attachHandle(selected);
    e.preventDefault();
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.glb$|\.gltf$/i)) {
      alert("Invalid file type");
      return;
    }
    const url = URL.createObjectURL(file);
    const { object, width } = await addModel(url, new THREE.Vector3(offset, 0, 0));
    offset += width;
    selectObject(object);
  });

  palette.querySelectorAll<HTMLButtonElement>("button[data-variant]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = subSelected ?? selected;
      if (!target) return;
      const type = btn.dataset.variant!;
      let mat: THREE.Material;
      if (type === "red") mat = new THREE.MeshStandardMaterial({ color: "red" });
      else if (type === "blue") mat = new THREE.MeshStandardMaterial({ color: "blue" });
      else {
        const tex = new THREE.TextureLoader().load("/assets/wood.jpg");
        mat = new THREE.MeshStandardMaterial({ map: tex });
      }
      applyVariant(target, mat);
      if (subSelected) subBox?.update();
      else bbox?.update();
    });
  });

  resetBtn.addEventListener("click", () => {
    const target = subSelected ?? selected;
    if (!target) return;
    resetMaterial(target);
    if (subSelected) subBox?.update();
    else bbox?.update();
  });
}

bootstrap();
