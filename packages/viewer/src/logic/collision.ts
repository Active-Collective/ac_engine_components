import * as THREE from "three";
import type { World } from "@thatopen/components";
import { floors, unitsByLevel } from "../../levels";

let world: World;

export function initCollision(w: World) {
  world = w;
}

/**
 * Voor elke root‑unit in de scene berekent deze functie de AABB
 * en markeert hij alle units die met minimaal één andere overlappen.
 */
export function checkOverlaps() {
  if (!world) return;
  world.scene.three.updateMatrixWorld(true);

  const units: THREE.Object3D[] = [];
  for (const arr of unitsByLevel) for (const u of arr) units.push(u);

  const H = floors[0]?.height ?? 1;
  const entries = units.map(obj => {
    const box = new THREE.Box3().setFromObject(obj);
    const level = (obj.userData.level ?? Math.round(obj.position.y / H)) as number;
    return {
      obj,
      level,
      minX: box.min.x, maxX: box.max.x,
      minZ: box.min.z, maxZ: box.max.z,
    };
  });

  const overlapping = new Set<THREE.Object3D>();
  const eps = 1e-6;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.level !== b.level) continue;
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > eps;
      const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > eps;
      if (overlapX && overlapZ) {
        overlapping.add(a.obj);
        overlapping.add(b.obj);
      }
    }
  }

  entries.forEach(({ obj }) => {
    const shouldBeRed = overlapping.has(obj);
    obj.traverse(child => {
      if (!(child as any).isMesh) return;
      const mesh = child as THREE.Mesh;
      const key = "__overlapSavedMat";
      const saved = (mesh.userData as any)[key] as THREE.Material | undefined;

      if (shouldBeRed) {
        if (!saved) {
          (mesh.userData as any)[key] = mesh.material;
          mesh.material = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: false });
        }
      } else if (saved) {
        (mesh.material as THREE.Material).dispose();
        mesh.material = saved;
        delete (mesh.userData as any)[key];
      }
    });
  });
}

