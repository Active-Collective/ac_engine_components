// Import the minimal modules from Open BIM Components (OBC) and Three.js.
// OBC provides an opinionated framework around Three.js for BIM viewers.
// https://github.com/ThatOpen/engine_components
import * as OBC from "@thatopen/components";
import * as THREE from "three";

// We rely on the standard GLTF loader for importing models and the
// TransformControls helper for translation/rotation gizmos.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import * as FRAGS from "@thatopen/fragments";
import { setupIfc, loadIfc } from "./src/ifc/loader";
import { toUint8Array } from "./src/ifc/bytes";
import { buildIndex, picked, byStorey } from "./src/ifc";
import { setStoreys } from "./src/ifc/storeys";
import { generateThumbnail } from "./utils/thumbnail";
// Helper modules defined in this package
//  - sidebar.ts: collects model metadata and renders the info sidebar
//  - levels.ts: manages floor grids and level switching
//  - settings.ts: binds UI inputs to runtime options

import {
  initSidebar,
  addUnitItem,
  removeUnitItem,
  addCartItem,
  removeCartItem,
  cartMap,
  cartListItems,
  analyzeUnit,
  metaCache,
  showInfo,
  renderMeta,
  clearInfo,
} from "./sidebar";
import {
  initFloors,
  addUnitToLevel,
  moveUnitToLevel,
  setActiveFloor,
  currentLevel,
  floors,
  grids,
  unitsByLevel,
} from "./levels";
import { initSettings } from "./settings";
import { initNavControls } from "./nav-controls";
// Simple styling for the nudge arrows
import "./nudge.css";

// Currently selected root object and (optionally) sub-mesh. The bounding boxes
// visualize selection and hover state.
let selected: THREE.Object3D | null = null;
const selection = new Set<THREE.Object3D>();
const boxMap = new Map<THREE.Object3D, THREE.BoxHelper>();
const footprintByUrl = new Map<string, { w: number; d: number }>();
const ifcBytes = new Map<string, Uint8Array>();
let subSelected: THREE.Mesh | null = null;
let subBox: THREE.BoxHelper | null = null;
let hoverBox: THREE.BoxHelper | null = null;
// One shared TransformControls instance is reused for all objects.
let controls: TransformControls | null = null;
let controlsHelper: THREE.Object3D | null = null;
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
let arrowHold: THREE.Object3D | null = null;
let holdInterval: number | null = null;

interface HistoryEntry {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

const history: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

interface LayoutItem {
  id: string;
  url: string;
  pos: [number, number, number];
  rot: number;
  level: number;
}
export const layoutMap = new Map<string, LayoutItem>();
// Layout IO helpers worden later in bootstrap ingevuld
export let downloadLayoutJson: (filename?: string) => void;
export let loadLayoutFromItems: (items: LayoutItem[]) => Promise<void>;
export let importLayoutFromFile: (file: File) => void;

// Optional UI elements and grid reference are declared up-front so that
// functions defined earlier can safely reference them.
let sidebarEl: HTMLElement | null = null;
let grid: any;

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
  checkOverlaps();
}

function updateBoxes() {
  for (const obj of selection) {
    boxMap.get(obj)?.update();
  }
}

function saveState(obj: THREE.Object3D) {
  history.push({ obj, pos: obj.position.clone(), quat: obj.quaternion.clone() });
  if (history.length > 20) history.shift();
}

/**
 * Voor elke root‑unit in de scene berekent deze functie de AABB
 * en markeert hij alle units die met minimaal één andere overlappen.
 */
function checkOverlaps() {
  // 0) forceer dat alle world-matrices actueel zijn
  world.scene.three.updateMatrixWorld(true);

  // 1) pak alle units (per level) uit jullie bestaande structuur
  const units: THREE.Object3D[] = [];
  for (const arr of unitsByLevel) for (const u of arr) units.push(u);

  // fallback: als unitsByLevel om wat voor reden leeg is:
  if (units.length === 0) {
    layoutMap.forEach(item => {
      const u = world.scene.three.getObjectByProperty("userData.id", item.id) as THREE.Object3D | null;
      if (u) units.push(u);
    });
  }

  // 2) bouw per unit een 2D-rect (XZ) + zijn level
  const H = floors[0]?.height ?? 1;            // vloerhoogte
  const entries = units.map(obj => {
    const box = new THREE.Box3().setFromObject(obj);
    // enkel XZ voor horizontale overlap; level obv y-positie (of userData.level)
    const level = (obj.userData.level ?? Math.round(obj.position.y / H)) as number;
    return {
      obj,
      level,
      minX: box.min.x, maxX: box.max.x,
      minZ: box.min.z, maxZ: box.max.z
    };
  });

  // 3) bepaal welke units overlappen op hetzelfde level (XZ)
  const overlapping = new Set<THREE.Object3D>();
  const eps = 1e-6; // als je “raken is oké” wilt, zet eps > 0; voor echt overlappen gebruik eps = 0
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.level !== b.level) continue; // alleen zelfde verdieping
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > eps;
      const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > eps;
      if (overlapX && overlapZ) {
        overlapping.add(a.obj);
        overlapping.add(b.obj);
      }
    }
  }

  // 4) pas rood toe op overlappers, herstel anderen
  entries.forEach(({ obj }) => {
    const shouldBeRed = overlapping.has(obj);
    obj.traverse(child => {
      if (!(child as any).isMesh) return;
      const mesh = child as THREE.Mesh;

      // we wisselen tijdelijk het materiaal uit voor een simpel rood materiaal
      // zonder de originele te verliezen (ook veilig bij gedeelde materialen)
      const key = "__overlapSavedMat";
      const saved = (mesh.userData as any)[key] as THREE.Material | undefined;

      if (shouldBeRed) {
        if (!saved) {
          (mesh.userData as any)[key] = mesh.material;
          mesh.material = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: false });
        }
      } else {
        if (saved) {
          (mesh.material as THREE.Material).dispose(); // opruimen tijdelijk rood materiaal
          mesh.material = saved;
          delete (mesh.userData as any)[key];
        }
      }
    });
  });
}

function undo() {
  const h = history.pop();
  if (!h) return;

  // Huidige staat opslaan voor redo
  redoStack.push({
    obj: h.obj,
    pos: h.obj.position.clone(),
    quat: h.obj.quaternion.clone()
  });

  // Oude staat herstellen
  h.obj.position.copy(h.pos);
  h.obj.quaternion.copy(h.quat);
  h.obj.updateMatrixWorld();
  updateBoxes();
  subBox?.update();
  if (controls && typeof (controls as any).updateMatrixWorld === "function") {
    controls.updateMatrixWorld(true);
  }
  attachNudge(h.obj);
  updateLayout(h.obj);
  checkOverlaps();
}

function redo() {
  const h = redoStack.pop();
  if (!h) return;

  // Huidige staat opslaan voor undo
  history.push({
    obj: h.obj,
    pos: h.obj.position.clone(),
    quat: h.obj.quaternion.clone()
  });

  // Redo staat toepassen
  h.obj.position.copy(h.pos);
  h.obj.quaternion.copy(h.quat);
  h.obj.updateMatrixWorld();
  updateBoxes();
  subBox?.update();
  if (controls && typeof (controls as any).updateMatrixWorld === "function") {
    controls.updateMatrixWorld(true);
  }
  attachNudge(h.obj);
  updateLayout(h.obj);
  checkOverlaps();
}

function deleteUnit(obj: THREE.Object3D) {
  const level = obj.userData.level ?? 0;
  unitsByLevel[level] = unitsByLevel[level].filter(o => o !== obj);
  // Als deze unit momenteel geselecteerd is, koppel dan eerst de
  // TransformControls los zodat de scene-hierarchy consistent blijft.
  if (controls?.object === obj) {
    controls.detach();
    detachNudge();
  }
  obj.traverse(o => {
    rootMap.delete(o);
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
      world.meshes.delete(o);
    }
  });
  world.scene.three.remove(obj);
  const box = boxMap.get(obj);
  if (box) world.scene.three.remove(box);
  boxMap.delete(obj);
  layoutMap.delete(obj.userData.id);
  removeCartItem(obj);
  checkOverlaps();
}

function removeSelected() {
  selection.forEach(obj => {
    deleteUnit(obj);
  });
  selection.clear();
  selected = null;
  subSelected = null;
  if (subBox) {
    world.scene.three.remove(subBox);
    subBox = null;
  }
  controls?.detach();
  detachNudge();
  if (hoverBox) {
    world.scene.three.remove(hoverBox);
    hoverBox = null;
  }
  clearInfo();
  saveLayout();
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

function createMat(type: string): THREE.Material {
  if (type === "red") return new THREE.MeshStandardMaterial({ color: "red" });
  if (type === "blue") return new THREE.MeshStandardMaterial({ color: "blue" });
  const tex = new THREE.TextureLoader().load("/assets/wood.jpg");
  return new THREE.MeshStandardMaterial({ map: tex });
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
  const meshes: THREE.Mesh[] = [];
  target.traverse(obj => {
    const mesh = obj as THREE.Mesh & { material?: any };
    if (
      (mesh as any).isMesh &&
      mesh.material &&
      typeof mesh.material.opacity === "number" &&
      !mesh.userData.hitArea
    ) {
      meshes.push(mesh);
    }
  });
  if (!meshes.length) return;
  const start = performance.now();
  const from = (meshes[0].material as any).opacity;
  function step() {
    const t = Math.min(1, (performance.now() - start) / 200);
    const val = from + (to - from) * t;
    meshes.forEach(m => {
      (m.material as any).opacity = val;
    });
    if (t < 1) requestAnimationFrame(step); else done && done();
  }
  step();
}

const ARROW_COLOR_DEFAULT = 0x0090ff;
const ARROW_COLOR_HOVER = 0x00ff00;

function createThickArrow(
  direction: THREE.Vector3,
  position: THREE.Vector3,
  length = 1,
  color = ARROW_COLOR_DEFAULT
): THREE.Group {
  const arrowGroup = new THREE.Group();

  const shaftRadius = 0.05;
  const shaftLength = length * 0.7;
  const headLength = length * 0.3;
  const headRadius = 0.1;

  const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 8);
  const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 8);

  const material = new THREE.MeshBasicMaterial({ color });

  const shaft = new THREE.Mesh(shaftGeometry, material);
  shaft.position.y = shaftLength / 2;
  shaft.userData.normal = direction.clone();

  const head = new THREE.Mesh(headGeometry, material);
  head.position.y = shaftLength + headLength / 2;
  head.userData.normal = direction.clone();

  const normal = direction.clone().normalize();
  const axis = new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, normal);

  arrowGroup.quaternion.copy(quaternion);
  arrowGroup.position.copy(position);
  arrowGroup.add(shaft, head);
  arrowGroup.userData.normal = direction.clone();

  return arrowGroup;
}

/**
 * Creates six ArrowHelpers around the object. They are positioned at the
 * center of each face of its bounding box and point outward. Only arrows with a
 * corresponding floor above/below are created.
 */
// function createNudgeGizmos(obj: THREE.Object3D) {
//   bboxer.reset();
//   obj.traverse(o => {
//     if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) bboxer.addMesh(o);
//   });
//   const box = bboxer.get();
//   bboxer.reset();
//   const midX = (box.min.x + box.max.x) / 2;
//   const midY = (box.min.y + box.max.y) / 2;
//   const midZ = (box.min.z + box.max.z) / 2;
//   const gap = 0.5;
//   const len = 1;
//   const head = 0.25;
//   const infos = [
//     { n: new THREE.Vector3(1, 0, 0), p: new THREE.Vector3(box.max.x, midY, midZ) },
//     { n: new THREE.Vector3(-1, 0, 0), p: new THREE.Vector3(box.min.x, midY, midZ) },
//     { n: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(midX, box.max.y, midZ) },
//     { n: new THREE.Vector3(0, -1, 0), p: new THREE.Vector3(midX, box.min.y, midZ) },
//     { n: new THREE.Vector3(0, 0, 1), p: new THREE.Vector3(midX, midY, box.max.z) },
//     { n: new THREE.Vector3(0, 0, -1), p: new THREE.Vector3(midX, midY, box.min.z) },
//   ];
//   const g = new THREE.Group();
//   nudgeTargets = [];
//   const parent = obj.parent as THREE.Object3D;
//   infos.forEach(info => {
//     if (info.n.y === 1 && currentLevel >= floors.length - 1) return;
//     if (info.n.y === -1 && currentLevel <= 0) return;
//     const pos = info.p.clone().addScaledVector(info.n, gap);
//     parent.worldToLocal(pos);
//     const arrow = new THREE.ArrowHelper(info.n, pos, len, 0x0078ff, head, head * 0.6);
//     arrow.cone.material.transparent = true;
//     arrow.line.material.transparent = true;
//     (arrow.cone.material as THREE.Material & { opacity: number }).opacity = 0;
//     (arrow.line.material as THREE.Material & { opacity: number }).opacity = 0;
//     arrow.cone.scale.multiplyScalar(1.6);
//     (arrow.line.material as THREE.LineBasicMaterial).linewidth = 5;
//     (arrow as any).userData.normal = info.n.clone();
//     g.add(arrow);
//     nudgeTargets.push(arrow.cone, arrow.line);
//   });
//   return g;
// }

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
  const padding = len * 0.5; // 50% extra rondom je arrow

  // alleen de horizontale verplaatsingen (x en z), geen y
  const infos = [
    { n: new THREE.Vector3( 1, 0, 0), p: new THREE.Vector3(box.max.x, midY, midZ) },
    { n: new THREE.Vector3(-1, 0, 0), p: new THREE.Vector3(box.min.x, midY, midZ) },
    { n: new THREE.Vector3( 0, 0, 1), p: new THREE.Vector3(midX, midY, box.max.z) },
    { n: new THREE.Vector3( 0, 0,-1), p: new THREE.Vector3(midX, midY, box.min.z) },
  ];

  const g = new THREE.Group();
  nudgeTargets = [];
  const parent = obj.parent as THREE.Object3D;

  infos.forEach(info => {
    if (info.n.y === 1 && currentLevel >= floors.length - 1) return;
    if (info.n.y === -1 && currentLevel <= 0) return;

    const pos = info.p.clone().addScaledVector(info.n, gap);
    parent.worldToLocal(pos);

    const arrow = createThickArrow(info.n, pos, len, ARROW_COLOR_DEFAULT);
    // maak een onzichtbaar balletje rond de arrow voor extra click‑area
    const hitSphere = new THREE.Mesh(
      new THREE.SphereGeometry(padding, 8, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
    );
    // lift de sphere naar het middelpunt van de arrow (arrow.local‑origin)
    hitSphere.position.set(0, 0, 0);
    // Voeg ‘m als kind, zodat hij meelift en meedraait
    hitSphere.userData.hitArea = true;
    arrow.add(hitSphere);

    g.add(arrow);

    // Voeg de afzonderlijke klikbare onderdelen toe aan nudgeTargets
    arrow.children.forEach(child => {
      nudgeTargets.push(child);
    });
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
function nudge(clickedObject: THREE.Object3D) {
  if (!selected) return;

  // Zoek de groep of userData.normal op het aangeklikte object of zijn ouder
  let arrowGroup: THREE.Object3D | null = clickedObject;
  while (arrowGroup && !arrowGroup.userData.normal) {
    arrowGroup = arrowGroup.parent!;
  }
  if (!arrowGroup || !arrowGroup.userData.normal) return;

  const n = arrowGroup.userData.normal as THREE.Vector3;
  const step = n.y ? verticalSnap : grids[currentLevel].config.primarySize;

  selection.forEach(obj => {
    saveState(obj);
    obj.position.addScaledVector(n, step);
    const h = grids[currentLevel].config.primarySize;
    obj.position.x = Math.round(obj.position.x / h) * h;
    obj.position.y = Math.round(obj.position.y / verticalSnap) * verticalSnap;
    obj.position.z = Math.round(obj.position.z / h) * h;
    updateLayout(obj);
  });

  updateBoxes();
  if (controls && typeof (controls as any).updateMatrixWorld === "function") {
    controls.updateMatrixWorld(true);
  }

  checkOverlaps();

  if (selection.size === 1) attachNudge(selected);
  else detachNudge();
}

// Rotation
function setupRotateButton() {
  const btn = document.getElementById("rotate-object");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (!selected) return;

    selection.forEach(obj => {
      saveState(obj);
      obj.rotateY(Math.PI / 2);
      updateLayout(obj);
    });

    updateBoxes();
  });
}

// Move up / down
function setupMoveFloorButtons() {
  const btnUp   = document.getElementById("move-object-up");
  const btnDown = document.getElementById("move-object-down");
  if (!btnUp && !btnDown) return;

  // Bepaal de huidige floor van een unit (voorkeur: userData.level)
  const getLevel = (o: THREE.Object3D) => {
    if (typeof o.userData.level === "number") return o.userData.level;
    const h = floors[0]?.height || 1;
    return Math.max(0, Math.min(floors.length - 1, Math.round(o.position.y / h)));
  };

  const moveBy = (delta: number) => {
    if (selection.size === 0) return;

    selection.forEach(o => {
      const from = getLevel(o);
      const to   = Math.min(Math.max(from + delta, 0), floors.length - 1);
      if (to === from) return;
      saveState(o);
      moveUnitToLevel(o, to);
      updateLayout(o);
    });

    updateBoxes();
    if (controls && typeof (controls as any).updateMatrixWorld === "function") {
      controls.updateMatrixWorld(true);
    }
  };

  btnUp?.addEventListener("click",   () => moveBy(1));
  btnDown?.addEventListener("click", () => moveBy(-1));
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

// Helper function for finding cartgroup
function findCartGroup(obj: THREE.Object3D | null): THREE.Object3D | null {
  if (!obj) return null;
  let current = obj;
  while (current.parent) {
    if (cartMap.has(current)) return current;
    current = current.parent;
  }
  return cartMap.has(current) ? current : null;
}

export function selectObject(obj: THREE.Object3D | null, additive = false) {
  if (!additive) {
    selection.forEach(o => {
      world.scene.three.remove(boxMap.get(o)!);
    });
    selection.clear();
    boxMap.clear();
  }

  cartListItems.forEach((item) => item.classList.remove("active"));

  if (obj) {
    const group = findCartGroup(obj);
    if (group) {
      const li = cartMap.get(group);
      if (li) {
        li.classList.add("active");
      }
    }
  }

  if (!obj) {
    if (selection.size === 0) {
      controls?.detach();
      detachNudge();
      selected = null;
      if (sidebarEl?.dataset.mode === "info") clearInfo();
    }
    updateBoxes();
    return;
  }

  const root = rootMap.get(obj) ?? obj;

  if (additive && selection.has(root)) {
    world.scene.three.remove(boxMap.get(root)!);
    boxMap.delete(root);
    selection.delete(root);
    if (selected === root) selected = selection.size ? Array.from(selection).pop()! : null;
  } else {
    selection.add(root);
    selected = root;
    if (!boxMap.has(root)) {
      const b = new THREE.BoxHelper(root, 0x00ff00);
      boxMap.set(root, b);
      world.scene.three.add(b);
    }
  }

  updateBoxes();

  if (selection.size === 1 && selected) {
    if (!controls) {
      const c = new TransformControls(
        world.camera.three,
        world.renderer.three.domElement,
      );
      const helper = (c as any).getHelper?.() ?? c;
      if ((helper as any).isObject3D) {
        helper.visible = false;
        c.showX = c.showY = c.showZ = false;
        c.enabled = false;
        world.scene.three.add(helper);
        controls = c;
        controlsHelper = helper as THREE.Object3D;
      } else {
        console.warn("[IFC] incompatible TransformControls instance");
        controls = null;
        controlsHelper = null;
      }
    } else if (controlsHelper && !controlsHelper.parent) {
      world.scene.three.add(controlsHelper);
    }

    attachNudge(selected);
    if (sidebarEl?.dataset.mode === "info") renderMeta(selected);
  } else {
    detachNudge();
    if (sidebarEl?.dataset.mode === "info") clearInfo();
  }
}

// laad GLB offscreen en toon Info-paneel
async function openInfoForUrl(url: string) {
  try {
    let root: THREE.Object3D;
    if (/\.ifc(zip)?$/i.test(url)) {
      const { root: r } = await loadIfc(url);
      root = r;
    } else {
      const gltf = await loadGltf(url);
      root = gltf.scene;
    }
    const info = analyzeUnit(root, url);
    metaCache.set(root, info);
    showInfo(root);
  } catch (e) {
    console.warn('[IFC] info load failed for', url, e);
  }
}

async function createLibraryItem(url: string): Promise<HTMLLIElement> {
  const li = document.createElement("li");
  li.className = "lib-item";
  li.draggable = true;
  li.dataset.url = url;

  const img = document.createElement("img");
  img.width = 80; img.height = 60;
  img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/lqY5WQAAAABJRU5ErkJggg==';
  img.draggable = false;
  li.appendChild(img);

  const row = document.createElement("div");
  row.className = "row";

  const span = document.createElement("span");
  span.className = "name";
  span.textContent = url.split("/").pop() || url;

  const infoBtn = document.createElement("button");
  infoBtn.className = "info";
  infoBtn.type = "button";
  infoBtn.textContent = "i";
  infoBtn.draggable = false;

  // klik betrouwbaar maken i.c.m. draggable li:
  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    openInfoForUrl(url);
  });
  infoBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  infoBtn.addEventListener("dragstart", (e) => e.preventDefault());

  row.append(span, infoBtn);
  li.appendChild(row);

  // dragstart alleen als niet vanaf de info-knop
  li.addEventListener("dragstart", (ev) => {
    const t = ev.target as HTMLElement;
    if (t && t.closest("button.info")) {
      ev.preventDefault();
      return;
    }
    ev.dataTransfer?.setData("text/plain", url);
  });

  // thumbnail genereren (asynchroon)
  try {
    const thumb = await generateThumbnail(url);
    img.src = thumb;
  } catch (err) {
    console.warn(`[IFC] thumbnail failed for ${url}`, err);
  }

  return li;
}

async function buildLibrary(urls: string[]) {
  const list = document.getElementById("unitList") as HTMLUListElement | null;
  if (!list) return;
  list.innerHTML = "";
  for (const url of urls) {
    const li = await createLibraryItem(url); // serieel => minder GPU piek
    list.appendChild(li);
  }
}

/**
 * Entry point for the viewer. Sets up the world, UI elements and event
 * listeners, then loads the default models. This function is invoked at the
 * bottom of the file.
 */
export async function bootstrap() {
  const container = document.getElementById("viewer") as HTMLDivElement | null;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement | null;
  const paintMenu = document.getElementById("paintMenu") as HTMLDivElement | null;
  const paintBtn = document.getElementById("paintBtn") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement | null;
  initSidebar();
  sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
  const placedList = document.getElementById("placedList") as HTMLUListElement | null;
  const placedListItem = document.querySelectorAll("#placedList .cart-item");
  if (!container) {
    console.warn('[IFC] viewer container missing');
    return;
  }
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
  placedList?.addEventListener("remove-unit", ev => {
    const group = (ev as CustomEvent).detail as THREE.Object3D;
    deleteUnit(group);
    selection.delete(group);
    if (selected === group) selected = null;
    subSelected = null;
    controls?.detach();
    detachNudge();
    updateBoxes();
    clearInfo();
    saveLayout();
  });
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
  await setupIfc(world);

  const gridPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  initFloors(world, gridPlane);
  grid = grids[0];
  grid.config.color = new THREE.Color(0x555555);
  grid.config.secondarySize = grid.config.primarySize;
  verticalSnap = floors[0].height;
  initSettings();
  snapInput && (snapInput.value = String(grid.config.primarySize));
  snapHeightInput && (snapHeightInput.value = String(floors[0].height));
  gridColorInput && (gridColorInput.value = `#${grid.config.color.getHexString()}`);
  bgInput && (bgInput.value = "#f0f0f0");
  snapInput?.addEventListener("change", () => {
    const v = parseFloat(snapInput!.value) || 1;
    grids.forEach(g => {
      g.config.primarySize = v;
      g.config.secondarySize = v;
    });
    if (controls) controls.translationSnap = v;
  });
  snapHeightInput?.addEventListener("change", () => {
    const v = parseFloat(snapHeightInput!.value) || 1;
    verticalSnap = v;
    floors.forEach(f => (f.height = v));
    setActiveFloor(currentLevel);
  });
  gridColorInput?.addEventListener("change", () => {
    grid.config.color = new THREE.Color(gridColorInput!.value);
  });
  bgInput?.addEventListener("change", () => {
    const col = new THREE.Color(bgInput!.value);
    world.renderer.three.setClearColor(col);
    world.scene.three.background = col;
  });

  // ---- Drop-Ghost (preview tijdens drag over viewer) ----
  let dropGhost: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;

  function showDropGhost(sizeX: number, sizeZ: number) {
    if (!dropGhost) {
      const geo = new THREE.PlaneGeometry(sizeX, sizeZ);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x0078ff,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      dropGhost = new THREE.Mesh(geo, mat);
      dropGhost.rotation.x = -Math.PI / 2; // vlak op de grond
      world.scene.three.add(dropGhost);
    } else {
      // update afmeting indien nodig
      dropGhost.geometry.dispose();
      dropGhost.geometry = new THREE.PlaneGeometry(sizeX, sizeZ);
    }
    dropGhost.visible = true;
  }

  function hideDropGhost() {
    if (dropGhost) dropGhost.visible = false;
  }

  function moveDropGhostTo(x: number, y: number, z: number) {
    if (!dropGhost) return;
    dropGhost.position.set(x, y + 0.01, z); // klein offsetje tegen z-fighting
  }

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
  setupRotateButton();
  setupMoveFloorButtons();

  const casters = components.get(OBC.Raycasters);
  const caster = casters.get(world);

  const assetFiles = [
    "unit1.glb",
    "unit2.glb",
    "unit3.glb",
    "unit4.glb",
    "unit_test.ifc",
  ];
  const libUrls = assetFiles.map(name =>
    new URL(`../core/assets/${name}`, import.meta.url).pathname
  );

  // async function populateUnitList(urls: string[]) {
  //   const list = document.getElementById("unitList");
  //   if (!list) return;
  //   list.innerHTML = "";

  //   // 1) loop serieel, zodat je netjes kunt await-en
  //   for (const url of urls) {
  //     const fileName = url.split("/").pop() || url;

  //     // 2) li én img aanmaken
  //     const li = document.createElement("li");
  //     li.className = "lib-item";
  //     li.setAttribute("draggable", "true");
  //     li.dataset.url = url;

  //     const img = document.createElement("img");
  //     img.width = 80;
  //     img.height = 60;
  //     img.src = "/path/to/placeholder.png";
  //     li.appendChild(img);

  //     // 3) thumbnail genereren en src aanpassen
  //     try {
  //       const thumb = await generateThumbnail(url);
  //       img.src = thumb;
  //     } catch (err) {
  //       console.warn(`Thumbnail failed for ${url}`, err);
  //     }

  //     // 4) de rest van je item maar wél in dezelfde scope
  //     const divRow   = document.createElement("div");
  //     divRow.className = "row";

  //     const spanName = document.createElement("span");
  //     spanName.className  = "name";
  //     spanName.textContent = fileName;

  //     const btnInfo = document.createElement("button");
  //     btnInfo.className = "info";
  //     btnInfo.type = "button";
  //     btnInfo.textContent = "i";
  //     btnInfo.draggable = false;

  //     // ⬇ click naar showInfo (offscreen)
  //     btnInfo.addEventListener("click", (e) => {
  //       e.stopPropagation();
  //       e.preventDefault();
  //       openInfoForUrl(url);
  //     });
  //     // ⬇ voorkom dat drag de click opslurpt
  //     btnInfo.addEventListener("pointerdown", (e) => e.stopPropagation());
  //     btnInfo.addEventListener("dragstart", (e) => e.preventDefault());

  //     row.append(spanName, btnInfo);
  //     li.append(divRow);
  //     list.append(li);

  //     // Alleen slepen als de oorsprong niet de info-button is
  //     li.addEventListener("dragstart", (ev) => {
  //       const t = ev.target as HTMLElement;
  //       if (t && t.closest("button.info")) {
  //         ev.preventDefault();
  //         return;
  //       }
  //       ev.dataTransfer!.setData("text/plain", url);
  //     });
  //   }
  // }

  // Dan roep je in bootstrap() na het definiëren van libUrls:
  await buildLibrary(libUrls);

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
    if (selection.has(root)) return;
    hoverBox = new THREE.BoxHelper(root, 0xffff00);
    world.scene.three.add(hoverBox);
  }

  /**
   * Handles selecting a root model. Attaches TransformControls and the drag
   * handle, creates bounding boxes and nudge arrows. Passing `null` clears the
   * current selection.
   */
  // Originele locatie voor selectObject() - nu naar boven verplaatst

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
    urlOrFile: string | File | Uint8Array,
    position = new THREE.Vector3(),
    level = currentLevel,
    displayUrl?: string,
    isWorld = false,
  ) {
    let modelID = -1;
    let root: THREE.Object3D;
    const url = typeof urlOrFile === 'string'
      ? (urlOrFile.startsWith('blob:') ? urlOrFile : new URL(urlOrFile, window.location.origin).pathname)
      : displayUrl || (urlOrFile instanceof File ? urlOrFile.name : 'bytes');

    if (typeof urlOrFile === 'string') {
      if (/\.ifc(zip)?$/i.test(urlOrFile)) {
        const res = await loadIfc(urlOrFile);
        modelID = res.modelID;
        root = res.root;
      } else {
        const gltf = await loadGltf(urlOrFile);
        root = gltf.scene;
      }
    } else {
      const res = await loadIfc(urlOrFile);
      modelID = res.modelID;
      root = res.root;
    }

    root.updateMatrixWorld(true);
    bboxer.reset();
    root.traverse(obj => {
      rootMap.set(obj, root);
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        bboxer.addMesh(obj);
        world.meshes.add(obj);
        if (!obj.userData.originalMaterial) {
          obj.userData.originalMaterial = obj.material;
        }
        picked.set(obj, {
          modelID,
          expressID: obj.userData.expressID || obj.id,
          globalId: obj.userData.globalId,
          ifcClass: obj.userData.ifcClass,
        });
      }
      if (obj instanceof THREE.Object3D) obj.name ||= 'unit';
    });
    const bounds = bboxer.get();
    const dims = OBC.BoundingBoxer.getDimensions(bounds);
    footprintByUrl.set(url, { w: dims.width, d: dims.depth });
    bboxer.reset();

    // Bewaar het oorspronkelijke nulpunt van het model zodat we deze later
    // kunnen tonen in het infovenster en de offset niet verliezen.
    (root.userData as any).zero = bounds.min.clone();

    // Corrigeer de positie met het oorspronkelijke nulpunt zodat de onderzijde op het grid rust.
    if (!isWorld) position.y -= bounds.min.y;
    root.position.copy(position);

    world.scene.three.add(root);
    addUnitToLevel(root, level);
    checkOverlaps();
    const id = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
    root.userData.id = id;
    root.userData.url = url;
    layoutMap.set(id, { id, url, pos: [position.x, position.y, position.z], rot: root.rotation.y, level });
    saveLayout();
    const info = analyzeUnit(root, url);
    metaCache.set(root, info);
    addUnitItem(root, url);
    addCartItem(root);
    await buildIndex({ modelID, root });
    setStoreys(byStorey);

    totalWidth += dims.width;
    totalHeight += dims.height;
    loadedCount++;
    const avg = totalWidth / loadedCount;
    const hAvg = totalHeight / loadedCount;
    grids.forEach(g => {
      g.config.primarySize = avg;
      g.config.secondarySize = avg;
    });
    verticalSnap = hAvg;
    floors.forEach(f => (f.height = hAvg));

    setActiveFloor(currentLevel);

    if (controls) controls.translationSnap = avg;

    snapInput.value = String(avg);
    snapHeightInput.value = String(hAvg);
    const sizeSnap = grids[currentLevel].config.primarySize;
    root.position.x = Math.round(root.position.x / sizeSnap) * sizeSnap;
    root.position.z = Math.round(root.position.z / sizeSnap) * sizeSnap;

    return { object: root, width: dims.width };
  
  }

  // Export / Import JSON helpers
  downloadLayoutJson = (filename = "layout.json") => {
    const data = JSON.stringify(Array.from(layoutMap.values()), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  loadLayoutFromItems = async (items: LayoutItem[]) => {
    // 1) huidige units opruimen
    const toRemove: THREE.Object3D[] = [];
    unitsByLevel.forEach(arr => arr.forEach(o => toRemove.push(o)));
    Array.from(new Set(toRemove)).forEach(o => deleteUnit(o));
    layoutMap.clear();
    saveLayout();

    // 2) nieuw laden mbv lokale addModel
    const errors: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        if (!it || !Array.isArray(it.pos) || it.pos.length !== 3) {
          throw new Error("Invalid item shape");
        }
        if (typeof it.url !== "string") {
          throw new Error("Item heeft geen geldige url");
        }
        if (it.url.startsWith("blob:")) {
          errors.push(`Item ${i}: blob-URL kan niet opnieuw geladen worden (${it.url}).`);
          continue;
        }
        const { object } = await addModel(it.url, new THREE.Vector3(...it.pos), it.level ?? 0, undefined, true);
        object.rotation.y = typeof it.rot === "number" ? it.rot : 0;
      } catch (e: any) {
        errors.push(`Item ${i} (${it?.url ?? "?"}): ${e?.message ?? e}`);
        console.error("Import item failed:", it, e);
      }
    }
    if (errors.length) {
      alert("Import gereed met waarschuwingen:\n" + errors.join("\n"));
    }
  };

  importLayoutFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result ?? "");
        const json = JSON.parse(text);
        const items: LayoutItem[] = Array.isArray(json) ? json : json?.items;
        if (!Array.isArray(items)) throw new Error("JSON moet een array of { items: [...] } zijn.");
        await loadLayoutFromItems(items);
      } catch (err) {
        console.error("Import failed:", err);
        alert("Kon layout JSON niet importeren. Controleer het bestand.");
      }
    };
    reader.readAsText(file);
  };

  let offset = 0;
  const saved = localStorage.getItem("layout");
  if (saved) {
    try {
      const items = JSON.parse(saved) as LayoutItem[];
      for (const it of items) {
        const { object, width } = await addModel(it.url, new THREE.Vector3(...it.pos), it.level, undefined, true);
        object.rotation.y = it.rot;
        offset = Math.max(offset, object.position.x + width);
      }
    } catch {}
  } else {
    for (const url of libUrls) {
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
    const rect = container!.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, world.camera.three);
    const hits = nudgeTargets.length
      ? ray.intersectObjects(nudgeTargets, false)
      : [];

    // --- hover over een arrow ---
    if (hits.length) {
      const pickedMesh = hits[0].object;
      const arrowGroup = pickedMesh.parent as THREE.Group;

      // 1) reset vorige hover (indien anders dan deze)
      if (hoveredArrow && hoveredArrow !== pickedMesh) {
        const prevGroup = hoveredArrow.parent as THREE.Group;
        prevGroup.children.forEach(ch => {
          if (!(ch as any).userData.hitArea) {
            (ch.material as THREE.MeshBasicMaterial).color.setHex(ARROW_COLOR_DEFAULT);
          }
        });
      }

      // 2) highlight de nieuwe hover
      hoveredArrow = pickedMesh;
      arrowGroup.children.forEach(ch => {
        if (!(ch as any).userData.hitArea) {
          (ch.material as THREE.MeshBasicMaterial).color.setHex(ARROW_COLOR_HOVER);
        }
      });

      container.style.cursor = "pointer";
      clearHover();
      return;
    }

    // --- geen hover meer op een arrow ---
    if (hoveredArrow) {
      const prevGroup = hoveredArrow.parent as THREE.Group;
      prevGroup.children.forEach(ch => {
        if (!(ch as any).userData.hitArea) {
          (ch.material as THREE.MeshBasicMaterial).color.setHex(ARROW_COLOR_DEFAULT);
        }
      });
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
      const arrow = hoveredArrow.parent as THREE.Group;
      nudge(arrow);
      arrowHold = arrow;
      holdInterval = window.setInterval(() => nudge(arrow), 200);
      arrow.children.forEach(ch => {
        if (!(ch as any).userData.hitArea) {
          (ch.material as THREE.MeshBasicMaterial).color.setHex(0x4caf50);
        }
      });
      arrow.scale.set(1.25, 1.25, 1.25);
      setTimeout(() => {
        arrow.scale.set(1, 1, 1);
        arrow.children.forEach(ch => {
          if (!(ch as any).userData.hitArea) {
          (ch.material as THREE.MeshBasicMaterial).color.setHex(ARROW_COLOR_DEFAULT);
          }
        });
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
      selectObject(result.object as THREE.Object3D, ev.shiftKey);
      if (!ev.shiftKey) selectSubObject(null);
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
      if (selection.size === 0 || !ev.shiftKey) return;
      selection.forEach(o => {
        o.position.y += (ev.deltaY > 0 ? -1 : 1) * floors[currentLevel].height * 0.1;
        updateLayout(o);
      });
      updateBoxes();
      ev.preventDefault();
    },
    { passive: false }
  );

  world.renderer.three.domElement.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    if (selection.size === 0) return;
    menu.innerHTML = "";
    const del = document.createElement("div");
    del.textContent = "Delete";
    del.onclick = () => {
      removeSelected();
      menu.style.display = "none";
    };
    menu.appendChild(del);
    floors.forEach((_, i) => {
      const move = document.createElement("div");
      move.textContent = `Move to floor ${i}`;
      move.onclick = () => {
        selection.forEach(o => {
          moveUnitToLevel(o, i);
          updateLayout(o);
        });
        menu.style.display = "none";
      };
      const dup = document.createElement("div");
      dup.textContent = `Duplicate to floor ${i}`;
      dup.onclick = () => {
        selection.forEach(sel => {
          let clone: THREE.Object3D;
          const cg = (sel as any)?.cloneGroup;
          if (typeof cg === "function") {
            try {
              clone = cg.call(sel);
            } catch {
              clone = sel.clone(true);
            }
          } else {
            clone = sel.clone(true);
          }
          world.scene.three.add(clone);
          addUnitToLevel(clone, i);
          const cid = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
          clone.userData.id = cid;
          layoutMap.set(cid, { id: cid, url: sel.userData.url || "", pos: [clone.position.x, clone.position.y, clone.position.z], rot: clone.rotation.y, level: i });
        });
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
  // Sta dragover toe en update ghost-positie
  container?.addEventListener("dragover", ev => {
      ev.preventDefault();

      // ➜ plane op de actieve floor zetten
      gridPlane.constant = -currentLevel * floors[currentLevel].height;

      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, world.camera.three);

      const point = new THREE.Vector3();
      ray.ray.intersectPlane(gridPlane, point); // ← nu op juiste y

      const step = grids[currentLevel].config.primarySize;
      const snapX = Math.round(point.x / step) * step;
      const snapZ = Math.round(point.z / step) * step;
      const levelY = currentLevel * floors[currentLevel].height;

      // ⬇ Footprint-logica
      let sizeX = step, sizeZ = step;
      const url = ev.dataTransfer?.getData("text") || ev.dataTransfer?.getData("text/plain") || "";
      const fp = url && footprintByUrl.get(url); // <- Map<string, { w: number; d: number }>
      if (fp) {
        sizeX = Math.max(step, Math.round(fp.w / step) * step);
        sizeZ = Math.max(step, Math.round(fp.d / step) * step);
      }

      showDropGhost(sizeX, sizeZ);
      moveDropGhostTo(snapX, levelY, snapZ);
    }, { passive: false });


  // Verberg ghost wanneer je container verlaat
  container?.addEventListener("dragleave", (ev) => {
    // Alleen verbergen als we écht de container verlaten
    if (!container.contains(ev.relatedTarget as Node)) hideDropGhost();
  });

  // Beste plek om ghost te verwijderen is bij drop
  container?.addEventListener("drop", async ev => {
    ev.preventDefault();
    hideDropGhost();

    gridPlane.constant = -currentLevel * floors[currentLevel].height;

    const url = ev.dataTransfer?.getData("text");
    if (!url) return;
    const source = ifcBytes.get(url) || url;

    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, world.camera.three);

    const point = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(gridPlane, point);
    if (!hit) return;

    const step = grids[currentLevel].config.primarySize;
    point.x = Math.round(point.x / step) * step;
    point.z = Math.round(point.z / step) * step;
    point.y = currentLevel * floors[currentLevel].height;
    try {
      const { object } = await addModel(source, point, currentLevel, url);
      selectObject(object);
    } catch (err) {
      console.error(`[IFC] load error ${url} (drag-drop)`, err);
    }
  });

  // Veiligheid: als drag wordt beëindigd buiten drop
  window.addEventListener("dragend", hideDropGhost);

  // Keyboard shortcuts for floor switching, movement and rotation
  const keyHandler = (e: KeyboardEvent) => {
    if (
      e.key === "Delete" ||
      e.key === "Backspace" ||
      (e as any).code === "Delete" ||
      (e as any).code === "Backspace" ||
      (e as any).keyCode === 8 ||
      (e as any).keyCode === 46
    ) {
      removeSelected();
      e.preventDefault();
      return;
    }
     if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      undo();
      e.preventDefault();
      return;
    }
    // REDO → Ctrl/Cmd+Shift+Z
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && e.shiftKey) {
      redo();
      e.preventDefault();
      return;
    }
    if (e.key >= "1" && e.key <= "3") {
      setActiveFloor(parseInt(e.key) - 1);
      return;
    }
    if (selection.size === 0) return;

    // const step = grid.config.primarySize;
    // const vstep = floors[currentLevel].height;
    const step = grids[currentLevel].config.primarySize;
    const vstep = floors[currentLevel].height;

    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        selection.forEach(o => {
          saveState(o);
          o.position.z -= step;
          updateLayout(o);
        });
        break;
      case "ArrowDown":
      case "s":
      case "S":
        selection.forEach(o => {
          saveState(o);
          o.position.z += step;
          updateLayout(o);
        });
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        selection.forEach(o => {
          saveState(o);
          o.position.x -= step;
          updateLayout(o);
        });
        break;
      case "ArrowRight":
      case "d":
      case "D":
        selection.forEach(o => {
          saveState(o);
          o.position.x += step;
          updateLayout(o);
        });
        break;
      case "q":
      case "Q":
        selection.forEach(o => {
          saveState(o);
          o.position.y += vstep;
          updateLayout(o);
        });
        break;
      case "e":
      case "E":
        selection.forEach(o => {
          saveState(o);
          o.position.y -= vstep;
          updateLayout(o);
        });
        break;
      case "PageUp":
        setActiveFloor(currentLevel + 1);
        return;
      case "PageDown":
        setActiveFloor(currentLevel - 1);
        return;
      case "r":
      case "R":
        selection.forEach(o => {
          saveState(o);
          o.rotateY(Math.PI / 4);
          updateLayout(o);
        });
        break;
      default:
        return;
    }

    selection.forEach(o => {
      o.position.x = Math.round(o.position.x / step) * step;
      o.position.y = Math.round(o.position.y / vstep) * vstep;
      o.position.z = Math.round(o.position.z / step) * step;
      setActiveFloor(Math.round(o.position.y / vstep));
      o.updateMatrixWorld();
      updateLayout(o);
    });
    if (controls && typeof (controls as any).updateMatrixWorld === "function") {
      controls.updateMatrixWorld(true);
    }
    updateBoxes();
    if (selection.size === 1 && selected) attachNudge(selected);
    e.preventDefault();
  };
  window.addEventListener("keydown", keyHandler, true);
  document.addEventListener("keydown", keyHandler, true);

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.ifc(zip)?$|\.glb$|\.gltf$/i)) {
      alert("Invalid file type");
      return;
    }
    try {
      let source: string | Uint8Array;
      if (file.name.match(/\.glb$|\.gltf$/i)) {
        source = URL.createObjectURL(file);
      } else {
        const bytes = await toUint8Array(file);
        ifcBytes.set(file.name, bytes.slice());
        source = bytes;
      }
      const { object, width } = await addModel(
        source,
        new THREE.Vector3(offset, currentLevel * floors[currentLevel].height, 0),
        currentLevel,
        file.name,
      );
      offset += width;
      selectObject(object);
      addCartItem(object);
      updateLayout(object);
    } catch (err) {
      console.error(`[IFC] load error ${file.name} (file-input)`, err);
    }
  });

  if (paintBtn && paintMenu) {
    paintBtn.onclick = () => paintMenu.classList.toggle("show");
    paintMenu.querySelectorAll<HTMLButtonElement>("button[data-variant]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (subSelected) {
          applyVariant(subSelected, createMat(btn.dataset.variant!));
          subBox?.update();
          paintMenu.classList.remove("show");
          return;
        }
        if (selection.size === 0) return;
        const mat = createMat(btn.dataset.variant!);
        selection.forEach(o => {
          applyVariant(o, mat);
          updateLayout(o);
        });
        updateBoxes();
        paintMenu.classList.remove("show");
      });
    });
  }

  resetBtn?.addEventListener("click", () => {
    if (subSelected) {
      resetMaterial(subSelected);
      subBox?.update();
      return;
    }
    selection.forEach(o => {
      resetMaterial(o);
      updateLayout(o);
    });
    updateBoxes();
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
