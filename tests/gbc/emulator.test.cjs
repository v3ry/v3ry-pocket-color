"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoy } = require("../../gbc/emulator.js");
const { Cartridge } = require("../../gbc/cartridge.js");
const { APU } = require("../../gbc/audio.js");
const { makeROM, makeDemoROM } = require("./helpers.cjs");

test("ROM validation rejects truncation, checksum and unsupported mappers", () => {
  assert.throws(() => new Cartridge(new Uint8Array(12)), /tronquee/);
  const rom = makeROM(); rom[0x134] ^= 1;
  assert.throws(() => new Cartridge(rom), /checksum/);
  assert.throws(() => new Cartridge(makeROM({ type: 0x22 })), /non prise en charge/);
  assert.throws(() => new Cartridge(makeROM().slice(0, 0x8000 - 1)), /tronquee/);
});

test("Game Boy Camera mapper exposes control registers and stores captured 2bpp tiles", () => {
  const cart = new Cartridge(makeROM({ type: 0xfc, sizeCode: 2, ramSize: 4 }));
  assert.equal(cart.isCamera, true);
  cart.control(0x2000, 0); assert.equal(cart.readROM(0x4000), 0);
  cart.control(0x2000, 2); assert.equal(cart.readROM(0x4000), 2);
  cart.control(0, 10);
  cart.control(0x4000, 0x10);
  cart.writeRAM(0xa000, 6);
  assert.equal(cart.readRAM(0xa080), 6);
  for (let index = 6; index < 0x36; index += 3) {
    cart.writeRAM(0xa000 + index, 64);
    cart.writeRAM(0xa001 + index, 128);
    cart.writeRAM(0xa002 + index, 192);
  }
  cart.writeRAM(0xa002, 3); cart.writeRAM(0xa003, 0);
  const pixels = new Uint8ClampedArray(128 * 120 * 4).fill(128);
  cart.setCameraCaptureProvider(() => pixels);
  cart.writeRAM(0xa000, 1);
  assert.equal(cart.readRAM(0xa000), 1);
  assert.equal(cart.readRAM(0xa001), 0);
  cart.control(0x4000, 0);
  assert.equal(cart.readRAM(0xa100), 0);
  cart.tick(cart.cameraBusyCycles);
  assert.equal(cart.readRAM(0xa100), 0xff);
  assert.equal(cart.readRAM(0xa101), 0);
});

test("Game Boy Camera requires an explicit image source and advances capture timing with the emulator", () => {
  const cart = new Cartridge(makeROM({ type: 0xfc, ramSize: 4 }));
  cart.control(0x4000, 0x10);
  assert.throws(() => cart.writeRAM(0xa000, 1), /activez la webcam/);
  const game = new GameBoy(makeROM({ type: 0xfc, ramSize: 4 }));
  game.cartridge.cameraBusyCycles = 10;
  game.tick(4);
  assert.equal(game.cartridge.cameraBusyCycles, 6);
});

test("MBC1 ROM/RAM banking, mode and disabled RAM", () => {
  const cart = new Cartridge(makeROM({ type: 3, sizeCode: 5, ramSize: 3 }));
  assert.equal(cart.readROM(0x4000), 1);
  cart.control(0x2000, 0); assert.equal(cart.readROM(0x4000), 1);
  cart.control(0x2000, 2); cart.control(0x4000, 1);
  assert.equal(cart.readROM(0x4000), 34);
  assert.equal(cart.readROM(0), 0);
  cart.control(0x6000, 1); assert.equal(cart.readROM(0), 32);
  cart.control(0, 10); cart.writeRAM(0xa123, 0x56);
  cart.control(0x4000, 2); assert.equal(cart.readRAM(0xa123), 0);
  cart.writeRAM(0xa123, 0x78); cart.control(0x4000, 1); assert.equal(cart.readRAM(0xa123), 0x56);
  cart.control(0, 0); assert.equal(cart.readRAM(0xa123), 255);
});

test("MBC2 address bit and nibble RAM; MBC5 bank 0 and ninth ROM bit", () => {
  const mbc2 = new Cartridge(makeROM({ type: 6, sizeCode: 2 }));
  mbc2.control(0x2100, 3); assert.equal(mbc2.readROM(0x4000), 3);
  mbc2.control(0, 10); mbc2.writeRAM(0xa001, 0xab); assert.equal(mbc2.readRAM(0xa201), 0xfb);
  const mbc5 = new Cartridge(makeROM({ type: 0x1b, sizeCode: 8, ramSize: 3 }));
  mbc5.rom[256 * 0x4000] = 0xde;
  mbc5.control(0x2000, 0); assert.equal(mbc5.readROM(0x4000), 0);
  mbc5.control(0x3000, 1); assert.equal(mbc5.readROM(0x4000), 0xde);
  mbc5.control(0, 10); mbc5.control(0x4000, 3); mbc5.writeRAM(0xa000, 42);
  mbc5.control(0x4000, 0); assert.equal(mbc5.readRAM(0xa000), 0);
  mbc5.control(0x4000, 3); assert.equal(mbc5.readRAM(0xa000), 42);
});

test("MBC3 RTC latch, halt and overflow", () => {
  const cart = new Cartridge(makeROM({ type: 0x10, ramSize: 3 }));
  cart.control(0, 10); cart.control(0x4000, 8); cart.writeRAM(0xa000, 58);
  cart.lastRTC -= 3000; cart.updateRTC();
  assert.equal(cart.rtc[0], 1); assert.equal(cart.rtc[1], 1);
  cart.control(0x6000, 0); cart.control(0x6000, 1);
  cart.writeRAM(0xa000, 20); assert.equal(cart.readRAM(0xa000), 1);
  cart.control(0x4000, 12); cart.writeRAM(0xa000, 0x40);
  cart.lastRTC -= 10000; cart.updateRTC(); assert.equal(cart.rtc[0], 20);
  cart.writeRAM(0xa000, 1); cart.rtc[3] = 255; cart.rtc[2] = 23; cart.rtc[1] = 59; cart.rtc[0] = 59;
  cart.lastRTC -= 2000; cart.updateRTC();
  assert.equal(cart.rtc[4], 0x80); assert.equal(cart.rtc[3], 0); assert.equal(cart.rtc[0], 1);
});

test("memory echo, WRAM/VRAM banks and palette auto-increment", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.write(0xc123, 42); assert.equal(gb.read(0xe123), 42);
  gb.write(0xff70, 2); gb.write(0xd123, 43); assert.equal(gb.read(0xf123), 43);
  gb.write(0xff70, 0); assert.equal(gb.read(0xd123), 0);
  gb.write(0xff4f, 1); gb.write(0x8000, 99); gb.write(0xff4f, 0); assert.equal(gb.read(0x8000), 0);
  gb.write(0xff4f, 1); assert.equal(gb.read(0x8000), 99);
  gb.write(0xff68, 0xbf); gb.write(0xff69, 0x12);
  assert.equal(gb.bgPalette[63], 0x12); assert.equal(gb.io[0x68], 0x80);
});

test("timer falling edges, delayed reload, cancellation and DIV reset", () => {
  const gb = new GameBoy(makeROM());
  gb.write(0xff04, 0); gb.write(0xff07, 5); gb.write(0xff06, 0x42);
  gb.write(0xff05, 255); gb.tick(16); assert.equal(gb.read(0xff05), 0);
  gb.tick(3); assert.equal(gb.io[0x0f] & 4, 0);
  gb.tick(1); assert.equal(gb.read(0xff05), 0x42); assert.equal(gb.io[0x0f] & 4, 4);
  gb.write(0xff04, 0); gb.write(0xff05, 255); gb.tick(16); gb.write(0xff05, 12);
  gb.tick(4); assert.equal(gb.read(0xff05), 12);
  gb.tick(4); const before = gb.read(0xff05); gb.write(0xff04, 0);
  assert.equal(gb.read(0xff05), before + 1);
});

test("joypad select groups, falling-edge interrupt and released keys", () => {
  const gb = new GameBoy(makeROM());
  gb.write(0xff0f, 0); gb.setButton(4, true); assert.equal(gb.io[0x0f], 0);
  gb.write(0xff00, 0x10); assert.equal(gb.read(0xff00) & 15, 14); assert.equal(gb.io[0x0f], 16);
  gb.write(0xff00, 0x20); assert.equal(gb.read(0xff00) & 15, 15);
  gb.setButton(2, true); assert.equal(gb.read(0xff00) & 15, 11);
  gb.releaseButtons(); assert.equal(gb.read(0xff00) & 15, 15);
});

test("LCD modes, VBlank, STAT edges, and frame length", () => {
  const gb = new GameBoy(makeROM());
  gb.write(0xff41, 0x20); gb.write(0xff0f, 0);
  assert.equal(gb.mode(), 2); gb.tick(80); assert.equal(gb.mode(), 3);
  gb.tick(172); assert.equal(gb.mode(), 0);
  gb.tick(204); assert.equal(gb.ly, 1); assert.equal(gb.mode(), 2); assert.equal(gb.io[0x0f] & 2, 2);
  gb.tick(456 * 143); assert.equal(gb.ly, 144); assert.equal(gb.frames, 1); assert.equal(gb.io[0x0f] & 1, 1);
  gb.tick(456 * 10); assert.equal(gb.ly, 0); assert.equal(gb.dot, 0);
  gb.write(0xff40, 0); gb.tick(999); assert.equal(gb.ly, 0); assert.equal(gb.mode(), 0);
});

test("synthetic GB and GBC ROMs execute and draw expected pixels", () => {
  for (const color of [false, true]) {
    const gb = new GameBoy(makeDemoROM(color));
    gb.runCycles(70224 * 3);
    assert.ok(gb.frames >= 2);
    assert.deepEqual([...gb.pixels.slice(0, 4)], color ? [255, 0, 0, 255] : [136, 176, 112, 255]);
    assert.equal(gb.cpu.halted, true);
  }
});

test("LY resets at dot 4 of line 153 without ending VBlank, at both CGB speeds", () => {
  for (const [color, fast] of [[false, false], [true, false], [true, true]]) {
    const gb = new GameBoy(makeROM({ color }));
    if (fast) { gb.write(0xff4d, 1); gb.switchSpeed(); }
    const scale = fast ? 2 : 1;
    gb.tick(456 * 153 * scale);
    assert.equal(gb.read(0xff44), 153);
    assert.equal(gb.mode(), 1);
    gb.write(0xff45, 0);
    gb.write(0xff41, 0x40);
    gb.write(0xff0f, 0);
    gb.tick(3 * scale);
    assert.equal(gb.read(0xff44), 153);
    assert.equal(gb.read(0xff41) & 4, 0);
    assert.equal(gb.io[0x0f] & 2, 0);
    gb.tick(scale);
    assert.equal(gb.read(0xff44), 0);
    assert.equal(gb.read(0xff41) & 7, 5);
    assert.equal(gb.io[0x0f] & 2, 2);
    assert.equal(gb.ly, 153);
    assert.equal(gb.frames, 1);
    gb.write(0xff0f, 0);
    gb.tick(451 * scale);
    assert.equal(gb.read(0xff44), 0);
    assert.equal(gb.mode(), 1);
    assert.equal(gb.io[0x0f] & 2, 0);
    gb.tick(scale);
    assert.equal(gb.ly, 0);
    assert.equal(gb.dot, 0);
    assert.equal(gb.mode(), 2);
    assert.equal(gb.frames, 1);
    assert.equal(gb.io[0x0f] & 2, 0);
  }
});

test("LYC 153 coincidence clears on the early LY reset and mode 1 keeps STAT high", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.write(0xff45, 153); gb.write(0xff41, 0x40);
  gb.tick(456 * 153);
  assert.equal(gb.read(0xff41) & 4, 4);
  gb.tick(4);
  assert.equal(gb.read(0xff41) & 4, 0);
  assert.equal(gb.statLine, false);
  gb.write(0xff41, 0x50);
  gb.write(0xff0f, 0);
  gb.write(0xff45, 0);
  assert.equal(gb.read(0xff41) & 4, 4);
  assert.equal(gb.io[0x0f] & 2, 0);
  gb.write(0xff40, 0);
  assert.equal(gb.read(0xff44), 0);
  assert.equal(gb.mode(), 0);
});

test("background attributes, window and sprite priority/transparency", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.bgPalette.set([0xff, 0x7f, 0x1f, 0, 0, 0, 0, 0]);
  gb.objPalette.set([0, 0, 0xe0, 3, 0, 0, 0, 0]);
  gb.vram[0] = 0xff;
  gb.vram[16] = 0xff;
  gb.io[0x40] = 0x93; gb.oam.set([16, 8, 1, 0]);
  gb.renderLine(); assert.deepEqual([...gb.pixels.slice(0, 4)], [0, 255, 0, 255]);
  gb.vram[8192 + 0x1800] = 128;
  gb.renderLine(); assert.deepEqual([...gb.pixels.slice(0, 4)], [255, 0, 0, 255]);
  gb.io[0x40] &= ~1;
  gb.renderLine(); assert.deepEqual([...gb.pixels.slice(0, 4)], [0, 255, 0, 255]);
  gb.io[0x40] = 0xf1; gb.io[0x4a] = 0; gb.io[0x4b] = 7;
  gb.vram[0x1c00] = 2; gb.vram[32] = 0;
  gb.renderLine(); assert.deepEqual([...gb.pixels.slice(0, 4)], [255, 255, 255, 255]);
  assert.equal(gb.windowLine, 1);
});

test("OAM DMA, CGB GDMA and cancellable HDMA", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  for (let i = 0; i < 160; i++) gb.write(0xc000 + i, i);
  gb.write(0xff46, 0xc0);
  assert.equal(gb.oam[159], 0); assert.equal(gb.stall, 0);
  gb.tick(639); assert.equal(gb.oam[159], 0); assert.equal(gb.dmaActive, true);
  gb.tick(1); assert.equal(gb.oam[159], 159); assert.equal(gb.dmaActive, false);
  gb.write(0xff40, 0); gb.write(0xff40, 0x91);
  gb.write(0xff51, 0xc0); gb.write(0xff52, 0); gb.write(0xff53, 0); gb.write(0xff54, 0);
  gb.write(0xff55, 1); assert.equal(gb.vram[31], 31); assert.equal(gb.read(0xff55), 255);
  gb.write(0xff55, 0x81); assert.equal(gb.hdmaActive, true);
  gb.tick(252); assert.equal(gb.hdmaBlocks, 1);
  gb.write(0xff55, 0); assert.equal(gb.hdmaActive, false); assert.equal(gb.read(0xff55), 0x80);
});

test("CGB speed switch halves PPU clocks but not CPU timer clocks; serial IRQ", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.write(0xff4d, 1); assert.equal(gb.switchSpeed(), true); assert.equal(gb.read(0xff4d), 0xfe);
  gb.tick(160); assert.equal(gb.dot, 80); assert.equal(gb.div, 160);
  gb.write(0xff01, 65); gb.write(0xff02, 0x83); gb.tick(128);
  assert.equal(gb.serialOutput, "A"); assert.equal(gb.read(0xff01), 255); assert.equal(gb.io[0x0f] & 8, 8);
});

test("real-time CGB budget keeps video and audio cadence at both CPU speeds", () => {
  const rom = makeROM({ color: true, program: [0x18, 0xfe] });
  const normal = new GameBoy(rom), fast = new GameBoy(rom);
  fast.write(0xff4d, 1);
  fast.switchSpeed();
  normal.runCycles(70224 * 2);
  const fastElapsed = fast.runCycles(70224 * 2);
  assert.equal(normal.frames, 2);
  assert.equal(fast.frames, 2);
  assert.ok(Math.abs(normal.dot - fast.dot) <= 12);
  assert.equal(normal.ly, fast.ly);
  assert.ok(Math.abs(normal.apu.drain().length - fast.apu.drain().length) <= 2);
  assert.ok(fastElapsed >= 70224 * 2 && fastElapsed < 70224 * 2 + 6);
  assert.equal(fast.div, (fastElapsed * 2) & 65535);
});

test("real-time budget handles a speed switch inside the running ROM", () => {
  const gb = new GameBoy(makeROM({ color: true, program: [
    0x3e, 1, 0xe0, 0x4d, 0x10, 0, 0x18, 0xfe,
  ] }));
  gb.runCycles(70224 * 2);
  assert.equal(gb.doubleSpeed, true);
  assert.equal(gb.frames, 2);
  assert.ok(gb.ly <= 1);
});

test("all timer frequencies use falling edges and disabling TAC increments once", () => {
  for (const [selector, period] of [1024, 16, 64, 256].entries()) {
    const gb = new GameBoy(makeROM());
    gb.write(0xff04, 0);
    gb.write(0xff07, 4 | selector);
    gb.tick(period - 1);
    assert.equal(gb.io[5], 0);
    gb.tick(1);
    assert.equal(gb.io[5], 1);
    gb.tick(period / 2);
    gb.write(0xff07, 0);
    assert.equal(gb.io[5], 2);
    gb.tick(period * 2);
    assert.equal(gb.io[5], 2);
  }
});

test("CPU video access follows LCD modes and DMA bypasses CPU-only restrictions", () => {
  for (const color of [false, true]) {
    const gb = new GameBoy(makeROM({ color }));
    gb.vram[0] = 0x12; gb.oam[0] = 0x34;
    assert.equal(gb.mode(), 2);
    assert.equal(gb.read(0x8000), 0x12);
    assert.equal(gb.read(0xfe00), 255);
    gb.write(0xfe00, 0x56);
    assert.equal(gb.oam[0], 0x34);
    gb.tick(80);
    assert.equal(gb.mode(), 3);
    assert.equal(gb.read(0x8000), 255);
    gb.write(0x8000, 0x78);
    assert.equal(gb.vram[0], 0x12);
    gb.tick(172);
    assert.equal(gb.mode(), 0);
    gb.write(0x8000, 0x9a); gb.write(0xfe00, 0xbc);
    assert.equal(gb.read(0x8000), 0x9a);
    assert.equal(gb.read(0xfe00), 0xbc);
    gb.tick(204 + 456 * 143);
    assert.equal(gb.mode(), 1);
    gb.write(0xfe00, 0xde);
    assert.equal(gb.read(0xfe00), 0xde);
    gb.write(0xff40, 0);
    gb.write(0xfe00, 0xef); gb.write(0x8000, 0xab);
    assert.equal(gb.read(0xfe00), 0xef);
    assert.equal(gb.read(0x8000), 0xab);
    const dma = new GameBoy(makeROM({ color }));
    dma.vram[0] = 0x12;
    dma.tick(80);
    dma.write(0xff46, 0x80);
    dma.tick(4);
    assert.equal(dma.oam[0], 0x12);
    assert.equal(dma.read(0x8000), 255);
  }
});

test("OAM DMA copies one byte per four CPU clocks, observes source changes and can restart", () => {
  for (const fast of [false, true]) {
    const gb = new GameBoy(makeROM({ color: true }));
    gb.write(0xff40, 0);
    if (fast) { gb.write(0xff4d, 1); gb.switchSpeed(); }
    gb.wram.fill(0x12, 0, 160);
    gb.wram.fill(0x34, 0x100, 0x1a0);
    gb.write(0xff46, 0xc0);
    assert.equal(gb.oam[0], 0);
    gb.tick(3); assert.equal(gb.oam[0], 0);
    gb.tick(1); assert.equal(gb.oam[0], 0x12);
    gb.wram[1] = 0x56;
    gb.tick(4); assert.equal(gb.oam[1], 0x56);
    gb.write(0xff46, 0xc1);
    assert.equal(gb.dmaIndex, 0);
    const elapsed = gb.tick(639);
    assert.equal(elapsed, fast ? 319 : 639);
    assert.equal(gb.dmaActive, true);
    assert.equal(gb.oam[158], 0x34);
    assert.equal(gb.oam[159], 0);
    gb.tick(1);
    assert.equal(gb.oam[159], 0x34);
    assert.equal(gb.dmaActive, false);
  }
});

test("DMG DMA permits HRAM execution but blocks external reads, writes and mapper controls", () => {
  const gb = new GameBoy(makeROM({ type: 1 }));
  gb.write(0xff40, 0);
  gb.hram.set([0x3e, 0x42, 0xea, 0x00, 0xc0, 0x76]);
  gb.cpu.pc = 0xff80;
  gb.write(0xff46, 0xc0);
  assert.equal(gb.read(0xc000), 255);
  assert.equal(gb.read(0), 255);
  gb.write(0x2000, 2);
  assert.equal(gb.cartridge.bank, 1);
  gb.write(0xc000, 0x99);
  gb.step(); gb.step(); gb.step();
  assert.equal(gb.cpu.a, 0x42);
  assert.equal(gb.cpu.halted, true);
  assert.equal(gb.cpu.haltBug, false);
  assert.equal(gb.wram[0], 0);
  assert.ok(gb.dmaIndex > 0);
  gb.tick(640);
  assert.equal(gb.read(0xc000), 0);
  gb.write(0xc000, 0x99);
  assert.equal(gb.read(0xc000), 0x99);
});

test("CGB DMA blocks only the source bus and OAM, leaving the other memory bus usable", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.write(0xff40, 0);
  gb.write(0xff46, 0xc0);
  assert.equal(gb.read(0xc000), 255);
  assert.equal(gb.read(0xe000), 255);
  assert.equal(gb.read(0), gb.cartridge.readROM(0));
  gb.write(0xff80, 42); assert.equal(gb.read(0xff80), 42);
  gb.write(0x8000, 17); assert.equal(gb.read(0x8000), 17);
  assert.equal(gb.read(0xfe00), 255);
  gb.write(0xff46, 0);
  assert.equal(gb.read(0), 255);
  gb.write(0xc000, 19); assert.equal(gb.read(0xc000), 19);
  gb.tick(640);
  assert.equal(gb.read(0xfe00), gb.cartridge.readROM(0));
});

test("mode 3 includes fine scroll, window and sprite fetch penalties but keeps 456-dot lines", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.io[0x43] = 7;
  gb.tick(80);
  assert.equal(gb.mode3End, 259);
  gb.tick(178); assert.equal(gb.mode(), 3);
  gb.tick(1); assert.equal(gb.mode(), 0);
  gb.tick(197); assert.equal(gb.ly, 1); assert.equal(gb.dot, 0);
  gb.io[0x43] = 0;
  gb.io[0x40] = 0xb3; gb.io[0x4b] = 87;
  gb.oam.set([17, 8, 0, 0, 17, 9, 0, 0]);
  gb.tick(80);
  assert.equal(gb.mode3End, 275); // window 6, first tile wait 5, two OBJ fetches 12
  gb.tick(194); assert.equal(gb.mode(), 3);
  gb.tick(1); assert.equal(gb.mode(), 0);
  gb.tick(181); assert.equal(gb.ly, 2); assert.equal(gb.dot, 0);
});

test("sprite penalties use the first ten OAM entries and include off-left but not off-right sprites", () => {
  const gb = new GameBoy(makeROM());
  gb.io[0x40] |= 2;
  for (let i = 0; i < 11; i++) gb.oam.set([16, i < 10 ? 168 : 8, 0, 0], i * 4);
  gb.tick(80);
  assert.equal(gb.mode3End, 252);
  gb.oam[1] = 0;
  assert.equal(gb.renderingEnd(), 263);
});

test("window Y match is latched per frame; changing WY to a past line cannot start it", () => {
  for (const color of [false, true]) {
    const gb = new GameBoy(makeROM({ color }));
    gb.write(0xff40, 0);
    gb.write(0xff4a, 10); gb.write(0xff4b, 7);
    gb.write(0xff40, 0xb1);
    gb.tick(456 * 5);
    gb.write(0xff4a, 2);
    gb.tick(456);
    assert.equal(gb.windowTriggered, false);
    assert.equal(gb.windowLine, 0);
    gb.write(0xff4a, 7);
    gb.tick(456 + 258);
    assert.equal(gb.windowTriggered, true);
    assert.equal(gb.windowLine, 1);
    gb.write(0xff40, 0x91);
    assert.equal(gb.windowTriggered, !color);
    gb.tick(456);
    gb.write(0xff40, 0xb1);
    assert.equal(gb.windowVisible(), !color);
  }
});

test("OAM DMA during mode 2 hides sprites on the affected line instead of showing partial OAM", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.io[0x40] |= 2;
  gb.bgPalette.fill(0); gb.objPalette.fill(0);
  gb.objPalette.set([0x1f, 0], 2);
  gb.vram[16] = 255;
  gb.oam.set([16, 8, 1, 0]);
  gb.write(0xff46, 0xc0);
  gb.tick(252);
  assert.equal(gb.oamScanBlocked, true);
  assert.deepEqual([...gb.pixels.slice(0, 4)], [0, 0, 0, 255]);
});

test("APU sequencer follows DIV falling edges and DIV writes at both CGB speeds", () => {
  for (const fast of [false, true]) {
    const gb = new GameBoy(makeROM({ color: true }));
    gb.write(0xff40, 0); gb.write(0xff04, 0);
    if (fast) { gb.write(0xff4d, 1); gb.switchSpeed(); }
    gb.write(0xff11, 63); gb.write(0xff12, 0xf0); gb.write(0xff14, 0xc0);
    const scale = fast ? 2 : 1;
    gb.tick(8192 * scale - 1);
    assert.equal(gb.apu.channels[0].enabled, true);
    assert.equal(gb.apu.frameStep, 0);
    gb.tick(1);
    assert.equal(gb.apu.channels[0].enabled, false);
    assert.equal(gb.apu.frameStep, 1);
    gb.tick(4096 * scale);
    gb.write(0xff04, 0);
    assert.equal(gb.apu.frameStep, 2);
    gb.write(0xff04, 0);
    assert.equal(gb.apu.frameStep, 2);
    gb.write(0xff26, 0);
    gb.tick(8192 * scale * 3);
    assert.equal(gb.apu.frameStep, 0);
  }
});

test("APU envelope and length sequencing is independent of tick chunk size", () => {
  const a = new GameBoy(makeROM()), b = new GameBoy(makeROM());
  for (const gb of [a, b]) {
    gb.write(0xff40, 0); gb.write(0xff04, 0);
    gb.write(0xff11, 0x80); gb.write(0xff12, 0xa9); gb.write(0xff14, 0x80);
  }
  a.tick(8192 * 8);
  for (let i = 0; i < 8192 * 8; i += 4) b.tick(4);
  assert.equal(a.apu.channels[0].volume, 11);
  assert.deepEqual(a.apu.channels, b.apu.channels);
  assert.deepEqual(a.apu.drain(), b.apu.drain());
});

test("CGB palette data is blocked in mode 3 but auto-increment still occurs", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.bgPalette[63] = 0x12; gb.objPalette[63] = 0x34;
  gb.write(0xff68, 0xbf); gb.write(0xff6a, 0xbf);
  gb.tick(80);
  assert.equal(gb.read(0xff69), 255);
  assert.equal(gb.read(0xff6b), 255);
  gb.write(0xff69, 0x56); gb.write(0xff6b, 0x78);
  assert.equal(gb.bgPalette[63], 0x12);
  assert.equal(gb.objPalette[63], 0x34);
  assert.equal(gb.io[0x68], 0x80);
  assert.equal(gb.io[0x6a], 0x80);
  gb.tick(172);
  gb.write(0xff69, 0x9a); gb.write(0xff6b, 0xbc);
  gb.write(0xff68, 0); gb.write(0xff6a, 0);
  assert.equal(gb.read(0xff69), 0x9a);
  assert.equal(gb.read(0xff6b), 0xbc);
});

test("TAC disable distinguishes CGB from DMG; frequency changes and DIV reset still tick", () => {
  for (const color of [false, true]) {
    const gb = new GameBoy(makeROM({ color }));
    gb.write(0xff04, 0); gb.write(0xff07, 5);
    gb.tick(8);
    gb.write(0xff07, 1);
    assert.equal(gb.io[5], color ? 0 : 1);
    gb.write(0xff07, 5);
    const before = gb.io[5];
    gb.write(0xff04, 0);
    assert.equal(gb.io[5], before + 1);
    gb.tick(8);
    gb.write(0xff07, 6);
    assert.equal(gb.io[5], before + 2);
  }
});

test("APU generates finite stereo samples, triggers channels and disables DAC", () => {
  const apu = new APU(48000);
  apu.write(0xff11, 0x80); apu.write(0xff12, 0xf3);
  apu.write(0xff13, 0x40); apu.write(0xff14, 0x87);
  assert.equal(apu.read(0xff26) & 1, 1);
  apu.tick(70224);
  const samples = apu.drain();
  assert.equal(samples.length, Math.floor(70224 * 48000 / 4194304) * 2);
  assert.ok(samples.some((sample) => sample > 0));
  assert.ok(samples.every(Number.isFinite));
  assert.equal(apu.drain().length, 0);
  apu.write(0xff12, 0); assert.equal(apu.read(0xff26) & 1, 0);
  apu.write(0xff26, 0); assert.equal(apu.read(0xff26), 0x70);
});

test("APU maps NR51 and NR50 left/right to Web Audio channels without swapping stereo", () => {
  for (const [route, leftVolume, rightVolume] of [[0x10, 7, 0], [0x01, 0, 7], [0x11, 7, 1]]) {
    const apu = new APU(48000);
    apu.write(0xff11, 0x80); apu.write(0xff12, 0xf0); apu.write(0xff14, 0x80);
    apu.write(0xff24, (leftVolume << 4) | rightVolume);
    apu.write(0xff25, route);
    apu.tick(88);
    const [left, right] = apu.drain();
    assert.equal(left, route & 0x10 ? (leftVolume + 1) / 64 : 0);
    assert.equal(right, route & 1 ? (rightVolume + 1) / 64 : 0);
  }
});

test("HDMA and STAT HBlank start at the variable end of rendering, not fixed dot 252", () => {
  const gb = new GameBoy(makeROM({ color: true }));
  gb.io[0x43] = 7;
  gb.wram[0] = 0x42;
  gb.write(0xff51, 0xc0); gb.write(0xff55, 0x80);
  gb.write(0xff41, 8); gb.write(0xff0f, 0);
  gb.tick(252);
  assert.equal(gb.mode(), 3);
  assert.equal(gb.vram[0], 0);
  assert.equal(gb.hdmaActive, true);
  assert.equal(gb.io[0x0f] & 2, 0);
  gb.tick(6);
  assert.equal(gb.vram[0], 0);
  gb.tick(1);
  assert.equal(gb.mode(), 0);
  assert.equal(gb.vram[0], 0x42);
  assert.equal(gb.hdmaActive, false);
  assert.equal(gb.io[0x0f] & 2, 2);
});
