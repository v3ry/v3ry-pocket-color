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

class Element {
  constructor() {
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.files = [];
    this.disabled = false;
    this.classes = new Set();
    this.classList = {
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      add: name => this.classes.add(name), remove: name => this.classes.delete(name),
    };
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  fire(name, event = {}) { return this.listeners.get(name)?.(event); }
  setAttribute(name, value) { this[name] = value; }
  closest() { return null; }
  replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ""; }
  click() { return this.fire("click"); }
  append() {}
  remove() {}
}

function harness(store = memorySaveStore()) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const canvas = element("#game-canvas");
  const context = { putImageData: image => { canvas.image = image; } };
  canvas.getContext = () => context;
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
  class AudioContext {
    constructor() { this.state = "running"; this.sampleRate = 48000; this.currentTime = 0; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  }
  const scope = vm.createContext({
    document, window, PocketGameBoy: GameBoy, PocketZIP: ZIP,
    PocketSaves: { SaveStore: class { constructor() { return store; } }, SaveSession },
    PocketStates: States,
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
  return { element, evaluate, window, errors, pending, scope, store, intervals, downloads, created };
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
  assert.equal(store.records.size, 1);
  assert.match(h.element("#save-status").textContent, /enregistrée/);
  h.evaluate("emulator.cartridge.writeRAM(0xa123, 0x56)");
  await h.element("#reset-button").fire("click");
  assert.equal(h.evaluate("emulator.cartridge.ram[0x123]"), 0x56);
  const fresh = harness(store);
  await load(fresh, "renamed.gb", rom);
  assert.equal(fresh.evaluate("emulator.cartridge.ram[0x123]"), 0x56);
  await load(fresh, "game.zip", makeZIP([{ name: "nested/again.gb", data: rom }], { method: 8 }));
  assert.equal(fresh.evaluate("emulator.cartridge.ram[0x123]"), 0x56);
  assert.equal(store.records.size, 1);
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
  assert.equal(h.evaluate("paused"), true);
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
  assert.equal(fresh.evaluate("paused"), true);
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
  assert.equal(h.evaluate("paused"), true);
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
  assert.equal(h.evaluate("paused"), true);
  assert.equal(h.evaluate("emulator.cpu.pc"), 0x100);
  await h.element("#pause-button").fire("click");
  h.evaluate("advance(0); advance(17)");
  assert.equal(h.evaluate("emulator.wram[0]"), 1);
  const fresh = harness(h.store);
  await load(fresh, "same.gbc", rom);
  fresh.evaluate("advance(0); advance(17)");
  assert.equal(fresh.evaluate("emulator.wram[0]"), 1);
  const key = await h.store.keyFor(rom);
  assert.equal(h.store.records.get(key).ram[2 * 8192], 0x77);
});
