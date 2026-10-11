"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { makeGBA } = require("./helpers.cjs");
const game = () => new GameBoyAdvance(makeGBA());
const pixel = (g, x = 0, y = 0) => [...g.pixels.slice((y * 240 + x) * 4, (y * 240 + x + 1) * 4)];
const affineGame = () => {
  const g = game();
  g.write16(0x04000000, 0x402); g.write16(0x0400000c, 0x100);
  g.write16(0x04000020, 0x100); g.write16(0x04000026, 0x100);
  g.vram[0x800] = 1;
  for (let row = 0; row < 6; row++) g.vram[64 + row * 8] = row + 1;
  g.vram[65] = 2; g.vram[66] = 3; g.vram[74] = 3;
  for (const [index, color] of [0, 31, 31 << 5, 31 << 10, 0x7fff, 31 | 31 << 5, 31 | 31 << 10].entries()) {
    g.write16(0x05000000 + index * 2, color);
  }
  return g;
};

test("bitmap modes 3, 4 and 5 respect pixels, palettes, pages and transparent borders", () => {
  for (const mode of [3, 4, 5]) {
    const g = game(); g.write16(0x04000000, 0x400 | mode | (mode === 3 ? 0 : 16));
    if (mode === 4) { g.palette[2] = 31; g.vram[0xa000] = 1; }
    else g.write16(0x06000000 + (mode === 5 ? 0xa000 : 0), 31);
    g.graphics.line(0); assert.deepEqual(pixel(g), [255, 0, 0, 255]);
    if (mode === 5) assert.deepEqual(pixel(g, 160), [0, 0, 0, 255]);
  }
});

test("text backgrounds decode 4-bit tiles, palette banks, flips and scroll", () => {
  const g = game();
  g.write16(0x04000000, 0x100); g.write16(0x04000008, 0x100);
  g.write16(0x06000800, 0x2400); g.vram[3] = 0x50; g.write16(0x0500004a, 0x3e0);
  g.graphics.line(0); assert.deepEqual(pixel(g), [0, 255, 0, 255]);
  g.write16(0x04000010, 1); g.graphics.line(0); assert.deepEqual(pixel(g), [0, 0, 0, 255]);
});

test("affine background uses signed matrix, reference coordinates and wrap control", () => {
  const g = game(); g.write16(0x04000000, 0x402);
  g.write16(0x0400000c, 0x100); g.vram[0x800] = 1; g.vram[64] = 1; g.write16(0x05000002, 0x7c00);
  g.graphics.line(0); assert.deepEqual(pixel(g), [0, 0, 255, 255]);
  g.write32(0x04000028, 128 * 256); g.graphics.line(0); assert.deepEqual(pixel(g), [0, 0, 0, 255]);
  g.write16(0x0400000c, 0x2100); g.graphics.line(0); assert.deepEqual(pixel(g), [0, 0, 255, 255]);
});

test("affine background accumulates matrix increments independently for each scanline", () => {
  const g = affineGame();
  g.graphics.line(0); assert.deepEqual(pixel(g), [255, 0, 0, 255]);
  g.write16(0x04000026, 0x200);
  g.graphics.line(1); assert.deepEqual(pixel(g, 0, 1), [0, 255, 0, 255]);
  g.graphics.line(2); assert.deepEqual(pixel(g, 0, 2), [255, 255, 255, 255]);
});

test("affine reference writes replace the current scanline origin without reapplying its line offset", () => {
  const g = affineGame();
  g.graphics.line(0);
  g.write32(0x0400002c, 2 * 256);
  g.graphics.line(1);
  assert.deepEqual(pixel(g, 0, 1), [0, 0, 255, 255]);
});

test("affine matrix writes during a scanline are latched for the following scanline", () => {
  const g = affineGame();
  g.graphics.latchLine(0);
  g.write16(0x04000020, 0x200);
  g.graphics.line(0);
  assert.deepEqual(pixel(g, 1), [0, 255, 0, 255]);
  g.graphics.latchLine(1); g.graphics.line(1);
  assert.deepEqual(pixel(g, 1, 1), [0, 0, 255, 255]);
});

test("sprites retain OAM order, priority, transparency, flips and palette", () => {
  const g = game(); g.write16(0x04000000, 0x1000);
  for (let i = 0; i < 128; i++) g.write16(0x07000000 + i * 8, 512);
  g.write16(0x07000000, 0); g.write16(0x07000002, 4096);
  g.vram[0x10003] = 0x10; g.write16(0x05000202, 31);
  g.graphics.line(0); assert.deepEqual(pixel(g), [255, 0, 0, 255]); assert.deepEqual(pixel(g, 1), [0, 0, 0, 255]);
});

test("ObjAffineSet matrices drive real affine sprite rendering", () => {
  const g = game();
  g.write16(0x04000000, 0x1040);
  for (let i = 0; i < 128; i++) g.write16(0x07000000 + i * 8, 512);
  g.write16(0x07000000, 256); g.write16(0x07000002, 0);
  g.vram[0x10000] = 0x10; g.write16(0x05000202, 31);
  g.write16(0x02000000, 256); g.write16(0x02000002, 256);
  g.cpu.r[0] = 0x02000000; g.cpu.r[1] = 0x07000006; g.cpu.r[2] = 1; g.cpu.r[3] = 8;
  g.swi(0x0f); g.graphics.line(0);
  assert.deepEqual(pixel(g, 1), [255, 0, 0, 255]);
  g.write16(0x02000004, 0x4000); g.swi(0x0f); g.graphics.line(0);
  assert.deepEqual(pixel(g), [0, 0, 0, 255]);
  g.graphics.line(7);
  assert.deepEqual(pixel(g, 0, 7), [255, 0, 0, 255]);
});
test("windows and brightness effects apply only to selected layers and regions", () => {
  const g = game(); g.write16(0x04000000, 0x2000);
  g.write16(0x05000000, 31); g.write16(0x04000040, 0x0001); g.write16(0x04000044, 0x0001);
  g.write16(0x04000048, 32); g.write16(0x0400004a, 0);
  g.write16(0x04000050, 0xe0); g.write16(0x04000054, 16); g.graphics.line(0);
  assert.deepEqual(pixel(g), [0, 0, 0, 255]); assert.deepEqual(pixel(g, 1), [255, 0, 0, 255]);
});

test("bitmap mode 4 palette index 0 is transparent so lower sprites show through", () => {
  const g = game(); g.write16(0x04000000, 0x1404);
  for (let i = 0; i < 128; i++) g.write16(0x07000000 + i * 8, 512);
  g.write16(0x07000000, 0); g.write16(0x07000004, 512 | 2 << 10);
  g.vram[0x14000] = 1; g.write16(0x05000202, 31);
  g.graphics.line(0);
  assert.deepEqual(pixel(g), [255, 0, 0, 255]);
});
