import * as THREE from 'three';

export type UnitEntry = {
  modelID: number;
  assemblyId: number | null;
  globalId: string | null;
  meshes: THREE.Object3D[];
  bbox: THREE.Box3;
  levelId: number | null;
  psets?: Record<string, any>;
};

export const byAssembly = new Map<THREE.Object3D, UnitEntry>();
export const byType = new Map<string, Set<THREE.Object3D>>();
export const byStorey = new Map<number, { elevation: number; name: string; objects: Set<THREE.Object3D> }>();
export const picked = new WeakMap<THREE.Object3D, { modelID: number; expressID: number; globalId?: string; ifcClass?: string }>();

export async function buildIndex({ modelID, root }: { modelID: number; root: THREE.Object3D }) {
  const entry: UnitEntry = {
    modelID,
    assemblyId: null,
    globalId: null,
    meshes: [],
    bbox: new THREE.Box3(),
    levelId: null,
    psets: {},
  };

  root.traverse((obj: any) => {
    if (obj.isMesh) {
      entry.meshes.push(obj);
      picked.set(obj, {
        modelID,
        expressID: obj.userData.expressID || obj.id,
        globalId: obj.userData.globalId,
        ifcClass: obj.userData.ifcClass,
      });
      entry.bbox.expandByObject(obj);
      const type = obj.userData.ifcClass;
      if (type) {
        if (!byType.has(type)) byType.set(type, new Set());
        byType.get(type)!.add(obj);
      }
    }
  });

  byAssembly.set(root, entry);
}

export function filterByType(type: string, visible: boolean) {
  const set = byType.get(type);
  if (!set) return;
  set.forEach(obj => {
    obj.visible = visible;
  });
}
