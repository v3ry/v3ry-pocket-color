"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoy } = require("../../gbc/emulator.js");
const States = require("../../gbc/states.js");
const { makeDemoROM, makeROM, memorySaveStore } = require("./helpers.cjs");

test("GB and GBC states restore CPU, video, memory and continue deterministically", async () => {
  const store = memorySaveStore();
  for (const color of [false, true]) {
    const rom = makeDemoROM(color), key = await store.keyFor(rom);
    const original = new GameBoy(rom);
    original.runCycles(70224 * 2 + 1234);
    original.apu.drain();
    original.write(0xc123, 0x42);
    original.cpu.imeDelay = 1;
    const snapshot = States.capture(original, key);
    const encoded = States.encode(snapshot);
    assert.ok(encoded.size < States.MAX_SIZE);
    const restored = new GameBoy(rom);
    States.restore(restored, await States.decode(encoded), key);
    const copy = States.capture(restored, key);
    copy.createdAt = snapshot.createdAt;
    copy.cartridge.scalars.lastRTC = snapshot.cartridge.scalars.lastRTC;
    assert.deepEqual(copy, snapshot);
    for (let i = 0; i < 1500; i++) {
      assert.equal(original.step(), restored.step());
    }
    assert.equal(original.cpu.pc, restored.cpu.pc);
    assert.equal(original.div, restored.div);
    assert.deepEqual(original.wram, restored.wram);
    assert.deepEqual(original.pixels, restored.pixels);
    assert.deepEqual(original.apu.drain(), restored.apu.drain());
    restored.wram[0x123] = 0;
    assert.equal(snapshot.memory.wram[0x123], 0x42);
  }
});

test("states restore mapper banks, RTC latch, DMA, timer overflow and APU phases", async () => {
  const rom = makeROM({ color: true, type: 0x10, ramSize: 3, program: [0x18, 0xfe] });
  const key = await memorySaveStore().keyFor(rom), game = new GameBoy(rom);
  game.cartridge.control(0, 10); game.cartridge.control(0x4000, 2);
  game.cartridge.writeRAM(0xa123, 123);
  game.cartridge.rtc.set([12, 34, 5, 6, 0x40]);
  game.cartridge.control(0x6000, 0); game.cartridge.control(0x6000, 1);
  game.write(0xff51, 0xc0); game.write(0xff55, 0x83);
  game.write(0xff04, 0); game.write(0xff07, 5); game.write(0xff05, 255); game.tick(16);
  game.apu.write(0xff11, 0x80); game.apu.write(0xff12, 0xf3);
  game.apu.write(0xff14, 0x87); game.apu.tick(1234);
  const state = States.capture(game, key), restored = new GameBoy(rom);
  States.restore(restored, state, key);
  assert.equal(restored.hdmaActive, true);
  assert.equal(restored.hdmaBlocks, 4);
  assert.equal(restored.timerDelay, 4);
  assert.equal(restored.cartridge.ramBank, 2);
  assert.equal(restored.cartridge.readRAM(0xa123), 123);
  assert.deepEqual([...restored.cartridge.latchedRTC], [12, 34, 5, 6, 0x40]);
  assert.equal(restored.apu.channels[0].phase, game.apu.channels[0].phase);
  assert.equal(restored.cpu.bus, restored);
});

test("wrong ROM, version and corrupt snapshots are rejected without mutation", async () => {
  const rom = makeDemoROM(true), key = await memorySaveStore().keyFor(rom), game = new GameBoy(rom);
  game.runCycles(70224);
  const state = States.capture(game, key), destination = new GameBoy(rom);
  const before = States.capture(destination, key);
  for (const corrupt of [
    data => { data.romKey = "0".repeat(64); },
    data => { data.version = 3; },
    data => { data.memory.vram.pop(); },
    data => { data.memory.pixels[0] = -1; },
    data => { data.cpu.pc = 65536; },
    data => { data.cpu.ime = "true"; },
    data => { data.cpu.f |= 1; },
    data => { data.machine.dot = 456; },
    data => { data.machine.dmaSource = 1; },
    data => { data.machine.dmaActive = true; data.machine.dmaIndex = 160; },
    data => { data.machine.mode3End = 251; },
    data => { data.audio.channels[0].phase = Infinity; },
    data => { data.audio.channels[0].lfsr = -1; },
    data => { data.cartridge.scalars.bank = 1e8; },
  ]) {
    const invalid = structuredClone(state); corrupt(invalid);
    assert.throws(() => States.restore(destination, invalid, key));
    const after = States.capture(destination, key); after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
  }
});

test("state decoding rejects empty, oversized or invalid JSON", async () => {
  await assert.rejects(States.decode(new Blob([])), /vide/);
  await assert.rejects(States.decode({ size: States.MAX_SIZE + 1 }), /volumineux/);
  await assert.rejects(States.decode(new Blob(["not JSON"])), /illisible/);
});

test("states preserve the early LY reset while the PPU is still on VBlank line 153", () => {
  const rom = makeROM({ color: true }), key = "0".repeat(64);
  const game = new GameBoy(rom), restored = new GameBoy(rom);
  game.tick(456 * 153 + 4);
  States.restore(restored, States.capture(game, key), key);
  assert.equal(restored.ly, 153);
  assert.equal(restored.dot, 4);
  assert.equal(restored.read(0xff44), 0);
  assert.equal(restored.mode(), 1);
  game.tick(452); restored.tick(452);
  assert.equal(restored.ly, game.ly);
  assert.equal(restored.dot, game.dot);
  assert.equal(restored.mode(), 2);
});

test("version 2 states preserve an in-progress OAM DMA and variable mode 3 timing", () => {
  const rom = makeROM({ color: true }), key = "0".repeat(64);
  const game = new GameBoy(rom), restored = new GameBoy(rom);
  game.io[0x43] = 5;
  game.tick(80);
  game.wram.fill(0x42, 0, 160);
  game.write(0xff46, 0xc0);
  game.tick(39);
  const state = States.capture(game, key);
  assert.equal(state.version, 2);
  States.restore(restored, state, key);
  assert.equal(restored.mode3End, 257);
  assert.equal(restored.dmaIndex, 9);
  assert.equal(restored.dmaClock, 3);
  assert.equal(restored.dmaActive, true);
  for (const gb of [game, restored]) gb.tick(601);
  assert.deepEqual(game.oam, restored.oam);
  assert.equal(restored.dmaActive, false);
  assert.deepEqual(game.pixels, restored.pixels);
  assert.equal(game.apu.frameStep, restored.apu.frameStep);
});

test("legacy version 1 states migrate without modifying the input or inventing an active DMA", () => {
  const rom = makeROM({ color: true }), key = "0".repeat(64);
  const original = new GameBoy(rom), restored = new GameBoy(rom);
  original.tick(456 * 10);
  const state = States.capture(original, key);
  state.version = 1;
  for (const field of ["dmaActive", "dmaSource", "dmaIndex", "dmaClock", "mode3End", "windowTriggered", "oamScanBlocked"]) {
    delete state.machine[field];
  }
  const before = structuredClone(state);
  States.restore(restored, state, key);
  assert.deepEqual(state, before);
  assert.equal(restored.dmaActive, false);
  assert.equal(restored.mode3End, 252);
  assert.equal(restored.ly, 10);
  assert.equal(restored.windowTriggered, true);
  const corrupt = structuredClone(state);
  corrupt.machine.dmaActive = true;
  assert.throws(() => States.restore(restored, corrupt, key), /Champs/);
});
