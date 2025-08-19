import * as THREE from "three";
import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";
import { IfcPropertiesUtils } from "@thatopen/components";

import {
  selectObject,
  downloadLayoutJson,
  importLayoutFromFile,
  clipSelected,
  makeTransparentSelected,
  resetVisuals,
} from "./index";
import { exportToPdf } from "./utils/exportPdf";

export interface UnitMeta {
  file: string;
  meshes: number;
  tris: number;
  mats: { name: string; color: string; texture?: string }[];
  layers: string[];
  origin: [number, number, number];
  dims?: {
    width: number;
    depth: number;
    height: number;
    area?: number;
    volume?: number;
  };
  parameterTest?: string | null;
}

export const metaCache = new WeakMap<THREE.Object3D, UnitMeta>();

let sidebar: HTMLElement;
let unitList: HTMLUListElement;
let cartList: HTMLUListElement;
const itemMap = new WeakMap<THREE.Object3D, HTMLLIElement>();
export const cartMap = new WeakMap<THREE.Object3D, HTMLLIElement>();
export const cartListItems: HTMLLIElement[] = [];
const libUrls = new Set<string>();
let metaTable: HTMLTableElement;
let panelLibrary: HTMLElement;
let panelInfo: HTMLElement;
let panelTitle: HTMLElement;
let backBtn: HTMLButtonElement;
let toggleBtn: HTMLButtonElement;
let tabBtn: HTMLElement;
let pdfOptions: HTMLElement;
let jsonButtons: HTMLElement;
let paramBanner: HTMLDivElement;

export function initSidebar() {
  sidebar = document.getElementById("sidebar") as HTMLElement;
  unitList = document.getElementById("unitList") as HTMLUListElement;
  cartList = document.getElementById("placedList") as HTMLUListElement;
  metaTable = document.getElementById("metaTable") as HTMLTableElement;
  panelLibrary = document.getElementById("panelLibrary") as HTMLElement;
  panelInfo = document.getElementById("panelInfo") as HTMLElement;
  panelTitle = document.getElementById("panelTitle") as HTMLElement;
  backBtn = document.getElementById("back") as HTMLButtonElement;
  toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
  tabBtn = document.getElementById("sidebarTab") as HTMLElement;
  pdfOptions = document.getElementById("pdfOptions") as HTMLElement;
  jsonButtons = document.getElementById("jsonButtons") as HTMLElement;
  paramBanner = document.createElement("div");
  paramBanner.className = "param-banner";
  paramBanner.hidden = true;
  panelInfo.prepend(paramBanner);

  const toggle = () => sidebar.classList.toggle("collapsed");
  toggleBtn.onclick = toggle;
  tabBtn.onclick = toggle;
  backBtn.onclick = () => showLibrary();

  showLibrary();

  // PDF export
  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export als PDF';
  exportBtn.className   = 'export-pdf';
  pdfOptions.appendChild(exportBtn);
  exportBtn.addEventListener('click', () => {
    exportToPdf();
  });

  // Export layout (JSON)
  const exportJsonBtn = document.createElement("button");
  exportJsonBtn.textContent = "Export JSON";
  exportJsonBtn.className = "export-json";
  exportJsonBtn.onclick = () => downloadLayoutJson();
  jsonButtons.appendChild(exportJsonBtn);

  // Import layout (JSON)
  const importJsonBtn = document.createElement("button");
  importJsonBtn.textContent = "Import JSON";
  importJsonBtn.className = "import-json";
  jsonButtons.appendChild(importJsonBtn);

  // Hidden file input voor import
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json";
  importInput.style.display = "none";
  panelLibrary.appendChild(importInput);

  importJsonBtn.onclick = () => importInput.click();
  importInput.onchange = () => {
    const file = importInput.files?.[0];
    if (!file) return;
    importLayoutFromFile(file);
    importInput.value = ""; // reset input voor volgende keer
  };
}

function showLibrary() {
  sidebar.dataset.mode = "library";
  panelLibrary.classList.add("active");
  panelInfo.classList.remove("active");
  panelTitle.textContent = "Units";
  backBtn.hidden = true;
}

export function showInfo(group: THREE.Object3D) {
  sidebar.dataset.mode = "info";
  panelLibrary.classList.remove("active");
  panelInfo.classList.add("active");
  panelTitle.textContent = "Info";
  backBtn.hidden = false;
  renderMeta(group);
}

export function addUnitItem(group: THREE.Object3D, url: string) {
  if (libUrls.has(url)) return;
  libUrls.add(url);

  const li = document.createElement("li");
  li.className = "lib-item";
  li.setAttribute("draggable", "true");
  li.dataset.url = url;

  const img = document.createElement("img");
  img.width = 80;
  img.height = 60;
  // img.draggable = false; // optioneel: zodat je alleen via li sleept
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

  // ⬇️ Kritiek: klik mag NIET veranderen in drag, en bubbelen blokkeren
  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    showInfo(group);
  });
  infoBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  infoBtn.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });

  row.append(span, infoBtn);
  li.appendChild(row);

  // Alleen slepen als de oorsprong NIET de info-button is
  li.addEventListener("dragstart", (ev) => {
    const target = ev.target as HTMLElement;
    if (target && target.closest("button.info")) {
      ev.preventDefault(); // geen drag vanaf de info-button
      return;
    }
    ev.dataTransfer?.setData("text/plain", url);
  });
  unitList.appendChild(li);
  itemMap.set(group, li);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.setSize(80, 60, false);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, 80 / 60, 0.1, 10);
  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(light);
  let clone: THREE.Object3D;
  const cg = (group as any)?.cloneGroup;
  if (typeof cg === "function") {
    try {
      clone = cg.call(group);
    } catch {
      clone = group.clone(true);
    }
  } else {
    clone = group.clone(true);
  }
  scene.add(clone);
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  cam.position.copy(center).addScalar(size);
  cam.lookAt(center);
  let snapshot: string | null = null;
  try {
    renderer.render(scene, cam);
    snapshot = renderer.domElement.toDataURL();
  } catch (err) {
    console.warn("[IFC] thumbnail render failed", err);
  }
  img.src = snapshot || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  renderer.dispose();
}

export function removeUnitItem(group: THREE.Object3D) {
  const li = itemMap.get(group);
  if (li && li.parentElement) li.parentElement.removeChild(li);
  itemMap.delete(group);
  metaCache.delete(group);
}

export function addCartItem(group: THREE.Object3D) {
  if (cartMap.has(group)) return; // voorkom dubbel toevoegen

  const li = document.createElement("li");
  li.className = "cart-item";
  const span = document.createElement("span");
  span.textContent = group.userData.url?.split("/").pop() || group.name || "unit";
  const btn = document.createElement("button");
  btn.className = "remove";
  btn.textContent = "×";
  btn.onclick = (event) => {
    event.stopPropagation();
    li.dispatchEvent(new CustomEvent("remove-unit", { detail: group, bubbles: true }));
  };
  li.onclick = () => {
    selectObject(group);
  };
  li.append(span, btn);
  cartListItems.push(li);
  cartList.appendChild(li);
  cartMap.set(group, li);
}

export function removeCartItem(group: THREE.Object3D) {
  const li = cartMap.get(group);
  if (li && li.parentElement) li.parentElement.removeChild(li);
  cartMap.delete(group);
}

export async function analyzeUnit(
  group: THREE.Object3D,
  url: string,
): Promise<UnitMeta> {
  const zero = (group.userData as any).zero as THREE.Vector3 | undefined;
  const meta: UnitMeta = {
    file: url.split("/").pop() || url,
    meshes: 0,
    tris: 0,
    mats: [],
    layers: [],
    origin: zero ? [zero.x, zero.y, zero.z] : [0, 0, 0],
  };
  const mats = new Map<string, { name: string; color: string; texture?: string }>();
  const layers = new Set<string>();
  group.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      meta.meshes++;
      meta.tris += countTris(obj);
      if (obj.userData.layer) layers.add(obj.userData.layer);
      if (obj.userData.ifcCategory) layers.add(obj.userData.ifcCategory);
      const material = obj.material as THREE.Material | THREE.Material[];
      const arr = Array.isArray(material) ? material : [material];
      for (const m of arr) {
        if (!mats.has(m.uuid)) {
          const entry: { name: string; color: string; texture?: string } = {
            name: (m as any).name || "",
            color: (m as any).color ? (m as any).color.getHexString() : "",
          };
          const map = (m as any).map;
          if (map) entry.texture = map.name || map.uuid;
          mats.set(m.uuid, entry);
        }
      }
    }
  });
  meta.mats = Array.from(mats.values());
  meta.layers = Array.from(layers);
  meta.parameterTest = await getParameterTest(group as FRAGS.FragmentsGroup);
  meta.dims = await getUnitDimensions(group as FRAGS.FragmentsGroup);
  return meta;
}

async function getParameterTest(group: FRAGS.FragmentsGroup) {
  try {
    const psets = await group.getAllPropertiesOfType(WEBIFC.IFCPROPERTYSET);
    if (!psets) return null;
    for (const pset of Object.values(psets) as any[]) {
      const props = pset.HasProperties || [];
      for (const h of props) {
        const prop = await group.getProperties(h.value);
        if (prop?.Name?.value === "ParameterTest") {
          const val = prop.NominalValue?.value;
          return val !== undefined ? String(val) : null;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getUnitDimensions(group: FRAGS.FragmentsGroup) {
  const factor = await IfcPropertiesUtils.getUnits(group);
  let width: number | undefined;
  let depth: number | undefined;
  let height: number | undefined;
  let area: number | undefined;
  let volume: number | undefined;
  try {
    const qsets = await group.getAllPropertiesOfType(WEBIFC.IFCELEMENTQUANTITY);
    if (qsets) {
      for (const qset of Object.values(qsets) as any[]) {
        if (qset.Name?.value !== "BaseQuantities") continue;
        const ids = await IfcPropertiesUtils.getQsetQuantities(group, qset.expressID);
        if (!ids) break;
        for (const id of ids) {
          const q = await group.getProperties(id);
          const name = q?.Name?.value as string | undefined;
          const { value } = await IfcPropertiesUtils.getQuantityValue(group, id);
          if (value === null || value === undefined || !name) continue;
          const num = Number(value);
          const lname = name.toLowerCase();
          if (lname === "width") width = num * factor;
          else if (lname === "length" || lname === "depth") depth = num * factor;
          else if (lname === "height") height = num * factor;
          else if (lname.includes("area")) area = num * factor * factor;
          else if (lname.includes("volume")) volume = num * factor * factor * factor;
        }
        break;
      }
    }
  } catch {
    /* empty */
  }
  if (width === undefined || depth === undefined || height === undefined) {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    width ??= size.x * factor;
    depth ??= size.z * factor;
    height ??= size.y * factor;
  }
  if (area === undefined && width !== undefined && depth !== undefined) {
    area = width * depth;
  }
  if (
    volume === undefined &&
    width !== undefined &&
    depth !== undefined &&
    height !== undefined
  ) {
    volume = width * depth * height;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    width: round(width ?? 0),
    depth: round(depth ?? 0),
    height: round(height ?? 0),
    area: area !== undefined ? round(area) : undefined,
    volume: volume !== undefined ? round(volume) : undefined,
  };
}

function countTris(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

export function renderMeta(group: THREE.Object3D) {
  const meta = metaCache.get(group);
  if (!meta) return;
  metaTable.innerHTML = "";
  const add = (k: string, v: string) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th>${k}</th><td>${v}</td>`;
    metaTable.appendChild(tr);
  };

  if (paramBanner) {
    paramBanner.innerHTML = "";
    if (meta.parameterTest) {
      const msg = document.createElement("div");
      msg.textContent = `ParameterTest: ${meta.parameterTest}`;
      const sides: Array<"A" | "B" | "C" | "D" | "E"> = ["A", "B", "C", "D", "E"];
      const btnWrap = document.createElement("div");
      sides.forEach(s => {
        const b = document.createElement("button");
        b.textContent = `Open side ${s}`;
        b.onclick = () => clipSelected(s);
        btnWrap.appendChild(b);
      });
      const tBtn = document.createElement("button");
      tBtn.textContent = "Make transparent";
      tBtn.onclick = () => makeTransparentSelected();
      const igBtn = document.createElement("button");
      igBtn.textContent = "Ignore";
      igBtn.onclick = () => {
        paramBanner.hidden = true;
        resetVisuals();
      };
      paramBanner.append(msg, btnWrap, tBtn, igBtn);
      paramBanner.hidden = false;
    } else {
      paramBanner.hidden = true;
    }
  }
  add("File", meta.file);
  add("Meshes", String(meta.meshes));
  add("Triangles", String(meta.tris));
  add("Origin", meta.origin.map(n => n.toFixed(2)).join(", "));
  if (meta.layers.length) add("Layers", meta.layers.join(", "));
  if (meta.mats.length) {
    const rows = meta.mats.map(m => `${m.name || "mat"} #${m.color}`).join(", ");
    add("Materials", rows);
  }
  if (meta.dims) {
    const d = meta.dims;
    add(
      "Dimensions",
      `${d.width.toFixed(2)} × ${d.depth.toFixed(2)} × ${d.height.toFixed(2)} m`,
    );
    if (d.area !== undefined) add("Area", `${d.area.toFixed(2)} m²`);
    if (d.volume !== undefined) add("Volume", `${d.volume.toFixed(2)} m³`);
  }
}

export function clearInfo() {
  metaTable.innerHTML = "";
  if (paramBanner) paramBanner.hidden = true;
}
