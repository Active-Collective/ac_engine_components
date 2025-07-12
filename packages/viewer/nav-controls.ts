import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { SimpleCamera } from '@thatopen/components';

const views = {
  iso: new THREE.Vector3(1, 1, 1),
  top: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  back: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(-1, 0, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};

let camera: SimpleCamera;
let getBounds: () => THREE.Box3;

function updateAction(active: 'orbit' | 'pan') {
  const bar = document.getElementById('navBar') as HTMLElement;
  const orbitBtn = bar.querySelector<HTMLButtonElement>('button[data-action="orbit"]')!;
  const panBtn = bar.querySelector<HTMLButtonElement>('button[data-action="pan"]')!;
  orbitBtn.classList.toggle('active', active === 'orbit');
  panBtn.classList.toggle('active', active === 'pan');
  camera.controls.mouseButtons.left =
    active === 'orbit' ? CameraControls.ACTION.ROTATE : CameraControls.ACTION.TRUCK;
}

export function goView(name: keyof typeof views) {
  const dir = views[name].clone().normalize();
  const box = getBounds();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const pos = center.clone().addScaledVector(dir, size);
  camera.controls.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, true);
  document
    .querySelectorAll<HTMLButtonElement>('#navBar button[data-view]')
    .forEach(b => b.classList.toggle('active', b.dataset.view === name));
}

export function handleAction(action: 'orbit' | 'pan' | 'zoomExt') {
  if (action === 'zoomExt') {
    camera.controls.fitToBox(getBounds(), true);
    return;
  }
  updateAction(action);
}

export function initNavControls(cam: SimpleCamera, boundsGetter: () => THREE.Box3) {
  camera = cam;
  getBounds = boundsGetter;
  updateAction('orbit');
  const help = document.getElementById('navHelp') as HTMLElement;
  const viewMenu = document.getElementById('viewMenu') as HTMLElement;
  const bar = document.getElementById('navBar')!;
  bar.addEventListener('click', ev => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) { viewMenu.classList.remove('show'); return; }
    if (btn.dataset.view) { goView(btn.dataset.view as keyof typeof views); viewMenu.classList.remove('show'); }
    if (btn.dataset.action) handleAction(btn.dataset.action as any);
    if (btn.id === 'helpBtn') help.classList.toggle('show');
    if (btn.id === 'camBtn') viewMenu.classList.toggle('show');
  });
  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey) {
      const idx = parseInt(ev.key);
      if (idx >= 1 && idx <= 7) {
        const list = ['iso', 'top', 'front', 'right', 'back', 'left', 'bottom'];
        goView(list[idx - 1] as keyof typeof views);
        ev.preventDefault();
        return;
      }
    }
    if (ev.key === 'o' || ev.key === 'O') {
      handleAction('orbit');
    } else if (ev.key === 'f' || ev.key === 'F') {
      handleAction('zoomExt');
    }
  });
}
