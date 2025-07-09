import * as THREE from "three";

export interface UnitInfo {
  id: string;
  fileName: string;
  meshes: number;
  tris: number;
  materials: { name: string; color: string; texture?: string }[];
  layers: string[];
  children: string[];
}

export const unitInfoMap = new Map<THREE.Object3D, UnitInfo>();

export function analyzeGroup(group: THREE.Object3D, url: string): UnitInfo {
  const info: UnitInfo = {
    id: group.name || url,
    fileName: url.split("/").pop() || url,
    meshes: 0,
    tris: 0,
    materials: [],
    layers: [],
    children: [],
  };

  const materialSet = new Map<string, { name: string; color: string; texture?: string }>();
  const layerSet = new Set<string>();

  group.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      info.meshes++;
      info.tris += countTris(obj);
      info.children.push(obj.name);
      if (obj.userData.layer) layerSet.add(obj.userData.layer);
      if (obj.userData.ifcCategory) layerSet.add(obj.userData.ifcCategory);
      const mat = obj.material as THREE.Material | THREE.Material[];
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const key = m.uuid;
        if (!materialSet.has(key)) {
          const entry: { name: string; color: string; texture?: string } = {
            name: (m as any).name || "",
            color: (m as any).color ? (m as any).color.getHexString() : "",
          };
          const map = (m as any).map;
          if (map) entry.texture = map.name || map.uuid;
          materialSet.set(key, entry);
        }
      }
    }
  });

  info.materials = Array.from(materialSet.values());
  info.layers = Array.from(layerSet);
  return info;
}

export function countTris(mesh: THREE.Mesh): number {
  const geom = mesh.geometry;
  if (geom.index) return geom.index.count / 3;
  return geom.attributes.position.count / 3;
}

export function renderSidebar(container: HTMLElement = document.getElementById("sidebar") as HTMLElement) {
  if (!container) return;
  const tab = container.querySelector<HTMLDivElement>("#sidebarTab");
  const content = container.querySelector<HTMLDivElement>("#sidebarContent");
  if (!tab || !content) return;

  content.innerHTML = "";
  const ul = document.createElement("ul");
  unitInfoMap.forEach(info => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${info.fileName}</strong> (meshes: ${info.meshes}, tris: ${info.tris})`;
    const mats = info.materials.map(m => `<li>${m.name || "mat"} - #${m.color}${m.texture ? ` (${m.texture})` : ""}</li>`).join("");
    const layers = info.layers.map(l => `<li>${l}</li>`).join("");
    const children = info.children.map(c => `<li>${c}</li>`).join("");
    li.innerHTML += `<ul>${mats}</ul>`;
    if (layers) li.innerHTML += `<ul>${layers}</ul>`;
    if (children) li.innerHTML += `<ul>${children}</ul>`;
    ul.appendChild(li);
  });
  content.appendChild(ul);

  tab.onclick = () => {
    container.classList.toggle("collapsed");
    tab.textContent = container.classList.contains("collapsed") ? "»" : "«";
  };
}
