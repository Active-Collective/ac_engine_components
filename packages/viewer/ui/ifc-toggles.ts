import type { ParamGroups, Label } from '../ifc/parameter-visibility';

export function mountIfcToggles(groups: ParamGroups) {
  const labels = groups.labels;
  const active = labels.some(l => (groups.map.get(l)?.size ?? 0) > 0);
  const existing = document.getElementById('ifcParamPanel');
  existing?.remove();


  const panel = document.createElement('div');
  panel.id = 'ifcParamPanel';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '10px',
    left: '10px',
    zIndex: '20',
    background: 'rgba(255,255,255,0.9)',
    border: '1px solid #ccc',
    padding: '4px',
    display: 'flex',
    gap: '4px',
  });

  const state: Record<Label, boolean> = { AA: true, BB: true, CC: true, DD: true };
  
  if (!active) {
    const msg = document.createElement('div');
    msg.textContent = 'Geen parameters gevonden';
    msg.style.fontSize = '12px';
    panel.appendChild(msg);
  }


  labels.forEach(label => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.padding = '2px 6px';
    const set = groups.map.get(label);
    if (!set || set.size === 0) {
      btn.disabled = true;
      btn.title = 'No elements';
    }
    btn.addEventListener('click', () => {
      state[label] = !state[label];
      groups.toggle(label, state[label]);
      btn.style.opacity = state[label] ? '1' : '0.5';
    });
    panel.appendChild(btn);
  });

  document.body.appendChild(panel);
}

