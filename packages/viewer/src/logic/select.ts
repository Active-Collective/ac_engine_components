import * as THREE from "three";
import type { World } from "@thatopen/components";

let world: World | null = null;

export function initSelect(w: World) {
  world = w;
}

export const selection = new Set<THREE.Object3D>();
let selected: THREE.Object3D | null = null;
const boxMap = new Map<THREE.Object3D, THREE.BoxHelper>();
let hoverBox: THREE.BoxHelper | null = null;
export const rootMap = new Map<THREE.Object3D, THREE.Object3D>();

export function getSelected() { return selected; }
export function getSelection() { return selection; }

export function updateBoxes() {
  for (const obj of selection) boxMap.get(obj)?.update();
}

export function clearHover() {
  if (hoverBox && world) {
    world.scene.three.remove(hoverBox);
    hoverBox = null;
  }
}

export function setHover(obj: THREE.Object3D | null) {
  clearHover();
  if (!obj || !world) return;
  const root = rootMap.get(obj) ?? obj;
  if (selection.has(root)) return;
  hoverBox = new THREE.BoxHelper(root, 0xffff00);
  world.scene.three.add(hoverBox);
}

export function selectObject(obj: THREE.Object3D | null, additive = false) {
  if (!world) return;
  if (!additive) {
    selection.forEach(o => world!.scene.three.remove(boxMap.get(o)!));
    selection.clear();
    boxMap.clear();
  }
  if (!obj) {
    if (selection.size === 0) selected = null;
    updateBoxes();
    return;
  }
  const root = rootMap.get(obj) ?? obj;
  if (additive && selection.has(root)) {
    world.scene.three.remove(boxMap.get(root)!);
    boxMap.delete(root);
    selection.delete(root);
    selected = selection.size ? Array.from(selection).pop()! : null;
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
}

