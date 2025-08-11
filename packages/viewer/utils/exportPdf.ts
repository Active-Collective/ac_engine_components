// src/utils/exportPdf.ts
import jsPDF from "jspdf";
import * as THREE from "three";
import { world, layoutMap } from "../index";
import { floors, grids, unitsByLevel } from "../levels";

// Alleen grid van floor 0 zichtbaar tijdens een taak
async function withOnlyFloor0Grid<T>(fn: () => Promise<T> | T): Promise<T> {
  const vis = grids.map(g => g.three.visible);
  grids.forEach((g, i) => (g.three.visible = i === 0));
  try {
    return await fn();
  } finally {
    grids.forEach((g, i) => (g.three.visible = vis[i]));
  }
}

// Verberg BoxHelpers en TransformControls tijdelijk (visibility flip)
async function withOverlaysHidden<T>(fn: () => Promise<T> | T): Promise<T> {
  const scene = world.scene.three;
  const toggled: Array<{ obj: THREE.Object3D; prev: boolean }> = [];
  scene.traverse(o => {
    const isBoxHelper = (o as any).isBoxHelper || o.type === "BoxHelper";
    const isTC = (o as any).isTransformControls === true || o.type === "TransformControls";
    const isNudge = !!(o as any).userData?.normal; // jouw dikke pijlen
    if (isBoxHelper || isTC || isNudge) {
      toggled.push({ obj: o, prev: o.visible });
      o.visible = false;
    }
  });
  try {
    return await fn();
  } finally {
    toggled.forEach(t => (t.obj.visible = t.prev));
  }
}

// Bounding box over alléén geplaatste units (alle verdiepingen)
function computeUnitsBounds(): THREE.Box3 {
  const scene = world.scene.three;
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3();
  let hasAny = false;

  for (const arr of unitsByLevel) {
    for (const obj of arr) {
      const b = new THREE.Box3().setFromObject(obj);
      if (!isFinite(b.min.x) || !isFinite(b.max.x)) continue;
      hasAny ? box.union(b) : box.copy(b);
      hasAny = true;
    }
  }
  if (!hasAny) box.setFromObject(scene);
  return box;
}

// True als er op enig level horizontale (XZ) overlap is
function anyOverlap(): boolean {
  world.scene.three.updateMatrixWorld(true);
  const H = floors[0]?.height ?? 1;

  // verzamel alle units
  const entries: Array<{
    obj: THREE.Object3D; level: number;
    minX: number; maxX: number; minZ: number; maxZ: number;
  }> = [];

  for (const arr of unitsByLevel) {
    for (const obj of arr) {
      const b = new THREE.Box3().setFromObject(obj);
      const level = (obj.userData.level ?? Math.round(obj.position.y / H)) as number;
      entries.push({
        obj,
        level,
        minX: b.min.x, maxX: b.max.x,
        minZ: b.min.z, maxZ: b.max.z
      });
    }
  }

  const eps = 1e-9;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.level !== b.level) continue;
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > eps;
      const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > eps;
      if (overlapX && overlapZ) return true;
    }
  }
  return false;
}

/**
 * Exporteert de huidige configuratie naar een PDF met:
 * - Isometrische en top-down views
 * - Lijst van geplaatste units met aantallen per type
 */
export async function exportToPdf() {
  // 0) Waarschuwen bij overlap
  if (anyOverlap()) {
    const proceed = window.confirm("Er zijn overlappende units. Toch exporteren?");
    if (!proceed) return;
  }

  // 1) Render met overlays verborgen en alleen floor 0 grid zichtbaar
  const { isoDataUrl, topDataUrl } = await withOverlaysHidden(async () =>
    withOnlyFloor0Grid(async () => {
      const isoDataUrl = await renderOffscreen("iso");
      const topDataUrl = await renderOffscreen("top");
      return { isoDataUrl, topDataUrl };
    })
  );

  // 2) PDF opbouwen
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;

  doc.setFontSize(18);
  doc.text("Unit Configurator Export", margin, y);
  y += 30;

  doc.addImage(isoDataUrl, "PNG", margin, y, 200, 150);
  doc.addImage(topDataUrl, "PNG", margin + 220, y, 200, 150);
  y += 160;

  doc.setFontSize(14);
  doc.text("Geplaatste Units:", margin, y);
  y += 20;

  const counts = new Map<string, number>();
  layoutMap.forEach(item => {
    const name = item.url.split("/").pop()!;
    counts.set(name, (counts.get(name) || 0) + 1);
  });

  doc.setFontSize(12);
  counts.forEach((count, name) => {
    doc.text(`- ${name} (${count}x)`, margin, y);
    y += 16;
    if (y > 800) { doc.addPage(); y = margin; }
  });

  doc.save("configuratie.pdf");
}

/**
 * Render offscreen een zicht vanuit specified view:
 * 'iso' of 'top'.
 */
function renderOffscreen(view: "iso" | "top"): Promise<string> {
  // Off-screen renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const size = { width: 400, height: 300 };
  renderer.setSize(size.width, size.height);

  const scene   = world.scene.three;
  const box     = computeUnitsBounds();
  const center  = box.getCenter(new THREE.Vector3());
  const sizeVec = box.getSize(new THREE.Vector3());
  const radius  = sizeVec.length() / 2;

  let camera: THREE.Camera;

  if (view === "iso") {
    // Orthografisch, 20% dichterbij
    const aspect = size.width / size.height;
    const base = radius * 1.5;
    const d = base * 0.8; // dichterbij
    const cam = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, radius * 10);
    const dir = new THREE.Vector3(1, 1, 1).normalize();
    cam.position.copy(center.clone().add(dir.multiplyScalar(d)));
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    camera = cam;
  } else {
    // Top-down, 20% verder weg
    const cam = new THREE.PerspectiveCamera(45, size.width / size.height, 0.1, radius * 10);
    const height = radius * 2 * 1.2;
    cam.position.set(center.x, center.y + height, center.z);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    camera = cam;
  }

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return Promise.resolve(dataUrl);
}
