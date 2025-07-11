import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { analyzeGroup, renderSidebar, unitInfoMap } from "./sidebar";
import { initFloors, addUnitToLevel, moveUnitToLevel, setActiveFloor, currentLevel, floors, grids } from "./levels";
import { initSettings } from "./settings";
import "./nudge.css";

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

let nudgeGroup: THREE.Group | null = null;
let nudgeTargets: THREE.Object3D[] = [];
let hoveredArrow: THREE.Object3D | null = null;
let planePreview: THREE.Mesh | null = null;

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

function fadeNudge(target: THREE.Group, to: number, done?: () => void) {
  const start = performance.now();
  const from = (target.children[0] as THREE.ArrowHelper).cone.material.opacity;
  function step() {
    const t = Math.min(1, (performance.now() - start) / 200);
    const val = from + (to - from) * t;
    target.children.forEach(c => {
      const a = c as THREE.ArrowHelper;
      (a.cone.material as THREE.Material & { opacity: number }).opacity = val;
      (a.line.material as THREE.Material & { opacity: number }).opacity = val;
    });
    if (t < 1) requestAnimationFrame(step); else done && done();
  }
  step();
}

function createNudgeGizmos(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  const midX = (box.min.x + box.max.x) / 2;
  const midY = (box.min.y + box.max.y) / 2;
  const midZ = (box.min.z + box.max.z) / 2;
  const gap = 0.5;
  const len = 1;
  const head = 0.2;
  const infos = [
    { n: new THREE.Vector3(1, 0, 0), p: new THREE.Vector3(box.max.x, midY, midZ) },
    { n: new THREE.Vector3(-1, 0, 0), p: new THREE.Vector3(box.min.x, midY, midZ) },
    { n: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(midX, box.max.y, midZ) },
    { n: new THREE.Vector3(0, -1, 0), p: new THREE.Vector3(midX, box.min.y, midZ) },
    { n: new THREE.Vector3(0, 0, 1), p: new THREE.Vector3(midX, midY, box.max.z) },
    { n: new THREE.Vector3(0, 0, -1), p: new THREE.Vector3(midX, midY, box.min.z) },
  ];
  const g = new THREE.Group();
  nudgeTargets = [];
  const parent = obj.parent as THREE.Object3D;
  infos.forEach(info => {
    const pos = info.p.clone().addScaledVector(info.n, gap);
    parent.worldToLocal(pos);
    const arrow = new THREE.ArrowHelper(info.n, pos, len, 0x0078ff, head, head * 0.5);
    arrow.cone.material.transparent = true;
    arrow.line.material.transparent = true;
    (arrow.cone.material as THREE.Material & { opacity: number }).opacity = 0;
    (arrow.line.material as THREE.Material & { opacity: number }).opacity = 0;
    (arrow as any).userData.normal = info.n.clone();
    g.add(arrow);
    nudgeTargets.push(arrow.cone, arrow.line);
  });
  return g;
}

function attachNudge(obj: THREE.Object3D) {
  detachNudge();
  nudgeGroup = createNudgeGizmos(obj);
  obj.parent?.add(nudgeGroup);
  nudgeTargets.forEach(t => world.meshes.add(t));
  fadeNudge(nudgeGroup, 1);
}

function detachNudge() {
  if (!nudgeGroup) return;
  const group = nudgeGroup;
  fadeNudge(group, 0, () => {
    group.parent?.remove(group);
    nudgeTargets.forEach(t => world.meshes.delete(t));
    nudgeGroup = null;
    nudgeTargets = [];
  });
  hoveredArrow = null;
}

function showPreview(y: number) {
  if (!planePreview) {
    planePreview = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x0078ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide })
    );
    planePreview.rotation.x = -Math.PI / 2;
    world.scene.three.add(planePreview);
  }
  planePreview.position.y = y;
  planePreview.visible = true;
}

function hidePreview() {
  if (planePreview) planePreview.visible = false;
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
  const menu = document.createElement("div");
  menu.id = "contextMenu";
  Object.assign(menu.style, {
    position: "absolute",
    zIndex: "12",
    background: "#fff",
    border: "1px solid #ccc",
    fontSize: "12px",
    display: "none",
  });
  document.body.appendChild(menu);
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

  const gridPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  initFloors(world, gridPlane);
  const grid = grids[0];
  verticalSnap = floors[0].height;
  initSettings();
  snapInput.value = String(grid.config.primarySize);
  snapHeightInput.value = String(floors[0].height);
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
    floors.forEach(f => (f.height = v));
    setActiveFloor(currentLevel);
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
    detachNudge();

    if (!obj) {
      controls?.detach();
      detachHandle();
      detachNudge();
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
        if (nudgeGroup) nudgeGroup.visible = !ev.value;
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
        attachNudge(controls.object as THREE.Object3D);
      });
      world.scene.three.add(controls);
    }

    controls.attach(root);
    bbox = new THREE.BoxHelper(root, 0x00ff00);
    world.scene.three.add(bbox);
    attachHandle(root);
    attachNudge(root);
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
    addUnitToLevel(gltf.scene, 0);
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
    floors.forEach(f => (f.height = hAvg));
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
      showPreview(currentLevel * floors[currentLevel].height);
      return;
    }
    if (controls && (controls as any).dragging) return;
    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, world.camera.three);
    const hits = nudgeTargets.length ? ray.intersectObjects(nudgeTargets, false) : [];
    if (hits.length) {
      const obj = hits[0].object;
      if (hoveredArrow && hoveredArrow !== obj) {
        ((hoveredArrow.parent as THREE.ArrowHelper).setColor(0x0078ff));
      }
      hoveredArrow = obj;
      ((obj.parent as THREE.ArrowHelper).setColor(0xffb800));
      container.style.cursor = "pointer";
      clearHover();
      return;
    }
    if (hoveredArrow) {
      ((hoveredArrow.parent as THREE.ArrowHelper).setColor(0x0078ff));
      hoveredArrow = null;
      container.style.cursor = "";
    }
    const result = caster.castRay();
    if (result) setHover(result.object as THREE.Object3D);
    else clearHover();
  });

  world.renderer.three.domElement.addEventListener("pointerdown", ev => {
    if (controls && (controls as any).dragging) return;
    if (hoveredArrow && selected) {
      const arrow = hoveredArrow.parent as THREE.ArrowHelper;
      const n = (arrow as any).userData.normal as THREE.Vector3;
      const step = n.y ? verticalSnap : grid.config.primarySize;
      selected.position.addScaledVector(n, step);
      selected.position.x = Math.round(selected.position.x / grid.config.primarySize) * grid.config.primarySize;
      selected.position.y = Math.round(selected.position.y / verticalSnap) * verticalSnap;
      selected.position.z = Math.round(selected.position.z / grid.config.primarySize) * grid.config.primarySize;
      bbox?.update();
      controls?.updateMatrixWorld(true);
      attachNudge(selected);
      arrow.setColor(0x4caf50);
      arrow.scale.set(1.25, 1.25, 1.25);
      setTimeout(() => {
        arrow.scale.set(1, 1, 1);
        arrow.setColor(0x0078ff);
      }, 150);
      return;
    }
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
      showPreview(selected!.position.y);
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
      hidePreview();
      if (selected) setActiveFloor(Math.round(selected.position.y / floors[currentLevel].height));
    }
  });

  world.renderer.three.domElement.addEventListener(
    "wheel",
    ev => {
      if (!selected || !ev.shiftKey) return;
      selected.position.y += (ev.deltaY > 0 ? -1 : 1) * floors[currentLevel].height * 0.1;
      bbox?.update();
      ev.preventDefault();
    },
    { passive: false }
  );

  world.renderer.three.domElement.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    if (!selected) return;
    menu.innerHTML = "";
    floors.forEach((_, i) => {
      const move = document.createElement("div");
      move.textContent = `Move to floor ${i}`;
      move.onclick = () => {
        moveUnitToLevel(selected!, i);
        menu.style.display = "none";
      };
      const dup = document.createElement("div");
      dup.textContent = `Duplicate to floor ${i}`;
      dup.onclick = () => {
        const clone = selected!.clone(true);
        world.scene.three.add(clone);
        addUnitToLevel(clone, i);
        menu.style.display = "none";
      };
      menu.appendChild(move);
      menu.appendChild(dup);
    });
    menu.style.left = `${ev.clientX}px`;
    menu.style.top = `${ev.clientY}px`;
    menu.style.display = "block";
  });

  window.addEventListener("click", () => (menu.style.display = "none"));

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
    point.y = currentLevel * floors[currentLevel].height;
    const { object } = await addModel(url, point);
    selectObject(object);
  });

  window.addEventListener("keydown", e => {
    if (e.key >= "1" && e.key <= "3") {
      setActiveFloor(parseInt(e.key) - 1);
      return;
    }
    if (!selected) return;

    const step = grid.config.primarySize;
    const vstep = floors[currentLevel].height;

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
      case "PageUp":
        setActiveFloor(currentLevel + 1);
        return;
      case "PageDown":
        setActiveFloor(currentLevel - 1);
        return;
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
    setActiveFloor(Math.round(selected.position.y / vstep));

    selected.updateMatrixWorld();
    controls?.updateMatrixWorld(true);
    bbox?.update();
    subBox?.update();
    detachHandle();
    attachHandle(selected);
    attachNudge(selected);
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
