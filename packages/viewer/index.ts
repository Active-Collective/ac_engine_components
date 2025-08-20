// Import the minimal modules from Open BIM Components (OBC) and Three.js.
// OBC provides an opinionated framework around Three.js for BIM viewers.
// https://github.com/ThatOpen/engine_components
import * as OBC from "@thatopen/components";
import * as THREE from "three";

// TransformControls helper for translation/rotation gizmos.
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { setupIfc, loadIfc } from "./src/ifc/loader";
import { buildIndex, picked, byStorey } from "./src/ifc";
import { setStoreys } from "./src/ifc/storeys";
import { generateThumbnail } from "./utils/thumbnail";
import { initSidebar } from "./src/ui/sidebar";
import {
  metaCache,
  cartMap,
  cartListItems,
  addUnitItem,
  addCartItem,
  removeCartItem,
  renderMeta,
  clearInfo,
  showInfo,
} from "./sidebar";
import {
  floors,
  grids,
  unitsByLevel,
  currentLevel,
  initFloors,
  setActiveFloor,
  addUnitToLevel,
  moveUnitToLevel,
} from "./levels";
import { initSettings } from "./settings";
import { initNavControls } from "./nav-controls";
import { initHealthOverlay, setStage } from "./src/ui/health";
import "./src/styles/app.css";
// Helper modules defined in this package
//  - sidebar.ts: collects model metadata and renders the info sidebar
//  - levels.ts: manages floor grids and level switching
//  - settings.ts: binds UI inputs to runtime options

// New modularized logic
import { initMask, resetVisuals as resetVisualsMask, applyClip as applyClipMask, applyTransparency as applyTransparencyMask } from "./src/logic/mask";
import { initCollision, checkOverlaps } from "./src/logic/collision";
import { selectObject as baseSelectObject, selection, rootMap, updateBoxes, clearHover, setHover, getSelected } from "./src/logic/select";

// Currently selected root object and (optionally) sub-mesh. The bounding boxes
// visualize selection and hover state.
// let selected: THREE.Object3D | null = null;
// const selection = new Set<THREE.Object3D>();
// const boxMap = new Map<THREE.Object3D, THREE.BoxHelper>();
const footprintByUrl = new Map<string, { w: number; d: number }>();
let subBox: THREE.BoxHelper | null = null;
// let hoverBox: THREE.BoxHelper | null = null;
// One shared TransformControls instance is reused for all objects.
let controls: TransformControls | null = null;
let controlsHelper: THREE.Object3D | null = null;
// Small red sphere used for mouse dragging
// Drag handle removed per UX update
// Maps any child mesh to its root model for easy selection lookups
// const rootMap = new Map<THREE.Object3D, THREE.Object3D>();

export let world: OBC.World<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;
let bboxer: OBC.BoundingBoxer;
let totalWidth = 0;
let totalHeight = 0;
let loadedCount = 0;

if (import.meta.env.DEV) {
  console.info('[BOOT] entry:', import.meta.url);
  (window as any).__boot_entry__ = import.meta.url;
  initHealthOverlay();
  setStage('entry', true);
}

// let activeClip: { root: THREE.Object3D; plane: THREE.Plane } | null = null;
// const transparentMats = new Map<THREE.Material, number>();

export function resetVisuals() {
  // delegate to mask module
  resetVisualsMask();
}

function applyClip(root: THREE.Object3D, side: "A" | "B" | "C" | "D" | "E") {
  applyClipMask(root, side);
}

function applyTransparency(root: THREE.Object3D) {
  applyTransparencyMask(root);
}

export function clipSelected(side: "A" | "B" | "C" | "D" | "E") {
  const sel = getSelected();
  if (sel) applyClip(sel, side);
}

export function makeTransparentSelected() {
  const sel = getSelected();
  if (sel) applyTransparency(sel);
}

// Group holding the six nudge arrows. nudgeTargets is the list of meshes used
// for raycasting interaction.
const nudgeTargets: THREE.Object3D[] = [];
let hoveredArrow: THREE.Object3D | null = null;
// When holding down a nudge arrow we repeatedly apply the movement at this
// interval, emulating a key-repeat behavior.
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

function saveState(obj: THREE.Object3D) {
  history.push({ obj, pos: obj.position.clone(), quat: obj.quaternion.clone() });
  if (history.length > 20) history.shift();
}

/**
 * Voor elke root‑unit in de scene berekent deze functie de AABB
 * en markeert hij alle units die met minimaal één andere overlappen.
 */
// removed local checkOverlaps; using imported version from ./src/logic/collision

function deleteUnit(obj: THREE.Object3D) {
  const level = obj.userData.level ?? 0;
  unitsByLevel[level] = unitsByLevel[level].filter(o => o !== obj);
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
  // BoxHelpers are managed by selection module when selection changes
  layoutMap.delete(obj.userData.id);
  removeCartItem(obj);
  checkOverlaps();
}

function nudge(clickedObject: THREE.Object3D) {
  if (!getSelected()) return;

  // Zoek de groep of userData.normal op het aangeklikte object of zijn ouder
  let arrowGroup: THREE.Object3D | null = clickedObject;
  while (arrowGroup && !arrowGroup.userData.normal) {
    arrowGroup = arrowGroup.parent!;
  }
  if (!arrowGroup || !arrowGroup.userData.normal) return;

  const n = arrowGroup.userData.normal as THREE.Vector3;
  const step = n.y ? floors[currentLevel].height : grids[currentLevel].config.primarySize;

  selection.forEach(obj => {
    saveState(obj);
    obj.position.addScaledVector(n, step);
    const h = grids[currentLevel].config.primarySize;
    obj.position.x = Math.round(obj.position.x / h) * h;
    obj.position.y = Math.round(obj.position.y / floors[currentLevel].height) * floors[currentLevel].height;
    obj.position.z = Math.round(obj.position.z / h) * h;
    updateLayout(obj);
  });

  updateBoxes();
  if (controls && typeof (controls as any).updateMatrixWorld === "function") {
    controls.updateMatrixWorld(true);
  }

  checkOverlaps();

  if (selection.size === 1) attachNudge(getSelected()!);
  else detachNudge();
}

// Rotation
function setupRotateButton() {
  const btn = document.getElementById("rotate-object");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (!getSelected()) return;

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
  resetVisuals();

  cartListItems.forEach((item) => item.classList.remove("active"));
  if (obj) {
    const group = findCartGroup(obj);
    if (group) {
      const li = cartMap.get(group);
      if (li) li.classList.add("active");
    }
  }

  baseSelectObject(obj, additive);

  updateBoxes();

  const sel = getSelected();
  if (selection.size === 1 && sel) {
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
        c.addEventListener("dragging-changed", e => {
          if (!e.value) {
            const current = getSelected();
            if (current) {
              current.updateWorldMatrix(true, true);
              clearDimensionsCache(current);
              if (sidebarEl?.dataset.mode === "info") renderMeta(current);
            }
          }
        });
      } else {
        console.warn("[IFC] incompatible TransformControls instance");
        controls = null;
        controlsHelper = null;
      }
    } else if (controlsHelper && !controlsHelper.parent) {
      world.scene.three.add(controlsHelper);
    }

    attachNudge(sel);
    if (sidebarEl?.dataset.mode === "info") renderMeta(sel);
  } else {
    detachNudge();
    if (sidebarEl?.dataset.mode === "info") clearInfo();
  }
}

// laad GLB offscreen en toon Info-paneel
async function openInfoForUrl(url: string) {
  try {
    const { root } = await loadIfc(url);
    const info = await analyzeUnit(root, url);
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
  if (import.meta.env.DEV) setStage('bootstrap', true);
  const container = document.getElementById("viewer") as HTMLDivElement | null;
  initSidebar();
  sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
  const placedList = document.getElementById("placedList") as HTMLUListElement | null;

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
  if (import.meta.env.DEV) console.info('[BOOT] renderer attached to #viewer');

  // initialize modular subsystems
  initMask(world);
  initCollision(world);

  components.init();
  if (import.meta.env.DEV) console.info('[BOOT] components.init()');
  world.scene.setup();
  if (import.meta.env.DEV) console.info('[BOOT] world.scene.setup()');
  world.renderer.three.setClearColor(0xf0f0f0);
  world.scene.three.background = new THREE.Color(0xf0f0f0);
  world.camera.controls.setLookAt(5, 5, 5, 0, 0, 0);
  if (import.meta.env.DEV) {
    console.info('[BOOT] camera lookAt set');
    setStage('renderer', true);
  }

  // Replace deprecated outputEncoding with outputColorSpace
  // world.renderer.three.outputEncoding = THREE.sRGBEncoding;
  (world.renderer.three as any).outputColorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(world.renderer.three);
  new THREE.TextureLoader().load("/assets/ozone.jpg", tex => {
    const env = pmrem.fromEquirectangular(tex).texture;
    world.scene.three.environment = env;
    tex.dispose();
    pmrem.dispose();
  });

  bboxer = components.get(OBC.BoundingBoxer);
  await setupIfc(world);
  if (import.meta.env.DEV) {
    const wasm = await fetch('/wasm/web-ifc.wasm', { method: 'HEAD' });
    console.info('[BOOT] wasm path = /wasm/');
    setStage('wasm', wasm.ok);
  }

  const gridPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  initFloors(world, gridPlane);
  grid = grids[0];
  grid.config.color = new THREE.Color(0x555555);
  grid.config.secondarySize = grid.config.primarySize;
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
    "unit_test.ifc",
  ];
  const libUrls = assetFiles.map(name =>
    new URL(`./assets/${name}`, import.meta.url).pathname
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
  // }

  // Dan roep je in bootstrap() na het definiëren van libUrls:
  await buildLibrary(libUrls);
  // use imported clearHover/setHover from selection logic

  /** Highlight an individual mesh within the selected model. */
  function selectSubObject(mesh: THREE.Mesh | null) {
    if (subBox) {
      world.scene.three.remove(subBox);
      subBox = null;
    }
    // removed subSelected tracking
    if (mesh) {
      subBox = new THREE.BoxHelper(mesh, 0xffff00);
      world.scene.three.add(subBox);
    }
  }

  /**
   * Loads an IFC file and inserts it into the scene. Every mesh is registered
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
      const res = await loadIfc(urlOrFile);
      modelID = res.modelID;
      root = res.root;
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
    const info = await analyzeUnit(root, url);
    metaCache.set(root, info);
    addUnitItem(root, url);
    addCartItem(root);
    await buildIndex({ modelID, root });
    setStoreys(byStorey);
    if (import.meta.env.DEV) setStage('storeys', true);

    totalWidth += dims.width;
    totalHeight += dims.height;
    loadedCount++;
    const avg = totalWidth / loadedCount;
    const hAvg = totalHeight / loadedCount;
    grids.forEach(g => {
      g.config.primarySize = avg;
      g.config.secondarySize = avg;
    });
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
    } catch { /* noop */ }
  } else {
    for (const url of libUrls) {
      const { object, width } = await addModel(
        url,
        new THREE.Vector3(offset, 0, 0),
        0
      );
      const step = grid.config.primarySize;
      object.position.x = Math.round(object.position.x / step) * step;
      object.position.z = Math.round(object.position.z / step) * step;
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
    if (hoveredArrow && getSelected()) {
      const arrow = hoveredArrow.parent as THREE.Group;
      nudge(arrow);
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
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
  });

  // --- File drop support ---
  container.addEventListener("dragover", ev => {
    ev.preventDefault();
    ev.dataTransfer!.dropEffect = "copy";
  });

  container.addEventListener("drop", ev => {
    ev.preventDefault();
    const files = Array.from(ev.dataTransfer!.files);
    if (files.length) {
      files.forEach(file => {
        if (file.name.toLowerCase().endsWith(".ifc")) {
          loadIfc(file).then(() => {
            const url = URL.createObjectURL(file);
            openInfoForUrl(url);
          });
        } else {
          alert("Only .ifc files are supported.");
        }
      });
    }
  });

  // --- UI: File import ---
  const fileDialog = document.getElementById("fileDialog") as HTMLDivElement;
  const fileNameInput = document.getElementById("fileName") as HTMLInputElement;
  const fileUrlInput = document.getElementById("fileUrl") as HTMLInputElement;

  document.getElementById("importFile")?.addEventListener("click", () => {
    fileDialog.showModal();
  });

  document.getElementById("closeDialog")?.addEventListener("click", () => {
    fileDialog.close();
  });

  document.getElementById("loadFile")?.addEventListener("click", async () => {
    const url = fileUrlInput.value.trim();
    const name = fileNameInput.value.trim();
    if (url) {
      if (url.startsWith("http")) {
        // External URL
        loadIfc(url).then(() => {
          openInfoForUrl(url);
          fileDialog.close();
        }).catch(err => {
          alert("Failed to load IFC from URL.");
          console.error(err);
        });
      } else {
        // Local file (blob URL)
        const file = new File([], name || "model.ifc", { type: "application/octet-stream" });
        loadIfc(file).then(() => {
          const blobUrl = URL.createObjectURL(file);
          openInfoForUrl(blobUrl);
          fileDialog.close();
        }).catch(err => {
          alert("Failed to load IFC from file.");
          console.error(err);
        });
      }
    } else {
      alert("Please enter a valid URL.");
    }
  });

  // --- UI: Settings ---
  const settingsDialog = document.getElementById("settingsDialog") as HTMLDivElement;
  const floorHeightInput = document.getElementById("floorHeight") as HTMLInputElement;
  const gridSizeInput = document.getElementById("gridSize") as HTMLInputElement;

  document.getElementById("openSettings")?.addEventListener("click", () => {
    floorHeightInput.value = String(floors[0].height);
    gridSizeInput.value = String(grids[0].config.primarySize);
    settingsDialog.showModal();
  });

  document.getElementById("closeSettings")?.addEventListener("click", () => {
    settingsDialog.close();
  });

  document.getElementById("saveSettings")?.addEventListener("click", () => {
    const newHeight = parseFloat(floorHeightInput.value);
    const newSize = parseFloat(gridSizeInput.value);
    if (!isNaN(newHeight) && !isNaN(newSize)) {
      floors.forEach(f => f.height = newHeight);
      grids.forEach(g => {
        g.config.primarySize = newSize;
        g.config.secondarySize = newSize;
      });
      setActiveFloor(currentLevel);
      if (controls) {
        controls.translationSnap = newSize;
        controls.rotationSnap = THREE.MathUtils.degToRad(15);
      }
      settingsDialog.close();
    } else {
      alert("Invalid input values.");
    }
  });

  // --- UI: About ---
  document.getElementById("openAbout")?.addEventListener("click", () => {
    document.getElementById("aboutDialog")?.showModal();
  });

  document.getElementById("closeAbout")?.addEventListener("click", () => {
    document.getElementById("aboutDialog")?.close();
  });

  // --- UI: Help ---
  document.getElementById("openHelp")?.addEventListener("click", () => {
    document.getElementById("helpDialog")?.showModal();
  });

  document.getElementById("closeHelp")?.addEventListener("click", () => {
    document.getElementById("helpDialog")?.close();
  });

  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    let url = params.get('autoload');
    if (url === '1') url = '/assets/unit_test.ifc';
    if (url) {
      console.info('[BOOT] autoload IFC', url);
      try {
        await addModel(url, new THREE.Vector3());
        setStage('ifc', true);
      } catch (e) {
        console.warn('[BOOT] autoload failed', e);
      }
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bootstrap());
} else {
  bootstrap();
}
