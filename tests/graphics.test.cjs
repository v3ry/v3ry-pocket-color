"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoy } = require("../emulator.js");
const { inspect, tileGrid } = require("../graphics.js");
const States = require("../states.js");
const { makeROM } = require("./helpers.cjs");
const pixel = (image, x, y) => [...image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test("3D tile grid decodes signed graphics from both banks with explicit palettes and stays read-only", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.vram[0x1000] = 128;
  game.vram[8192 + 0x1000 + 1] = 128;
  game.bgPalette.fill(0);
  game.bgPalette.set([31, 0], 2);
  game.bgPalette.set([224, 3], 8 + 4);
  const before = States.capture(game, "0".repeat(64));
  const grid = tileGrid(game, new Uint16Array([0, 0x180]), 2, 1);
  assert.deepEqual(pixel(grid, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(grid, 8, 0), [0, 255, 0, 255]);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  assert.throws(() => tileGrid(game, [0], 2, 1), /Dimensions/);
  assert.throws(() => tileGrid(game, [0], 0, 1), /Dimensions/);
  assert.throws(() => tileGrid(game, [0], 33, 1), /Dimensions/);
  assert.throws(() => tileGrid(game, [2048], 1, 1), /Tuile/);
  assert.throws(() => tileGrid(game, [-1], 1, 1), /Tuile/);
  const dmg = new GameBoy(makeROM());
  const fullMap = tileGrid(dmg, new Uint16Array(40 * 36), 40, 36);
  assert.equal(fullMap.width, 320);
  assert.equal(fullMap.height, 288);
  assert.throws(() => tileGrid(dmg, new Uint16Array(129), 129, 1), /Dimensions/);
});

test("graphics inspection is read-only, including pixels, window counter and mapper state", () => {
  for (const color of [false, true]) {
    const game = new GameBoy(makeROM({ color }));
    game.io[0x40] = 0xf3;
    game.io[0x4b] = 7;
    game.tick(456 * 20 + 123);
    const before = States.capture(game, "0".repeat(64));
    for (const background of [true, false]) inspect(game, { background });
    const after = States.capture(game, "0".repeat(64));
    after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
  }
});

test("tile banks, map signed addressing, CGB attributes and palettes are decoded", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.bgPalette.fill(0);
  game.bgPalette.set([0x1f, 0], 2);
  game.bgPalette.set([0xe0, 3], 8 + 4);
  game.vram[0] = 128;
  game.vram[8192 + 1] = 1;
  game.vram[8192 + 0x1800] = 8 | 32 | 1;
  const data = inspect(game, { bank: 1, palette: 1 });
  assert.deepEqual(pixel(data.maps[0], 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(data.tiles, 7, 0), [0, 255, 0, 255]);
  game.io[0x40] &= ~16;
  game.vram[0x1000] = 128;
  game.vram[8192 + 0x1c00] = 0;
  assert.deepEqual(pixel(inspect(game).maps[1], 0, 0), [255, 0, 0, 255]);
  assert.throws(() => inspect(game, { bank: 2 }), /invalide/);
});

test("layer filters isolate background, window and behind-background sprites in the preview", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.bgPalette.fill(0); game.objPalette.fill(0);
  game.bgPalette.set([0x1f, 0], 2);
  game.bgPalette.set([0, 0x7c], 4);
  game.objPalette.set([0xe0, 3], 2);
  game.vram[0] = 255;
  game.vram[17] = 255;
  game.vram[32] = 255;
  game.vram[0x1c00] = 1;
  game.io[0x40] = 0xf3; game.io[0x4b] = 15; game.io[0x4a] = 0;
  game.oam.set([16, 8, 2, 128]);
  assert.deepEqual(pixel(inspect(game).preview, 0, 0), [255, 0, 0, 255]);
  const isolated = inspect(game, { background: false });
  assert.deepEqual(pixel(isolated.preview, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(isolated.preview, 8, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(inspect(game, { background: false, window: false, sprites: false }).preview, 0, 0), [0, 0, 0, 0]);
});

test("OAM inspector shows all 40 sprites, 8x16 flips, bank, palette and transparent color zero", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.io[0x40] |= 4;
  game.objPalette.fill(0);
  game.objPalette.set([0x1f, 0], 7 * 8 + 2);
  game.oam.set([20, 30, 3, 8 | 32 | 64 | 128 | 7], 39 * 4);
  game.vram[8192 + 3 * 16 + 14] = 1;
  const data = inspect(game);
  assert.equal(data.entries.length, 40);
  assert.deepEqual(data.entries[39], { index: 39, x: 22, y: 4, tile: 3, height: 16,
    bank: 1, palette: 7, flipX: true, flipY: true, behind: true });
  assert.deepEqual(pixel(data.objects, 72, 48), [255, 0, 0, 255]);
  assert.deepEqual(pixel(data.objects, 73, 48), [0, 0, 0, 0]);
});

test("DMG inspector uses BGP and the two OBJ palettes", () => {
  const game = new GameBoy(makeROM());
  game.io[0x47] = 0xe4; game.io[0x48] = 0xe4; game.io[0x49] = 0x1b;
  const data = inspect(game);
  assert.deepEqual(pixel(data.palettes, 0, 0), [232, 240, 208, 255]);
  assert.deepEqual(pixel(data.palettes, 32, 8), [16, 40, 40, 255]);
  assert.throws(() => inspect(game, { bank: 1 }), /invalide/);
});
