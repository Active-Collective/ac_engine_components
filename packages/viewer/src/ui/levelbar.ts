/**
 * Levelbar UI: dynamic storey buttons.
 * Inputs: storey data, active storey.
 * Outputs: UI updates, storey selection.
 */
import { floors, currentLevel, setActiveFloor } from '../../levels';

export function renderLevelbar(container: HTMLElement) {
  container.innerHTML = '';
  floors.forEach((floor, i) => {
    const btn = document.createElement('button');
    btn.textContent = `Storey ${i + 1}`;
    btn.className = i === currentLevel ? 'active' : '';
    btn.onclick = () => {
      setActiveFloor(i);
      renderLevelbar(container);
    };
    container.appendChild(btn);
  });
}
