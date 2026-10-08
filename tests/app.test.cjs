"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { GameBoy } = require("../emulator.js");
const ZIP = require("../zip.js");
const { makeDemoROM, makeROM, makeZIP, memorySaveStore } = require("./helpers.cjs");
const { SaveSession } = require("../saves.js");
const States = require("../states.js");
const Graphics = require("../graphics.js");
const Scene = require("../scene.js");
const AladdinPreset = require("../preset/aladdin.js");
const CrystalPreset = require("../preset/pokemon-crystal.js");

class Element {
  constructor() {
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.files = [];
    this.disabled = false;
    this.checked = false;
    this.classes = new Set();
    this.classList = {
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
    };
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  fire(name, event = {}) { return this.listeners.get(name)?.(event); }
  setAttribute(name, value) { this[name] = value; }
  closest() { return null; }
  focus() {}
  replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ""; }
  click() { return this.fire("click"); }
  append() {}
  remove() {}
}

function harness(store = memorySaveStore(), preferences = new Map()) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const canvas = element("#game-canvas");
  const context = { putImageData: image => { canvas.image = image; } };
  canvas.getContext = () => context;
  canvas.toDataURL = () => "data:image/png;base64,AAAA";
  canvas.toBlob = callback => callback(new Blob(["png"], { type: "image/png" }));
  for (const name of ["preview", "tiles", "map0", "map1", "objects", "palettes"]) {
    const target = element(`#graphics-${name}`);
    target.getContext = () => ({ putImageData: image => { target.image = image; } });
  }
  for (const name of ["background", "window", "sprites", "live"]) element(`#graphics-${name}`).checked = true;
  element("#graphics-bank").value = element("#graphics-palette").value = "0";
  const window = new Element(), document = new Element();
  document.querySelector = element;
  document.querySelectorAll = () => [];
  const created = [];
  document.createElement = () => { const result = new Element(); created.push(result); return result; };
  document.hidden = false;
  document.body = new Element();
  let nextFrame = 0;
  const pending = new Map();
  const errors = [];
  const intervals = [];
  const downloads = [];
  window.confirm = () => true;
  window.setInterval = callback => { intervals.push(callback); return intervals.length; };
  window.setTimeout = callback => callback();
  window.clearTimeout = () => {};
  window.localStorage = { getItem: key => preferences.get(key) || null, setItem: (key, value) => preferences.set(key, value) };
  class AudioContext {
    constructor() { this.state = "running"; this.sampleRate = 48000; this.currentTime = 0; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    createGain() {
      return { gain: { value: 1, setValueAtTime(value) { this.value = value; } }, connect() {} };
    }
  }
  const scope = vm.createContext({
    document, window, navigator: { getGamepads: () => [] }, performance,
    PocketGameBoy: GameBoy, PocketZIP: ZIP,
    PocketSaves: { SaveStore: class { constructor() { return store; } }, SaveSession },
    PocketStates: States,
    PocketGraphics: Graphics,
    PocketPresets: [AladdinPreset, CrystalPreset],
    PocketScene: { ...Scene, Renderer: class {
      render(game, preset, camera, mode) { if (scope.failScene) throw new Error("WebGL failed"); scope.sceneMode = mode; scope.sceneRenders = (scope.sceneRenders || 0) + 1; return { tiles: 360 }; }
      dispose() { scope.sceneDisposed = true; }
    } },
    Uint8Array, AudioContext, ImageData: class { constructor(data) { this.data = data; } },
    Blob, URL: {
      createObjectURL: blob => { downloads.push(blob); return "blob:test"; },
      revokeObjectURL() {},
    },
    console: { error: error => errors.push(error) },
    requestAnimationFrame: callback => { pending.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => pending.delete(id),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), scope);
  scope.advance = time => {
    const [id, callback] = pending.entries().next().value;
    pending.delete(id);
    callback(time);
  };
  const evaluate = expression => vm.runInContext(expression, scope);
  return { element, evaluate, window, document, preferences, errors, pending, scope, store, intervals, downloads, created };
}
function file(name, bytes) {
  return { name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
}
async function load(h, name, bytes) {
  h.scope.testFile = file(name, bytes);
  await h.evaluate("loadRom(testFile)");
}

test("UI loads GB/GBC, advances the canvas, and pauses without pending frames", async () => {
  const h = harness();
  await load(h, "demo.gbc", makeDemoROM(true));
  assert.equal(h.evaluate("emulator.color"), true);
  assert.equal(h.element("#screen-placeholder").hidden, true);
  h.evaluate("advance(0); advance(17); advance(34)");
  assert.ok(h.evaluate("emulator.frames") >= 2);
  assert.deepEqual([...h.element("#game-canvas").image.data.slice(0, 4)], [255, 0, 0, 255]);
  await h.element("#pause-button").fire("click");
  assert.equal(h.evaluate("paused"), true);
  assert.equal(h.pending.size, 0);
  await h.element("#pause-button").fire("click");
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
  await load(h, "demo.gb", makeDemoROM(false));
  assert.equal(h.evaluate("emulator.color"), false);
});

test("first audio click enables sound; second click mutes it", async () => {
  const h = harness();
  await h.element("#sound-button").fire("click");
  assert.equal(h.evaluate("audioContext.state"), "running");
  assert.equal(h.element("#sound-button")["aria-pressed"], "true");
  await h.element("#sound-button").fire("click");
  assert.equal(h.evaluate("audioContext.state"), "suspended");
  assert.equal(h.element("#sound-button")["aria-pressed"], "false");
});

test("fast-forward scales the base cycle budget by exactly 2 and 4 at both CGB CPU speeds", async () => {
  for (const fastCPU of [false, true]) for (const speed of [1, 2, 4]) {
    const h = harness();
    await load(h, "demo.gbc", makeROM({ color: true, program: [0x18, 0xfe] }));
    if (fastCPU) h.evaluate("emulator.write(0xff4d, 1); emulator.switchSpeed()");
    h.element("#playback-speed").value = String(speed);
    h.element("#playback-speed").fire("change");
    h.scope.elapsedDots = 0;
    h.evaluate("const tick = emulator.tick; emulator.tick = function(cycles) { const dots = tick.call(this, cycles); elapsedDots += dots; return dots; }");
    h.evaluate("advance(0); advance(1000 / 60)");
    const elapsedDots = h.scope.elapsedDots;
    assert.ok(Math.abs(elapsedDots - 4194304 / 60 * speed) < 12);
    assert.equal(h.evaluate("paused"), false);
    assert.equal(h.pending.size, 1);
    assert.equal(h.evaluate("emulator.apu.samples.length"), 0);
  }
});

test("speed changes clear audio/debt without resuming pause; invalid speed reports an error", async () => {
  const h = harness();
  await load(h, "demo.gb", makeDemoROM());
  await h.element("#pause-button").fire("click");
  h.evaluate("cycleDebt = 123; nextAudioTime = 10");
  h.element("#playback-speed").value = "4";
  h.element("#playback-speed").fire("change");
  assert.equal(h.evaluate("cycleDebt"), 0);
  assert.equal(h.evaluate("nextAudioTime"), 0);
  assert.equal(h.evaluate("paused"), true);
  assert.equal(h.pending.size, 0);
  h.element("#playback-speed").value = "9";
  h.element("#playback-speed").fire("change");
  assert.equal(h.evaluate("playbackSpeed"), 4);
  assert.equal(h.element("#playback-speed").value, "4");
  assert.match(h.element("#comfort-status").textContent, /invalide/);
});

test("fast-forward drains but never queues audio, then normal speed restores output", async () => {
  const h = harness();
  await load(h, "demo.gb", makeDemoROM());
  await h.element("#sound-button").fire("click");
  h.element("#playback-speed").value = "2";
  h.element("#playback-speed").fire("change");
  h.evaluate("emulator.apu.samples.push(0.1, 0.1); outputAudio()");
  assert.equal(h.evaluate("emulator.apu.samples.length"), 0);
  assert.equal(h.errors.length, 0);
  h.scope.buffers = 0;
  h.evaluate(`audioContext.createBuffer = () => { buffers++; return {getChannelData: () => new Float32Array(1), duration: 0.01}; };
    audioContext.createBufferSource = () => ({connect(){}, start(){}, stop(){}})`);
  h.element("#playback-speed").value = "1";
  h.element("#playback-speed").fire("change");
  h.evaluate("emulator.apu.samples.push(0.1, 0.1); outputAudio()");
  assert.equal(h.scope.buffers, 1);
});

test("PNG captures work paused/running, preserve states and report missing game or encoding failure", async () => {
  const h = harness();
  await h.element("#capture-screen").fire("click");
  assert.match(h.element("#comfort-status").textContent, /indisponible/);
  await load(h, "demo.gbc", makeDemoROM(true));
  for (const paused of [false, true]) {
    if (paused) await h.element("#pause-button").fire("click");
    const before = States.capture(h.evaluate("emulator"), "0".repeat(64));
    const pending = h.pending.size;
    await h.element("#capture-screen").fire("click");
    const after = States.capture(h.evaluate("emulator"), "0".repeat(64));
    after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
    assert.equal(h.pending.size, pending);
    assert.equal(h.downloads.at(-1).type, "image/png");
    assert.match(h.created.at(-1).download, /^demo-.*\.png$/);
  }
  h.element("#game-canvas").toBlob = callback => callback(null);
  await h.element("#capture-screen").fire("click");
  assert.match(h.element("#comfort-status").textContent, /Capture impossible/);
  assert.equal(h.errors.length, 1);
});

test("graphics inspector renders only when open and refreshes while paused without affecting the game", async () => {
  const h = harness();
  await load(h, "demo.gbc", makeDemoROM(true));
  assert.equal(h.element("#graphics-tiles").image, undefined);
  h.element("#graphics-inspector").open = true;
  h.element("#graphics-inspector").fire("toggle");
  assert.ok(h.element("#graphics-tiles").image);
  assert.match(h.element("#graphics-status").textContent, /CGB/);
  await h.element("#pause-button").fire("click");
  const before = States.capture(h.evaluate("emulator"), "0".repeat(64));
  h.element("#graphics-background").checked = false;
  h.element("#graphics-background").fire("change");
  h.element("#graphics-refresh").fire("click");
  const after = States.capture(h.evaluate("emulator"), "0".repeat(64));
  after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  assert.equal(h.evaluate("paused"), true);
  assert.equal(h.pending.size, 0);
  await load(h, "demo.gb", makeDemoROM(false));
  assert.equal(h.element("#graphics-bank").disabled, true);
  assert.match(h.element("#graphics-status").textContent, /GB/);
});

test("2.5D is opt-in and switches back to original 2D without restarting or mutating the game", async () => {
  const h = harness();
  await load(h, "test.gbc", makeROM({ color: true, type: 0x19, program: [0x18, 0xfe] }));
  h.evaluate("emulator.cartridge.title = 'ALADDIN'; sceneGame = null; updateScene(true)");
  assert.equal(h.element("#scene-option").disabled, false);
  assert.equal(h.element("#world-option").disabled, true);
  assert.equal(h.element("#render-mode").value, "2d");
  const game = h.evaluate("emulator"), before = States.capture(game, "0".repeat(64));
  h.element("#render-mode").value = "2.5d";
  h.element("#render-mode").fire("change");
  assert.equal(h.element("#scene-canvas").hidden, false);
  assert.notEqual(game.videoLayers(), null);
  assert.equal(h.scope.sceneRenders, 1);
  h.element("#scene-yaw").value = "30";
  h.element("#scene-yaw").fire("input");
  assert.equal(h.evaluate("sceneCamera.yaw"), 30);
  h.element("#scene-reset").fire("click");
  assert.equal(h.evaluate("sceneCamera.yaw"), -18);
  assert.equal(h.evaluate("sceneCamera.light"), 0.75);
  h.element("#render-mode").value = "2d";
  h.element("#render-mode").fire("change");
  assert.equal(h.element("#scene-canvas").hidden, true);
  assert.equal(game.videoLayers(), null);
  assert.equal(h.evaluate("emulator"), game);
  const after = States.capture(game, "0".repeat(64));
  after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
});

test("automatic 2.5D rendering is capped at 30 Hz and stops work in original 2D", async () => {
  const h = harness();
  let time = 0;
  h.scope.performance = { now: () => time };
  await load(h, "test.gbc", makeROM({ color: true, type: 0x19, program: [0x18, 0xfe] }));
  h.evaluate("emulator.cartridge.title = 'ALADDIN'; sceneGame = null; updateScene(true)");
  h.element("#render-mode").value = "2.5d";
  h.element("#render-mode").fire("change");
  for (time = 1; time < 1000; time++) h.evaluate("draw()");
  assert.equal(h.scope.sceneRenders, 30);
  h.element("#render-mode").value = "2d";
  h.element("#render-mode").fire("change");
  for (time = 1000; time < 2000; time++) h.evaluate("draw()");
  assert.equal(h.scope.sceneRenders, 30);
  assert.equal(h.evaluate("emulator.videoLayers()"), null);
});

test("Crystal 1.1 selects its own camera and relief without affecting pause or saves", async () => {
  const h = harness(), rom = makeROM({ color: true, type: 0x10, sizeCode: 6, ramSize: 3, program: [0x18, 0xfe] });
  rom.fill(0, 0x134, 0x143);
  rom.set(Buffer.from("PM_CRYSTAL"), 0x134); rom[0x14c] = 1;
  let checksum = 0;
  for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - rom[i] - 1) & 255;
  rom[0x14d] = checksum;
  await load(h, "test.gbc", rom);
  assert.equal(h.evaluate("scenePreset.id"), CrystalPreset.id);
  assert.equal(h.element("#scene-option").disabled, false);
  assert.equal(h.element("#world-option").disabled, false);
  await h.element("#pause-button").fire("click");
  const game = h.evaluate("emulator"), before = States.capture(game, "0".repeat(64));
  const saves = structuredClone(h.store.records);
  h.element("#render-mode").value = "2.5d"; h.element("#render-mode").fire("change");
  const defaults = { yaw: 0, pitch: -20, zoom: 0.83, thickness: 14, light: 0.73 };
  for (const [key, value] of Object.entries(defaults)) {
    assert.equal(h.evaluate(`sceneCamera.${key}`), value);
    assert.equal(h.element(`#scene-${key}`).value, String(Math.round(value * (["zoom", "light"].includes(key) ? 100 : 1))));
  }
  h.element("#scene-light").value = "10"; h.element("#scene-light").fire("input");
  h.element("#scene-reset").fire("click");
  for (const [key, value] of Object.entries(defaults)) assert.equal(h.evaluate(`sceneCamera.${key}`), value);
  h.element("#render-mode").value = "3d"; h.element("#render-mode").fire("change");
  assert.equal(h.scope.sceneMode, "3d");
  assert.equal(h.element("#scene-canvas").hidden, false);
  h.element("#scene-reset").fire("click");
  for (const [key, value] of Object.entries(defaults)) assert.equal(h.evaluate(`sceneCamera.${key}`), value);
  assert.equal(h.evaluate("paused"), true);
  assert.equal(h.pending.size, 0);
  assert.deepEqual(h.store.records, saves);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  await h.element("#pause-button").fire("click");
  assert.equal(h.evaluate("paused"), false);
  h.element("#render-mode").value = "2.5d"; h.element("#render-mode").fire("change");
  assert.equal(h.scope.sceneMode, "2.5d");
  assert.equal(h.pending.size, 1);
  await load(h, "aladdin.gbc", makeROM({ color: true, type: 0x19, program: [0x18, 0xfe] }));
  h.evaluate("emulator.cartridge.title = 'ALADDIN'; sceneGame = null; updateScene(true)");
  assert.equal(h.element("#world-option").disabled, true);
  h.element("#render-mode").value = "3d"; h.element("#render-mode").fire("change");
  assert.equal(h.element("#render-mode").value, "2d");
  assert.match(h.element("#scene-status").textContent, /aucun preset 3D/);
  assert.equal(h.evaluate("paused"), false);
});

test("unsupported ROMs and rendering failures fall back explicitly without stopping emulation", async () => {
  const h = harness();
  await load(h, "demo.gb", makeDemoROM(false));
  assert.equal(h.element("#scene-option").disabled, true);
  h.element("#render-mode").value = "2.5d";
  h.element("#render-mode").fire("change");
  assert.equal(h.element("#render-mode").value, "2d");
  assert.match(h.element("#scene-status").textContent, /indisponible/);
  await load(h, "test.gbc", makeROM({ color: true, type: 0x19, program: [0x18, 0xfe] }));
  h.evaluate("emulator.cartridge.title = 'ALADDIN'; sceneGame = null; updateScene(true)");
  h.scope.failScene = true;
  h.element("#render-mode").value = "2.5d";
  h.element("#render-mode").fire("change");
  assert.equal(h.element("#render-mode").value, "2d");
  assert.equal(h.element("#scene-canvas").hidden, true);
  assert.match(h.element("#scene-status").textContent, /WebGL failed/);
  assert.equal(h.scope.sceneDisposed, true);
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
  assert.equal(h.errors.length, 1);
});

test("2.5D camera works paused, rejects invalid values and handles context loss", async () => {
  const h = harness();
  await load(h, "test.gbc", makeROM({ color: true, type: 0x19, program: [0x18, 0xfe] }));
  h.evaluate("emulator.cartridge.title = 'ALADDIN'; sceneGame = null; updateScene(true)");
  await h.element("#pause-button").fire("click");
  h.element("#render-mode").value = "2.5d";
  h.element("#render-mode").fire("change");
  h.element("#scene-zoom").value = "110";
  h.element("#scene-zoom").fire("input");
  assert.equal(h.evaluate("sceneCamera.zoom"), 1.1);
  assert.equal(h.pending.size, 0);
  h.element("#scene-yaw").value = "100";
  h.element("#scene-yaw").fire("input");
  assert.match(h.element("#scene-status").textContent, /refusé/);
  assert.equal(h.evaluate("sceneCamera.yaw"), -18);
  let prevented = false;
  h.element("#scene-canvas").fire("webglcontextlost", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.element("#render-mode").value, "2d");
  assert.equal(h.evaluate("paused"), true);
  assert.equal(h.scope.sceneDisposed, true);
});

test("fullscreen enters/exits natively and browser Escape updates the button", async () => {
  const h = harness(), player = h.element(".player-column");
  h.document.fullscreenEnabled = true;
  player.requestFullscreen = async () => { h.document.fullscreenElement = player; };
  h.document.exitFullscreen = async () => { h.document.fullscreenElement = null; };
  await h.element("#fullscreen-button").fire("click");
  assert.equal(player.classes.has("is-immersive"), true);
  assert.equal(h.element("#fullscreen-button")["aria-pressed"], "true");
  await h.element("#fullscreen-button").fire("click");
  assert.equal(player.classes.has("is-immersive"), false);
  await h.element("#fullscreen-button").fire("click");
  h.document.fullscreenElement = null;
  h.document.fire("fullscreenchange");
  assert.equal(h.element("#fullscreen-button")["aria-pressed"], "false");
});

test("unsupported or rejected fullscreen falls back explicitly and Escape exits", async () => {
  for (const rejected of [false, true]) {
    const h = harness();
    if (rejected) {
      h.document.fullscreenEnabled = true;
      h.element(".player-column").requestFullscreen = async () => { throw new Error("Denied"); };
    }
    await h.element("#fullscreen-button").fire("click");
    assert.equal(h.document.body.classes.has("is-immersive"), true);
    assert.match(h.element("#fullscreen-status").textContent, /immersif actif/);
    if (rejected) assert.match(h.element("#fullscreen-status").textContent, /Denied/);
    h.window.fire("keydown", { code: "Escape", preventDefault() {} });
    assert.equal(h.document.body.classes.has("is-immersive"), false);
  }
});

test("F shortcut excludes text entry, modifiers and repeats and preserves the machine", async () => {
  const h = harness();
  await load(h, "demo.gb", makeDemoROM());
  const game = h.evaluate("emulator");
  for (const patch of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { target: { closest: () => ({}) } }]) {
    h.window.fire("keydown", { code: "KeyF", target: new Element(), preventDefault() {}, ...patch });
    assert.equal(h.evaluate("immersiveFallback"), false);
  }
  h.window.fire("keydown", { code: "KeyF", target: new Element(), preventDefault() {} });
  assert.equal(h.evaluate("immersiveFallback"), true);
  assert.equal(h.evaluate("emulator"), game);
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
});

test("UI opens compressed ZIPs, offers multiple games and selects GB", async () => {
  const h = harness(), color = makeDemoROM(true), classic = makeDemoROM(false);
  await load(h, "single.zip", makeZIP([{ name: "dir/color.gbc", data: color }], { method: 8 }));
  assert.equal(h.evaluate("loadedName"), "dir/color.gbc");
  await load(h, "multi.zip", makeZIP([
    { name: "color.gbc", data: color }, { name: "classic.gb", data: classic },
  ], { method: 8 }));
  assert.equal(h.element("#archive-picker").hidden, false);
  assert.deepEqual(h.element("#archive-rom").children.map(option => option.textContent), ["color.gbc", "classic.gb"]);
  h.element("#archive-rom").value = "1";
  await h.element("#archive-open").fire("click");
  assert.equal(h.evaluate("loadedName"), "classic.gb");
  assert.equal(h.element("#archive-picker").hidden, true);
});

test("invalid files leave the active game intact and report errors", async () => {
  const h = harness();
  await load(h, "valid.gbc", makeDemoROM(true));
  const active = h.evaluate("emulator");
  await load(h, "bad.gbc", new Uint8Array(12));
  assert.match(h.element("#status-message").textContent, /tronquee/);
  assert.ok(h.element("#status-message").classes.has("is-error"));
  assert.equal(h.evaluate("emulator"), active);
  await load(h, "invalid.txt", new Uint8Array([1]));
  assert.match(h.element("#status-message").textContent, /\.ZIP/);
  assert.equal(h.evaluate("emulator"), active);
});

test("a newer file wins an asynchronous loading race", async () => {
  const h = harness();
  let resolve;
  h.scope.testFile = { name: "old.gb", size: 32768, arrayBuffer: () => new Promise(done => { resolve = done; }) };
  const oldLoad = h.evaluate("loadRom(testFile)");
  await load(h, "new.gbc", makeDemoROM(true));
  resolve(makeDemoROM(false).buffer);
  await oldLoad;
  assert.equal(h.evaluate("loadedName"), "new.gbc");
});

test("keyboard group overlap and blur release all keys", async () => {
  const h = harness();
  await load(h, "game.gb", makeDemoROM(false));
  const target = new Element();
  const key = code => ({ code, target, preventDefault() {} });
  h.window.fire("keydown", key("ShiftLeft")); h.window.fire("keydown", key("ShiftRight"));
  assert.equal(h.evaluate("emulator.buttons"), 64);
  h.window.fire("keyup", key("ShiftLeft"));
  assert.equal(h.evaluate("emulator.buttons"), 64);
  h.window.fire("keydown", key("KeyQ"));
  assert.equal(h.evaluate("emulator.buttons"), 80);
  h.window.fire("blur");
  assert.equal(h.evaluate("emulator.buttons"), 0);
});

for (const [layout, labels] of [["AZERTY", ["a", "z"]], ["QWERTY", ["q", "w"]]]) {
  test(`${layout} action keys press and release A/B independently`, async () => {
    const h = harness();
    await load(h, "game.gb", makeDemoROM(false));
    const target = new Element();
    let prevented = 0;
    const key = (code, label) => ({ code, key: label, target, preventDefault() { prevented++; } });
    h.window.fire("keydown", key("KeyQ", labels[0]));
    assert.equal(h.evaluate("emulator.buttons"), 16);
    h.window.fire("keydown", key("KeyQ", labels[0]));
    assert.equal(h.evaluate("emulator.buttons"), 16);
    h.window.fire("keydown", key("KeyW", labels[1]));
    assert.equal(h.evaluate("emulator.buttons"), 48);
    h.window.fire("keyup", key("KeyQ", labels[0]));
    assert.equal(h.evaluate("emulator.buttons"), 32);
    h.window.fire("keyup", key("KeyW", labels[1]));
    assert.equal(h.evaluate("emulator.buttons"), 0);
    assert.equal(prevented, 3);
    h.window.fire("keydown", key("KeyA", layout === "AZERTY" ? "q" : "a"));
    h.window.fire("keydown", key("KeyZ", layout === "AZERTY" ? "w" : "z"));
    h.window.fire("keydown", key("KeyX", "x"));
    assert.equal(h.evaluate("emulator.buttons"), 0);
  });
}

test("invalid CPU instruction stops the loop and offers reset, not false success", async () => {
  const h = harness(), rom = makeDemoROM(true);
  rom[0x150] = 0xd3;
  await load(h, "illegal.gbc", rom);
  h.evaluate("advance(0); advance(17)");
  assert.equal(h.evaluate("paused"), true);
  assert.equal(h.pending.size, 0);
  assert.match(h.element("#status-message").textContent, /Opcode invalide/);
  assert.equal(h.element("#screen-caption").textContent, "ERREUR");
  assert.equal(h.element("#pause-button").disabled, true);
  assert.equal(h.element("#reset-button").disabled, false);
});

test("autosave survives a new page session, restart, rename and loading the same ROM from ZIP", async () => {
  const store = memorySaveStore(), h = harness(store);
  const rom = makeROM({ type: 3, ramSize: 3 });
  await load(h, "first.gb", rom);
  h.evaluate("emulator.cartridge.control(0, 10); emulator.cartridge.writeRAM(0xa123, 0x42)");
  await h.intervals[0]();
  assert.equal(store.records.size, 2);
  assert.match(h.element("#save-status").textContent, /enregistrée/);
  h.evaluate("emulator.cartridge.writeRAM(0xa123, 0x56)");
  await h.element("#reset-button").fire("click");
  assert.equal(h.evaluate("emulator.cartridge.ram[0x123]"), 0x56);
  const fresh = harness(store);
  await load(fresh, "renamed.gb", rom);
  assert.equal(fresh.evaluate("emulator.cartridge.ram[0x123]"), 0x56);
  await load(fresh, "game.zip", makeZIP([{ name: "nested/again.gb", data: rom }], { method: 8 }));
  assert.equal(fresh.evaluate("emulator.cartridge.ram[0x123]"), 0x56);
  assert.equal(store.records.size, 2);
});

test("changing ROM commits the old game without leaking its RAM into the new one", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2 });
  await load(h, "one.gb", rom);
  h.evaluate("emulator.cartridge.control(0, 10); emulator.cartridge.writeRAM(0xa000, 99)");
  const other = rom.slice(); other[0x200] ^= 1;
  await load(h, "same-name.gb", other);
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 0);
  await load(h, "same-name.gb", rom);
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 99);
});

test("import SAV validates, confirms, reboots and persists RAM; export is raw RAM", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2 });
  await load(h, "dir/game.gb", rom);
  const input = h.element("#save-file");
  input.files = [file("bad.sav", new Uint8Array(10))];
  await input.fire("change");
  assert.match(h.element("#save-status").textContent, /8192 octets/);
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 0);
  const bytes = new Uint8Array(8192); bytes[0] = 42; bytes[8191] = 99;
  h.window.confirm = () => false;
  input.files = [file("game.sav", bytes)]; await input.fire("change");
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 0);
  h.window.confirm = () => true;
  input.files = [file("game.sav", bytes)]; await input.fire("change");
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 42);
  assert.equal(h.evaluate("emulator.cpu.pc"), 0x100);
  assert.equal(h.evaluate("saveSession.dirty"), false);
  await h.element("#export-save").fire("click");
  assert.equal(h.created.at(-1).download, "game.sav");
  assert.deepEqual(new Uint8Array(await h.downloads[0].arrayBuffer()), bytes);
  const fresh = harness(h.store); await load(fresh, "game.gb", rom);
  assert.equal(fresh.evaluate("emulator.cartridge.ram[8191]"), 99);
});

test("storage write failure leaves the old game dirty, blocks switching and allows export", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2 });
  await load(h, "one.gb", rom);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(7))");
  const old = h.evaluate("emulator"), write = h.store.write;
  h.store.write = async () => { throw new Error("Quota exceeded"); };
  await h.intervals[0]();
  assert.match(h.element("#save-status").textContent, /Quota exceeded/);
  assert.equal(h.evaluate("saveSession.dirty"), true);
  await load(h, "other.gb", makeDemoROM());
  assert.equal(h.evaluate("emulator"), old);
  assert.equal(h.element("#export-save").disabled, false);
  h.store.write = write;
  await h.element("#save-button").fire("click");
  assert.equal(h.evaluate("saveSession.dirty"), false);
});

test("corrupt or inaccessible storage does not launch a fresh game over an existing save", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2 });
  h.store.read = async () => ({ version: 500 });
  await load(h, "game.gb", rom);
  assert.equal(h.evaluate("emulator"), null);
  assert.match(h.element("#save-status").textContent, /invalide/);
  assert.equal(h.store.records.size, 0);
  h.store.read = async () => { throw new Error("Access denied"); };
  await load(h, "game.gb", rom);
  assert.equal(h.evaluate("emulator"), null);
  assert.match(h.element("#status-message").textContent, /Access denied/);
});

test("dirty saves warn before unload; visibility and pause trigger commits", async () => {
  const h = harness();
  await load(h, "game.gb", makeROM({ type: 3, ramSize: 2 }));
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(3))");
  let warned = false;
  const event = { preventDefault() { warned = true; } };
  h.window.fire("beforeunload", event);
  assert.equal(warned, true);
  await h.evaluate("saveSession.pending");
  assert.equal(h.evaluate("saveSession.dirty"), false);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(4))");
  await h.element("#pause-button").fire("click");
  await h.evaluate("saveSession.pending");
  assert.equal(h.evaluate("saveSession.dirty"), false);
});

test("a newer ROM cancels an older pending save restore without replacing the active game", async () => {
  const h = harness(), oldROM = makeROM({ type: 3, ramSize: 2 });
  let resolveRead, signalRead;
  const readStarted = new Promise(resolve => { signalRead = resolve; });
  const read = h.store.read;
  h.store.read = () => new Promise(resolve => { resolveRead = resolve; signalRead(); });
  h.scope.testFile = file("old.gb", oldROM);
  const pendingLoad = h.evaluate("loadRom(testFile)");
  await readStarted;
  h.store.read = read;
  const nextROM = makeDemoROM(true);
  h.scope.testFile = file("new.gbc", nextROM);
  const nextLoad = h.evaluate("loadRom(testFile)");
  resolveRead(undefined);
  await Promise.all([pendingLoad, nextLoad]);
  assert.equal(h.evaluate("loadedName"), "new.gbc");
  assert.equal(h.evaluate("saveSession"), null);
  assert.equal(h.evaluate("transitioning"), false);
});

test("failed SAV import commit rolls back UI state and preserves previous RAM", async () => {
  const h = harness();
  await load(h, "game.gb", makeROM({ type: 3, ramSize: 2 }));
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(2))");
  await h.evaluate("saveCurrent()");
  const old = h.evaluate("emulator");
  h.store.write = async () => { throw new Error("Disk full"); };
  h.element("#save-file").files = [file("game.sav", new Uint8Array(8192).fill(3))];
  await h.element("#save-file").fire("change");
  assert.equal(h.evaluate("emulator"), old);
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 2);
  assert.match(h.element("#save-status").textContent, /Disk full/);
  assert.equal(h.element("#export-save").disabled, false);
});

test("SAV import preserves RTC, and clock-only cartridges cannot import/export RAM", async () => {
  const h = harness();
  await load(h, "clock.gb", makeROM({ type: 0x10, ramSize: 2 }));
  h.evaluate("emulator.cartridge.rtc.set([12,34,5,6,0x40]); emulator.cartridge.saveRevision++");
  h.element("#save-file").files = [file("clock.sav", new Uint8Array(8192).fill(3))];
  await h.element("#save-file").fire("change");
  assert.deepEqual([...h.evaluate("emulator.cartridge.rtc")], [12, 34, 5, 6, 0x40]);
  await load(h, "clock-only.gb", makeROM({ type: 0x0f }));
  assert.equal(h.element("#save-button").disabled, false);
  assert.equal(h.element("#export-save").disabled, true);
  assert.equal(h.element("#import-save").disabled, true);
});

test("RTC at boot cannot overwrite the RAM restored message or change the saved RAM", async () => {
  const h = harness(), rom = makeROM({ type: 0x10, ramSize: 3 });
  const saved = new GameBoy(rom).cartridge;
  saved.importRAM(new Uint8Array(32768).fill(0x44));
  const key = await h.store.keyFor(rom);
  await h.store.write(key, saved.saveData());
  await load(h, "clock.gb", rom);
  const message = h.element("#save-status").textContent;
  assert.match(message, /restaurée avant/);
  h.evaluate("emulator.cartridge.lastRTC -= 2100");
  await h.intervals[0]();
  assert.equal(h.element("#save-status").textContent, message);
  assert.equal(h.store.records.get(key).ram[0], 0x44);
});

test("reload local RAM discards unsaved running RAM; recovery can restore the pre-boot copy", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2 }), cart = new GameBoy(rom).cartridge;
  cart.importRAM(new Uint8Array(8192).fill(0x55));
  const key = await h.store.keyFor(rom);
  await h.store.write(key, cart.saveData());
  await load(h, "game.gb", rom);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(0x33))");
  await h.element("#reload-save").fire("click");
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 0x55);
  assert.equal(h.store.records.get(key).ram[0], 0x55);
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(0))");
  await h.intervals[0]();
  assert.equal(h.store.records.get(key).ram[0], 0);
  await h.element("#recover-save").fire("click");
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 0x55);
  assert.equal(h.store.records.get(key).ram[0], 0x55);
});

test("states survive reload, restore the same instant and cannot autosave over in-game RAM", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2, program: [0x18, 0xfe] });
  await load(h, "game.gb", rom);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(1))");
  await h.evaluate("saveCurrent(true)");
  h.evaluate("emulator.runCycles(10000); emulator.write(0xc123, 0x77)");
  const pc = h.evaluate("emulator.cpu.pc"), dot = h.evaluate("emulator.dot");
  await h.element("#save-state").fire("click");
  const key = await h.store.keyFor(rom);
  assert.equal(h.store.records.get(key).ram[0], 1);
  const fresh = harness(h.store);
  await load(fresh, "renamed.gb", rom);
  await fresh.element("#load-state").fire("click");
  assert.equal(fresh.evaluate("emulator.cpu.pc"), pc);
  assert.equal(fresh.evaluate("emulator.dot"), dot);
  assert.equal(fresh.evaluate("emulator.read(0xc123)"), 0x77);
  assert.equal(fresh.evaluate("paused"), false);
  assert.equal(fresh.pending.size, 1);
  assert.equal(fresh.evaluate("stateMode"), true);
  fresh.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(9))");
  await fresh.intervals[0]();
  assert.equal(h.store.records.get(key).ram[0], 1);
  await fresh.element("#reset-button").fire("click");
  assert.equal(fresh.evaluate("emulator.cartridge.ram[0]"), 1);
  assert.equal(fresh.evaluate("stateMode"), false);
});

test("local RAM reload waits for an in-flight commit and restores the committed bytes", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2 });
  await load(h, "game.gb", rom);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(1))");
  await h.evaluate("saveCurrent()");
  const write = h.store.write, read = h.store.read;
  let releaseWrite, signalWrite, signalRead;
  const blocked = new Promise(resolve => { releaseWrite = resolve; });
  const writing = new Promise(resolve => { signalWrite = resolve; });
  const reading = new Promise(resolve => { signalRead = resolve; });
  h.store.write = async (...args) => { signalWrite(); await blocked; return write(...args); };
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(2))");
  const commit = h.evaluate("saveCurrent()");
  await writing;
  h.store.read = async (...args) => { const data = await read(...args); signalRead(); return data; };
  const reload = h.element("#reload-save").fire("click");
  await reading;
  releaseWrite();
  await Promise.all([commit, reload]);
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 2);
  assert.equal(h.evaluate("saveSession.committedData.ram[0]"), 2);
  const key = await h.store.keyFor(rom);
  assert.equal(h.store.records.get(key).ram[0], 2);
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
});

test("state RAM replaces SAV only after explicit confirmation, with recovery preserved", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2, program: [0x18, 0xfe] });
  await load(h, "game.gb", rom);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(1))");
  await h.evaluate("saveCurrent(true)");
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(2))");
  await h.element("#save-state").fire("click");
  await h.element("#load-state").fire("click");
  const key = await h.store.keyFor(rom);
  h.window.confirm = () => false;
  await h.element("#save-button").fire("click");
  assert.equal(h.store.records.get(key).ram[0], 1);
  h.window.confirm = () => true;
  await h.element("#save-button").fire("click");
  assert.equal(h.store.records.get(key).ram[0], 2);
  assert.equal(h.store.records.get(`backup:${key}`).ram[0], 1);
  assert.equal(h.evaluate("stateMode"), false);
});

test("state export/import works without cartridge RAM and invalid files keep the live machine", async () => {
  const h = harness(), rom = makeDemoROM(true);
  await load(h, "game.gbc", rom);
  h.evaluate("emulator.runCycles(10000)");
  await h.element("#export-state").fire("click");
  assert.equal(h.created.at(-1).download, "game.state");
  const blob = h.downloads.at(-1), old = h.evaluate("emulator");
  h.element("#state-file").files = [{ name: "game.state", size: blob.size, text: () => blob.text() }];
  await h.element("#state-file").fire("change");
  assert.notEqual(h.evaluate("emulator"), old);
  assert.equal(h.evaluate("stateMode"), true);
  assert.equal(h.evaluate("saveSession"), null);
  const active = h.evaluate("emulator");
  const invalid = new Blob(["{}"]);
  h.element("#state-file").files = [{ name: "bad.state", size: invalid.size, text: () => invalid.text() }];
  await h.element("#state-file").fire("change");
  assert.equal(h.evaluate("emulator"), active);
  assert.match(h.element("#state-status").textContent, /incompatible/);
});

test("a synthetic game sees the imported in-game save in the correct SRAM bank at boot", async () => {
  const program = [
    0x3e, 10, 0xea, 0, 0, 0x3e, 2, 0xea, 0, 0x40,
    0xfa, 0, 0xa0, 0xfe, 0x77, 0xc2, 0, 0,
    0x3e, 1, 0xea, 0, 0xc0, 0x18, 0xfe,
  ];
  const failureAddress = 0x150 + program.length;
  program[16] = failureAddress & 255; program[17] = failureAddress >> 8;
  program.push(0xaf, 0xea, 0, 0xc0, 0x18, 0xfe);
  const rom = makeROM({ color: true, type: 0x10, ramSize: 3, program });
  const h = harness();
  await load(h, "game.gbc", rom);
  const ram = new Uint8Array(32768); ram[2 * 8192] = 0x77;
  h.element("#save-file").files = [file("game.sav", ram)];
  await h.element("#save-file").fire("change");
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.evaluate("emulator.cpu.pc"), 0x100);
  h.evaluate("advance(0); advance(17)");
  assert.equal(h.evaluate("emulator.wram[0]"), 1);
  const fresh = harness(h.store);
  await load(fresh, "same.gbc", rom);
  fresh.evaluate("advance(0); advance(17)");
  assert.equal(fresh.evaluate("emulator.wram[0]"), 1);
  const key = await h.store.keyFor(rom);
  assert.equal(h.store.records.get(key).ram[2 * 8192], 0x77);
});

test("volume, FPS and physical key mappings persist and conflicts are refused", async () => {
  const h = harness();
  await h.element("#sound-button").fire("click");
  h.element("#volume").value = "25";
  h.element("#volume").fire("input");
  assert.equal(h.evaluate("audioGain.gain.value"), 0.25);
  h.element("#show-fps").checked = true;
  h.element("#show-fps").fire("change");
  h.element("#key-action").value = "4";
  h.element("#bind-key").fire("click");
  const press = code => h.window.fire("keydown", { code, target: new Element(), preventDefault() {} });
  press("ArrowLeft");
  assert.match(h.element("#key-status").textContent, /déjà utilisée/);
  press("KeyF");
  assert.match(h.element("#key-status").textContent, /réservée/);
  press("KeyX");
  assert.equal(h.evaluate("keys.get('KeyX')"), 4);
  assert.equal(h.evaluate("keys.has('KeyQ')"), false);
  const fresh = harness(h.store, h.preferences);
  assert.equal(fresh.evaluate("volume"), 0.25);
  assert.equal(fresh.evaluate("keys.get('KeyX')"), 4);
  assert.equal(fresh.element("#show-fps").checked, true);
  await load(fresh, "demo.gb", makeDemoROM());
  fresh.window.fire("keydown", { code: "KeyX", target: new Element(), preventDefault() {} });
  assert.equal(fresh.evaluate("emulator.buttons"), 1 << 4);
  fresh.element("#reset-keys").fire("click");
  assert.equal(fresh.evaluate("emulator.buttons"), 0);
  assert.equal(fresh.evaluate("keys.get('KeyQ')"), 4);
});

test("unavailable preference storage is reported without preventing play", async () => {
  const h = harness();
  h.window.localStorage.setItem = () => { throw new Error("Access denied"); };
  h.element("#volume").value = "0";
  h.element("#volume").fire("input");
  assert.match(h.element("#preferences-status").textContent, /Access denied/);
  assert.equal(h.evaluate("volume"), 0);
  await load(h, "demo.gb", makeDemoROM());
  assert.ok(h.evaluate("emulator"));
});

test("standard gamepads merge with keyboard, release on disconnect and respect focus and pause", async () => {
  const h = harness();
  await load(h, "demo.gb", makeDemoROM());
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  buttons[0].pressed = true;
  const pad = { connected: true, mapping: "standard", buttons, axes: [0.5, -0.5] };
  h.scope.navigator.getGamepads = () => [null, pad];
  h.evaluate("pollGamepads()");
  assert.equal(h.evaluate("emulator.buttons"), (1 << 4) | 1 | (1 << 2));
  h.window.fire("keydown", { code: "KeyQ", target: new Element(), preventDefault() {} });
  h.scope.navigator.getGamepads = () => [];
  h.evaluate("pollGamepads()");
  assert.equal(h.evaluate("emulator.buttons"), 1 << 4);
  h.window.fire("keyup", { code: "KeyQ" });
  assert.equal(h.evaluate("emulator.buttons"), 0);
  h.scope.navigator.getGamepads = () => [pad];
  h.window.fire("blur");
  h.evaluate("pollGamepads()");
  assert.equal(h.evaluate("emulator.buttons"), 0);
  h.window.fire("focus");
  await h.element("#pause-button").fire("click");
  h.evaluate("pollGamepads()");
  assert.equal(h.evaluate("emulator.buttons"), 0);
  await h.element("#pause-button").fire("click");
  h.evaluate("pollGamepads()");
  assert.equal(h.evaluate("emulator.buttons"), (1 << 4) | 1 | (1 << 2));
  pad.mapping = "";
  h.evaluate("pollGamepads()");
  assert.equal(h.evaluate("emulator.buttons"), 0);
  assert.match(h.element("#gamepad-status").textContent, /non standard/);
});

test("three independent state slots keep names previews and legacy slot one", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2, program: [0x18, 0xfe] });
  await load(h, "game.gb", rom);
  const key = await h.store.keyFor(rom);
  for (let slot = 1; slot <= 3; slot++) {
    h.element("#state-slot").value = String(slot);
    await h.element("#state-slot").fire("change");
    h.element("#state-name").value = `Partie ${slot}`;
    h.evaluate(`emulator.wram[123] = ${slot}`);
    await h.element("#save-state").fire("click");
  }
  assert.equal(h.store.records.get(`state:${key}`).name, "Partie 1");
  const fresh = harness(h.store);
  await load(fresh, "game.gb", rom);
  for (let slot = 1; slot <= 3; slot++) {
    fresh.element("#state-slot").value = String(slot);
    await fresh.element("#state-slot").fire("change");
    assert.equal(fresh.element("#state-name").value, `Partie ${slot}`);
    assert.equal(fresh.element("#state-preview").hidden, false);
    await fresh.element("#load-state").fire("click");
    assert.equal(fresh.evaluate("emulator.wram[123]"), slot);
    assert.equal(fresh.evaluate("paused"), false);
    assert.equal(fresh.pending.size, 1);
  }
  fresh.window.confirm = () => false;
  fresh.evaluate("emulator.wram[123] = 9");
  await fresh.element("#save-state").fire("click");
  assert.equal(h.store.records.get(`state:${key}:3`).memory.wram[123], 3);
});

test("historical RAM restoration resumes automatically and preserves main SAV from states", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2 });
  await load(h, "game.gb", rom);
  for (let value = 1; value <= 5; value++) {
    h.evaluate(`emulator.cartridge.importRAM(new Uint8Array(8192).fill(${value}))`);
    await h.evaluate("saveCurrent()");
  }
  const key = await h.store.keyFor(rom);
  assert.equal(h.store.records.get(`history:${key}`).length, 3);
  assert.deepEqual(h.store.records.get(`history:${key}`).map(copy => copy.data.ram[0]), [4, 3, 2]);
  h.element("#ram-history").value = "1";
  await h.element("#restore-history").fire("click");
  assert.equal(h.evaluate("emulator.cartridge.ram[0]"), 3);
  assert.equal(h.store.records.get(key).ram[0], 3);
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
});

test("FPS diagnostics measure emulated frames and report bounded catch-up", async () => {
  const h = harness();
  await load(h, "game.gbc", makeROM({ color: true, program: [0x18, 0xfe] }));
  h.element("#show-fps").checked = true;
  h.element("#show-fps").fire("change");
  for (let time = 0; time <= 1050; time += 17) h.evaluate(`advance(${time})`);
  assert.match(h.element("#fps-status").textContent, /^5[89]\.\d FPS jeu/);
  h.evaluate("advance(2200)");
  assert.match(h.element("#fps-status").textContent, /1 rattrapage/);
});

test("every successful restore leaves a previously paused game running with a single callback", async () => {
  const h = harness(), rom = makeROM({ type: 3, ramSize: 2, program: [0x18, 0xfe] });
  await load(h, "game.gb", rom);
  h.evaluate("emulator.cartridge.importRAM(new Uint8Array(8192).fill(1))");
  await h.evaluate("saveCurrent()");
  await h.element("#save-state").fire("click");
  await h.element("#export-state").fire("click");
  const blob = h.downloads.at(-1);
  const restores = [
    () => h.element("#reload-save").fire("click"),
    async () => {
      h.element("#save-file").files = [file("game.sav", new Uint8Array(8192).fill(2))];
      await h.element("#save-file").fire("change");
    },
    () => h.element("#recover-save").fire("click"),
    () => h.element("#load-state").fire("click"),
    async () => {
      h.element("#state-file").files = [{ name: "game.state", size: blob.size, text: () => blob.text() }];
      await h.element("#state-file").fire("change");
    },
  ];
  for (const restore of restores) {
    await h.element("#pause-button").fire("click");
    assert.equal(h.evaluate("paused"), true);
    assert.equal(h.pending.size, 0);
    await restore();
    assert.equal(h.evaluate("paused"), false);
    assert.equal(h.pending.size, 1);
    assert.equal(h.element("#pause-button").textContent, "Pause");
  }
});

test("F6/F8 use the selected slot without taking over text entry", async () => {
  const h = harness();
  await load(h, "game.gb", makeROM({ program: [0x18, 0xfe] }));
  h.element("#state-slot").value = "2";
  const key = h.evaluate("gameKey");
  h.evaluate("emulator.wram[123] = 6");
  h.window.fire("keydown", { code: "F6", target: { closest: () => ({}) }, preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.records.has(`state:${key}:2`), false);
  h.window.fire("keydown", { code: "F6", target: new Element(), preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.records.get(`state:${key}:2`).memory.wram[123], 6);
  h.evaluate("emulator.wram[123] = 9");
  h.window.fire("keydown", { code: "F8", target: new Element(), preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.evaluate("emulator.wram[123]"), 6);
  assert.equal(h.evaluate("paused"), false);
  assert.equal(h.pending.size, 1);
});

test("quick-state success and failures are visible inside the immersive player", async () => {
  const h = harness();
  await load(h, "game.gb", makeROM({ program: [0x18, 0xfe] }));
  await h.element("#fullscreen-button").fire("click");
  await h.element("#quick-save").fire("click");
  assert.equal(h.element("#fullscreen-status").hidden, false);
  assert.match(h.element("#fullscreen-status").textContent, /État 1 enregistré/);
  h.store.read = async () => { throw new Error("Access denied"); };
  await h.element("#quick-load").fire("click");
  assert.match(h.element("#fullscreen-status").textContent, /Access denied/);
  assert.equal(h.element("#fullscreen-status").classes.has("is-error"), true);
});
