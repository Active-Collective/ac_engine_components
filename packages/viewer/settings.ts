import { floors, currentLevel, setActiveFloor, updateFloor } from "./levels";

function qs(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

const heightInput = qs("floorHeight");
const ghostInput = qs("ghostOpacity");
const hideInput = qs("hideGhost");
const levelBar = document.getElementById("levelBar") as HTMLDivElement;

function save() {
  localStorage.setItem("floors", JSON.stringify(floors));
}

function load() {
  const data = localStorage.getItem("floors");
  if (data) {
    try {
      const arr = JSON.parse(data) as typeof floors;
      arr.forEach((d, i) => Object.assign(floors[i], d));
    } catch {}
  }
}

function refreshInputs() {
  const cfg = floors[currentLevel];
  heightInput.value = String(cfg.height);
  ghostInput.value = String(cfg.ghostOpacity);
  hideInput.checked = !cfg.showGhost;
}

function refreshButtons() {
  levelBar.querySelectorAll<HTMLButtonElement>("button[data-level]").forEach(b => {
    const i = parseInt(b.dataset.level!) - 1;
    b.classList.toggle("active", i === currentLevel);
  });
}

export function initSettings() {
  load();
  refreshInputs();
  refreshButtons();

  heightInput.oninput = () => {
    updateFloor(currentLevel, { height: parseFloat(heightInput.value) || 1 });
    refreshButtons();
    save();
  };
  ghostInput.oninput = () => {
    updateFloor(currentLevel, { ghostOpacity: parseFloat(ghostInput.value) });
    save();
  };
  hideInput.onchange = () => {
    updateFloor(currentLevel, { showGhost: !hideInput.checked });
    save();
  };

  levelBar.querySelectorAll<HTMLButtonElement>("button[data-level]").forEach(b => {
    b.onclick = () => {
      setActiveFloor(parseInt(b.dataset.level!) - 1);
      refreshButtons();
      refreshInputs();
      save();
    };
  });

  document.addEventListener("floorchange", () => {
    refreshButtons();
    refreshInputs();
  });
}
