"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { Cartridge, MAX_ROM } = require("../../gba/cartridge.js");
const { SaveSession } = require("../../gbc/saves.js");
const { memorySaveStore } = require("../gbc/helpers.cjs");
const { makeGBA, makeGBADemo } = require("./helpers.cjs");
const game = () => new GameBoyAdvance(makeGBA());

test("GBA header validation and save-type detection are explicit", () => {
  assert.throws(() => new Cartridge(new Uint8Array(191)), /invalide/);
  const bad = makeGBA(); bad[0xa0] ^= 1;
  assert.throws(() => new Cartridge(bad), /checksum/);
  assert.throws(() => new Cartridge(new Uint8Array(MAX_ROM + 1)), /invalide/);
  assert.equal(new Cartridge(makeGBA({ signature: "EEPROM_V124" })).kind, "EEPROM");
  assert.equal(new Cartridge(makeGBA({ signature: "SRAM_V110" })).ram.length, 32768);
  assert.equal(new Cartridge(makeGBA({ signature: "FLASH512_V130" })).ram.length, 65536);
  assert.equal(new Cartridge(makeGBA({ signature: "FLASH1M_V103" })).ram.length, 131072);
  assert.equal(new Cartridge(makeGBA()).ram.length, 0);
});

test("GBA memory mirrors, VRAM mapping, byte writes and OAM access widths", () => {
  const g = game();
  g.write32(0x02000000, 0x12345678); assert.equal(g.read32(0x02040000), 0x12345678);
  g.write16(0x03000000, 0xabcd); assert.equal(g.read16(0x03008000), 0xabcd);
  g.write16(0x06010000, 0x1234); assert.equal(g.read16(0x06018000), 0x1234);
  g.write8(0x05000001, 0x12); assert.equal(g.read16(0x05000000), 0x1212);
  g.write8(0x06000001, 0x34); assert.equal(g.read16(0x06000000), 0x3434);
  g.write8(0x06010000, 0x56); assert.equal(g.read16(0x06010000), 0x1234);
  g.write8(0x07000000, 0x77); assert.equal(g.read16(0x07000000), 0);
  g.write16(0x07000000, 0x5678); assert.equal(g.read16(0x07000400), 0x5678);
});

test("GBA run loop fetches each ARM instruction once and fast word reads match byte lanes", () => {
  const g = game();
  let fetches = 0;
  const read32 = g.read32;
  g.read32 = function(address) { fetches++; return read32.call(this, address); };
  g.runCycles(1);
  assert.equal(fetches, 1);
  assert.equal(g.openBus, 0xea00002e);
  g.write32(0x02000000, 0x89abcdef);
  assert.equal(g.read16(0x02000001), 0xcdef);
  assert.equal(g.read32(0x02000003), 0x89abcdef);
  const expected = (g.cartridge.readROM(0x080000c0) | g.cartridge.readROM(0x080000c1) << 8
    | g.cartridge.readROM(0x080000c2) << 16 | g.cartridge.readROM(0x080000c3) << 24) >>> 0;
  assert.equal(g.read32(0x080000c0), expected);
});

test("GBA SRAM persists using existing transactional SaveSession without sharing GB keys", async () => {
  const bytes = makeGBA({ signature: "SRAM_V110" }), store = memorySaveStore();
  const g = new GameBoyAdvance(bytes), key = `gba:${await store.keyFor(bytes)}`;
  const session = new SaveSession(store, key, g.cartridge);
  await session.restore();
  g.write8(0x0e000123, 0x55); await session.flush();
  assert.equal(g.read16(0x0e000123), 0x5555); assert.equal(g.read32(0x0e000123), 0x55555555);
  const next = new GameBoyAdvance(bytes), restored = new SaveSession(store, key, next.cartridge);
  assert.equal(await restored.restore(), true);
  assert.equal(next.read8(0x0e000123), 0x55);
  assert.throws(() => next.cartridge.importRAM(new Uint8Array(1)), /Taille/);
  assert.throws(() => next.cartridge.restoreData({ version: 1, type: "GB", ram: g.cartridge.ram }), /incompatible/);
});

test("Flash unlock, program, bank switching, identification and sector erase", () => {
  const c = new Cartridge(makeGBA({ signature: "FLASH1M_V103" }));
  const command = value => { c.writeRAM(0x5555, 0xaa); c.writeRAM(0x2aaa, 0x55); c.writeRAM(0x5555, value); };
  command(0xa0); c.writeRAM(0x1234, 0x42); assert.equal(c.readRAM(0x1234), 0x42);
  command(0xb0); c.writeRAM(0, 1); assert.equal(c.readRAM(0x1234), 255);
  command(0xa0); c.writeRAM(0x1234, 0x24);
  command(0x90); assert.equal(c.readRAM(0), 0x62); c.writeRAM(0, 0xf0);
  command(0x80); c.writeRAM(0x5555, 0xaa); c.writeRAM(0x2aaa, 0x55); c.writeRAM(0x1234, 0x30);
  assert.equal(c.readRAM(0x1234), 255);
  command(0xb0); c.writeRAM(0, 0); assert.equal(c.readRAM(0x1234), 0x42);
});

test("timers prescale, reload, cascade, interrupt and acknowledge", () => {
  const g = game();
  g.write16(0x04000100, 0xfffe); g.write16(0x04000102, 0xc0);
  g.write16(0x04000104, 0xffff); g.write16(0x04000106, 0xc4);
  g.tick(2);
  assert.equal(g.read16(0x04000100), 0xfffe); assert.equal(g.read16(0x04000104), 0xffff);
  assert.equal(g.read16(0x04000202) & 24, 24);
  g.write16(0x04000202, 8); assert.equal(g.read16(0x04000202) & 24, 16);
  g.write16(0x04000102, 0x81); g.timers[0].phase = 0; g.tick(63);
  assert.equal(g.read16(0x04000100), 0xfffe); g.tick(1); assert.equal(g.read16(0x04000100), 0xffff);
});

test("DMA immediate and repeated HBlank transfers use count, destination reload and IRQ", () => {
  const g = game();
  g.write32(0x02000000, 0x12345678);
  g.write32(0x040000b0, 0x02000000); g.write32(0x040000b4, 0x03000000);
  g.write16(0x040000b8, 1); g.write16(0x040000ba, 0xc400);
  assert.equal(g.read32(0x03000000), 0x12345678); assert.equal(g.io16(0xba) & 0x8000, 0);
  assert.ok(g.io16(0x202) & 256);
  g.write16(0x02000004, 0xabcd); g.write16(0x02000006, 0x9876);
  g.write32(0x040000b0, 0x02000004); g.write32(0x040000b4, 0x03000010);
  g.write16(0x040000ba, 0xa260); g.tick(960);
  assert.equal(g.read16(0x03000010), 0xabcd); assert.equal(g.dma[0].destination, 0x03000010);
  g.tick(1232); assert.equal(g.read16(0x03000010), 0x9876);
});

test("HBlank affine DMA updates the following scanline, not the line already rendered", () => {
  const g = game();
  g.write16(0x04000000, 0x402); g.write16(0x0400000c, 0x100);
  g.write16(0x04000020, 0x100); g.write16(0x04000026, 0x100);
  g.write32(0x02000000, 0x00000200); g.write32(0x02000004, 0x02000000);
  g.write32(0x040000b0, 0x02000000); g.write32(0x040000b4, 0x04000020);
  g.write16(0x040000b8, 2); g.write16(0x040000ba, 0xa660);
  g.tick(1232);
  assert.equal(g.graphics.affineLineMatrices[0], 0x100);
  assert.equal(g.graphics.affineLineMatrices[8], 0x200);
});

test("video timing reaches VBlank after 160 lines and wraps after 228", () => {
  const g = game();
  g.write16(0x04000004, 8);
  g.tick(1232 * 160);
  assert.equal(g.frames, 1); assert.equal(g.read16(0x04000006), 160);
  assert.ok(g.io16(4) & 1); assert.ok(g.io16(0x202) & 1);
  g.tick(1232 * 68); assert.equal(g.line, 0); assert.equal(g.dot, 0); assert.equal(g.io16(4) & 1, 0);
});

test("GBA presents a complete framebuffer only after all visible scanlines reach VBlank", () => {
  const g = game();
  g.write16(0x04000000, 0x403); g.write16(0x06000000, 31);
  g.tick(960);
  assert.deepEqual([...g.pixels.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...g.framePixels.slice(0, 4)], [255, 255, 255, 255]);
  g.tick(1232 * 160 - 960);
  assert.deepEqual([...g.framePixels.slice(0, 4)], [255, 0, 0, 255]);
});

test("all ten controls map to active-low GBA keypad and keypad IRQ", () => {
  const g = game();
  for (const [index, bit] of [4, 5, 6, 7, 0, 1, 2, 3, 9, 8].entries()) {
    g.setButton(index, true); assert.equal(g.read16(0x04000130), 1023 & ~(1 << bit)); g.releaseButtons();
  }
  g.write16(0x04000132, 0x4001); g.setButton(4, true);
  assert.ok(g.read16(0x04000202) & 0x1000);
});

test("HLE IRQ handler returns to Thumb code, preserving registers and banking", () => {
  const g = game(), c = g.cpu;
  g.write32(0x03007ffc, 0x03000000); g.write32(0x03000000, 0xe12fff1e);
  c.cpsr |= 32; c.r[0] = 123; c.r[12] = 456; c.r[15] = 0x080000c0;
  c.irq(); assert.equal(c.cpsr & 31, 0x12); assert.equal(c.thumb, false);
  c.step(); c.step(); assert.equal(c.r[15], 0x080000c0); assert.equal(c.thumb, true);
  assert.equal(c.r[0], 123); assert.equal(c.r[12], 456);
});

test("nested GBA IRQs restore the interrupted handler context before the original program", () => {
  const g = game(), c = g.cpu;
  g.write32(0x03007ffc, 0x03000000); g.write32(0x03000000, 0xe12fff1e);
  c.cpsr |= 32; c.r[0] = 123; c.r[12] = 456; c.r[15] = 0x080000c0;
  c.irq();
  c.r[0] = 789; c.r[12] = 987; c.cpsr &= ~128; c.r[15] = 0x03000100;
  c.irq();
  c.step(); c.step();
  assert.equal(c.r[15], 0x03000100); assert.equal(c.cpsr & 31, 0x12);
  assert.equal(c.r[0], 789); assert.equal(c.r[12], 987);
  assert.equal(c.r[14], 0x138); assert.equal(c.irqFrames.length, 1);
  c.r[15] = 0x03000000; c.step(); c.step();
  assert.equal(c.r[15], 0x080000c0); assert.equal(c.cpsr, 0x3f);
  assert.equal(c.r[0], 123); assert.equal(c.r[12], 456);
  assert.equal(c.irqFrames.length, 0);
});

test("an IRQ taken during IntrWait runs its handler immediately, then resumes waiting", () => {
  const g = game(), c = g.cpu;
  g.write32(0x03007ffc, 0x03000000); g.write32(0x03000000, 0xe12fff1e);
  g.write16(0x04000200, 5);
  c.cpsr = 0x1f; c.r[15] = 0x080000c0;
  g.swi(5); assert.equal(g.halted, true);
  g.interrupt(4);
  g.runCycles(1);
  assert.equal(g.halted, false); assert.equal(c.cpsr & 31, 0x12); assert.equal(c.r[15], 0x138);
  g.runCycles(1);
  assert.equal(c.r[15], 0x080000c0); assert.equal(g.halted, true); assert.equal(g.waitMask, 1);
  g.interrupt(1); assert.equal(g.halted, false); assert.equal(g.waitMask, 0);
});

test("an IRQ nested inside a handler returns to that handler without re-entering the IntrWait halt", () => {
  const g = game(), c = g.cpu;
  g.write32(0x03007ffc, 0x03000000); g.write32(0x03000000, 0xe12fff1e);
  g.write16(0x04000200, 5);
  c.cpsr = 0x1f; c.r[15] = 0x080000c0;
  g.swi(5);
  g.interrupt(4); g.runCycles(1);
  assert.equal(c.irqFrames.length, 1); assert.equal(g.halted, false);
  g.setIO16(0x202, 0); c.cpsr &= ~128; c.r[15] = 0x03000100;
  g.interrupt(4); g.runCycles(1);
  assert.equal(c.irqFrames.length, 2); g.setIO16(0x202, 0);
  g.runCycles(1);
  assert.equal(c.r[15], 0x03000100); assert.equal(g.halted, false); assert.equal(g.waitMask, 1);
  c.r[15] = 0x03000000; g.runCycles(1); g.runCycles(1);
  assert.equal(c.r[15], 0x080000c0); assert.equal(g.halted, true);
});

test("IntrWait ends as soon as a handler has flagged an interrupt that was masked while it ran", () => {
  const g = game(), c = g.cpu;
  g.write32(0x03007ffc, 0x03000000); g.write32(0x03000000, 0xe12fff1e);
  g.write16(0x04000200, 5);
  c.cpsr = 0x1f; c.r[15] = 0x080000c0;
  g.swi(5);
  g.interrupt(4); g.runCycles(1);
  g.setIO16(0x202, 0); g.write16(0x04000200, 4);
  g.interrupt(1);
  assert.equal(g.waitMask, 1); assert.equal(g.halted, false);
  g.runCycles(1);
  assert.equal(c.r[15], 0x080000c0); assert.equal(g.halted, true); assert.equal(g.waitMask, 1);
  g.write16(0x04000200, 5); g.runCycles(1); g.runCycles(1);
  assert.equal(c.r[15], 0x080000c0); assert.equal(g.halted, false); assert.equal(g.waitMask, 0);
  assert.equal(g.read16(0x03007ff8) & 1, 0);
});

test("HLE division, CpuSet/FastSet, waits and unsupported services", () => {
  const g = game(), r = g.cpu.r;
  r[0] = -17; r[1] = 5; g.swi(6);
  assert.equal(r[0] | 0, -3); assert.equal(r[1] | 0, -2); assert.equal(r[3], 3);
  r[0] = 0x02000000; r[1] = 0x03000000; r[2] = 0x05000002;
  g.write32(r[0], 0xdeadbeef); g.swi(0x0b);
  assert.equal(g.read32(0x03000004), 0xdeadbeef);
  g.write16(0x04000200, 1);
  r[0] = 1; r[1] = 1; g.swi(4); assert.equal(g.halted, true);
  g.interrupt(1); assert.equal(g.halted, false);
  assert.throws(() => g.swi(0x2a), /Service BIOS/);
});

test("BIOS ArcTan and ArcTan2 use signed 1.14 inputs and return wrapped GBA angles", () => {
  const g = game(), r = g.cpu.r;
  for (const [value, expected] of [[0, 0], [16384, 8192], [-16384, -8192]]) {
    r[0] = value; g.swi(9);
    assert.ok(Math.abs((r[0] << 16 >> 16) - expected) <= 1);
  }
  r[0] = 32767; g.swi(9);
  assert.equal(r[0] << 16 >> 16, Math.trunc(Math.atan(32767 / 16384) * 32768 / Math.PI));
  for (const [x, y, expected] of [[1, 0, 0], [0, 1, 16384], [-1, 0, 32768],
    [0, -1, 49152], [1, 1, 8192], [-1, 1, 24576]]) {
    r[0] = x * 16384; r[1] = y * 16384; g.swi(0x0a);
    assert.ok(Math.abs(r[0] - expected) <= 1);
  }
  r[0] = r[1] = 0; g.swi(0x0a); assert.equal(r[0], 0);
});

test("BIOS BitUnPack expands packed source fields with conditional zero offset", () => {
  const g = game(), r = g.cpu.r, src = 0x02000000, dst = 0x03000000, info = 0x02000100;
  g.write8(src, 0xe4);
  g.write16(info, 1); g.write8(info + 2, 2); g.write8(info + 3, 8); g.write32(info + 4, 0x80000010);
  r[0] = src; r[1] = dst; r[2] = info; g.swi(0x10);
  assert.equal(g.read32(dst), 0x13121110);
  g.write32(info + 4, 0x10); g.swi(0x10);
  assert.equal(g.read32(dst), 0x13121100);
  g.write8(info + 2, 3); assert.throws(() => g.swi(0x10), /BitUnPack/);
});

test("BIOS Huffman and differential filters decode bounded WRAM/VRAM assets", () => {
  const g = game(), r = g.cpu.r, src = 0x02000000, dst = 0x03000000;
  g.write32(src, 0x00000428); g.write8(src + 4, 1);
  for (const [offset, value] of [[5, 0xc0], [6, 0x41], [7, 0x42], [12, 0x50]]) g.write8(src + offset, value);
  r[0] = src; r[1] = dst; g.swi(0x13);
  assert.deepEqual([...g.iwram.slice(0, 4)], [0x41, 0x42, 0x41, 0x42]);

  g.write32(src, 0x00000480); g.ewram.set([10, 2, 0xfb, 4], 4);
  r[1] = dst + 16; g.swi(0x16);
  assert.deepEqual([...g.iwram.slice(16, 20)], [10, 12, 7, 11]);
  g.write32(src, 0x00000481); g.ewram.set([0xf0, 0, 0x20, 0xff], 4);
  r[1] = dst + 32; g.swi(0x18);
  assert.deepEqual([...g.iwram.slice(32, 36)], [0xf0, 0, 0x10, 0]);

  g.write32(src, 0x00000480); g.ewram.set([0x1f, 0xff, 2, 1], 4);
  r[1] = 0x06000000; g.swi(0x17);
  assert.deepEqual([...g.vram.slice(0, 4)], [0x1f, 0x1e, 0x20, 0x21]);
});

test("STOP BIOS and HALTCNT sleep without advancing hardware until a keypad press", () => {
  const g = game();
  const frames = g.frames;
  g.swi(3); g.runCycles(1232 * 228);
  assert.equal(g.stopped, true); assert.equal(g.frames, frames);
  g.setButton(4, true); assert.equal(g.stopped, false); assert.equal(g.halted, false);
  g.runCycles(1232 * 228);
  assert.ok(g.frames > frames);
  g.write8(0x04000301, 0x80);
  g.tick(1232 * 228); assert.equal(g.stopped, true);
});

test("BIOS RegisterRamReset clears requested memory and peripherals but preserves stack RAM", () => {
  const g = game();
  g.ewram.fill(17); g.iwram.fill(34); g.vram.fill(51); g.palette.fill(68); g.oam.fill(85);
  g.write16(0x04000084, 0x80); g.write32(0x040000a0, 0x12345678);
  g.write16(0x04000100, 0xfffe); g.write16(0x04000102, 0x80);
  g.write16(0x04000200, 0x3fff);
  g.cpu.r[0] = 255; g.swi(1);
  for (const memory of [g.ewram, g.vram, g.palette, g.oam]) assert.equal(memory.some(Boolean), false);
  assert.equal(g.iwram[0], 0); assert.equal(g.iwram[0x7e00], 34);
  assert.equal(g.read16(0x04000100), 0); assert.equal(g.io16(0x200), 0);
  assert.equal(g.apu.master, false); assert.equal(g.apu.fifos[0].length, 0);
  assert.equal(g.io16(0x20), 256); assert.equal(g.io16(0), 128);
});

test("ObjAffineSet writes signed 8.8 matrices with padded sources and OAM destination stride", () => {
  const g = game(), r = g.cpu.r, src = 0x02000000, dst = 0x07000006;
  g.oam.fill(0x5a);
  for (const [index, sx, sy, angle] of [[0, 256, 512, 0], [1, 256, -512, 0x40ff],
    [2, 256, 256, 0x8000], [3, 256, 256, 0xc000], [4, 257, -257, 0x2000]]) {
    g.write16(src + index * 8, sx); g.write16(src + index * 8 + 2, sy);
    g.write16(src + index * 8 + 4, angle); g.write16(src + index * 8 + 6, 0xffff);
  }
  r[0] = src; r[1] = dst; r[2] = 5; r[3] = 8; g.swi(0x0f);
  const expected = [[256, 0, 0, 512], [0, -256, -512, 0], [-256, 0, 0, -256],
    [0, 256, -256, 0], [181, -181, -182, -182]];
  for (let i = 0; i < expected.length; i++) for (let j = 0; j < 4; j++) {
    assert.equal(g.read16(dst + i * 32 + j * 8) << 16 >> 16, expected[i][j]);
  }
  for (let offset = 0; offset < 160; offset++) if ((offset & 7) < 6) assert.equal(g.oam[offset], 0x5a);
  r[1] = 0x03000000; r[2] = 1; r[3] = 2; g.swi(0x0f);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => g.read16(r[1] + i * 2)), expected[0]);
  r[2] = 0; g.swi(0x0f); assert.equal(g.read16(r[1]), 256);
});

test("BgAffineSet handles signed centers, start coordinates and 20-byte source records", () => {
  const g = game(), r = g.cpu.r, src = 0x02000000, dst = 0x03000000;
  for (const [index, centerX, centerY, x, y, sx, sy, angle] of [
    [0, 10 * 256, -5 * 256, 120, 80, 256, 512, 0],
    [1, -256, 512, -3, 4, 512, 256, 0x4000],
  ]) {
    const base = src + index * 20;
    g.write32(base, centerX); g.write32(base + 4, centerY);
    for (const [offset, value] of [[8, x], [10, y], [12, sx], [14, sy], [16, angle], [18, 0xffff]]) g.write16(base + offset, value);
  }
  r[0] = src; r[1] = dst; r[2] = 2; g.swi(0x0e);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => g.read16(dst + i * 2) << 16 >> 16), [256, 0, 0, 512]);
  assert.equal(g.read32(dst + 8) | 0, -28160); assert.equal(g.read32(dst + 12) | 0, -42240);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => g.read16(dst + 16 + i * 2) << 16 >> 16), [0, -512, 256, 0]);
  assert.equal(g.read32(dst + 24) | 0, 1792); assert.equal(g.read32(dst + 28) | 0, 1280);
});

test("ARM and Thumb SWI instructions dispatch ObjAffineSet and continue execution", () => {
  for (const thumb of [false, true]) {
    const g = new GameBoyAdvance(makeGBA({ program: thumb ? [0xdf0f, 0x2407] : [0xef0f0000, 0xe3a04007], thumb }));
    g.cpu.r[15] = 0x080000c0;
    if (thumb) g.cpu.cpsr |= 32;
    g.write16(0x02000000, 256); g.write16(0x02000002, 256);
    g.cpu.r[0] = 0x02000000; g.cpu.r[1] = 0x03000000; g.cpu.r[2] = 1; g.cpu.r[3] = 2;
    g.cpu.step(); g.cpu.step();
    assert.equal(g.read16(0x03000000), 256); assert.equal(g.read16(0x03000006), 256);
    assert.equal(g.cpu.r[4], 7);
  }
});

test("BIOS LZ77 and run-length decompress into WRAM and halfword-only VRAM", () => {
  const g = game();
  g.ewram.set([0x10, 6, 0, 0, 0x10, 65, 66, 67, 0, 2]);
  g.cpu.r[0] = 0x02000000; g.cpu.r[1] = 0x06000000; g.swi(0x12);
  assert.deepEqual([...g.vram.slice(0, 6)], [65, 66, 67, 65, 66, 67]);
  g.ewram.set([0x30, 4, 0, 0, 0x81, 90]);
  g.cpu.r[1] = 0x02000100; g.swi(0x14);
  assert.deepEqual([...g.ewram.slice(256, 260)], [90, 90, 90, 90]);
});

test("synthetic ARM GBA ROM boots, fills a mode-3 frame and advances at GBA clock", () => {
  const g = new GameBoyAdvance(makeGBADemo());
  const elapsed = g.runCycles(1232 * 228 * 2);
  assert.ok(elapsed >= 1232 * 228 * 2); assert.equal(g.frames, 2);
  assert.deepEqual([...g.pixels.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...g.pixels.slice(-4)], [255, 0, 0, 255]);
});

test("BIOS checksum, SoundBias, MidiKey2Freq and CustomHalt follow the documented behaviour", () => {
  const g = game(), r = g.cpu.r;
  g.swi(0x0d); assert.equal(r[0], 0xbaae187f);
  g.setIO16(0x88, 0xc200); r[0] = 0; g.swi(0x19); assert.equal(g.io16(0x88), 0xc000);
  r[0] = 7; g.swi(0x19); assert.equal(g.io16(0x88), 0xc200);
  const wave = 0x02000000;
  g.write32(wave + 4, 1000 * 2 ** 10);
  for (const [key, fine, expected] of [[60, 0, 1000], [72, 0, 2000], [60, 128, 1029]]) {
    r[0] = wave; r[1] = key; r[2] = fine; g.swi(0x1f); assert.equal(r[0], expected);
  }
  r[2] = 0; g.swi(0x27); assert.equal(g.halted, true); assert.equal(g.stopped, false);
  g.halted = false; r[2] = 0x80; g.swi(0x27); assert.equal(g.stopped, true);
});

test("a jump to the reset vector restarts the console while other BIOS addresses stop", () => {
  const g = new GameBoyAdvance(makeGBA({ program: [0xe3a0f000] }));
  g.ewram[0] = 7; g.iwram[0x100] = 9; g.iwram[0x7f00] = 5; g.write16(0x04000200, 1);
  g.runCycles(100);
  assert.ok(g.resets.length > 0); assert.equal(g.resets[0].frame, 0);
  assert.equal(g.ewram[0], 0); assert.equal(g.iwram[0x100], 0); assert.equal(g.iwram[0x7f00], 0);
  assert.equal(g.io16(0x200), 0);
  const stop = new GameBoyAdvance(makeGBA());
  stop.cpu.r[15] = 4;
  assert.throws(() => stop.cpu.step(), error => error.kind === "bios" && error.report.pc === 4);
  assert.equal(stop.resets.length, 0);
});

test("HardReset reboots from the cartridge entry point", () => {
  const g = game();
  g.ewram[0] = 7; g.cpu.r[14] = 0x08000123; g.cpu.cpsr |= 0x80;
  g.swi(0x26);
  assert.equal(g.cpu.r[15], 0x08000000); assert.equal(g.cpu.cpsr, 0x1f); assert.equal(g.ewram[0], 0);
  assert.deepEqual(g.resets, [{ frame: 0, caller: 0x08000123 }]);
});

test("an unsupported BIOS service records where it was requested", () => {
  const g = game();
  g.cpu.address = 0x08000010;
  assert.throws(() => g.swi(0x2a), error => {
    assert.equal(error.kind, "swi"); assert.equal(error.report.swi, 0x2a);
    assert.equal(error.report.pc, 0x08000010); assert.equal(g.lastStop, error.report);
    return /a 0x8000010/.test(error.message);
  });
});

test("DMA treats the reserved source control as increment instead of stopping", () => {
  const g = game();
  g.write32(0x02000000, 0x11111111); g.write32(0x02000004, 0x22222222);
  g.write32(0x040000b0, 0x02000000); g.write32(0x040000b4, 0x03000000);
  g.write16(0x040000b8, 2); g.write16(0x040000ba, 0x8000 | 1 << 10 | 3 << 7);
  assert.equal(g.read32(0x03000000), 0x11111111); assert.equal(g.read32(0x03000004), 0x22222222);
});

test("DMA0 special timing is prohibited: it neither stops the core nor transfers", () => {
  const g = game();
  g.write32(0x02000000, 0x12345678);
  g.write32(0x040000b0, 0x02000000); g.write32(0x040000b4, 0x03000000);
  g.write16(0x040000b8, 1); g.write16(0x040000ba, 0x8000 | 1 << 10 | 3 << 12);
  g.tick(1232 * 228);
  assert.equal(g.read32(0x03000000), 0); assert.ok(g.io16(0xba) & 0x8000);
});

test("DMA3 video capture copies one unit per scanline from line 2 and stops at line 162", () => {
  const g = game();
  for (let i = 0; i < 170; i++) g.write16(0x02000000 + i * 2, 0x100 + i);
  g.write32(0x040000d4, 0x02000000); g.write32(0x040000d8, 0x06000000);
  g.write16(0x040000dc, 1); g.write16(0x040000de, 0x8000 | 1 << 9 | 3 << 12);
  g.tick(1232 * 2 + 959); assert.equal(g.read16(0x06000000), 0);
  g.tick(1); assert.equal(g.read16(0x06000000), 0x100); assert.equal(g.read16(0x06000002), 0);
  g.tick(1232); assert.equal(g.read16(0x06000002), 0x101);
  g.tick(1232 * 170);
  assert.equal(g.read16(0x06000000 + 159 * 2), 0x100 + 159);
  assert.equal(g.read16(0x06000000 + 160 * 2), 0);
  assert.equal(g.io16(0xde) & 0x8000, 0);
});

test("DMA3 special timing without repeat captures a single scanline", () => {
  const g = game();
  g.write16(0x02000000, 0xabcd); g.write16(0x02000002, 0xdcba);
  g.write32(0x040000d4, 0x02000000); g.write32(0x040000d8, 0x06000000);
  g.write16(0x040000dc, 1); g.write16(0x040000de, 0x8000 | 3 << 12);
  g.tick(1232 * 5);
  assert.equal(g.read16(0x06000000), 0xabcd); assert.equal(g.read16(0x06000002), 0);
  assert.equal(g.io16(0xde) & 0x8000, 0);
});
