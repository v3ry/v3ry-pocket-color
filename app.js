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
const archivePicker = document.querySelector("#archive-picker");
const archiveSelect = document.querySelector("#archive-rom");
const archiveOpen = document.querySelector("#archive-open");
const saveButton = document.querySelector("#save-button");
const exportButton = document.querySelector("#export-save");
const importButton = document.querySelector("#import-save");
const saveInput = document.querySelector("#save-file");
const saveStatus = document.querySelector("#save-status");
const saveStore = new PocketSaves.SaveStore();
const clock = 4194304;
const keys = new Map([
  ["ArrowRight", 0], ["ArrowLeft", 1], ["ArrowUp", 2], ["ArrowDown", 3],
  // Physical Q/W positions are labelled A/Z on AZERTY keyboards.
  ["KeyQ", 4], ["KeyW", 5], ["ShiftLeft", 6], ["ShiftRight", 6], ["Enter", 7],
]);

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
let nextAudioTime = 0;
let saveSession = null;
let gameTransition = Promise.resolve();
let transitioning = false;
let importing = false;
const audioSources = new Set();
const heldKeys = new Set();
const heldPointers = new Map();

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function setSaveStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("is-error", isError);
}

function updateSaveButtons() {
  const busy = transitioning || importing;
  saveButton.disabled = busy || !saveSession;
  exportButton.disabled = importButton.disabled = busy || !emulator?.cartridge.ram.length;
}

async function saveCurrent(notify = false) {
  const session = saveSession;
  if (!session || transitioning || importing) return;
  try {
    const written = await session.flush();
    if (session === saveSession && (written || notify === true)) {
      setSaveStatus(session.dirty ? "Sauvegarde enregistrée ; dernières modifications en attente."
        : written ? "Sauvegarde locale enregistrée." : "Aucune nouvelle modification à enregistrer.");
    }
  } catch (error) {
    if (session === saveSession) setSaveStatus(`Sauvegarde impossible : ${error.message} Exportez un .sav pour conserver la RAM.`, true);
    console.error(error);
  }
}

function stopAudio() {
  for (const source of audioSources) source.stop();
  audioSources.clear();
  nextAudioTime = 0;
}

function releaseControls() {
  heldKeys.clear();
  heldPointers.clear();
  emulator?.releaseButtons();
}

function stopLoop() {
  cancelAnimationFrame(animation);
  animation = 0;
  previousTime = null;
  cycleDebt = 0;
  stopAudio();
  releaseControls();
}

function outputAudio() {
  const samples = emulator.apu.drain();
  if (!audioContext || audioContext.state !== "running" || !samples.length) return;
  const length = samples.length / 2;
  const buffer = audioContext.createBuffer(2, length, emulator.apu.sampleRate);
  for (let side = 0; side < 2; side++) {
    const channel = buffer.getChannelData(side);
    for (let i = 0; i < length; i++) channel[i] = samples[i * 2 + side];
  }
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  if (nextAudioTime < audioContext.currentTime || nextAudioTime > audioContext.currentTime + 0.2) {
    nextAudioTime = audioContext.currentTime + 0.035;
  }
  source.start(nextAudioTime);
  nextAudioTime += buffer.duration;
  audioSources.add(source);
  source.onended = () => { audioSources.delete(source); source.disconnect(); };
}

function draw() {
  context.putImageData(new ImageData(emulator.pixels, 160, 144), 0, 0);
}

function run(time) {
  if (!emulator || paused) return;
  try {
    if (previousTime !== null) {
      // Bound catch-up after a slow frame; do not fast-forward a hidden tab.
      cycleDebt += Math.min(time - previousTime, 50) * clock / 1000;
      if (cycleDebt > 0) cycleDebt -= emulator.runCycles(cycleDebt);
      draw();
      outputAudio();
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
  const candidate = new PocketGameBoy(bytes, audioContext?.sampleRate || 48000);
  const transition = async () => {
    if (version !== loadVersion) return;
    transitioning = true;
    stopLoop();
    updateSaveButtons();
    pauseButton.disabled = true;
    let committed = false;
    try {
      if (saveSession) await saveSession.flush();
      if (version !== loadVersion) return;
      let session = null, restored = false;
      if (candidate.cartridge.ram.length || candidate.cartridge.hasRTC) {
        setSaveStatus("Lecture de la sauvegarde locale…");
        session = new PocketSaves.SaveSession(saveStore, await saveStore.keyFor(bytes), candidate.cartridge);
        restored = await session.restore();
      }
      if (version !== loadVersion) return;
      emulator = candidate;
      saveSession = session;
      loadedBytes = bytes;
      loadedName = name;
      paused = false;
      archivePicker.hidden = true;
      gameName.textContent = candidate.cartridge.title || name;
      gameName.title = name;
      placeholder.hidden = true;
      screenCaption.textContent = candidate.color ? "GAME BOY COLOR" : "GAME BOY";
      restartButton.disabled = pauseButton.disabled = resetButton.disabled = false;
      pauseButton.textContent = "Pause";
      draw();
      setStatus(`${name} — cœur maison actif. Compatibilité expérimentale.`);
      setSaveStatus(session ? restored ? "Sauvegarde locale restaurée." : "Sauvegarde automatique activée (toutes les secondes)."
        : "Cette cartouche n’a pas de RAM de sauvegarde ni d’horloge.");
      committed = true;
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
  if (!["gb", "gbc", "zip"].includes(extension)) {
    setStatus("Choisissez un fichier .GB, .GBC ou .ZIP.", true);
    return;
  }
  if (!file.size || file.size > (extension === "zip" ? PocketZIP.MAX_ARCHIVE : PocketZIP.MAX_ROM)) {
    setStatus("Fichier vide ou trop volumineux (ROM : 8 Mio ; ZIP : 32 Mio).", true);
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
  screenCaption.textContent = paused ? "PAUSE" : emulator.color ? "GAME BOY COLOR" : "GAME BOY";
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

saveButton.addEventListener("click", () => saveCurrent(true));
exportButton.addEventListener("click", () => {
  if (!emulator?.cartridge.ram.length || transitioning || importing) return;
  try {
    const bytes = emulator.cartridge.exportRAM();
    const name = loadedName.split(/[\\/]/).pop().replace(/\.(gb|gbc)$/i, "") + ".sav";
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  if (!/\.sav$/i.test(file.name) || file.size !== target.cartridge.ram.length || !file.size) {
    setSaveStatus(`Fichier .sav invalide : ${target.cartridge.ram.length} octets attendus.`, true);
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
    const candidate = new PocketGameBoy(loadedBytes, audioContext?.sampleRate || 48000);
    candidate.cartridge.restoreData(target.cartridge.saveData());
    candidate.cartridge.importRAM(bytes);
    if (session) {
      await session.flush();
      const importedSession = new PocketSaves.SaveSession(saveStore, session.key, candidate.cartridge);
      importedSession.savedRevision = -1;
      await importedSession.flush();
      saveSession = importedSession;
    }
    emulator = candidate;
    paused = false;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause";
    screenCaption.textContent = emulator.color ? "GAME BOY COLOR" : "GAME BOY";
    draw();
    animation = requestAnimationFrame(run);
    setSaveStatus("Sauvegarde .sav importée et enregistrée. Horloge RTC locale conservée.");
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
  }
});
window.setInterval(saveCurrent, 1000);
window.addEventListener("pagehide", saveCurrent);
window.addEventListener("beforeunload", (event) => {
  if (saveSession?.dirty || importing || transitioning) {
    saveCurrent();
    event.preventDefault();
    event.returnValue = "";
  }
});
soundButton.addEventListener("click", async () => {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
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

function updateButton(index) {
  const pressed = [...heldKeys].some((key) => keys.get(key) === index)
    || [...heldPointers.values()].includes(index);
  emulator?.setButton(index, pressed);
}
window.addEventListener("keydown", (event) => {
  if (!emulator || paused || transitioning || importing || !keys.has(event.code)) return;
  if (event.target.closest("input, select, textarea, button, a")) return;
  event.preventDefault();
  heldKeys.add(event.code);
  updateButton(keys.get(event.code));
});
window.addEventListener("keyup", (event) => {
  if (!keys.has(event.code)) return;
  heldKeys.delete(event.code);
  updateButton(keys.get(event.code));
});
window.addEventListener("blur", () => { releaseControls(); previousTime = null; stopAudio(); });
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
