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

const GPIO = 0x080000c4, DIRECTION = 0x080000c6, CONTROL = 0x080000c8;
const CLOCK = new Date(2026, 4, 17, 13, 5, 9).getTime();

function clockGame(rom) {
  const game = new GameBoyAdvance(rom);
  game.cartridge.rtc.clock = () => CLOCK;
  return game;
}

// Starts a clock command and leaves the transfer open so the state is captured mid-transaction.
function startCommand(game, command) {
  game.write16(CONTROL, 1);
  game.write16(DIRECTION, 7);
  game.write16(GPIO, 0); game.write16(GPIO, 4);
  for (let bit = 0; bit < 8; bit++) {
    const sio = command >>> bit & 1;
    game.write16(GPIO, 4 | sio << 1); game.write16(GPIO, 5 | sio << 1);
  }
}

function readBits(game, count) {
  game.write16(DIRECTION, 5);
  let value = 0;
  for (let bit = 0; bit < count; bit++) {
    game.write16(GPIO, 4);
    value |= (game.read16(GPIO) >> 1 & 1) << bit;
    game.write16(GPIO, 5);
  }
  return value;
}

test("GBA states carry the real-time clock mid-transaction and continue the same reads", async () => {
  const rom = makeGBA({ signature: "SIIRTC_V" }), key = keyOf(rom);
  const original = clockGame(rom);
  startCommand(original, 0xa6);
  const restored = clockGame(rom);
  States.restore(restored, await States.decode(States.encode(States.capture(original, key))), key);
  assert.deepEqual(stateOf(restored, key), stateOf(original, key));
  assert.equal(readBits(restored, 8), readBits(original, 8));
  assert.deepEqual(stateOf(restored, key), stateOf(original, key));
});

test("GBA states without a clock section reset the link of a clock cartridge", () => {
  const rom = makeGBA({ signature: "SIIRTC_V" }), key = keyOf(rom);
  const data = cloneState(States.capture(clockGame(rom), key));
  delete data.rtc;
  const game = clockGame(rom);
  startCommand(game, 0xa6);
  assert.notEqual(game.cartridge.rtc.phase, "idle");
  States.restore(game, data, key);
  assert.equal(game.cartridge.rtc.phase, "idle");
});

test("GBA states refuse a clock section that does not fit the cartridge, leaving the machine untouched", () => {
  const clockRom = makeGBA({ signature: "SIIRTC_V" }), key = keyOf(clockRom);
  const plainRom = makeGBA({ signature: "SRAM_V110" });
  const data = States.capture(clockGame(clockRom), key);
  const plain = new GameBoyAdvance(plainRom);
  const before = stateOf(plain, key);
  assert.throws(() => States.restore(plain, cloneState(data), key), /horloge/i);
  assert.deepEqual(stateOf(plain, key), before);

  const game = clockGame(clockRom);
  startCommand(game, 0xa6);
  const beforeClock = stateOf(game, key);
  const cases = [
    (d) => { d.rtc.phase = "sleep"; },
    (d) => { d.rtc.value = 999; },
    (d) => { d.rtc.bytes = [1, 2, 3, 4, 5, 6, 7, 8]; },
  ];
  for (const mutate of cases) {
    const bad = cloneState(States.capture(clockGame(clockRom), key));
    mutate(bad);
    assert.throws(() => States.restore(game, bad, key), Error);
    assert.deepEqual(stateOf(game, key), beforeClock);
  }
});
