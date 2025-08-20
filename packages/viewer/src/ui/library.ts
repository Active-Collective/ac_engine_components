/**
 * Library panel: Bouw units → Bibliotheek, file picker, read-only info.
 * Inputs: IFC file metadata, cached dimensions.
 * Outputs: UI updates, preview thumbnails.
 */

export interface LibraryUnitMeta {
  file: string;
  dims?: {
    width: number;
    depth: number;
    height: number;
    area?: number;
    volume?: number;
    source: "qto" | "box";
  };
}

export function renderLibraryPanel(container: HTMLElement, units: LibraryUnitMeta[]) {
  container.innerHTML = '';
  units.forEach(unit => {
    const item = document.createElement('div');
    item.className = 'library-unit';
    item.textContent = unit.file;
    // Optionally show dimensions if available
    if (unit.dims) {
      const dims = document.createElement('span');
      dims.className = 'unit-dims';
      dims.textContent = `(${unit.dims.width} x ${unit.dims.depth} x ${unit.dims.height})`;
      item.appendChild(dims);
    }
    container.appendChild(item);
  });
}
// Add file picker logic here if needed
