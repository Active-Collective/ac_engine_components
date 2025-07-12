import * as THREE from "three";

export interface UnitMeta {
  file: string;
  meshes: number;
  tris: number;
  mats: { name: string; color: string; texture?: string }[];
  layers: string[];
}

export const metaCache = new WeakMap<THREE.Object3D, UnitMeta>();

let sidebar: HTMLElement;
let unitList: HTMLUListElement;
let metaTable: HTMLTableElement;
let panelLibrary: HTMLElement;
let panelInfo: HTMLElement;
let panelTitle: HTMLElement;
let backBtn: HTMLButtonElement;
let toggleBtn: HTMLButtonElement;

export function initSidebar() {
  sidebar = document.getElementById("sidebar") as HTMLElement;
  unitList = document.getElementById("unitList") as HTMLUListElement;
  metaTable = document.getElementById("metaTable") as HTMLTableElement;
  panelLibrary = document.getElementById("panelLibrary") as HTMLElement;
  panelInfo = document.getElementById("panelInfo") as HTMLElement;
  panelTitle = document.getElementById("panelTitle") as HTMLElement;
  backBtn = document.getElementById("back") as HTMLButtonElement;
  toggleBtn = document.getElementById("toggle") as HTMLButtonElement;

  toggleBtn.onclick = () => sidebar.classList.toggle("collapsed");
  backBtn.onclick = () => showLibrary();

  showLibrary();
}

function showLibrary() {
  sidebar.dataset.mode = "library";
  panelLibrary.classList.add("active");
  panelInfo.classList.remove("active");
  panelTitle.textContent = "Units";
  backBtn.hidden = true;
}

function showInfo(group: THREE.Object3D) {
  sidebar.dataset.mode = "info";
  panelLibrary.classList.remove("active");
  panelInfo.classList.add("active");
  panelTitle.textContent = "Info";
  backBtn.hidden = false;
  renderMeta(group);
}

export function addUnitItem(group: THREE.Object3D, url: string) {
  const li = document.createElement("li");
  li.className = "lib-item";
  li.draggable = true;
  li.dataset.url = url;
  const span = document.createElement("span");
  span.className = "name";
  span.textContent = url.split("/").pop() || url;
  const infoBtn = document.createElement("button");
  infoBtn.className = "info";
  infoBtn.textContent = "i";
  infoBtn.onclick = () => showInfo(group);
  li.append(span, infoBtn);
  li.addEventListener("dragstart", ev => {
    ev.dataTransfer?.setData("text", url);
  });
  unitList.appendChild(li);
}

export function analyzeUnit(group: THREE.Object3D, url: string): UnitMeta {
  const meta: UnitMeta = { file: url.split("/").pop() || url, meshes: 0, tris: 0, mats: [], layers: [] };
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
  return meta;
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
  add("File", meta.file);
  add("Meshes", String(meta.meshes));
  add("Triangles", String(meta.tris));
  if (meta.layers.length) add("Layers", meta.layers.join(", "));
  if (meta.mats.length) {
    const rows = meta.mats.map(m => `${m.name || "mat"} #${m.color}`).join(", ");
    add("Materials", rows);
  }
}

export function clearInfo() {
  metaTable.innerHTML = "";
}

