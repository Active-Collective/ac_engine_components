// Import the minimal modules from Open BIM Components (OBC) and Three.js.
// OBC provides an opinionated framework around Three.js for BIM viewers.
// https://github.com/ThatOpen/engine_components
import * as OBC from "@thatopen/components";
import * as THREE from "three";
// We rely on the standard GLTF loader for importing models and the
// TransformControls helper for translation/rotation gizmos.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
// Helper modules defined in this package
//  - sidebar.ts: collects model metadata and renders the info sidebar
//  - levels.ts: manages floor grids and level switching
//  - settings.ts: binds UI inputs to runtime options
import {
  initSidebar,
  addUnitItem,
  analyzeUnit,
  metaCache,
  renderMeta,
  clearInfo,
} from "./sidebar";
import { initFloors, addUnitToLevel, moveUnitToLevel, setActiveFloor, currentLevel, floors, grids } from "./levels";
import { initSettings } from "./settings";
import { initNavControls } from "./nav-controls";
// Simple styling for the nudge arrows
import "./nudge.css";

// Currently selected root object and (optionally) sub-mesh. The bounding boxes
// visualize selection and hover state.
let selected: THREE.Object3D | null = null;
let subSelected: THREE.Mesh | null = null;
let bbox: THREE.BoxHelper | null = null;
let subBox: THREE.BoxHelper | null = null;
let hoverBox: THREE.BoxHelper | null = null;
// One shared TransformControls instance is reused for all objects.
let controls: TransformControls | null = null;
// Small red sphere used for mouse dragging
// Drag handle removed per UX update
// Maps any child mesh to its root model for easy selection lookups
const rootMap = new Map<THREE.Object3D, THREE.Object3D>();

// Group holding the six nudge arrows. nudgeTargets is the list of meshes used
// for raycasting interaction.
let nudgeGroup: THREE.Group | null = null;
let nudgeTargets: THREE.Object3D[] = [];
let hoveredArrow: THREE.Object3D | null = null;
// When holding down a nudge arrow we repeatedly apply the movement at this
// interval, emulating a key-repeat behavior.
let arrowHold: THREE.ArrowHelper | null = null;
let holdInterval: number | null = null;

interface HistoryEntry {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}
const history: HistoryEntry[] = [];

interface LayoutItem {
  id: string;
  url: string;
  pos: [number, number, number];
  rot: number;
  level: number;
}
const layoutMap = new Map<string, LayoutItem>();

function saveLayout() {
  localStorage.setItem("layout", JSON.stringify(Array.from(layoutMap.values())));
}

function updateLayout(obj: THREE.Object3D) {
  const id = obj.userData.id as string | undefined;
  if (!id) return;
  const item = layoutMap.get(id);
  if (!item) return;
  item.pos = [obj.position.x, obj.position.y, obj.position.z];
  item.rot = obj.rotation.y;
  item.level = obj.userData.level ?? 0;
  saveLayout();
}

function saveState(obj: THREE.Object3D) {
  history.push({ obj, pos: obj.position.clone(), quat: obj.quaternion.clone() });
  if (history.length > 20) history.shift();
}

function undo() {
  const h = history.pop();
  if (!h) return;
  h.obj.position.copy(h.pos);
  h.obj.quaternion.copy(h.quat);
  h.obj.updateMatrixWorld();
  bbox?.update();
  subBox?.update();
  controls?.updateMatrixWorld(true);
  // handle removed
  attachNudge(h.obj);
  updateLayout(h.obj);
}

// Public reference to the world so other modules can access scene/camera.
export let world: OBC.World;
// BoundingBoxer is used repeatedly to measure objects when placing them or
// computing handle positions.
let bboxer: OBC.BoundingBoxer;
// Variables that track the cumulative size of loaded units to derive snap sizes
// dynamically from the average unit dimensions.
let totalWidth = 0;
let totalHeight = 0;
let loadedCount = 0;
let verticalSnap = 1;
// Temporary objects reused for measurements to avoid garbage collection.
const tempBox = new THREE.Box3();
const tempSize = new THREE.Vector3();

/**
 * Replaces the material of every mesh inside `target` with the given variant.
 * The original material is stored the first time so it can be restored later.
 */
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

/**
 * Restores every mesh inside `target` to its originally loaded material.
 * Disposes any temporary material that might have been applied.
 */
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

/**
 * Creates or updates the small red sphere used for mouse dragging. The sphere
 * scales with the size of the selected object and is positioned slightly above
 * the object's top surface.
 */
function attachHandle(_root: THREE.Object3D) {
  /* handle removed */
}

/**
 * Removes the drag handle from the scene and raycaster set.
 */
function detachHandle() {
  /* handle removed */
}

/**
 * Fades the opacity of all arrow helpers in the provided group. This is used
 * when showing or hiding the nudge arrows around the selected model.
 */
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

/**
 * Creates six ArrowHelpers around the object. They are positioned at the
 * center of each face of its bounding box and point outward. Only arrows with a
 * corresponding floor above/below are created.
 */
function createNudgeGizmos(obj: THREE.Object3D) {
  bboxer.reset();
  obj.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) bboxer.addMesh(o);
  });
  const box = bboxer.get();
  bboxer.reset();
  const midX = (box.min.x + box.max.x) / 2;
  const midY = (box.min.y + box.max.y) / 2;
  const midZ = (box.min.z + box.max.z) / 2;
  const gap = 0.5;
  const len = 1;
  const head = 0.25;
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
    if (info.n.y === 1 && currentLevel >= floors.length - 1) return;
    if (info.n.y === -1 && currentLevel <= 0) return;
    const pos = info.p.clone().addScaledVector(info.n, gap);
    parent.worldToLocal(pos);
    const arrow = new THREE.ArrowHelper(info.n, pos, len, 0x0078ff, head, head * 0.6);
    arrow.cone.material.transparent = true;
    arrow.line.material.transparent = true;
    (arrow.cone.material as THREE.Material & { opacity: number }).opacity = 0;
    (arrow.line.material as THREE.Material & { opacity: number }).opacity = 0;
    arrow.cone.scale.multiplyScalar(1.6);
    (arrow.line.material as THREE.LineBasicMaterial).linewidth = 5;
    (arrow as any).userData.normal = info.n.clone();
    g.add(arrow);
    nudgeTargets.push(arrow.cone, arrow.line);
  });
  return g;
}

/**
 * Generates the arrow helpers for the given object and adds them to the scene.
 * The arrows are added to the world's raycast set so pointer events can
 * trigger nudging.
 */
function attachNudge(obj: THREE.Object3D) {
  detachNudge();
  nudgeGroup = createNudgeGizmos(obj);
  obj.parent?.add(nudgeGroup);
  nudgeTargets.forEach(t => world.meshes.add(t));
  fadeNudge(nudgeGroup, 1);
}

/**
 * Removes the arrow helpers and cleans up the raycasting references.
 */
function detachNudge() {
  if (!nudgeGroup) return;
  const group = nudgeGroup;
  group.parent?.remove(group);
  nudgeTargets.forEach(t => world.meshes.delete(t));
  nudgeGroup = null;
  nudgeTargets = [];
  hoveredArrow = null;
}

/**
 * Moves the selected object exactly one grid increment in the direction of the
 * provided arrow helper and then re-snaps its position. This is called when a
 * user clicks or drags a nudge arrow.
 */
function nudge(arrow: THREE.ArrowHelper) {
  if (!selected) return;
  const n = (arrow as any).userData.normal as THREE.Vector3;
  const step = n.y ? verticalSnap : grids[currentLevel].config.primarySize;
  saveState(selected);
  selected.position.addScaledVector(n, step);
  const h = grids[currentLevel].config.primarySize;
  selected.position.x = Math.round(selected.position.x / h) * h;
  selected.position.y = Math.round(selected.position.y / verticalSnap) * verticalSnap;
  selected.position.z = Math.round(selected.position.z / h) * h;
  bbox?.update();
  controls?.updateMatrixWorld(true);
  attachNudge(selected);
  updateLayout(selected);
}

/**
 * Displays a translucent plane at the provided Y level while dragging an
 * object between floors so the user can see where it will land.
 */

/** Helper wrapper around GLTFLoader that returns a promise. */
function loadGltf(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return loader.loadAsync(url);
}

/**
 * Entry point for the viewer. Sets up the world, UI elements and event
 * listeners, then loads the default models. This function is invoked at the
 * bottom of the file.
 */
export async function bootstrap() {
  const container = document.getElementById("viewer") as HTMLDivElement;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;
  const paintMenu = document.getElementById("paintMenu") as HTMLDivElement;
  const paintBtn = document.getElementById("paintBtn") as HTMLButtonElement;
  const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;
  initSidebar();
  const sidebarEl = document.getElementById("sidebar") as HTMLElement;
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
  world.renderer.three.setClearColor(0xf0f0f0);
  world.scene.three.background = new THREE.Color(0xf0f0f0);
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
  grid.config.color = new THREE.Color(0xafafaf);
  grid.config.secondarySize = grid.config.primarySize;
  verticalSnap = floors[0].height;
  initSettings();
  snapInput.value = String(grid.config.primarySize);
  snapHeightInput.value = String(floors[0].height);
  gridColorInput.value = `#${grid.config.color.getHexString()}`;
  bgInput.value = "#f0f0f0";
  snapInput.addEventListener("change", () => {
    const v = parseFloat(snapInput.value) || 1;
    grid.config.primarySize = v;
    grid.config.secondarySize = v;
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
    const col = new THREE.Color(bgInput.value);
    world.renderer.three.setClearColor(col);
    world.scene.three.background = col;
  });

  function sceneBounds() {
    bboxer.reset();
    world.meshes.forEach(m => {
      if (m instanceof THREE.Mesh || m instanceof THREE.InstancedMesh) {
        bboxer.addMesh(m);
      }
    });
    const b = bboxer.get().clone();
    bboxer.reset();
    return b;
  }

  initNavControls(world.camera, sceneBounds);

  const casters = components.get(OBC.Raycasters);
  const caster = casters.get(world);

  const libUrls = [
    new URL("../core/assets/unit1.glb", import.meta.url).href,
    new URL("../core/assets/unit2.glb", import.meta.url).href,
    new URL("../core/assets/unit3.glb", import.meta.url).href,
    new URL("../core/assets/unit4.glb", import.meta.url).href,
  ];


  /** Remove the yellow hover box from the scene if present. */
  function clearHover() {
    if (hoverBox) {
      world.scene.three.remove(hoverBox);
      hoverBox = null;
    }
  }

  /** Draw a yellow box around the hovered object (if not selected). */
  function setHover(obj: THREE.Object3D | null) {
    clearHover();
    if (!obj) return;
    const root = rootMap.get(obj) ?? obj;
    if (root === selected) return;
    hoverBox = new THREE.BoxHelper(root, 0xffff00);
    world.scene.three.add(hoverBox);
  }

  /**
   * Handles selecting a root model. Attaches TransformControls and the drag
   * handle, creates bounding boxes and nudge arrows. Passing `null` clears the
   * current selection.
   */
  function selectObject(obj: THREE.Object3D | null) {
    if (bbox) {
      world.scene.three.remove(bbox);
      bbox = null;
    }
    detachNudge();

    if (!obj) {
      controls?.detach();
      detachNudge();
      selected = null;
      if (sidebarEl.dataset.mode === "info") clearInfo();
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
        if (ev.value && controls?.object) saveState(controls.object as THREE.Object3D);
        world.camera.controls.enabled = !ev.value;
        if (nudgeGroup) nudgeGroup.visible = !ev.value;
      });
      controls.addEventListener("change", () => {
        if (!controls || !controls.object) return;
        const p = controls.object.position;
        const size = grid.config.primarySize;
        p.set(
          Math.round(p.x / size) * size,
          p.y,
          Math.round(p.z / size) * size,
        );
        bbox?.update();
        subBox?.update();
        attachNudge(controls.object as THREE.Object3D);
        updateLayout(controls.object as THREE.Object3D);
      });
      world.scene.three.add(controls);
    }

    controls.attach(root);
    bbox = new THREE.BoxHelper(root, 0x00ff00);
    world.scene.three.add(bbox);
    attachNudge(root);
    if (sidebarEl.dataset.mode === "info") renderMeta(root);
  }

  /** Highlight an individual mesh within the selected model. */
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

  /**
   * Loads a glTF file and inserts it into the scene. Every mesh is registered
   * in `world.meshes` for raycasting. The function also updates average snap
   * sizes based on all loaded models.
   */
  async function addModel(
    url: string,
    position = new THREE.Vector3(),
    level = currentLevel
  ) {
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
    addUnitToLevel(gltf.scene, level);
    const id = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
    gltf.scene.userData.id = id;
    gltf.scene.userData.url = url;
    layoutMap.set(id, { id, url, pos: [gltf.scene.position.x, gltf.scene.position.y, gltf.scene.position.z], rot: gltf.scene.rotation.y, level });
    saveLayout();
    const info = analyzeUnit(gltf.scene, url);
    metaCache.set(gltf.scene, info);
    addUnitItem(gltf.scene, url);
    totalWidth += dims.width;
    totalHeight += dims.height;
    loadedCount++;
    const avg = totalWidth / loadedCount;
    const hAvg = totalHeight / loadedCount;
    grid.config.primarySize = avg;
    grid.config.secondarySize = avg;
    verticalSnap = hAvg;
    floors.forEach(f => (f.height = hAvg));
    setActiveFloor(currentLevel);
    if (controls) controls.translationSnap = avg;
    snapInput.value = String(avg);
    snapHeightInput.value = String(hAvg);
    const sizeSnap = grid.config.primarySize;
    gltf.scene.position.x = Math.round(gltf.scene.position.x / sizeSnap) * sizeSnap;
    gltf.scene.position.z = Math.round(gltf.scene.position.z / sizeSnap) * sizeSnap;
    return { object: gltf.scene, width: dims.width };
  }

  let offset = 0;
  const saved = localStorage.getItem("layout");
  if (saved) {
    try {
      const items = JSON.parse(saved) as LayoutItem[];
      for (const it of items) {
        const { object, width } = await addModel(it.url, new THREE.Vector3(...it.pos), it.level);
        object.rotation.y = it.rot;
        offset = Math.max(offset, object.position.x + width);
      }
    } catch {}
  } else {
    const loadUrls = [
      new URL("../core/assets/unit1.glb", import.meta.url).href,
      new URL("../core/assets/unit2.glb", import.meta.url).href,
      new URL("../core/assets/unit3.glb", import.meta.url).href,
      new URL("../core/assets/unit4.glb", import.meta.url).href,
    ];
    for (const url of loadUrls) {
      const { object, width } = await addModel(
        url,
        new THREE.Vector3(offset, 0, 0),
        0
      );
      const step = grid.config.primarySize;
      object.position.x = Math.round(object.position.x / step) * step;
      offset = object.position.x + Math.round(width / step) * step;
    }
  }

  world.renderer.three.domElement.addEventListener("pointermove", ev => {
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
      nudge(arrow);
      arrowHold = arrow;
      holdInterval = window.setInterval(() => nudge(arrow), 200);
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
    if (holdInterval !== null) {
      clearInterval(holdInterval);
      holdInterval = null;
      arrowHold = null;
    }
  });

  world.renderer.three.domElement.addEventListener(
    "wheel",
    ev => {
      if (!selected || !ev.shiftKey) return;
      selected.position.y += (ev.deltaY > 0 ? -1 : 1) * floors[currentLevel].height * 0.1;
      bbox?.update();
      updateLayout(selected);
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
        updateLayout(selected!);
        menu.style.display = "none";
      };
      const dup = document.createElement("div");
      dup.textContent = `Duplicate to floor ${i}`;
      dup.onclick = () => {
        const clone = selected!.clone(true);
        world.scene.three.add(clone);
        addUnitToLevel(clone, i);
        const cid = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
        clone.userData.id = cid;
        layoutMap.set(cid, { id: cid, url: selected!.userData.url || "", pos: [clone.position.x, clone.position.y, clone.position.z], rot: clone.rotation.y, level: i });
        saveLayout();
        menu.style.display = "none";
      };
      menu.appendChild(move);
      menu.appendChild(dup);
    });
    menu.style.left = `${ev.clientX}px`;
    menu.style.top = `${ev.clientY}px`;
    menu.style.display = "block";
  });

  // Hide the custom context menu whenever the user clicks elsewhere
  window.addEventListener("click", () => (menu.style.display = "none"));

  // Allow dropping a library item onto the canvas
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
    const { object } = await addModel(url, point, currentLevel);
    selectObject(object);
  });

  // Keyboard shortcuts for floor switching, movement and rotation
  window.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      undo();
      e.preventDefault();
      return;
    }
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
        saveState(selected);
        selected.position.z -= step;
        break;
      case "ArrowDown":
      case "s":
      case "S":
        saveState(selected);
        selected.position.z += step;
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        saveState(selected);
        selected.position.x -= step;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        saveState(selected);
        selected.position.x += step;
        break;
      case "q":
      case "Q":
        saveState(selected);
        selected.position.y += vstep;
        break;
      case "e":
      case "E":
        saveState(selected);
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
        saveState(selected);
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
    attachNudge(selected);
    updateLayout(selected);
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
    const { object, width } = await addModel(
      url,
      new THREE.Vector3(offset, currentLevel * floors[currentLevel].height, 0),
      currentLevel
    );
    offset += width;
    selectObject(object);
    updateLayout(object);
  });

  paintBtn.onclick = () => paintMenu.classList.toggle("show");
  paintMenu.querySelectorAll<HTMLButtonElement>("button[data-variant]").forEach(btn => {
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
      paintMenu.classList.remove("show");
    });
  });

  resetBtn.addEventListener("click", () => {
    const target = subSelected ?? selected;
    if (!target) return;
    resetMaterial(target);
    if (subSelected) subBox?.update();
    else bbox?.update();
  });

  // Activate Bootstrap tooltips if available
  if ((window as any).bootstrap) {
    document
      .querySelectorAll('[data-bs-toggle="tooltip"]')
      .forEach(el => new (window as any).bootstrap.Tooltip(el));
  }
}

// Kick everything off. When bundling this package you can import { bootstrap }
// and call it from your own entry point instead.
bootstrap();
