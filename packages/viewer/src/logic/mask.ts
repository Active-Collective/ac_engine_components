import * as THREE from "three";
import type { World } from "@thatopen/components";

let world: World | null = null;

export function initMask(w: World) {
  world = w;
}

let activeClip: { root: THREE.Object3D; plane: THREE.Plane } | null = null;
const transparentMats = new Map<THREE.Material, number>();

export function resetVisuals() {
  if (activeClip) {
    activeClip.root.traverse(obj => {
      if ((obj as any).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => (m.clippingPlanes = undefined));
      }
    });
    activeClip = null;
  }
  transparentMats.forEach((o, m) => {
    m.opacity = o;
    if (o >= 1) m.transparent = false;
  });
  transparentMats.clear();
  if (world?.renderer?.three) {
    world.renderer.three.localClippingEnabled = false;
  }
}

export function applyClip(root: THREE.Object3D, side: "A" | "B" | "C" | "D" | "E") {
  resetVisuals();
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const normal = new THREE.Vector3();
  switch (side) {
    case "A": normal.set(-1, 0, 0); break;
    case "B": normal.set(0, 0, -1); break;
    case "C": normal.set(1, 0, 0); break;
    case "D": normal.set(0, 0, 1); break;
    case "E": normal.set(0, -1, 0); break;
  }
  const plane = new THREE.Plane(normal, -normal.dot(center));
  plane.applyMatrix4(root.matrixWorld);
  root.traverse(obj => {
    if ((obj as any).isMesh) {
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => (m.clippingPlanes = [plane]));
    }
  });
  if (world) world.renderer.three.localClippingEnabled = true;
  activeClip = { root, plane };
}

export function applyTransparency(root: THREE.Object3D) {
  resetVisuals();
  root.traverse(obj => {
    if ((obj as any).isMesh) {
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => {
        if (!transparentMats.has(m)) transparentMats.set(m, m.opacity);
        m.transparent = true;
        m.opacity = 0.6;
      });
    }
  });
}

export function clipSelected(selected: THREE.Object3D | null, side: "A" | "B" | "C" | "D" | "E") {
  if (selected) applyClip(selected, side);
}

export function makeTransparentSelected(selected: THREE.Object3D | null) {
  if (selected) applyTransparency(selected);
}

