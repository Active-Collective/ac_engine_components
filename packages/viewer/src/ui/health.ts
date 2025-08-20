const stages: Record<string, boolean> = {
  entry: false,
  bootstrap: false,
  renderer: false,
  wasm: false,
  ifc: false,
  storeys: false,
};

let el: HTMLDivElement | null = null;

function render() {
  if (!el) return;
  el.innerHTML = Object.entries(stages)
    .map(([k, v]) => `${k}: <span style="color:${v ? 'lime' : '#f55'}">${v ? '✔' : '✖'}</span>`)
    .join('<br>');
}

export function initHealthOverlay(): void {
  el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    padding: '4px',
    fontSize: '12px',
    fontFamily: 'monospace',
    background: '#0008',
    color: '#fff',
    zIndex: '9999',
  });
  document.body.appendChild(el);
  render();
}

export function setStage(stage: keyof typeof stages, ok: boolean): void {
  stages[stage] = ok;
  render();
}
