import * as OBC from '@thatopen/components';
import * as THREE from 'three';

let ifcLoader: any;

export async function setupIfc(world: any) {
  const components = (world && (world.components || world._components)) || new OBC.Components();
  ifcLoader = components.get(OBC.IfcLoader as any);
  if (ifcLoader && ifcLoader.setup) {
    await ifcLoader.setup();
  }
  if (ifcLoader && ifcLoader.settings) {
    ifcLoader.settings.wasm = { path: '/wasm/', absolute: true };
  }
}

export async function loadIfc(urlOrFile: string | File): Promise<{ modelID: number; root: THREE.Object3D }> {
  if (!ifcLoader) throw new Error('IFC loader not initialized');
  const model: any = await ifcLoader.load(urlOrFile as any);
  const root: any = model?.mesh || model?.root || model?.object || model;
  const modelID: number = model?.modelID || root?.modelID || 0;
  return { modelID, root };
}

export function disposeIfc(modelID: number): void {
  if (!ifcLoader) return;
  try {
    ifcLoader.ifc?.api?.DisposeModel?.(modelID);
  } catch {
    // ignore
  }
}
