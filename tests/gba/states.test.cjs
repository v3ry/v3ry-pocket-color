"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const States = require("../../gba/states.js");
const { makeGBADemo, makeGBA } = require("./helpers.cjs");

const CYCLES_PER_FRAME = 280896;

function keyOf(rom) {
  return crypto.createHash("sha256").update(rom).digest("hex");
}

function stateOf(game, key) {
  const { createdAt, ...rest } = States.capture(game, key);
  return rest;
}

function cloneState(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

test("GBA states round-trip the full machine and continue deterministically", async () => {
  const rom = makeGBADemo(), key = keyOf(rom);
  const original = new GameBoyAdvance(rom);
  original.runCycles(CYCLES_PER_FRAME * 3 + 1234);
  original.apu.drain();
  const snapshot = States.capture(original, key);
  const encoded = States.encode(snapshot);
  assert.ok(encoded.size < States.MAX_SIZE);

  const restored = new GameBoyAdvance(rom);
  States.restore(restored, await States.decode(encoded), key);
  assert.deepEqual(stateOf(restored, key), stateOf(original, key));

  original.runCycles(CYCLES_PER_FRAME * 2 + 555);
  restored.runCycles(CYCLES_PER_FRAME * 2 + 555);
  assert.deepEqual(stateOf(restored, key), stateOf(original, key));
  assert.deepEqual(restored.framePixels, original.framePixels);
  assert.deepEqual(restored.apu.drain(), original.apu.drain());
});

test("GBA states restore at the end of a frame as well", async () => {
  const rom = makeGBADemo(), key = keyOf(rom);
  const original = new GameBoyAdvance(rom);
  original.runCycles(CYCLES_PER_FRAME * 2);
  const restored = new GameBoyAdvance(rom);
  States.restore(restored, await States.decode(States.encode(States.capture(original, key))), key);
  original.runCycles(CYCLES_PER_FRAME);
  restored.runCycles(CYCLES_PER_FRAME);
  assert.deepEqual(stateOf(restored, key), stateOf(original, key));
});

test("GBA states refuse another ROM, another system and malformed data without touching the machine", async () => {
  const rom = makeGBADemo(), key = keyOf(rom);
  const game = new GameBoyAdvance(rom);
  game.runCycles(CYCLES_PER_FRAME + 77);
  const before = stateOf(game, key);
  const good = States.capture(game, key);
  const otherKey = keyOf(makeGBA({ signature: "SRAM_V110" }));

  assert.throws(() => States.restore(game, cloneState(good), otherKey), /autre ROM/);
  assert.throws(() => States.restore(game, { ...cloneState(good), format: "v3ry-pocket-color-state" }), /Format ou version/);
  assert.throws(() => States.restore(game, { ...cloneState(good), version: 2 }), /Format ou version/);

  const cases = [
    (d) => { d.machine.line = 300; },
    (d) => { d.machine.ewram = { $: "Uint8Array", b: Buffer.from([1, 2, 3, 4]).toString("base64") }; },
    (d) => { d.machine.ewram = { $: "Uint8Array", b: "!!!" }; },
    (d) => { d.machine.ewram = { $: "Uint8Array", b: Buffer.alloc(2 * 1024 * 1024).toString("base64") }; },
    (d) => { d.cpu.r = "not-an-array"; },
    (d) => { d.cpu.r = { $: "Int32Array", b: Buffer.alloc(64).toString("base64") }; },
    (d) => { d.cartridge.ram = { $: "Uint8Array", b: Buffer.alloc(100).toString("base64") }; },
    (d) => { d.psg.frameStep = 9; },
    (d) => { d.machine.system = "gbc"; },
    (d) => { d.cartridge.kind = "NONE"; },
    (d) => { d.apu.fifos = { $: "Object", v: {} }; },
  ];
  for (const mutate of cases) {
    const data = cloneState(good);
    mutate(data);
    assert.throws(() => States.restore(game, data, key), Error);
    assert.deepEqual(stateOf(game, key), before);
  }

  const polluted = JSON.parse(JSON.stringify(good).replace('"machine":{', '"machine":{"__proto__":{"x":1},'));
  assert.throws(() => States.restore(game, polluted, key), /invalides/);
  assert.equal({}.x, undefined);
  assert.deepEqual(stateOf(game, key), before);

  await assert.rejects(States.decode({ size: 0, text: async () => "" }), /vide ou trop volumineux/);
  await assert.rejects(States.decode({ size: 4, text: async () => "{not json" }), /illisible/);
});

test("GBA states carry an EEPROM save that changed size", async () => {
  const rom = makeGBA({ signature: "EEPROM_V124" }), key = keyOf(rom);
  const original = new GameBoyAdvance(rom);
  assert.equal(original.cartridge.kind, "EEPROM");
  const save = new Uint8Array(8192).map((_, index) => (index * 7) & 255);
  original.cartridge.importRAM(save);
  const restored = new GameBoyAdvance(rom);
  assert.equal(restored.cartridge.ram.length, 512);
  const revision = restored.cartridge.saveRevision;
  States.restore(restored, await States.decode(States.encode(States.capture(original, key))), key);
  assert.deepEqual(restored.cartridge.ram, save);
  assert.equal(restored.cartridge.saveRevision, revision + 1);
});
