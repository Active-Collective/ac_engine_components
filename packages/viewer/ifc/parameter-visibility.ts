import type { IfcAPI } from 'web-ifc';
import * as THREE from 'three';

export type Label = 'AA' | 'BB' | 'CC' | 'DD';

export interface ParamGroups {
  map: Map<Label, Set<THREE.Object3D>>;
  labels: Label[];
  toggle: (label: Label, visible: boolean) => void;
}

function toString(val: any): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val.value === 'string') return val.value;
  if (typeof val.wrappedValue === 'string') return val.wrappedValue;
  return String(val);
}

export async function buildParamGroups(
  ifcAPI: IfcAPI,
  modelID: number,
  root: THREE.Object3D,
): Promise<ParamGroups> {
  const labels: Label[] = ['AA', 'BB', 'CC', 'DD'];
  const map = new Map<Label, Set<THREE.Object3D>>();
  labels.forEach(l => map.set(l, new Set()));

  // Build expressID -> Object3D index
  const index = new Map<number, THREE.Object3D>();
  root.traverse(obj => {
    const id = (obj as any).userData?.expressID ?? (obj as any).userData?.ifcId;
    if (typeof id === 'number') index.set(id, obj);
  });

  if (!ifcAPI) {
    return { map, labels, toggle };
  }

  const relIDs: Iterable<number> = (ifcAPI as any).GetLineIDsWithType
    ? (ifcAPI as any).GetLineIDsWithType(modelID, (ifcAPI as any).IFCRELDEFINESBYPROPERTIES)
    : [];

  for (const relID of Array.from(relIDs as any)) {
    const rel: any = (ifcAPI as any).GetLine(modelID, relID);
    if (!rel) continue;
    const related: any[] = rel.RelatedObjects || [];
    const propDef = rel.RelatingPropertyDefinition?.value;
    if (!propDef) continue;
    const pset: any = (ifcAPI as any).GetLine(modelID, propDef);
    const hasProps: any[] = pset?.HasProperties || [];
    for (const pRef of hasProps) {
      const prop: any = (ifcAPI as any).GetLine(modelID, pRef.value);
      if (!prop || prop.Name?.value !== 'ParameterTest') continue;
      const text = toString(prop.NominalValue)?.toUpperCase();
      if (!text || !map.has(text as Label)) continue;
      const set = map.get(text as Label)!;
      for (const r of related) {
        const eid = typeof r === 'number' ? r : r.value;
        const obj = index.get(eid);
        if (obj) set.add(obj);
      }
    }
  }

  function toggle(label: Label, visible: boolean) {
    const set = map.get(label);
    if (!set) return;
    set.forEach(o => {
      o.visible = visible;
    });
  }

  return { map, labels, toggle };
}

