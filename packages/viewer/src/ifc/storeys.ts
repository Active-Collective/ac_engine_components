import * as THREE from 'three';
import { byStorey } from './index';

export type StoreyInfo = { id: number; elevation: number; name: string };

let active: number | null = null;

export function setStoreys(map: typeof byStorey) {
  // placeholder: store incoming data
  active = null;
  for (const [id, data] of map) {
    if (active === null) active = id;
    // ensure set exists
    data.objects = data.objects || new Set<THREE.Object3D>();
  }
  dispatchEvent();
}

export function getActiveStorey() {
  return active;
}

export function activateStorey(id: number) {
  active = id;
  dispatchEvent();
}

function dispatchEvent() {
  const ev = new CustomEvent('storeychange', { detail: active });
  window.dispatchEvent(ev);
}
