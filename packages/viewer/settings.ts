import { floors, currentLevel, setActiveFloor, updateFloor } from "./levels";

function qs(id: string) {
  return document.getElementById(id);
}

const heightInput = document.getElementById("floorHeight") as HTMLInputElement;
const ghostInput = document.getElementById("ghostOpacity") as HTMLInputElement;
const hideInput = document.getElementById("hideGhost") as HTMLInputElement;
const levelBar = document.getElementById("levelBar") as HTMLDivElement;

function save() {
  localStorage.setItem("floors", JSON.stringify(floors));
}

function load() {
  const data = localStorage.getItem("floors");
  if (data) {
    try {
      const arr = JSON.parse(data) as typeof floors;
      arr.forEach((d, i) => {
        if (floors[i]) Object.assign(floors[i], d);
      });
    } catch (err) {
      console.warn("Failed to parse floors from localStorage", err);
    }
  }
}

function refreshInputs() {
  const cfg = floors[currentLevel];
  if (!cfg) return;
  heightInput.value = String(cfg.height);
  ghostInput.value = String(cfg.ghostOpacity);
  hideInput.checked = !cfg.showGhost;
}

function refreshButtons() {
  levelBar.querySelectorAll<HTMLButtonElement>("button[data-level]").forEach(b => {
    const i = parseInt(b.dataset.level || "0", 10) - 1;
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
    updateFloor(currentLevel, { ghostOpacity: parseFloat(ghostInput.value) || 0 });
    save();
  };
  hideInput.onchange = () => {
    updateFloor(currentLevel, { showGhost: !hideInput.checked });
    save();
  };

  levelBar.querySelectorAll<HTMLButtonElement>("button[data-level]").forEach(b => {
    b.onclick = () => {
      setActiveFloor(parseInt(b.dataset.level || "1", 10) - 1);
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

const settingsContainer = qs("settings") as HTMLElement | null;
const settingsOpen = qs("settingsOpen") as HTMLElement | null;
const settingsClosed = qs("settingsClosed") as HTMLElement | null;

const openButton = qs("openButton");
const closeButton = qs("closeButton");

openButton?.addEventListener("click", () => {
  if (!settingsContainer || !settingsOpen || !settingsClosed) return;
  settingsOpen.style.display = "block";
  settingsClosed.style.display = "none";
  settingsContainer.style.padding = "10px";
});

closeButton?.addEventListener("click", () => {
  if (!settingsContainer || !settingsOpen || !settingsClosed) return;
  settingsOpen.style.display = "none";
  settingsClosed.style.display = "block";
  settingsContainer.style.padding = "0px";
});
