import * as THREE from "three";
import * as OBC from "@thatopen/components";

export interface FloorCfg {
  height: number;
  ghostOpacity: number;
  showGhost: boolean;
}

export const floors: FloorCfg[] = [
  { height: 3, ghostOpacity: 0.5, showGhost: true },
  { height: 3, ghostOpacity: 0.5, showGhost: true },
  { height: 3, ghostOpacity: 0.5, showGhost: true },
];

export let currentLevel = 0;
export const grids: OBC.SimpleGrid[] = [];
export const unitsByLevel: THREE.Object3D[][] = [];

let world: OBC.World;
let workingPlane: THREE.Plane;

export function initFloors(w: OBC.World, plane: THREE.Plane) {
  world = w;
  workingPlane = plane;
  grids.length = 0;
  unitsByLevel.length = 0;
  floors.forEach((cfg, i) => {
    const grid = new OBC.SimpleGrid(world.components, world);
    grid.setup();
    grid.three.position.y = i * cfg.height;
    grid.material.transparent = true;
    grids.push(grid);
    unitsByLevel[i] = [];
  });
  setActiveFloor(0);
}

export function setActiveFloor(level: number) {
  currentLevel = Math.min(Math.max(level, 0), floors.length - 1);
  grids.forEach((g, i) => {
    const f = floors[i];
    g.three.position.y = i * f.height;
    const op = i === currentLevel ? 1 : f.showGhost ? f.ghostOpacity : 0;
    g.material.opacity = op;
    g.material.transparent = op < 1;
  });
  workingPlane.constant = currentLevel * floors[currentLevel].height;
  document.dispatchEvent(
    new CustomEvent("floorchange", { detail: { level: currentLevel } })
  );
}

export function addUnitToLevel(obj: THREE.Object3D, level = currentLevel) {
  unitsByLevel[level].push(obj);
  obj.userData.level = level;
  obj.position.y = level * floors[level].height;
}

export function moveUnitToLevel(obj: THREE.Object3D, level: number) {
  const old = obj.userData.level ?? 0;
  if (old === level) return;
  unitsByLevel[old] = unitsByLevel[old].filter(o => o !== obj);
  unitsByLevel[level].push(obj);
  obj.userData.level = level;
  obj.position.y = level * floors[level].height;
}

export function updateFloor(index: number, cfg: Partial<FloorCfg>) {
  Object.assign(floors[index], cfg);
  setActiveFloor(currentLevel);
  unitsByLevel[index].forEach(obj => {
    obj.position.y = index * floors[index].height;
  });
}

export function getCollisionCandidates() {
  return unitsByLevel[currentLevel];
}
