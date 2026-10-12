"use strict";

const romInput = document.querySelector("#rom-file");
const dropZone = document.querySelector("#drop-zone");
const canvas = document.querySelector("#game-canvas");
const context = canvas.getContext("2d");
const placeholder = document.querySelector("#screen-placeholder");
const statusMessage = document.querySelector("#status-message");
const gameName = document.querySelector("#game-name");
const screenCaption = document.querySelector("#screen-caption");
const restartButton = document.querySelector("#restart-button");
const pauseButton = document.querySelector("#pause-button");
const resetButton = document.querySelector("#reset-button");
const soundButton = document.querySelector("#sound-button");
const player = document.querySelector(".player-column");
const fullscreenButton = document.querySelector("#fullscreen-button");
const fullscreenStatus = document.querySelector("#fullscreen-status");
const volumeInput = document.querySelector("#volume");
const volumeValue = document.querySelector("#volume-value");
const cameraPanel = document.querySelector("#camera-panel");
const cameraVideo = document.querySelector("#camera-video");
const cameraButton = document.querySelector("#camera-button");
const cameraStatus = document.querySelector("#camera-status");
const cameraCaptureContext = document.querySelector("#camera-capture")
  .getContext("2d", { willReadFrequently: true });
const printerPanel = document.querySelector("#printer-panel");
const printerOutput = document.querySelector("#printer-output");
const printerPaperWindow = document.querySelector("#printer-paper-window");
const printerPaper = document.querySelector("#printer-paper");
const printerPaperContext = printerPaper.getContext("2d");
const printerStatus = document.querySelector("#printer-status");
const printerCloseButton = document.querySelector("#printer-close");
const keyAction = document.querySelector("#key-action");
const bindKeyButton = document.querySelector("#bind-key");
const keyStatus = document.querySelector("#key-status");
const preferencesStatus = document.querySelector("#preferences-status");
const gamepadStatus = document.querySelector("#gamepad-status");
const fpsToggle = document.querySelector("#show-fps");
const fpsStatus = document.querySelector("#fps-status");
const themeSelect = document.querySelector("#theme-select");
const themeColor = document.querySelector('meta[name="theme-color"]');
const speedInput = document.querySelector("#playback-speed");
const comfortStatus = document.querySelector("#comfort-status");
let playbackSpeed = 1;
const graphicsInspector = document.querySelector("#graphics-inspector");
const graphicsStatus = document.querySelector("#graphics-status");
let graphicsTime = -Infinity;
let graphicsGame = null;
let graphicsFailed = false;
const sceneCanvas = document.querySelector("#scene-canvas");
const sceneResolution = document.querySelector("#scene-resolution");
const sceneFilter = document.querySelector("#scene-filter");
let scene2DFilter = null;
const sceneCanvasBaseWidth = sceneCanvas.width || 640;
const sceneCanvasBaseHeight = sceneCanvas.height || 576;
const sceneStatus = document.querySelector("#scene-status");
const renderMode = document.querySelector("#render-mode");
let sceneRenderer = null;
let sceneGame = null;
let scenePreset = null;
let sceneTime = -Infinity;
let sceneCamera = { yaw: -18, pitch: 10, zoom: 0.9, thickness: 4, light: 0.75 };
const archivePicker = document.querySelector("#archive-picker");
const archiveSelect = document.querySelector("#archive-rom");
const archiveOpen = document.querySelector("#archive-open");
const saveButton = document.querySelector("#save-button");
const exportButton = document.querySelector("#export-save");
const importButton = document.querySelector("#import-save");
const saveInput = document.querySelector("#save-file");
const saveStatus = document.querySelector("#save-status");
const saveStore = new PocketSaves.SaveStore();
const reloadSaveButton = document.querySelector("#reload-save");
const recoverSaveButton = document.querySelector("#recover-save");
const saveStateButton = document.querySelector("#save-state");
const loadStateButton = document.querySelector("#load-state");
const quickSaveButton = document.querySelector("#quick-save");
const quickLoadButton = document.querySelector("#quick-load");
const exportStateButton = document.querySelector("#export-state");
const importStateButton = document.querySelector("#import-state");
const stateInput = document.querySelector("#state-file");
const stateStatus = document.querySelector("#state-status");
const stateSlot = document.querySelector("#state-slot");
const stateName = document.querySelector("#state-name");
const statePreview = document.querySelector("#state-preview");
const stateInfo = document.querySelector("#state-info");
const ramHistory = document.querySelector("#ram-history");
const restoreHistoryButton = document.querySelector("#restore-history");
const clock = 4194304;
const defaultKeys = [
  ["ArrowRight", 0], ["ArrowLeft", 1], ["ArrowUp", 2], ["ArrowDown", 3],
  // Physical Q/W positions are labelled A/Z on AZERTY keyboards.
  ["KeyQ", 4], ["KeyW", 5], ["ShiftLeft", 6], ["ShiftRight", 6], ["Enter", 7],
  ["KeyE", 8], ["KeyR", 9],
];
const keys = new Map(defaultKeys);

let emulator = null;
let loadedBytes = null;
let loadedName = "";
let archive = null;
let loadVersion = 0;
let animation = 0;
let previousTime = null;
let cycleDebt = 0;
let paused = false;
let audioContext = null;
let audioGain = null;
let cameraStream = null;
let printerAnimation = 0;
let printerRenderVersion = 0;
let printerPanelDismissed = false;
const printerDevice = new PocketGameBoyPrinter({ onPrint: showPrinterJob, onStatus: updatePrinterStatus });
let volume = 0.7;
let bindingAction = null;
let inputFocused = true;
let slotReadVersion = 0;
let historyCopies = [];
let fpsTime = null;
let fpsFrames = 0;
let emulationTime = 0;
let frameSamples = 0;
let limitedFrames = 0;
let nextAudioTime = 0;
let saveSession = null;
let gameTransition = Promise.resolve();
let transitioning = false;
let importing = false;
let gameKey = null;
let stateMode = false;
let immersiveFallback = false;
let fullscreenBusy = false;
let fullscreenIdleTimer = 0;
let gamepadError = "";
const themes = ["system", "light", "dark"];
let theme = "system";
const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function applyTheme() {
  const dark = theme === "dark" || (theme === "system" && Boolean(darkQuery?.matches));
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeColor.content = dark ? "#0e1511" : "#f4f5ed";
}
darkQuery?.addEventListener("change", () => {
  if (theme === "system") applyTheme();
});
const audioSources = new Set();
const heldKeys = new Set();
const heldPointers = new Map();
const heldGamepad = new Set();

function preferenceError(error) {
  preferencesStatus.hidden = false;
  preferencesStatus.classList.add("is-error");
  preferencesStatus.textContent = `Réglages non conservés : ${error.message}`;
  showFullscreenMessage(preferencesStatus.textContent, true);
  console.error(error);
}
function keyboardSummary() {
  const names = ["Droite", "Gauche", "Haut", "Bas", "A", "B", "Select", "Start", "L (GBA)", "R (GBA)"];
  keyStatus.textContent = names.map((name, index) =>
    `${name} : ${[...keys].filter(([, value]) => value === index).map(([code]) => code).join("/")}`).join(" · ");
}
function persistPreferences() {
  try {
    window.localStorage.setItem("v3ry-pocket-color-preferences", JSON.stringify({
      version: 3, keys: [...keys], volume, fps: fpsToggle.checked, theme,
    }));
    preferencesStatus.hidden = true;
  } catch (error) { preferenceError(error); }
}
function validKey(code) {
  return typeof code === "string" && /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Shift(Left|Right)|Space|Enter|Backspace|Tab|Numpad[0-9])$/.test(code)
    && code !== "KeyF";
}
try {
  const stored = window.localStorage.getItem("v3ry-pocket-color-preferences");
  if (stored) {
    const data = JSON.parse(stored);
    const actions = data.version === 1 ? 8 : 10;
    const storedTheme = data.version === 3 ? data.theme : "system";
    if (![1, 2, 3].includes(data.version) || !Array.isArray(data.keys) || data.keys.length < actions
      || !themes.includes(storedTheme)
      || data.keys.length > (data.version === 1 ? 16 : 20)
      || data.keys.some(entry => !Array.isArray(entry) || entry.length !== 2 || !validKey(entry[0])
        || !Number.isInteger(entry[1]) || entry[1] < 0 || entry[1] >= actions)
      || new Set(data.keys.map(entry => entry[0])).size !== data.keys.length
      || new Set(data.keys.map(entry => entry[1])).size !== actions
      || !Number.isFinite(data.volume) || data.volume < 0 || data.volume > 1 || typeof data.fps !== "boolean") {
      throw new Error("Format de préférences invalide ; réglages par défaut utilisés.");
    }
    keys.clear();
    for (const [code, index] of data.keys) keys.set(code, index);
    if (data.version === 1) {
      const candidates = ["KeyE", "KeyR", "KeyT", "KeyY", ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
        ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`)];
      for (const index of [8, 9]) keys.set(candidates.find(code => !keys.has(code)), index);
    }
    volume = data.volume;
    fpsToggle.checked = data.fps;
    theme = storedTheme;
  }
} catch (error) { preferenceError(error); }
volumeInput.value = String(Math.round(volume * 100));
volumeValue.textContent = `${volumeInput.value} %`;
keyboardSummary();
fpsStatus.hidden = !fpsToggle.checked;
themeSelect.value = theme;
applyTheme();
themeSelect.addEventListener("change", () => {
  theme = themeSelect.value;
  applyTheme();
  persistPreferences();
});
volumeInput.addEventListener("input", () => {
  volume = Number(volumeInput.value) / 100;
  volumeValue.textContent = `${volumeInput.value} %`;
  if (audioGain) audioGain.gain.setValueAtTime(volume, audioContext.currentTime);
  persistPreferences();
});
fpsToggle.addEventListener("change", () => {
  fpsStatus.hidden = !fpsToggle.checked;
  fpsTime = null;
  persistPreferences();
});
bindKeyButton.addEventListener("click", () => {
  bindingAction = Number(keyAction.value);
  releaseControls();
  keyStatus.textContent = "Appuyez sur une touche (position physique). Échap annule ; F, F6 et F8 sont réservées.";
});
document.querySelector("#reset-keys").addEventListener("click", () => {
  bindingAction = null;
  releaseControls();
  keys.clear();
  for (const [code, index] of defaultKeys) keys.set(code, index);
  keyboardSummary();
  persistPreferences();
});

function pollGamepads() {
  const pressed = new Set();
  try {
    const supported = typeof navigator.getGamepads === "function";
    const pads = supported ? [...navigator.getGamepads()].filter(Boolean) : [];
    const standard = pads.filter(pad => pad.connected && pad.mapping === "standard");
    const message = !supported ? "API manette indisponible dans ce navigateur. Utilisez le clavier ou les commandes tactiles."
      : standard.length ? `Manette standard connectée : croix/stick gauche, A/B, Select/Start${isGBA() ? ", L/R" : ""}.`
      : pads.length ? "Manette non standard : disposition non prise en charge. Utilisez le clavier."
        : "Manette : connectez une manette standard et appuyez sur un bouton.";
    if (gamepadStatus.textContent !== message) gamepadStatus.textContent = message;
    gamepadStatus.classList.remove("is-error");
    gamepadError = "";
    if (emulator && !paused && !transitioning && !importing && bindingAction === null
      && inputFocused && !document.hidden && !document.activeElement?.closest("input, select, textarea, [contenteditable]")) {
      for (const pad of standard) {
        const down = index => !!pad.buttons[index]?.pressed;
        for (const [button, index] of [[15, 0], [14, 1], [12, 2], [13, 3], [0, 4], [1, 5], [8, 6], [9, 7], [4, 8], [5, 9]]) {
          if (down(button)) pressed.add(index);
        }
        if (pad.axes[0] > 0.35) pressed.add(0);
        if (pad.axes[0] < -0.35) pressed.add(1);
        if (pad.axes[1] < -0.35) pressed.add(2);
        if (pad.axes[1] > 0.35) pressed.add(3);
      }
    }
  } catch (error) {
    const message = `Manette indisponible : ${error.message}`;
    if (gamepadStatus.textContent !== message) gamepadStatus.textContent = message;
    gamepadStatus.classList.add("is-error");
    if (gamepadError !== message) console.error(error);
    gamepadError = message;
  }
  const changed = [...new Set([...heldGamepad, ...pressed])]
    .filter(index => heldGamepad.has(index) !== pressed.has(index));
  heldGamepad.clear();
  for (const index of pressed) heldGamepad.add(index);
  for (const index of changed) updateButton(index);
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
  if (isError) showFullscreenMessage(message, true);
}

function updateFullscreen() {
  const active = document.fullscreenElement === player || immersiveFallback;
  player.classList.toggle("is-immersive", active);
  document.body.classList.toggle("is-immersive", active);
  fullscreenButton.textContent = active ? "Quitter le plein écran" : "Plein écran";
  fullscreenButton.setAttribute("aria-pressed", String(active));
  fullscreenStatus.hidden = !active && !fullscreenStatus.classList.contains("is-error");
  releaseControls();
  canvas.focus();
  showFullscreenControls();
}

function showFullscreenControls() {
  window.clearTimeout(fullscreenIdleTimer);
  player.classList.remove("controls-idle");
  if (player.classList.contains("is-immersive") && window.matchMedia?.("(pointer: fine)").matches) {
    fullscreenIdleTimer = window.setTimeout(() => {
      player.classList.add("controls-idle");
    }, 2500);
  }
}
player.addEventListener("pointermove", showFullscreenControls);
player.addEventListener("focusin", showFullscreenControls);
player.addEventListener("pointerdown", showFullscreenControls);
quickSaveButton.addEventListener("click", () => saveStateButton.click());
quickLoadButton.addEventListener("click", () => loadStateButton.click());

async function toggleFullscreen() {
  if (fullscreenBusy) return;
  fullscreenBusy = true;
  fullscreenButton.disabled = true;
  try {
    if (document.fullscreenElement === player) {
      await document.exitFullscreen();
    } else if (immersiveFallback) {
      immersiveFallback = false;
    } else {
      fullscreenStatus.classList.remove("is-error");
      fullscreenStatus.textContent = "F ou Échap pour quitter le plein écran.";
      if (player.requestFullscreen && document.fullscreenEnabled) {
        try {
          await player.requestFullscreen();
        } catch (error) {
          console.error(error);
          immersiveFallback = true;
          fullscreenStatus.textContent = `Plein écran indisponible : ${error.message}. Mode immersif actif ; F ou Échap pour quitter.`;
        }
      } else {
        immersiveFallback = true;
        fullscreenStatus.textContent = "Plein écran non disponible dans ce navigateur. Mode immersif actif ; F ou Échap pour quitter.";
      }
    }
    updateFullscreen();
  } catch (error) {
    fullscreenStatus.hidden = false;
    fullscreenStatus.classList.add("is-error");
    fullscreenStatus.textContent = `Plein écran impossible : ${error.message}`;
    console.error(error);
  } finally {
    fullscreenBusy = false;
    fullscreenButton.disabled = false;
  }
}
fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreen);

function setSaveStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("is-error", isError);
  if (isError) showFullscreenMessage(message, true);
}

function setStateStatus(message, isError = false) {
  stateStatus.textContent = message;
  stateStatus.classList.toggle("is-error", isError);
  showFullscreenMessage(message, isError);
}

function showFullscreenMessage(message, isError) {
  if (!player.classList.contains("is-immersive")) return;
  fullscreenStatus.hidden = false;
  fullscreenStatus.textContent = message;
  fullscreenStatus.classList.toggle("is-error", isError);
  showFullscreenControls();
}

function updateSaveButtons() {
  const busy = transitioning || importing;
  saveButton.disabled = busy || !saveSession;
  exportButton.disabled = importButton.disabled = busy || !emulator?.cartridge.ram.length;
  reloadSaveButton.disabled = recoverSaveButton.disabled = busy || !saveSession;
  for (const button of [saveStateButton, loadStateButton, exportStateButton, importStateButton]) {
    button.disabled = busy || !emulator || !gameKey;
  }
  restoreHistoryButton.disabled = busy || !saveSession || !ramHistory.value;
  stateSlot.disabled = stateName.disabled = busy || !emulator;
  quickSaveButton.disabled = quickLoadButton.disabled = busy || !emulator || !gameKey;
}

async function saveCurrent(notify = false) {
  const session = saveSession;
  if (!session || transitioning || importing) return;
  if (stateMode) {
    if (notify === true) setSaveStatus("État chargé : sauvegarde in-game protégée. Exportez un .sav ou redémarrez pour retrouver la sauvegarde in-game.");
    return;
  }
  try {
    const written = await session.flush();
    if (written && session === saveSession && session.lastWriteKind === "ram") await refreshHistory();
    if (session === saveSession && ((written && session.lastWriteKind === "ram") || notify === true)) {
      setSaveStatus(session.dirty ? "Sauvegarde enregistrée ; dernières modifications en attente."
        : written && session.lastWriteKind === "ram" ? "RAM in-game enregistrée localement (cela ne valide pas la sauvegarde dans le jeu)."
          : "RAM in-game à jour ; horloge conservée.");
    }
  } catch (error) {
    if (session === saveSession) setSaveStatus(`Sauvegarde impossible : ${error.message} Exportez un .sav pour conserver la RAM.`, true);
    console.error(error);
  }
}

function stopAudio() {
  for (const source of audioSources) source.stop();
  audioSources.clear();
  emulator?.apu?.drain?.();
  nextAudioTime = 0;
}

function releaseControls() {
  heldKeys.clear();
  heldPointers.clear();
  heldGamepad.clear();
  emulator?.releaseButtons();
}

function stopLoop() {
  cancelAnimationFrame(animation);
  animation = 0;
  previousTime = null;
  cycleDebt = 0;
  fpsTime = null;
  stopAudio();
  releaseControls();
}

function outputAudio() {
  const samples = emulator?.apu?.drain?.();
  if (!samples) return;
  if (playbackSpeed !== 1 || !audioContext || audioContext.state !== "running" || !samples.length) return;
  const length = samples.length / 2;
  const buffer = audioContext.createBuffer(2, length, emulator.apu.sampleRate);
  for (let side = 0; side < 2; side++) {
    const channel = buffer.getChannelData(side);
    for (let i = 0; i < length; i++) channel[i] = samples[i * 2 + side];
  }
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioGain);
  if (nextAudioTime < audioContext.currentTime || nextAudioTime > audioContext.currentTime + 0.2) {
    nextAudioTime = audioContext.currentTime + 0.035;
  }
  source.start(nextAudioTime);
  nextAudioTime += buffer.duration;
  audioSources.add(source);
  source.onended = () => { audioSources.delete(source); source.disconnect(); };
}

function comfortMessage(message, error = false) {
  comfortStatus.textContent = message;
  comfortStatus.classList.toggle("is-error", error);
  if (error) showFullscreenMessage(message, true);
}
speedInput.addEventListener("change", () => {
  const speed = Number(speedInput.value);
  if (![1, 2, 4].includes(speed)) {
    speedInput.value = String(playbackSpeed);
    comfortMessage("Vitesse invalide : choisissez ×1, ×2 ou ×4.", true);
    return;
  }
  playbackSpeed = speed;
  cycleDebt = 0;
  previousTime = null;
  fpsTime = null;
  stopAudio();
  comfortMessage(speed === 1 ? "Vitesse normale. Son rétabli s’il est activé."
    : `Avance rapide ×${speed} : son temporairement coupé. La vitesse réelle dépend de votre appareil.`);
});
document.querySelector("#capture-screen").addEventListener("click", async () => {
  if (!emulator || transitioning || importing) {
    comfortMessage("Capture indisponible : chargez un jeu et attendez la fin du chargement.", true);
    return;
  }
  try {
    const name = loadedName.split(/[\\/]/).pop().replace(/\.(gb|gbc|gba)$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    context.putImageData(new ImageData(emulator.framePixels || emulator.pixels, canvas.width, canvas.height), 0, 0);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result =>
      result ? resolve(result) : reject(new Error("Le navigateur n’a pas produit de PNG.")), "image/png"));
    downloadFile(blob, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    comfortMessage(`Capture PNG ${canvas.width} × ${canvas.height} téléchargée, sans pause ni modification de la partie.`);
  } catch (error) {
    comfortMessage(`Capture impossible : ${error.message}`, true);
    console.error(error);
  }
});

function updateGraphics(force = false) {
  if (isGBA()) return;
  if (!graphicsInspector.open || player.classList.contains("is-immersive")) return;
  if (!emulator) {
    graphicsStatus.textContent = "Chargez une ROM pour examiner sa mémoire vidéo.";
    return;
  }
  const now = performance.now();
  const changed = graphicsGame !== emulator;
  if (!force && !changed && (graphicsFailed || !document.querySelector("#graphics-live").checked || now - graphicsTime < 200)) return;
  graphicsGame = emulator;
  graphicsTime = now;
  try {
    const bank = document.querySelector("#graphics-bank");
    const palette = document.querySelector("#graphics-palette");
    const object = document.querySelector("#graphics-object").checked;
    bank.disabled = !emulator.color;
    if (!emulator.color) bank.value = "0";
    if (!emulator.color && Number(palette.value) > (object ? 1 : 0)) palette.value = "0";
    const data = PocketGraphics.inspect(emulator, {
      bank: Number(bank.value), palette: Number(palette.value), object,
      background: document.querySelector("#graphics-background").checked,
      window: document.querySelector("#graphics-window").checked,
      sprites: document.querySelector("#graphics-sprites").checked,
    });
    const images = { preview: data.preview, tiles: data.tiles, map0: data.maps[0],
      map1: data.maps[1], objects: data.objects, palettes: data.palettes };
    for (const [name, image] of Object.entries(images)) {
      document.querySelector(`#graphics-${name}`).getContext("2d")
        .putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
    }
    const r = data.registers;
    document.querySelector("#graphics-registers").textContent =
      `LCDC $${r.lcd.toString(16).padStart(2, "0")} · LY ${r.line} · mode ${r.mode}\nSCX ${r.scrollX} · SCY ${r.scrollY} · WX ${r.windowX} · WY ${r.windowY}`;
    document.querySelector("#graphics-entries").textContent = data.entries.map(s =>
      `${String(s.index).padStart(2, "0")} : x=${s.x} y=${s.y} tuile=$${s.tile.toString(16).padStart(2, "0")} ${s.height}px banque=${s.bank} palette=${s.palette} X=${Number(s.flipX)} Y=${Number(s.flipY)} derrière=${Number(s.behind)}`).join("\n");
    graphicsFailed = false;
    graphicsStatus.classList.remove("is-error");
    graphicsStatus.textContent = `${emulator.color ? "CGB" : "GB"} · image ${r.frames} · mémoire vidéo lue sans modifier la partie.`;
  } catch (error) {
    graphicsFailed = true;
    graphicsStatus.classList.add("is-error");
    graphicsStatus.textContent = `Inspecteur indisponible : ${error.message}. Cliquez sur Actualiser pour réessayer.`;
    console.error(error);
  }
}
graphicsInspector.addEventListener("toggle", () => updateGraphics(true));
for (const name of ["bank", "palette", "object", "background", "window", "sprites", "live"]) {
  document.querySelector(`#graphics-${name}`).addEventListener("change", () => updateGraphics(true));
}
document.querySelector("#graphics-refresh").addEventListener("click", () => updateGraphics(true));

function sceneMessage(message, error = false) {
  sceneStatus.textContent = message;
  sceneStatus.classList.toggle("is-error", error);
  if (error) showFullscreenMessage(message, true);
}
function shaderLabel() {
  return { light: "Lissage léger", soft: "Arrondi des sprites", sharp: "Netteté", crt: "CRT rétro",
    scale2x: "Scale2x pixel art", scale4x: "Scale4x pixel art" }[sceneFilter.value];
}
function cameraControls() {
  for (const key of ["yaw", "pitch", "zoom", "thickness", "light"]) {
    const percent = key === "zoom" || key === "light";
    const value = Math.round(sceneCamera[key] * (percent ? 100 : 1));
    document.querySelector(`#scene-${key}`).value = String(value);
    document.querySelector(`#scene-${key}-value`).textContent =
      `${value}${percent ? " %" : key === "yaw" || key === "pitch" ? "°" : ""}`;
  }
}
function resetSceneCamera() {
  sceneCamera = { ...(scenePreset?.camera || { yaw: -18, pitch: 10, zoom: 0.9 }),
    thickness: scenePreset?.thickness ?? 4, light: scenePreset?.light ?? 0.75 };
  cameraControls();
}
function returnTo2D(message, error = false) {
  if (!isGBA()) emulator?.setVideoCapture(false);
  renderMode.value = "2d";
  if (scene2DFilter) {
    sceneFilter.value = scene2DFilter;
    scene2DFilter = null;
  }
  document.querySelector("#scene-filter-scale4x").disabled = isGBA();
  sceneResolution.disabled = isGBA();
  document.querySelector("#scene-smoothing").disabled = isGBA();
  if (sceneCanvas.width !== sceneCanvasBaseWidth) sceneCanvas.width = sceneCanvasBaseWidth;
  if (sceneCanvas.height !== sceneCanvasBaseHeight) sceneCanvas.height = sceneCanvasBaseHeight;
  sceneCanvas.classList.toggle("is-super-resolution", false);
  sceneCanvas.hidden = true;
  sceneCanvas.setAttribute("aria-hidden", "true");
  sceneMessage(message, error);
}
function updateScene(force = false) {
  if (isGBA()) {
    sceneResolution.disabled = true;
    document.querySelector("#scene-smoothing").disabled = true;
    sceneGame?.setVideoCapture?.(false);
    sceneGame = null;
    scenePreset = null;
    returnTo2D("GBA : rendu 2D natif 240 × 160. Shaders et rendus 2.5D/3D non disponibles.");
    return;
  }
  const requestedResolution = Number(sceneResolution.value);
  if (![1, 2, 4].includes(requestedResolution)) {
    sceneResolution.value = "1";
    returnTo2D("Réglage de sur-résolution 2D invalide.", true);
    return;
  }
  const superResolution2D = renderMode.value === "2d" && requestedResolution > 1;
  const outputScale = superResolution2D ? requestedResolution : 1;
  const outputWidth = sceneCanvasBaseWidth * outputScale;
  const outputHeight = sceneCanvasBaseHeight * outputScale;
  if (sceneCanvas.width !== outputWidth) sceneCanvas.width = outputWidth;
  if (sceneCanvas.height !== outputHeight) sceneCanvas.height = outputHeight;
  sceneCanvas.classList.toggle("is-super-resolution", superResolution2D);
  sceneResolution.disabled = renderMode.value !== "2d";
  document.querySelector("#scene-filter-scale4x").disabled = renderMode.value !== "2d";
  document.querySelector("#scene-smoothing").disabled = superResolution2D;
  if (superResolution2D) document.querySelector("#scene-smoothing").checked = true;
  if (sceneGame !== emulator) {
    sceneGame?.setVideoCapture(false);
    sceneGame = emulator;
    scenePreset = emulator ? PocketScene.selectPreset(emulator, PocketPresets) : null;
    const option = document.querySelector("#scene-option");
    option.disabled = !scenePreset;
    option.textContent = scenePreset ? `2.5D · ${scenePreset.label || scenePreset.match.title}` : "2.5D · preset requis";
    document.querySelector("#world-option").disabled = !scenePreset?.world;
    document.querySelector("#world-option").textContent = scenePreset?.world
      ? `3D · ${scenePreset.label || scenePreset.match.title}` : "3D · preset requis";
    if (renderMode.value === "3d" && scenePreset && !scenePreset.world) renderMode.value = "2.5d";
    resetSceneCamera();
    if (!scenePreset) returnTo2D(emulator
      ? "Aucun preset 2.5D pour cette ROM : rendu 2D conservé."
      : "Prototype 2.5D : chargez Pokémon Rouge FR, Pokémon Jaune, Cristal UE 1.1, Aladdin GBC ou Zelda Oracle of Ages pour activer un preset.");
    else sceneMessage(`Preset disponible : ${scenePreset.name}. Choisissez le rendu 2.5D${scenePreset.world ? " ou 3D" : ""} pour l’activer.`);
    force = true;
  }
  if (renderMode.value === "2d") {
    emulator?.setVideoCapture(false);
    if (!emulator || !document.querySelector("#scene-smoothing").checked) {
      sceneCanvas.hidden = true;
      sceneCanvas.setAttribute("aria-hidden", "true");
      return;
    }
    try {
      if (!sceneRenderer) sceneRenderer = new PocketScene.Renderer(sceneCanvas);
      sceneRenderer.render2D(emulator, sceneFilter.value);
      sceneCanvas.hidden = false;
      sceneCanvas.setAttribute("aria-hidden", "false");
      const resolution = superResolution2D ? ` · sur-résolution ×${outputScale} (${outputWidth} × ${outputHeight})` : "";
      const filterType = sceneFilter.value === "scale4x" ? "filtre" : "shader";
      sceneMessage(`2D · ${filterType} ${shaderLabel()}${resolution} · image entière filtrée, textes inclus · jeu et sauvegardes inchangés.`);
    } catch (error) {
      if (sceneRenderer) { sceneRenderer.dispose(); sceneRenderer = null; }
      document.querySelector("#scene-smoothing").checked = false;
      if (superResolution2D) sceneResolution.value = "1";
      returnTo2D(`Filtre 2D arrêté : ${error.message} Retour aux pixels originaux.`, true);
      console.error(error);
    }
    return;
  }
  if (!["2.5d", "3d"].includes(renderMode.value)) return;
  if (!emulator || !scenePreset) {
    returnTo2D("Rendu 2.5D indisponible : aucun preset compatible avec le jeu chargé.", true);
    return;
  }
  if (renderMode.value === "3d" && !scenePreset.world) {
    returnTo2D("Rendu 3D indisponible : aucun preset 3D pour ce jeu.", true);
    return;
  }
  const now = performance.now();
  if (!force && now - sceneTime < 1000 / 30) return;
  sceneTime = now;
  try {
    emulator.setVideoCapture(true);
    if (!sceneRenderer) sceneRenderer = new PocketScene.Renderer(sceneCanvas);
    const result = sceneRenderer.render(emulator, scenePreset, sceneCamera, renderMode.value,
      document.querySelector("#scene-smoothing").checked, document.querySelector("#scene-filter").value);
    sceneCanvas.hidden = false;
    sceneCanvas.setAttribute("aria-hidden", "false");
    sceneMessage(`${scenePreset.name} · ${result.detail || `${result.tiles} tuiles`}${result.smoothed ? ` · contours lissés / shader ${shaderLabel()}` : ""} · rendu ≤30 Hz · jeu et sauvegardes inchangés.`);
  } catch (error) {
    if (sceneRenderer) { sceneRenderer.dispose(); sceneRenderer = null; }
    document.querySelector("#scene-smoothing").checked = false;
    returnTo2D(`Rendu 2.5D arrêté : ${error.message} Retour au rendu 2D.`, true);
    console.error(error);
  }
}
renderMode.value = "2d";
sceneResolution.value = "1";
document.querySelector("#scene-smoothing").checked = false;
document.querySelector("#scene-filter").value = "light";
document.querySelector("#scene-filter").addEventListener("change", () => {
  if (renderMode.value === "2d") scene2DFilter = sceneFilter.value;
  else {
    scene2DFilter = null;
    if (sceneFilter.value === "scale4x") sceneFilter.value = "scale2x";
  }
  document.querySelector("#scene-smoothing").checked = true;
  updateScene(true);
  canvas.focus();
});
document.querySelector("#scene-smoothing").addEventListener("change", () => {
  if (renderMode.value === "2d" && Number(sceneResolution.value) > 1) {
    document.querySelector("#scene-smoothing").checked = true;
  }
  updateScene(true);
  if (renderMode.value === "2d" && !document.querySelector("#scene-smoothing").checked
    && !sceneStatus.classList.contains("is-error")) sceneMessage("Rendu 2D original rétabli, sans filtre.");
  canvas.focus();
});
sceneResolution.addEventListener("change", () => {
  updateScene(true);
  canvas.focus();
});
renderMode.addEventListener("change", () => {
  if (!["2d", "2.5d", "3d"].includes(renderMode.value)) {
    returnTo2D("Mode de rendu invalide. Retour au rendu 2D.", true);
    return;
  }
  if (renderMode.value === "2d") {
    if (scene2DFilter) {
      sceneFilter.value = scene2DFilter;
      scene2DFilter = null;
    }
  } else if (sceneFilter.value === "scale4x") {
    scene2DFilter = "scale4x";
    sceneFilter.value = "scale2x";
  }
  if (renderMode.value === "2d") {
    returnTo2D("Rendu 2D original rétabli, sans redémarrage de la partie.");
    updateScene(true);
  }
  else updateScene(true);
  canvas.focus();
});
for (const key of ["yaw", "pitch", "zoom", "thickness", "light"]) {
  document.querySelector(`#scene-${key}`).addEventListener("input", () => {
    const next = { ...sceneCamera, [key]: Number(document.querySelector(`#scene-${key}`).value) / (key === "zoom" || key === "light" ? 100 : 1) };
    try {
      PocketScene.validateCamera(next);
      sceneCamera = next;
      cameraControls();
      updateScene(true);
    } catch (error) {
      cameraControls();
      sceneMessage(`Réglage refusé : ${error.message}`, true);
      console.error(error);
    }
  });
}
document.querySelector("#scene-reset").addEventListener("click", () => {
  resetSceneCamera();
  updateScene(true);
});
sceneCanvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  if (sceneRenderer) { sceneRenderer.dispose(); sceneRenderer = null; }
  document.querySelector("#scene-smoothing").checked = false;
  returnTo2D("Contexte WebGL perdu : rendu 2D rétabli. Réessayez la 2.5D après restauration du contexte.", true);
});

function isGBA(game = emulator) { return game?.system === "gba"; }
function statesFor(game = emulator) { return isGBA(game) ? PocketGBAStates : PocketStates; }
function createEmulator(bytes, name) {
  const game = /\.gba$/i.test(name) ? new PocketGameBoyAdvance(bytes, audioContext?.sampleRate || 48000)
    : new PocketGameBoy(bytes, audioContext?.sampleRate || 48000);
  if (!isGBA(game)) game.setSerialDevice(printerDevice);
  return game;
}
function setPrinterStatus(message, error = false) {
  printerStatus.textContent = message;
  printerStatus.classList.toggle("is-error", error);
}
function updatePrinterStatus(status) {
  if (printerAnimation && (status & 2)) {
    setPrinterStatus("Impression thermique en cours…");
  } else if (status & 1) {
    setPrinterStatus("Imprimante : erreur de checksum du paquet.", true);
  } else if (status & 16) {
    setPrinterStatus("Imprimante : paquet ou compression invalide.", true);
  } else if (status & 2) {
    setPrinterStatus("Impression thermique en cours…");
  } else if (status & 8) {
    setPrinterStatus("Image reçue. En attente de l’ordre d’impression.");
  } else if (status & 4) {
    setPrinterStatus("Impression terminée. L’imprimante est prête.");
  } else {
    setPrinterStatus("Imprimante prête. Le jeu envoie l’image au moment prévu.");
  }
}
function showPrinterJob(job) {
  printerPanelDismissed = false;
  printerPanel.hidden = false;
  printerOutput.hidden = false;
  printerPaper.width = job.width;
  printerPaper.height = job.height;
  printerPaperContext.putImageData(new ImageData(job.pixels, job.width, job.height), 0, 0);
  printerPaperWindow.style.height = "0px";
  setPrinterStatus(job.copies > 1
    ? `Impression thermique en cours… (${job.copies} exemplaires).`
    : "Impression thermique en cours…");
  const version = ++printerRenderVersion;
  const duration = Math.max(1200, job.height * 45);
  let startedAt = null;
  const reveal = time => {
    if (version !== printerRenderVersion) return;
    if (startedAt === null) startedAt = time;
    const progress = job.height ? Math.min(1, (time - startedAt) / duration) : 1;
    const visibleHeight = Math.ceil(job.height * progress);
    const scale = (printerPaper.clientWidth || printerPaper.width) / printerPaper.width;
    printerPaperWindow.style.height = `${visibleHeight * scale}px`;
    if (progress < 1) printerAnimation = requestAnimationFrame(reveal);
    else {
      printerAnimation = 0;
      printerDevice.finishPrinting();
    }
  };
  printerAnimation = requestAnimationFrame(reveal);
}
function stopMediaStream(stream) {
  if (stream) for (const track of stream.getTracks()) track.stop();
}
function setCameraStatus(message, error = false) {
  cameraStatus.textContent = message;
  cameraStatus.classList.toggle("is-error", error);
}
function captureCameraFrame(game, stream) {
  if (emulator !== game || cameraStream !== stream || cameraVideo.readyState < 2
    || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    throw new Error("Webcam indisponible au moment de la capture. Réactivez-la puis redémarrez le jeu.");
  }
  const aspect = 128 / 120, width = cameraVideo.videoWidth, height = cameraVideo.videoHeight;
  let sx = 0, sy = 0, sw = width, sh = height;
  if (width / height > aspect) {
    sw = height * aspect;
    sx = (width - sw) / 2;
  } else {
    sh = width / aspect;
    sy = (height - sh) / 2;
  }
  cameraCaptureContext.drawImage(cameraVideo, sx, sy, sw, sh, 0, 0, 128, 120);
  return cameraCaptureContext.getImageData(0, 0, 128, 120).data;
}
function attachCameraProvider(game, stream = cameraStream) {
  if (stream && game?.cartridge.isCamera) {
    game.cartridge.setCameraCaptureProvider(() => captureCameraFrame(game, stream));
  }
}
function stopCamera() {
  if (emulator?.cartridge.isCamera) emulator.cartridge.setCameraCaptureProvider(null);
  stopMediaStream(cameraStream);
  cameraStream = null;
  cameraVideo.pause();
  cameraVideo.srcObject = null;
  cameraVideo.hidden = true;
  cameraButton.textContent = "Activer la webcam";
  setCameraStatus("La webcam est désactivée.");
}
async function requestCamera(target, version) {
  if (!target?.cartridge.isCamera) return false;
  if (cameraStream) {
    attachCameraProvider(target);
    return true;
  }
  cameraButton.disabled = true;
  let stream = null;
  try {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) throw new Error("Accès webcam indisponible. Ouvrez l’émulateur via HTTPS ou localhost.");
    stream = await mediaDevices.getUserMedia.call(mediaDevices, { video: true, audio: false });
    if (target !== emulator || version !== loadVersion) {
      stopMediaStream(stream);
      return false;
    }
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
    if (target !== emulator || version !== loadVersion) {
      stopMediaStream(stream);
      cameraVideo.srcObject = null;
      return false;
    }
    cameraStream = stream;
    attachCameraProvider(target, stream);
    cameraVideo.hidden = false;
    cameraButton.textContent = "Désactiver la webcam";
    setCameraStatus("Webcam prête. Le jeu ne capture une image qu’à sa demande.");
    return true;
  } catch (error) {
    stopMediaStream(stream);
    cameraVideo.srcObject = null;
    cameraVideo.hidden = true;
    setCameraStatus(`Webcam indisponible : ${error.message}`, true);
    console.error(error);
    return false;
  } finally {
    cameraButton.disabled = false;
  }
}
async function toggleCamera() {
  if (cameraStream) stopCamera();
  else await requestCamera(emulator, loadVersion);
}
function consoleName(game = emulator) {
  return isGBA(game) ? "GAME BOY ADVANCE" : game?.color ? "GAME BOY COLOR" : "GAME BOY";
}
function updateConsole() {
  const gba = isGBA();
  canvas.width = gba ? 240 : 160;
  canvas.height = gba ? 160 : 144;
  canvas.setAttribute("aria-label", gba ? "Écran de jeu Game Boy Advance" : "Écran de jeu Game Boy Color");
  player.classList.toggle("is-gba", gba);
  document.querySelector(".system-pill").textContent = gba ? "GBA" : "GB / GBC";
  for (const selector of ["#render-mode", "#scene-smoothing", "#scene-filter", "#scene-resolution"]) document.querySelector(selector).disabled = gba;
  document.querySelector("#camera-settings").hidden = graphicsInspector.hidden = gba;
  printerPanel.hidden = gba || printerOutput.hidden || printerPanelDismissed;
  for (const button of document.querySelectorAll("[data-gba]")) button.hidden = !gba;
  soundButton.disabled = false;
  soundButton.textContent = audioContext?.state === "running" ? "Couper le son" : "Activer le son";
  soundButton.setAttribute("aria-pressed", String(audioContext?.state === "running"));
  document.querySelector("#console-status").hidden = !gba;
  cameraPanel.hidden = !emulator?.cartridge.isCamera;
  cameraButton.disabled = false;
  if (emulator?.cartridge.isCamera) {
    if (cameraStream) {
      attachCameraProvider(emulator);
      cameraVideo.hidden = false;
      cameraButton.textContent = "Désactiver la webcam";
      setCameraStatus("Webcam prête. Le jeu ne capture une image qu’à sa demande.");
    } else {
      cameraVideo.hidden = true;
      cameraButton.textContent = "Activer la webcam";
      setCameraStatus("Demande d’accès à la webcam…");
    }
  }
  if (!gba) updatePrinterStatus(printerDevice.status);
  if (gba) stopAudio();
}
function draw() {
  context.putImageData(new ImageData(emulator.framePixels || emulator.pixels, canvas.width, canvas.height), 0, 0);
  updateScene();
  updateGraphics();
}

function run(time) {
  if (!emulator || paused) return;
  try {
    pollGamepads();
    if (previousTime !== null) {
      // Bound catch-up after a slow frame; do not fast-forward a hidden tab.
      const delta = time - previousTime;
      if (delta > 50) limitedFrames++;
      cycleDebt += Math.min(delta, 50) * (emulator.clock || clock) * playbackSpeed / 1000;
      const started = performance.now();
      if (cycleDebt > 0) cycleDebt -= emulator.runCycles(cycleDebt);
      emulationTime += performance.now() - started;
      frameSamples++;
      draw();
      outputAudio();
    }
    if (fpsTime === null) {
      fpsTime = time;
      fpsFrames = emulator.frames;
      emulationTime = frameSamples = limitedFrames = 0;
    } else if (time - fpsTime >= 1000) {
      fpsStatus.textContent = `${((emulator.frames - fpsFrames) * 1000 / (time - fpsTime)).toFixed(1)} FPS jeu · ${(emulationTime / Math.max(1, frameSamples)).toFixed(1)} ms/raf · ${limitedFrames} rattrapage(s) limité(s)`;
      fpsTime = time;
      fpsFrames = emulator.frames;
      emulationTime = frameSamples = limitedFrames = 0;
    }
    previousTime = time;
    animation = requestAnimationFrame(run);
  } catch (error) {
    stopLoop();
    paused = true;
    pauseButton.disabled = true;
    screenCaption.textContent = "ERREUR";
    setStatus(`Émulation arrêtée : ${error.message}`, true);
    console.error(error);
    saveCurrent();
  }
}

function startGame(bytes, name, version = loadVersion) {
  const candidate = createEmulator(bytes, name);
  const transition = async () => {
    if (version !== loadVersion) return;
    transitioning = true;
    stopLoop();
    if (!candidate.cartridge.isCamera) stopCamera();
    updateSaveButtons();
    pauseButton.disabled = true;
    let committed = false;
    try {
      if (saveSession && !stateMode) await saveSession.flush();
      if (version !== loadVersion) return;
      let session = null, restored = false;
      const hash = await saveStore.keyFor(bytes);
      const key = isGBA(candidate) ? `gba:${hash}` : hash;
      if (candidate.cartridge.ram.length || candidate.cartridge.hasRTC) {
        setSaveStatus("Lecture de la sauvegarde locale…");
        session = new PocketSaves.SaveSession(saveStore, key, candidate.cartridge);
        restored = await session.restore();
      }
      if (version !== loadVersion) return;
      emulator = candidate;
      saveSession = session;
      gameKey = key;
      stateMode = false;
      loadedBytes = bytes;
      loadedName = name;
      paused = false;
      archivePicker.hidden = true;
      gameName.textContent = candidate.cartridge.title || name;
      gameName.title = name;
      placeholder.hidden = true;
      screenCaption.textContent = consoleName(candidate);
      restartButton.disabled = pauseButton.disabled = resetButton.disabled = false;
      pauseButton.textContent = "Pause";
      updateConsole();
      draw();
      setStatus(`${name} — cœur maison actif. Compatibilité expérimentale.`);
      setSaveStatus(session ? restored ? "RAM in-game restaurée avant le démarrage. Choisissez Continuer dans le jeu."
        : "Aucune sauvegarde in-game locale. Enregistrement automatique de la RAM activé."
        : "Cette cartouche n’a pas de RAM de sauvegarde ni d’horloge.");
      setStateStatus("État indépendant : sauvegardez un instant, puis chargez-le avec Charger l’état.");
      historyCopies = [];
      ramHistory.replaceChildren();
      refreshStateSlot();
      refreshHistory();
      committed = true;
      if (candidate.cartridge.isCamera && !cameraStream) await requestCamera(candidate, version);
      animation = requestAnimationFrame(run);
    } catch (error) {
      setSaveStatus(`Sauvegardes inaccessibles : ${error.message} Le jeu n’a pas été remplacé.`, true);
      throw error;
    } finally {
      transitioning = false;
      updateSaveButtons();
      pauseButton.disabled = !emulator || screenCaption.textContent === "ERREUR";
      if (!committed && emulator && !paused && !document.hidden) animation = requestAnimationFrame(run);
    }
  };
  gameTransition = gameTransition.then(transition, transition);
  return gameTransition;
}

async function loadRom(file) {
  if (!file) return;
  if (importing) {
    setStatus("Attendez la fin de l’import de sauvegarde avant de changer de jeu.", true);
    return;
  }
  const version = ++loadVersion;
  archive = null;
  archivePicker.hidden = true;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["gb", "gbc", "gba", "zip"].includes(extension)) {
    setStatus("Choisissez un fichier .GB, .GBC, .GBA ou .ZIP.", true);
    return;
  }
  if (!file.size || file.size > (extension === "zip" ? PocketZIP.MAX_ARCHIVE : PocketZIP.romLimit(file.name))) {
    setStatus("Fichier vide ou trop volumineux (GB/GBC : 8 Mio ; GBA : 32 Mio ; ZIP : 64 Mio).", true);
    return;
  }
  setStatus(extension === "zip" ? "Lecture de l’archive ZIP…" : "Lecture de la ROM…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (version !== loadVersion) return;
    if (extension !== "zip") { await startGame(bytes, file.name, version); return; }
    archive = PocketZIP.listROMs(bytes);
    if (archive.entries.length === 1) {
      const entry = archive.entries[0];
      const rom = await PocketZIP.extractROM(archive, entry);
      if (version === loadVersion) await startGame(rom, entry.name, version);
    } else {
      archiveSelect.replaceChildren(...archive.entries.map((entry, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = entry.name;
        return option;
      }));
      archivePicker.hidden = false;
      setStatus(`${archive.entries.length} ROM trouvées : choisissez un jeu dans l’archive.`);
    }
  } catch (error) {
    if (version === loadVersion) {
      setStatus(error.message, true);
      console.error(error);
    }
  }
}

romInput.addEventListener("change", () => {
  loadRom(romInput.files[0]);
  romInput.value = "";
});
restartButton.addEventListener("click", () => romInput.click());
archiveOpen.addEventListener("click", async () => {
  if (!archive || importing) return;
  const selectedArchive = archive, version = ++loadVersion;
  const entry = selectedArchive.entries[Number(archiveSelect.value)];
  archiveOpen.disabled = true;
  setStatus("Extraction de la ROM…");
  try {
    const rom = await PocketZIP.extractROM(selectedArchive, entry);
    if (version === loadVersion) await startGame(rom, entry.name, version);
  } catch (error) {
    if (version === loadVersion) { setStatus(error.message, true); console.error(error); }
  } finally { archiveOpen.disabled = false; }
});

pauseButton.addEventListener("click", () => {
  if (!emulator || transitioning || importing) return;
  paused = !paused;
  stopLoop();
  pauseButton.textContent = paused ? "Reprendre" : "Pause";
  screenCaption.textContent = paused ? "PAUSE" : consoleName();
  if (!paused) animation = requestAnimationFrame(run);
  else saveCurrent();
});
resetButton.addEventListener("click", async () => {
  if (importing) return;
  if (loadedBytes) {
    loadVersion++;
    archive = null;
    try { await startGame(loadedBytes, loadedName, loadVersion); }
    catch (error) { setStatus(error.message, true); console.error(error); }
  }
});

saveButton.addEventListener("click", async () => {
  if (!stateMode) return saveCurrent(true);
  if (!saveSession || transitioning || importing) return;
  if (!window.confirm("Utiliser la RAM de cet état comme sauvegarde in-game remplacera votre .sav locale. Continuer ?")) return;
  importing = true;
  stopLoop();
  updateSaveButtons();
  try {
    const previous = await saveStore.read(gameKey);
    saveSession.committedData = previous || emulator.cartridge.saveData();
    saveSession.recoveryData = previous;
    saveSession.savedRevision = -1;
    await saveSession.flush();
    stateMode = false;
    setSaveStatus("RAM de l’état enregistrée comme sauvegarde in-game. Enregistrement automatique réactivé.");
  } catch (error) {
    setSaveStatus(`Enregistrement de la RAM d’état impossible : ${error.message}`, true);
    console.error(error);
  } finally {
    importing = false;
    updateSaveButtons();
    if (!paused && !document.hidden) animation = requestAnimationFrame(run);
  }
});
exportButton.addEventListener("click", () => {
  if (!emulator?.cartridge.ram.length || transitioning || importing) return;
  try {
    const bytes = emulator.cartridge.exportRAM();
    const name = loadedName.split(/[\\/]/).pop().replace(/\.(gb|gbc|gba)$/i, "") + ".sav";
    downloadFile(new Blob([bytes], { type: "application/octet-stream" }), name);
    setSaveStatus("Export .sav lancé : RAM uniquement, sans l’horloge RTC.");
  } catch (error) {
    setSaveStatus(`Export impossible : ${error.message}`, true);
    console.error(error);
  }
});
importButton.addEventListener("click", () => saveInput.click());
saveInput.addEventListener("change", async () => {
  const file = saveInput.files[0];
  saveInput.value = "";
  if (!file || !emulator || transitioning || importing) return;
  const target = emulator, session = saveSession, version = loadVersion;
  const ramSizes = target.cartridge.ramSizes || [target.cartridge.ram.length];
  if (!/\.sav$/i.test(file.name) || !ramSizes.includes(file.size) || !file.size) {
    setSaveStatus(`Fichier .sav invalide : ${ramSizes.join(" ou ")} octets attendus.`, true);
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (target !== emulator || version !== loadVersion || transitioning) {
      setSaveStatus("Import annulé : le jeu a changé. Sélectionnez à nouveau le fichier .sav.", true);
      return;
    }
    if (!window.confirm(`Importer ce .sav remplacera la sauvegarde de « ${loadedName} » et redémarrera le jeu. Continuer ?`)) return;
    loadVersion++;
    importing = true;
    updateSaveButtons();
    stopLoop();
    // Reboot against the imported RAM rather than letting the running game overwrite it.
    const candidate = createEmulator(loadedBytes, loadedName);
    candidate.cartridge.restoreData(target.cartridge.saveData());
    candidate.cartridge.importRAM(bytes);
    if (session) {
      if (!stateMode) await session.flush();
      const importedSession = new PocketSaves.SaveSession(saveStore, session.key, candidate.cartridge);
      importedSession.recoveryData = await saveStore.read(session.key);
      if (importedSession.recoveryData) importedSession.committedData = importedSession.recoveryData;
      importedSession.savedRevision = -1;
      await importedSession.flush();
      saveSession = importedSession;
    }
    activateRestored(candidate, saveSession, false);
    setSaveStatus("RAM .sav importée et enregistrée. Jeu relancé : choisissez Continuer dans le jeu. Horloge locale conservée.");
    await refreshHistory();
  } catch (error) {
    setSaveStatus(`Import impossible : ${error.message} La sauvegarde précédente est conservée.`, true);
    console.error(error);
    if (emulator && !paused && !document.hidden) {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(run);
    }
  } finally {
    importing = false;
    updateSaveButtons();
    if (!paused && emulator && !document.hidden) {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(run);
    }
  }
});
window.setInterval(saveCurrent, 1000);
window.addEventListener("pagehide", () => { stopCamera(); saveCurrent(); });
window.addEventListener("beforeunload", (event) => {
  if ((!stateMode && saveSession?.dirty) || importing || transitioning) {
    saveCurrent();
    event.preventDefault();
    event.returnValue = "";
  }
});

function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function activateRestored(candidate, session, fromState) {
  stopLoop();
  if (candidate.cartridge.isCamera && cameraStream) {
    attachCameraProvider(candidate);
  } else if (!candidate.cartridge.isCamera) stopCamera();
  emulator = candidate;
  saveSession = session;
  stateMode = fromState;
  paused = false;
  pauseButton.disabled = false;
  pauseButton.textContent = "Pause";
  screenCaption.textContent = consoleName(candidate);
  updateConsole();
  draw();
  updateSaveButtons();
  canvas.focus();
  if (!fromState) setStateStatus("États indépendants disponibles dans les trois emplacements ; aucun état actif.");
}

async function restoreLocalRAM(recovery = false, historyCopy = null) {
  if (!emulator || !saveSession || transitioning || importing) return;
  const target = emulator, key = gameKey, version = loadVersion;
  try {
    const data = historyCopy || await saveStore.read(recovery ? `backup:${key}` : key);
    if (!data) throw new Error(recovery ? "Aucune copie de récupération disponible." : "Aucune sauvegarde in-game locale.");
    if (target !== emulator || version !== loadVersion || transitioning || importing) {
      throw new Error("Le jeu a changé pendant la lecture. Réessayez.");
    }
    const candidate = createEmulator(loadedBytes, loadedName);
    candidate.cartridge.restoreData(data);
    if (!window.confirm("Recharger cette RAM redémarrera le jeu sans enregistrer les modifications actuelles. Continuer ?")) return;
    importing = true;
    loadVersion++;
    stopLoop();
    updateSaveButtons();
    await saveSession.pending.then(() => {}, error => {
      setSaveStatus(`Dernier commit non enregistré : ${error.message}. Restauration de la copie locale.`, true);
      console.error(error);
    });
    if (!recovery && !historyCopy) {
      const latest = await saveStore.read(key);
      if (!latest) throw new Error("La sauvegarde locale n’est plus disponible.");
      candidate.cartridge.restoreData(latest);
    }
    const session = new PocketSaves.SaveSession(saveStore, key, candidate.cartridge);
    if (recovery || historyCopy) {
      session.recoveryData = await saveStore.read(key);
      if (session.recoveryData) session.committedData = session.recoveryData;
      session.savedRevision = -1;
      await session.flush();
    } else {
      session.recoveryData = candidate.cartridge.saveData();
    }
    activateRestored(candidate, session, false);
    setSaveStatus("RAM in-game rechargée, jeu relancé. Choisissez Continuer dans le jeu.");
    await refreshHistory();
  } catch (error) {
    setSaveStatus(`Restauration impossible : ${error.message}`, true);
    console.error(error);
    if (importing && emulator && !paused && !document.hidden) animation = requestAnimationFrame(run);
  } finally {
    importing = false;
    updateSaveButtons();
    if (!paused && emulator && !document.hidden) {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(run);
    }
  }
}
reloadSaveButton.addEventListener("click", () => restoreLocalRAM(false));
recoverSaveButton.addEventListener("click", () => restoreLocalRAM(true));

function stateStorageKey(key = gameKey, slot = stateSlot.value || "1") {
  return slot === "1" ? `state:${key}` : `state:${key}:${slot}`;
}
async function refreshStateSlot() {
  const key = gameKey, storageKey = stateStorageKey(), version = ++slotReadVersion;
  statePreview.hidden = true;
  stateInfo.textContent = "Lecture de l’emplacement…";
  stateName.value = "";
  if (!key) { stateInfo.textContent = "Chargez un jeu."; return; }
  try {
    const data = await saveStore.read(storageKey);
    if (key !== gameKey || version !== slotReadVersion) return;
    stateInfo.textContent = data ? new Date(data.createdAt).toLocaleString() : "Emplacement vide";
    stateName.value = typeof data?.name === "string" ? data.name.slice(0, 60) : "";
    if (typeof data?.preview === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.preview)
      && data.preview.length < 200000) {
      statePreview.src = data.preview;
      statePreview.hidden = false;
    }
  } catch (error) {
    setStateStatus(`Lecture des emplacements impossible : ${error.message}`, true);
    console.error(error);
  }
}
async function refreshHistory() {
  const key = gameKey;
  if (!key) return;
  try {
    const copies = await saveStore.read(`history:${key}`);
    if (key !== gameKey) return;
    if (copies !== undefined && (!Array.isArray(copies) || copies.length > 3
      || copies.some(copy => !Number.isSafeInteger(copy?.savedAt) || copy.savedAt < 0 || !copy.data))) {
      throw new Error("Historique RAM invalide.");
    }
    historyCopies = copies || [];
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = historyCopies.length ? "Choisir une copie" : "Aucune copie historique";
    ramHistory.replaceChildren(empty, ...historyCopies.map((copy, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${index + 1} · ${new Date(copy.savedAt).toLocaleString()}`;
      return option;
    }));
    updateSaveButtons();
  } catch (error) {
    setSaveStatus(`Lecture de l’historique impossible : ${error.message}`, true);
    console.error(error);
  }
}
stateSlot.addEventListener("change", refreshStateSlot);
ramHistory.addEventListener("change", updateSaveButtons);
restoreHistoryButton.addEventListener("click", () => {
  if (ramHistory.value === "" || !historyCopies[Number(ramHistory.value)]) return;
  return restoreLocalRAM(false, historyCopies[Number(ramHistory.value)].data);
});

saveStateButton.addEventListener("click", async () => {
  if (!emulator || transitioning || importing) return;
  const target = emulator, key = gameKey, slot = stateSlot.value || "1";
  try {
    const data = statesFor(target).capture(target, key);
    data.name = stateName.value.trim().slice(0, 60);
    draw();
    data.preview = canvas.toDataURL("image/png");
    if (await saveStore.read(stateStorageKey(key, slot))
      && !window.confirm(`Remplacer l’état de l’emplacement ${slot} ?`)) return;
    await saveStore.write(stateStorageKey(key, slot), data);
    if (target === emulator) {
      setStateStatus(`État ${slot} enregistré à ${new Date(data.createdAt).toLocaleTimeString()}. La sauvegarde in-game est inchangée.`);
      await refreshStateSlot();
    }
  } catch (error) {
    setStateStatus(`Enregistrement d’état impossible : ${error.message}`, true);
    console.error(error);
  }
});

async function restoreState(data, target, key, version) {
  if (target !== emulator || key !== gameKey || version !== loadVersion || transitioning || importing) {
    throw new Error("Le jeu a changé pendant la lecture de l’état. Réessayez.");
  }
  const candidate = isGBA(target) ? createEmulator(loadedBytes, loadedName)
    : new PocketGameBoy(loadedBytes, audioContext?.sampleRate || 48000);
  statesFor(target).restore(candidate, data, key);
  if (!window.confirm("Charger cet état remplace la partie en cours. La sauvegarde in-game locale restera inchangée. Continuer ?")) return;
  importing = true;
  loadVersion++;
  updateSaveButtons();
  stopLoop();
  try {
    if (saveSession) await saveSession.pending;
    const session = candidate.cartridge.ram.length || candidate.cartridge.hasRTC
      ? new PocketSaves.SaveSession(saveStore, key, candidate.cartridge) : null;
    activateRestored(candidate, session, true);
    setStateStatus("État chargé : reprise automatique au même instant.");
    setSaveStatus("Mode état : enregistrement automatique in-game suspendu pour protéger votre .sav. Export .sav possible ; Redémarrer retrouve la sauvegarde in-game.");
  } finally {
    importing = false;
    updateSaveButtons();
    if (!paused && !document.hidden) {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(run);
    }
  }
}
loadStateButton.addEventListener("click", async () => {
  if (!emulator || transitioning || importing) return;
  const target = emulator, key = gameKey, version = loadVersion;
  try {
    const data = await saveStore.read(stateStorageKey(key));
    if (!data) throw new Error("Aucun état local pour cette ROM. Utilisez Sauvegarder l’état ou Importer un état.");
    await restoreState(data, target, key, version);
  } catch (error) {
    setStateStatus(`Chargement d’état impossible : ${error.message}`, true);
    console.error(error);
  }
});
exportStateButton.addEventListener("click", () => {
  if (!emulator || transitioning || importing) return;
  try {
    const name = loadedName.split(/[\\/]/).pop().replace(/\.(gb|gbc|gba)$/i, "") + ".state";
    downloadFile(statesFor(emulator).encode(statesFor(emulator).capture(emulator, gameKey)), name);
    setStateStatus("Export .state lancé : instant complet, réservé à cet émulateur et à cette ROM.");
  } catch (error) {
    setStateStatus(`Export d’état impossible : ${error.message}`, true);
    console.error(error);
  }
});
importStateButton.addEventListener("click", () => stateInput.click());
stateInput.addEventListener("change", async () => {
  const file = stateInput.files[0];
  stateInput.value = "";
  if (!file || !emulator || transitioning || importing) return;
  const target = emulator, key = gameKey, version = loadVersion;
  try {
    if (!/\.state$/i.test(file.name)) throw new Error("Choisissez un fichier .state de v3ry Pocket Color, pas un .sav.");
    const data = await statesFor(target).decode(file);
    await restoreState(data, target, key, version);
  } catch (error) {
    setStateStatus(`Import d’état impossible : ${error.message}`, true);
    console.error(error);
  }
});
soundButton.addEventListener("click", async () => {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      audioGain = audioContext.createGain();
      audioGain.gain.setValueAtTime(volume, audioContext.currentTime);
      audioGain.connect(audioContext.destination);
      if (emulator) emulator.apu.sampleRate = audioContext.sampleRate;
      await audioContext.resume();
    } else if (audioContext.state === "running") {
      stopAudio();
      await audioContext.suspend();
    } else await audioContext.resume();
    soundButton.textContent = audioContext.state === "running" ? "Couper le son" : "Activer le son";
    soundButton.setAttribute("aria-pressed", String(audioContext.state === "running"));
  } catch (error) {
    setStatus(`Audio indisponible : ${error.message}`, true);
    console.error(error);
  }
});
cameraButton.addEventListener("click", toggleCamera);
printerCloseButton.addEventListener("click", () => {
  printerPanelDismissed = true;
  printerPanel.hidden = true;
});

function updateButton(index) {
  if (!isGBA() && index >= 8) return;
  const pressed = [...heldKeys].some((key) => keys.get(key) === index)
    || [...heldPointers.values()].includes(index) || heldGamepad.has(index);
  emulator?.setButton(index, pressed);
}
window.addEventListener("keydown", (event) => {
  if (bindingAction !== null) {
    event.preventDefault();
    if (event.code === "Escape") {
      bindingAction = null;
      keyboardSummary();
    } else if (!event.repeat) {
      if (!validKey(event.code) || event.ctrlKey || event.altKey || event.metaKey) {
        keyStatus.textContent = "Touche réservée ou non prise en charge. Choisissez une autre touche ; Échap annule.";
      } else if (keys.has(event.code) && keys.get(event.code) !== bindingAction) {
        keyStatus.textContent = "Touche déjà utilisée pour une autre commande. Choisissez une autre touche ; Échap annule.";
      } else {
        releaseControls();
        for (const [code, index] of keys) if (index === bindingAction) keys.delete(code);
        keys.set(event.code, bindingAction);
        bindingAction = null;
        keyboardSummary();
        persistPreferences();
        canvas.focus();
      }
    }
    return;
  }
  if (["F6", "F8"].includes(event.code) && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey
    && !event.target.closest("input, select, textarea, button, a, [contenteditable]")) {
    event.preventDefault();
    (event.code === "F6" ? saveStateButton : loadStateButton).click();
    return;
  }
  if (event.code === "Escape" && immersiveFallback) {
    event.preventDefault();
    toggleFullscreen();
    return;
  }
  if (event.code === "KeyF" && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey
    && !event.target.closest("input, select, textarea, button, a, [contenteditable]")) {
    event.preventDefault();
    toggleFullscreen();
    return;
  }
  if (!emulator || paused || transitioning || importing || !keys.has(event.code)) return;
  if (event.target.closest("input, select, textarea, button, a, [contenteditable]")) return;
  event.preventDefault();
  heldKeys.add(event.code);
  updateButton(keys.get(event.code));
});
window.addEventListener("keyup", (event) => {
  if (!keys.has(event.code)) return;
  heldKeys.delete(event.code);
  updateButton(keys.get(event.code));
});
window.addEventListener("blur", () => { inputFocused = false; releaseControls(); previousTime = null; stopAudio(); });
window.addEventListener("focus", () => { inputFocused = true; });
window.setInterval(pollGamepads, 50);
document.addEventListener("focusin", (event) => {
  if (event.target.closest("input, select, textarea, [contenteditable]")) releaseControls();
});
document.addEventListener("visibilitychange", () => {
  releaseControls();
  previousTime = null;
  stopAudio();
  saveCurrent();
  if (document.hidden) cancelAnimationFrame(animation);
  else if (emulator && !paused && !transitioning && !importing) {
    cancelAnimationFrame(animation);
    animation = requestAnimationFrame(run);
  }
});

for (const button of document.querySelectorAll("[data-key]")) {
  const index = Number(button.dataset.key);
  button.addEventListener("pointerdown", (event) => {
    if (!emulator || paused || transitioning || importing) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    heldPointers.set(event.pointerId, index);
    updateButton(index);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(name, (event) => {
      heldPointers.delete(event.pointerId);
      updateButton(index);
    });
  }
}
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}
dropZone.addEventListener("drop", (event) => {
  if (event.dataTransfer.files.length !== 1) {
    setStatus("Déposez une seule ROM ou une seule archive ZIP à la fois.", true);
    return;
  }
  loadRom(event.dataTransfer.files[0]);
});
