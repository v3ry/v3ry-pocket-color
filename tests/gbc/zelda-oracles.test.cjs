"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoy } = require("../../gbc/emulator.js");
const States = require("../../gbc/states.js");
const Scene = require("../../gbc/scene.js");
const World = require("../../gbc/world.js");
const { makeROM } = require("./helpers.cjs");
const preset = require("../../gbc/preset/zelda-oracles.js");

function startRoom() {
  const game = new GameBoy(makeROM({ color: true, type: 0x1b, sizeCode: 5, ramSize: 3 }));
  game.cartridge.title = "ZELDA NAYRU";
  game.cartridge.rom[0x14e] = 0xa6;
  game.cartridge.rom[0x14f] = 0x64;
  game.wram[0xc2d] = 0;
  game.wram[0xc2e] = 0;
  game.wram[0xc2f] = 0x8a;
  game.wram[0xc30] = 0x8a;
  game.wram[0xc31] = 1;
  game.wram[0xd0a] = 20;
  game.wram[0xd0b] = 16;
  game.wram[0xd00] = 1;
  game.io[0x40] = 0xa7;
  game.io[0x42] = 240;
  game.io[0x43] = 0;
  game.io[0x4a] = 199;
  game.io[0x4b] = 199;
  game.io[0x47] = 0xe4;
  return game;
}

test("Oracle of Ages preset matches the European Ages ROM, not Seasons or another revision", () => {
  const game = startRoom();
  assert.equal(Scene.selectPreset(game, [preset]), preset);
  game.cartridge.title = "ZELDA DIN";
  assert.equal(Scene.selectPreset(game, [preset]), null);
  game.cartridge.title = "ZELDA NAYRU";
  game.cartridge.rom[0x14f] ^= 1;
  assert.equal(Scene.selectPreset(game, [preset]), null);
});

test("start room collision quadrants drive 2.5D depth while special collisions stay flat", () => {
  const game = startRoom(), ram = game.wram;
  ram[0xe00] = 0b1000;
  ram[0xe01] = 0x10;
  const terrain = preset.terrain(game);
  assert.equal(terrain.active, true);
  assert.equal(terrain.depths[0], 8);
  assert.equal(terrain.depths[1], 0);
  assert.equal(terrain.depths[32], 0);
  assert.equal(terrain.depths[33], 0);
  assert.equal(terrain.depths[2], 0);
  assert.equal(terrain.hidden.length, 1024);
  assert.equal(terrain.hidden.some(Boolean), false);
  assert.equal(terrain.depths[20 * 32], 0);

  const scene = Scene.buildScene(game, preset, 8);
  assert.equal(scene.terrain.active, true);
  assert.ok(scene.background.length > 0);
});

test("3D start room uses the raw CGB map entries and 8-pixel collision surfaces without state writes", () => {
  const game = startRoom();
  game.wram[0xe00] = 0b1000;
  assert.equal(preset.light, 0.25);
  game.vram[0x1800] = 0x92;
  game.vram[8192 + 0x1800] = 0x69;
  const before = States.capture(game, "0".repeat(64));
  const descriptor = preset.world(game);
  assert.equal(descriptor.active, true);
  assert.equal(descriptor.generic, true);
  assert.equal(descriptor.procedural, true);
  assert.equal(descriptor.texturedGround, true);
  assert.equal(descriptor.luminanceRelief, true);
  assert.equal(descriptor.canopyRelief, true);
  assert.equal(descriptor.vegetationRelief, true);
  assert.equal(descriptor.modeledFoliage, true);
  assert.equal(descriptor.foundationDepth, 8);
  assert.deepEqual(descriptor.objects, []);
  assert.equal(descriptor.tiles.length, 320);
  assert.equal(descriptor.tiles[0], 0x6992);
  assert.equal(descriptor.surfaces.length, 320);
  assert.deepEqual(descriptor.surfaces[0], { x: 0, y: 0, depth: 14, size: 8, sculpted: true });
  assert.deepEqual(descriptor.surfaces[1], { x: 8, y: 0, depth: 0, size: 8, sculpted: false });

  const world = World.build(game, preset, 8);
  assert.equal(world.active, true);
  assert.equal(world.textures.background.width, 160);
  assert.equal(world.textures.background.height, 128);
  assert.deepEqual(world.origin, [0, -16]);
  assert.ok(world.background.length > 0);
  const after = States.capture(game, "0".repeat(64));
  after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
});

test("3D start room sculpts connected collision art into a continuous textured relief", () => {
  const game = startRoom();
  game.wram[0xe00] = 0x0f;
  const world = World.build(game, preset, 8);
  assert.equal(world.stats.sculpted, 4);
  assert.ok(world.stats.reliefQuads > 0);
  assert.ok(world.stats.reliefQuads < 256);
  assert.equal(world.background.length, world.stats.reliefQuads * 36);
  assert.ok(world.background.some((value, index) => index % 6 === 2 && value > 0));
  assert.ok(world.background.some((value, index) => index % 6 === 2 && value <= -8 * 8 / 14));
  assert.deepEqual(world.clearColor, [0.16, 0.23, 0.18, 1]);
});

test("3D start room pins its tile map and signed tile addressing across LCDC changes", () => {
  const game = startRoom();
  game.wram[0xe00] = 0b1000;
  game.vram[0x1800] = 10;
  game.vram[8192 + 0x1800] = 0x69;
  game.vram[0x1c00] = 0x4c;
  game.vram[8192 + 0x1c00] = 0;
  game.bgPalette.fill(0);
  game.bgPalette.set([0x1f, 0], 10);
  game.vram[8192 + 0x1000 + 10 * 16 + 14] = 1;
  const firstDescriptor = preset.world(game);
  assert.equal(firstDescriptor.tiles[0], 0x690a);
  const firstWorld = World.build(game, preset, 8);
  const firstPixel = [...firstWorld.textures.background.pixels.slice(0, 4)];
  assert.deepEqual(firstPixel, [255, 0, 0, 255]);
  const reliefHeights = [];
  for (let i = 2; i < firstWorld.background.length; i += 6) reliefHeights.push(firstWorld.background[i]);
  assert.ok(reliefHeights.some(z => Math.abs(z) < 1e-6));
  assert.ok(reliefHeights.some(z => Math.abs(z - 4 / 7) < 1e-6));
  assert.ok(reliefHeights.some(z => Math.abs(z - 8 / 7) < 1e-6));

  game.io[0x40] |= 0x18;
  const secondDescriptor = preset.world(game);
  assert.equal(secondDescriptor.tiles[0], 0x690a);
  const secondWorld = World.build(game, preset, 8);
  assert.strictEqual(secondWorld.textures.background, firstWorld.textures.background);
  assert.strictEqual(secondWorld.models, firstWorld.models);
});

test("3D start room extrudes the original sprite art as a raised silhouette", () => {
  const game = startRoom();
  game.oam.set([48, 48, 1, 0]);
  for (let row = 0; row < 8; row++) game.vram[16 + row * 2] = 0xff;
  const world = World.build(game, preset, 8);
  assert.equal(world.stats.characters, 1);
  assert.ok(world.sprites.length > 0);
});

test("3D start room raises small green pixel clusters as textured plant mounds", () => {
  const game = startRoom();
  game.bgPalette.fill(0);
  game.bgPalette.set([0xff, 0x03, 0xe0, 0x03], 0);
  for (let row = 2; row <= 4; row++) game.vram[0x1000 + row * 2] = 0x38;
  const world = World.build(game, preset, 8);
  assert.equal(world.stats.sculpted, undefined);
  assert.ok(world.stats.plants > 0);
  assert.ok(world.background.some((value, index) => index % 6 === 2 && value > 0));
});

test("Oracle 2.5D and 3D fall back outside the region but remain stable with visible windows", () => {
  const game = startRoom();
  game.wram[0xd00] = 8;
  assert.equal(preset.terrain(game).active, false);
  assert.match(preset.world(game).reason, /Transition/);
  game.wram[0xd00] = 1;
  game.wram[0xc30] = 0x3a;
  assert.equal(preset.terrain(game).active, false);
  game.wram[0xc30] = 0x8a;
  for (const [wy, wx] of [[199, 199], [0, 7], [100, 166], [199, 199]]) {
    game.io[0x4a] = wy;
    game.io[0x4b] = wx;
    assert.equal(preset.terrain(game).active, true);
    assert.equal(preset.world(game).active, true);
    assert.equal(Scene.buildScene(game, preset, 8).terrain.active, true);
  }
});

test("room 7A stays in relief across HUD raster scroll and LCDC changes without state writes", () => {
  const game = startRoom();
  game.wram[0xc30] = game.wram[0xc2f] = 0x7a;
  game.wram[0xe00] = 0b1000;
  game.vram[0x1800] = 10;
  game.vram[0x1c00] = 20;
  const referenceScene = Scene.buildScene(game, preset, 8);
  const referenceWorld = World.build(game, preset, 8);
  for (const [sy, lcdc] of [[112, 0xa7], [240, 0xef], [112, 0xa7], [240, 0xef]]) {
    game.io[0x42] = sy;
    game.io[0x40] = lcdc;
    const before = States.capture(game, "0".repeat(64));
    const scene = Scene.buildScene(game, preset, 8);
    const world = World.build(game, preset, 8);
    assert.equal(scene.terrain.active, true);
    assert.deepEqual(scene.background, referenceScene.background);
    assert.equal(world.active, true);
    assert.strictEqual(world.textures.background, referenceWorld.textures.background);
    assert.strictEqual(world.models, referenceWorld.models);
    const after = States.capture(game, "0".repeat(64));
    after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
  }
  game.wram[0xd00] = 8;
  assert.equal(preset.terrain(game).active, false);
  assert.equal(preset.world(game).active, false);
});

test("exactly forty-one nearby exterior screens support both render modes without state writes", () => {
  const game = startRoom();
  let supported = 0;
  for (let room = 0; room < 256; room++) {
    game.wram[0xc30] = room;
    game.wram[0xc2f] = room;
    const inRegion = Math.abs((room >> 4) - 8) + Math.abs((room & 15) - 10) <= 4;
    assert.equal(preset.terrain(game).active, inRegion, room.toString(16));
    assert.equal(preset.world(game).active, inRegion, room.toString(16));
    if (!inRegion) {
      assert.equal(World.build(game, preset, 8).active, false);
      continue;
    }
    supported++;
    const before = States.capture(game, "0".repeat(64));
    const world = World.build(game, preset, 8);
    assert.equal(world.active, true);
    assert.match(world.detail, new RegExp(`extérieur ${room.toString(16).toUpperCase()}`));
    const after = States.capture(game, "0".repeat(64));
    after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
  }
  assert.equal(supported, 41);
});

test("new region boundary screens keep collision relief and transition guards in both modes", () => {
  for (const room of [0x4a, 0x68, 0x6c, 0x86, 0x8e, 0xa8, 0xac, 0xca]) {
    const game = startRoom();
    game.wram[0xc30] = game.wram[0xc2f] = room;
    game.wram[0xe00] = 0b1000;
    assert.equal(preset.terrain(game).depths[0], 8);
    assert.equal(preset.world(game).surfaces[0].sculpted, true);
    game.wram[0xd00] = 8;
    assert.equal(preset.terrain(game).active, false);
    assert.equal(preset.world(game).active, false);
    game.wram[0xd00] = 1;
    assert.equal(preset.terrain(game).active, true);
    assert.equal(preset.world(game).active, true);
    game.wram[0xc2d] = 1;
    assert.equal(preset.terrain(game).active, false);
    assert.equal(preset.world(game).active, false);
  }
});

test("nearby interiors, past era, large rooms, fades and incomplete scrolling stay in 2D", () => {
  for (const [offset, value] of [[0xc2d, 1], [0xc2d, 2], [0xc31, 2], [0xc2e, 1],
    [0xd0a, 32], [0xd0b, 32], [0xd00, 8], [0xd00, 3], [0xc2f, 0x7a], [0x4ab, 1]]) {
    const game = startRoom();
    game.wram[offset] = value;
    assert.equal(preset.terrain(game).active, false, offset.toString(16));
    assert.equal(preset.world(game).active, false);
    assert.equal(World.build(game, preset, 8).active, false);
  }
});

function foliageRoom() {
  const game = startRoom();
  game.bgPalette.fill(0);
  game.bgPalette.set([0xff, 0x03, 0xe0, 0x03], 0);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const address = 0x1800 + (y >> 3) * 32 + (x >> 3);
    game.vram[address] = 1 + (y >> 3) * 2 + (x >> 3);
    if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 49) {
      game.vram[0x1000 + game.vram[address] * 16 + (y & 7) * 2] |= 1 << (7 - (x & 7));
    }
  }
  game.wram[0xe00] = 0x0f;
  return game;
}

test("tree foliage has a separate rounded crown, a trunk and palette-aware cached geometry", () => {
  const game = foliageRoom();
  const world = World.build(game, preset, 8);
  assert.equal(world.stats.trees, 1);
  assert.equal(world.models.length, (8 + 5 * 8) * 36);
  const heights = new Set();
  for (let i = 2; i < world.models.length; i += 6) heights.add(world.models[i]);
  assert.ok(heights.size >= 6);
  assert.ok(Math.max(...heights) > 12);
  for (let i = 3; i < world.models.length; i += 6) {
    assert.ok(world.models[i] >= 0 && world.models[i] <= 1);
    assert.ok(world.models[i + 1] >= 0 && world.models[i + 1] <= 1);
  }
  const again = World.build(game, preset, 8);
  assert.strictEqual(again.models, world.models);
  game.bgPalette.set([0x1f, 0], 2);
  const recolored = World.build(game, preset, 8);
  assert.equal(recolored.stats.trees, 0);
  assert.notStrictEqual(recolored.models, world.models);
  const flat = World.build(foliageRoom(), preset, 0);
  assert.equal(flat.models.length, 0);
});

test("small collision foliage becomes folded leaves rather than a raised square", () => {
  const game = foliageRoom();
  for (let tile = 1; tile <= 4; tile++) game.vram.fill(0, 0x1000 + tile * 16, 0x1000 + tile * 16 + 16);
  for (let y = 2; y <= 6; y++) game.vram[0x1010 + y * 2] = 0x7c;
  const world = World.build(game, preset, 8);
  assert.equal(world.stats.trees, 0);
  assert.equal(world.stats.plants, 1);
  assert.equal(world.models.length, 6 * 2 * 36);
  const again = World.build(game, preset, 8);
  assert.strictEqual(again.models, world.models);
});

test("dense rectangular green roof patterns are not reconstructed as trees", () => {
  const game = foliageRoom();
  for (let tile = 1; tile <= 4; tile++) for (let row = 0; row < 8; row++) {
    game.vram[0x1000 + tile * 16 + row * 2] = 0xff;
  }
  const world = World.build(game, preset, 8);
  assert.equal(world.stats.trees, 0);
  assert.equal(world.models.length, 0);
});
