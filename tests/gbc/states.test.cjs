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

test("MBC7 states preserve EEPROM words, mid-command EEPROM state, accelerometer latch and bank", async () => {
  const rom = makeROM({ type: 0x22, sizeCode: 2, program: [0x18, 0xfe] });
  const key = await memorySaveStore().keyFor(rom), game = new GameBoy(rom);
  game.cartridge.control(0, 0x0a); game.cartridge.control(0x4000, 0x40);
  game.cartridge.control(0x2000, 3);
  game.cartridge.ram[10] = 0xbe; game.cartridge.ram[11] = 0xef;
  game.cartridge.eepromWriteEnabled = true;
  game.cartridge.writeRAM(0xa010, 0xaa);
  game.cartridge.eepromPhase = 2; game.cartridge.eepromShift = 0xbeef; game.cartridge.eepromCount = 3;
  const state = States.capture(game, key), restored = new GameBoy(rom);
  States.restore(restored, state, key);
  assert.equal(restored.cartridge.ram[10], 0xbe);
  assert.equal(restored.cartridge.ram[11], 0xef);
  assert.equal(restored.cartridge.eepromWriteEnabled, true);
  assert.equal(restored.cartridge.eepromPhase, 2);
  assert.equal(restored.cartridge.eepromShift, 0xbeef);
  assert.equal(restored.cartridge.eepromCount, 3);
  assert.equal(restored.cartridge.mbc7Latched, true);
  assert.equal(restored.cartridge.bank, 3);
  restored.cartridge.control(0, 0x0a); restored.cartridge.control(0x4000, 0x40);
  assert.equal(restored.cartridge.readRAM(0xa020), 0xd0);
});

test("MMM01 states preserve menu registers, mapping and the selected RAM bank", async () => {
  const rom = makeROM({ type: 0x0b, sizeCode: 7, ramSize: 3 });
  const key = await memorySaveStore().keyFor(rom), game = new GameBoy(rom);
  game.cartridge.control(0x0000, 0x0a); game.cartridge.control(0x4000, 0x12);
  game.cartridge.control(0x2000, 0x21); game.cartridge.control(0x6000, 0x01);
  game.cartridge.writeRAM(0xa000, 0x66);
  const state = States.capture(game, key), restored = new GameBoy(rom);
  States.restore(restored, state, key);
  assert.equal(restored.cartridge.mmmControl, 0x00);
  assert.equal(restored.cartridge.mmmRam, 0x12);
  assert.equal(restored.cartridge.mmmLow, 0x21);
  assert.equal(restored.cartridge.mmmMask, 0x01);
  assert.equal(restored.cartridge.readRAM(0xa000), 0x66);
});

test("HuC1 and HuC3 states preserve banks, IR mode and HuC3 command memory", async () => {
  const huc1 = makeROM({ type: 0xff, sizeCode: 7, ramSize: 3 });
  const huc1Key = await memorySaveStore().keyFor(huc1), huc1Game = new GameBoy(huc1);
  huc1Game.cartridge.control(0x2000, 0x45); huc1Game.cartridge.control(0x4000, 0x03);
  huc1Game.cartridge.writeRAM(0xa000, 0x5a); huc1Game.cartridge.control(0x0000, 0x0e);
  const huc1Restored = new GameBoy(huc1);
  States.restore(huc1Restored, States.capture(huc1Game, huc1Key), huc1Key);
  assert.equal(huc1Restored.cartridge.bank, 5);
  assert.equal(huc1Restored.cartridge.irMode, 1);
  assert.equal(huc1Restored.cartridge.readRAM(0xa000), 0xc0);
  huc1Restored.cartridge.control(0x0000, 0x0a);
  huc1Restored.cartridge.control(0x4000, 0x03);
  assert.equal(huc1Restored.cartridge.readRAM(0xa000), 0x5a);

  const huc3 = makeROM({ type: 0xfe, sizeCode: 7, ramSize: 3 });
  const huc3Key = await memorySaveStore().keyFor(huc3), huc3Game = new GameBoy(huc3);
  for (const mailbox of [0x52, 0x40, 0x39]) {
    huc3Game.cartridge.control(0x0000, 0x0b); huc3Game.cartridge.writeRAM(0xa000, mailbox);
    huc3Game.cartridge.control(0x0000, 0x0d); huc3Game.cartridge.writeRAM(0xa000, 0x00);
  }
  const huc3Restored = new GameBoy(huc3);
  States.restore(huc3Restored, States.capture(huc3Game, huc3Key), huc3Key);
  const cart = huc3Restored.cartridge;
  assert.equal(cart.huc3Memory[0x20], 9);
  assert.equal(cart.huc3Address, 0x21);
  assert.equal(cart.huc3Mailbox, 0x39);
  for (const mailbox of [0x40, 0x10]) {
    cart.control(0x0000, 0x0b); cart.writeRAM(0xa000, mailbox);
    cart.control(0x0000, 0x0d); cart.writeRAM(0xa000, 0x00);
  }
  cart.control(0x0000, 0x0c);
  assert.equal(cart.readRAM(0xa000), 0x19);
});

test("states without HuC3 memory still restore an MBC1 cartridge", async () => {
  const rom = makeROM({ type: 0x01, sizeCode: 2, ramSize: 2 });
  const key = await memorySaveStore().keyFor(rom), game = new GameBoy(rom);
  game.cartridge.control(0x0000, 0x0a); game.cartridge.writeRAM(0xa000, 0x42);
  const state = States.capture(game, key);
  delete state.cartridge.huc3Memory;
  const restored = new GameBoy(rom);
  States.restore(restored, state, key);
  restored.cartridge.control(0x0000, 0x0a);
  assert.equal(restored.cartridge.readRAM(0xa000), 0x42);
});

test("wrong ROM, version and corrupt snapshots are rejected without mutation", async () => {
  const rom = makeDemoROM(true), key = await memorySaveStore().keyFor(rom), game = new GameBoy(rom);
  game.runCycles(70224);
  const state = States.capture(game, key), destination = new GameBoy(rom);
  const before = States.capture(destination, key);
  for (const corrupt of [
    data => { data.romKey = "0".repeat(64); },
    data => { data.version = 4; },
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

test("version 3 states preserve an in-progress OAM DMA and variable mode 3 timing", () => {
  const rom = makeROM({ color: true }), key = "0".repeat(64);
  const game = new GameBoy(rom), restored = new GameBoy(rom);
  game.io[0x43] = 5;
  game.tick(80);
  game.wram.fill(0x42, 0, 160);
  game.write(0xff46, 0xc0);
  game.tick(39);
  const state = States.capture(game, key);
  assert.equal(state.version, 3);
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

test("camera states preserve capture registers, busy timing and captured RAM", () => {
  const rom = makeROM({ type: 0xfc, ramSize: 4 }), key = "0".repeat(64);
  const game = new GameBoy(rom), restored = new GameBoy(rom);
  game.cartridge.cameraRegisters.set(Array.from({ length: 0x36 }, (_, index) => index));
  game.cartridge.cameraBusyCycles = 1234;
  game.cartridge.ram[0x100] = 0x5a;
  const state = States.capture(game, key);
  States.restore(restored, state, key);
  assert.deepEqual(restored.cartridge.cameraRegisters, game.cartridge.cameraRegisters);
  assert.equal(restored.cartridge.cameraBusyCycles, 1234);
  assert.equal(restored.cartridge.ram[0x100], 0x5a);
  assert.equal(restored.cartridge.cameraCaptureProvider, null);
});

test("states preserve an attached serial peripheral without serializing the device", () => {
  const rom = makeROM(), key = "0".repeat(64);
  const device = { transfer: () => 0xff };
  const game = new GameBoy(rom), restored = new GameBoy(rom);
  game.setSerialDevice(device);
  const state = States.capture(game, key);
  assert.equal(Object.hasOwn(state.machine, "serialDevice"), false);
  restored.setSerialDevice(device);
  States.restore(restored, state, key);
  assert.equal(restored.serialDevice, device);
});

test("legacy version 2 states remain restorable without camera metadata", () => {
  const rom = makeROM({ color: true }), key = "0".repeat(64);
  const original = new GameBoy(rom), restored = new GameBoy(rom);
  original.tick(456 * 10);
  const state = States.capture(original, key);
  state.version = 2;
  delete state.cartridge.camera;
  States.restore(restored, state, key);
  assert.equal(restored.ly, original.ly);
  assert.equal(restored.dot, original.dot);
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
