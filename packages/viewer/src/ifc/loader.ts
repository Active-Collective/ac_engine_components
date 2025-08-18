import * as OBC from '@thatopen/components';
import * as THREE from 'three';

let ifcLoader: any;

export async function setupIfc(world: any) {
  const components = (world && (world.components || world._components)) || new OBC.Components();
  ifcLoader = components.get(OBC.IfcLoader as any);
  if (ifcLoader && ifcLoader.settings) {
    ifcLoader.settings.wasm = { path: '/wasm/', absolute: true };
    const wasmUrl = '/wasm/web-ifc.wasm';
    try {
      const res = await fetch(wasmUrl, { method: 'HEAD' });
      if (!res.ok) {
        console.warn(`web-ifc.wasm not found at ${wasmUrl}`);
      }
    } catch {
      console.warn(`Could not access ${wasmUrl}. Ensure the file exists and has the correct MIME type.`);
    }
  }
  if (ifcLoader && ifcLoader.setup) {
    await ifcLoader.setup();
  }
}

export async function loadIfc(urlOrFile: string | File): Promise<{ modelID: number; root: THREE.Object3D }> {
  if (!ifcLoader) throw new Error('IFC loader not initialized');
  try {
    let data: any = urlOrFile;
    if (typeof File !== 'undefined' && urlOrFile instanceof File) {
      const buffer = await urlOrFile.arrayBuffer();
      data = new Uint8Array(buffer);
    }
    const model: any = await ifcLoader.load(data as any);
    const root: any = model?.mesh || model?.root || model?.object || model;
    const modelID: number = model?.modelID || root?.modelID || 0;
    return { modelID, root };
  } catch (error: any) {
    const msg = String(error?.message || error);
    if (msg.includes('magic word')) {
      console.warn('Failed to initialize web-ifc WASM. Check that web-ifc.wasm is served from /public/wasm/ with application/wasm MIME type.');
    }
    throw error;
  }
}

export function disposeIfc(modelID: number): void {
  if (!ifcLoader) return;
  try {
    ifcLoader.ifc?.api?.DisposeModel?.(modelID);
  } catch {
    // ignore
  }
}
