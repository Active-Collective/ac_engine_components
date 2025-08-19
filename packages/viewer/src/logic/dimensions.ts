import * as THREE from "three";
import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";
import { IfcPropertiesUtils } from "@thatopen/components";

export interface Dimensions {
  width: number;
  depth: number;
  height: number;
  area?: number;
  volume?: number;
  source: "qto" | "box";
}

let cache = new WeakMap<THREE.Object3D, Dimensions>();
const logged = new WeakSet<THREE.Object3D>();

export async function getUnitDimensions(
  unitRoot: THREE.Object3D,
  _opts: { modelID?: number; expressID?: number } = {},
): Promise<Dimensions> {
  const cached = cache.get(unitRoot);
  if (cached) return cached;

  unitRoot.updateWorldMatrix(true, true);

  let width: number | undefined;
  let depth: number | undefined;
  let height: number | undefined;
  let area: number | undefined;
  let volume: number | undefined;
  let source: "qto" | "box" = "box";
  let hasBQ = false;
  let boxSize: THREE.Vector3 | undefined;

  const group = unitRoot as any as FRAGS.FragmentsGroup;

  try {
    const qsets = await group.getAllPropertiesOfType?.(
      WEBIFC.IFCELEMENTQUANTITY,
    );
    if (qsets) {
      for (const qset of Object.values(qsets) as any[]) {
        const qname = String(qset.Name?.value || "")
          .toLowerCase()
          .replace(/\s+/g, "");
        if (
          qname === "basequantities" ||
          qname.startsWith("qto_") ||
          qname.includes("basequant")
        ) {
          const ids = await IfcPropertiesUtils.getQsetQuantities(
            group,
            qset.expressID,
          );
          if (ids) {
            hasBQ = true;
            for (const id of ids) {
              const q = await group.getProperties(id);
              const name = String(q?.Name?.value || "").toLowerCase();
              const { value } = await IfcPropertiesUtils.getQuantityValue(
                group,
                id,
              );
              const num = Number(value);
              if (Number.isNaN(num)) continue;
              if (name === "width") width = num;
              else if (name === "length" || name === "depth") depth = num;
              else if (name === "height") height = num;
              else if (name.includes("area")) area = num;
              else if (name.includes("volume")) volume = num;
            }
          }
          break;
        }
      }
    }
  } catch {
    /* empty */
  }

  if (width !== undefined && depth !== undefined && height !== undefined)
    source = "qto";

  if (
    width === undefined ||
    depth === undefined ||
    height === undefined ||
    area === undefined ||
    volume === undefined
  ) {
    const box = new THREE.Box3().setFromObject(unitRoot);
    boxSize = box.getSize(new THREE.Vector3());
    width ??= boxSize.x;
    depth ??= boxSize.z;
    height ??= boxSize.y;
    area ??= width * depth;
    volume ??= width * depth * height;
    if (source !== "qto") source = "box";
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const result: Dimensions = {
    width: round(width ?? 0),
    depth: round(depth ?? 0),
    height: round(height ?? 0),
    source,
  };
  if (area !== undefined) result.area = round(area);
  if (volume !== undefined) result.volume = round(volume);
  cache.set(unitRoot, result);

  if (import.meta.env.DEV && !logged.has(unitRoot)) {
    console.info("[dims]", { box: boxSize, qtoFound: hasBQ, source });
    logged.add(unitRoot);
  }

  return result;
}

export function clearDimensionsCache(root?: THREE.Object3D): void {
  if (root) cache.delete(root);
  else cache = new WeakMap();
}
