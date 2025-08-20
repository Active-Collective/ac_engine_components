import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { grids, floors, currentLevel, setActiveFloor } from "../../levels";

let controls: TransformControls | null = null;

export function bindTransformControls(c: TransformControls | null) {
  controls = c;
  if (controls) controls.translationSnap = grids[currentLevel].config.primarySize;
}

export function getGridStep() {
  return grids[currentLevel].config.primarySize;
}

export function setGridStep(v: number) {
  grids.forEach(g => {
    g.config.primarySize = v;
    g.config.secondarySize = v;
  });
  if (controls) controls.translationSnap = v;
}

export function getVerticalStep() {
  return floors[currentLevel].height;
}

export function setVerticalStep(v: number) {
  floors.forEach(f => (f.height = v));
  setActiveFloor(currentLevel);
}

export function snapVector3(vec: THREE.Vector3, step = getGridStep(), vstep = getVerticalStep()) {
  vec.x = Math.round(vec.x / step) * step;
  vec.y = Math.round(vec.y / vstep) * vstep;
  vec.z = Math.round(vec.z / step) * step;
  return vec;
}

export function snapObjectPosition(obj: THREE.Object3D, step = getGridStep(), vstep = getVerticalStep()) {
  obj.position.x = Math.round(obj.position.x / step) * step;
  obj.position.y = Math.round(obj.position.y / vstep) * vstep;
  obj.position.z = Math.round(obj.position.z / step) * step;
}

