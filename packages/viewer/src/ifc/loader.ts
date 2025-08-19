import * as OBC from '@thatopen/components';
import * as THREE from 'three';
import { toUint8Array } from './bytes';

export const ifcCache = new Map<
  string,
  { bytes: Uint8Array; parsed?: { modelID: number; root: THREE.Object3D } }
>();

let components: OBC.Components | null = null;
let ifcLoader: any;

export async function setupIfc(world?: any) {
  if (ifcLoader) {
    console.warn('[IFC] setup called more than once; reusing existing loader');
    return ifcLoader;
  }
  components = (world && (world.components || world._components)) || new OBC.Components();
  ifcLoader = components.get(OBC.IfcLoader as any);
  if (ifcLoader?.settings) {
    ifcLoader.settings.wasm = { path: '/wasm/', absolute: true };
  }
  if (ifcLoader?.setup) await ifcLoader.setup();
  console.log('[IFC] setup wasm path: /wasm/');
  return ifcLoader;
}

export async function loadIfc(
  source: string | File | Uint8Array,
): Promise<{ modelID: number; root: THREE.Object3D }> {
  if (!ifcLoader) throw new Error('IFC loader not initialized');

  if (typeof source === 'string') {
    const url = source;
    const cached = ifcCache.get(url);
    if (cached?.parsed) {
      const { modelID, root } = cached.parsed;
      const clone =
        typeof (root as any).cloneGroup === 'function'
          ? (root as any).cloneGroup()
          : root.clone(true);
      (clone as any).modelID = modelID;
      return { modelID, root: clone };
    }
    const bytes = cached?.bytes || (await loadIfcBytes(url));
    try {
      const model: any = await ifcLoader.load(bytes.slice() as any);
      const base: any = model?.mesh || model?.root || model?.object || model;
      const modelID: number = model?.modelID || base?.modelID || 0;
      ifcCache.set(url, { bytes, parsed: { modelID, root: base } });
      const root =
        typeof (base as any).cloneGroup === 'function'
          ? (base as any).cloneGroup()
          : base.clone(true);
      (root as any).modelID = modelID;
      return { modelID, root };
    } catch (error: any) {
      console.error(`[IFC] load error ${url}`, error);
      throw error;
    }
  }

  const bytes = await toUint8Array(source);
  const name = source instanceof File ? source.name : 'bytes';
  const type = source instanceof Uint8Array ? 'bytes' : 'file';
  console.log(`[IFC] loading ${name} (${type})`);
  try {
    const model: any = await ifcLoader.load(bytes.slice() as any);
    const root: any = model?.mesh || model?.root || model?.object || model;
    const modelID: number = model?.modelID || root?.modelID || 0;
    console.log(`[IFC] loaded ${name} bytes=${bytes.byteLength}`);
    return { modelID, root };
  } catch (error: any) {
    console.error(`[IFC] load error ${name}`, error);
    const msg = String(error?.message || error);
    if (msg.includes('magic word')) {
      console.warn(
        '[IFC] failed to initialize web-ifc WASM. Check that web-ifc.wasm is served from /public/wasm/ with application/wasm MIME type.',
      );
    }
    throw error;
  }
}

export async function loadIfcBytes(url: string): Promise<Uint8Array> {
  const cached = ifcCache.get(url);
  if (cached?.bytes) return cached.bytes;
  console.log(`[IFC] streaming ${url}`);
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  ifcCache.set(url, { bytes });
  return bytes;
}

export function disposeIfc(modelID: number): void {
  if (!ifcLoader) return;
  try {
    ifcLoader.ifc?.api?.DisposeModel?.(modelID);
  } catch {
    // ignore
  }
}
