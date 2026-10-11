"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoy } = require("../../gbc/emulator.js");
const { makeROM, makeRedBattle } = require("./helpers.cjs");
const States = require("../../gbc/states.js");
const Graphics = require("../../gbc/graphics.js");
const Scene = require("../../gbc/scene.js");
const preset = require("../../gbc/preset/aladdin.js");
const crystal = require("../../gbc/preset/pokemon-crystal.js");
const red = require("../../gbc/preset/pokemon-red.js");
const World = require("../../gbc/world.js");
const camera = { ...preset.camera, thickness: preset.thickness, light: 0.75 };
const pixel = (image, x, y) => [...image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test("preset matching uses cartridge header identity rather than the ROM filename", () => {
  const game = new GameBoy(makeROM({ color: true, type: 0x19 }));
  assert.equal(Scene.selectPreset(game, [preset]), null);
  game.cartridge.title = "ALADDIN";
  assert.equal(Scene.selectPreset(game, [preset]), preset);
  game.cartridge.type = 0;
  assert.equal(Scene.selectPreset(game, [preset]), null);
  game.cartridge.type = 0x19; game.color = false;
  assert.equal(Scene.selectPreset(game, [preset]), null);
});

function crystalMap() {
  const game = new GameBoy(makeROM({ color: true, type: 0x10, sizeCode: 6, ramSize: 3 }));
  game.cartridge.title = "PM_CRYSTAL"; game.cartridge.rom[0x14c] = 1;
  const ram = game.wram, rom = game.cartridge.rom;
  ram.set([0, 0xc8, 0, 0, 37, 6, 3, 0, 0, 0, 4, 4], 0x1194);
  ram.set([1, 0, 0x60, 1, 0, 0x40, 1, 0, 0x50, 0, 0x40, 0, 0, 0, 0x40], 0x11d9);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) ram[0x800 + y * 10 + x] = x % 4 + 1;
  for (let block = 0; block <= 4; block++) {
    rom.fill(block, 0x4000 + block * 16, 0x4000 + block * 16 + 16);
    rom.fill([7, 0, 7, 0x29, 0x90][block], 0x5000 + block * 4, 0x5000 + block * 4 + 4);
  }
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) game.vram[0x1800 + y * 32 + x] = Math.floor(x / 8) + 1;
  game.io[0x40] = 0x83;
  return game;
}

function town() {
  const game = crystalMap();
  game.wram[0x1199] = 1; game.wram[0x119a] = 1;
  game.wram[0x119f] = 10; game.wram[0x119e] = 9;
  game.wram.set([0x47, 0xc8, 0, 1], 0x1194);
  game.wram.set([24, 4, 6, 13], 0x1cb5);
  game.wram.set([0x40, 0x98], 0x1152);
  game.wram.fill(1, 0x800, 0x8f0);
  game.vram.fill(1, 0x1800, 0x1c00);
  game.io[0x42] = 16;
  return game;
}
function setBlock(game, x, y, id) { game.wram[0x800 + (y + 3) * 16 + x + 3] = id; }

function startMenu(game) {
  game.wram[0xf78] = 1;
  game.wram.set([0x40, 0, 10, 13, 19], 0xf81);
  const tile = (x, y, value) => {
    const index = 0x1800 + (((y * 8 + game.io[0x42]) & 255) >> 3) * 32
      + (((x * 8 + game.io[0x43]) & 255) >> 3);
    game.vram[index] = value;
  };
  for (let y = 0; y <= 13; y++) for (let x = 10; x < 20; x++) tile(x, y, 127);
  for (let y = 13; y < 18; y++) for (let x = 0; x < 10; x++) tile(x, y, 127);
  tile(10, 0, 121); tile(19, 0, 123); tile(10, 13, 125); tile(19, 13, 126);
  tile(12, 2, 0x80);
}

test("3D scroll stays continuous across left/right and up/down early anchors and 255/0 wrapping", () => {
  const game = town(), ram = game.wram;
  function origin(anchor, mx, my, bg, sx, sy) {
    ram.set([anchor & 255, anchor >> 8, my, mx], 0x1194);
    ram.set([bg & 255, bg >> 8], 0x1152);
    game.io[0x43] = sx; game.io[0x42] = sy;
    const world = crystal.world(game);
    assert.equal(world.active, true);
    return [world.originX, world.originY];
  }
  assert.deepEqual(origin(0xc855, 0, 0, 0x9800, 0, 0), [64, 64]);
  assert.deepEqual(origin(0xc854, 1, 0, 0x981e, 0, 0), [64, 64]);
  for (let distance = 2; distance <= 16; distance += 2) {
    assert.deepEqual(origin(0xc854, 1, 0, 0x981e, 256 - distance, 0), [64 - distance, 64]);
  }
  assert.deepEqual(origin(0xc854, 0, 0, 0x981c, 240, 0), [48, 64]);
  assert.deepEqual(origin(0xc854, 0, 0, 0x981c, 238, 0), [46, 64]);
  assert.deepEqual(origin(0xc855, 0, 0, 0x9800, 240, 0), [48, 64]);
  assert.deepEqual(origin(0xc855, 0, 0, 0x9800, 254, 0), [62, 64]);
  assert.deepEqual(origin(0xc855, 0, 0, 0x9800, 0, 0), [64, 64]);
  assert.deepEqual(origin(0xc845, 0, 1, 0x9bc0, 0, 0), [64, 64]);
  assert.deepEqual(origin(0xc845, 0, 1, 0x9bc0, 0, 254), [64, 62]);
  assert.deepEqual(origin(0xc845, 0, 1, 0x9bc0, 0, 240), [64, 48]);
  assert.deepEqual(origin(0xc845, 0, 0, 0x9b80, 0, 240), [64, 48]);
  assert.deepEqual(origin(0xc855, 0, 0, 0x9800, 0, 240), [64, 48]);
  assert.deepEqual(origin(0xc855, 0, 0, 0x9800, 0, 0), [64, 64]);
  ram.set([0, 0x9c], 0x1152);
  assert.match(crystal.world(game).reason, /ancrage graphique invalide/);
});

test("Start displays exact captured menu pixels over 3D without treating its glyphs as terrain or sprites", () => {
  const game = town();
  startMenu(game);
  assert.equal(crystal.terrain(game).active, false);
  assert.equal(crystal.world(game).active, true);
  game.setVideoCapture(true); game.tick(70224);
  const before = States.capture(game, "0".repeat(64));
  const world = World.build(game, crystal, 14), overlay = crystal.world(game).overlay;
  assert.equal(world.active, true);
  assert.match(world.detail, /menu Start en surimpression/);
  assert.ok(overlay.some(Boolean));
  for (let i = 0; i < overlay.length; i++) {
    const offset = i * 4;
    if (overlay[i]) {
      assert.deepEqual(world.textures.window.pixels.slice(offset, offset + 4), game.pixels.slice(offset, offset + 4));
      assert.equal(world.textures.sprites.pixels[offset + 3], 0);
    } else assert.equal(world.textures.window.pixels[offset + 3], 0);
  }
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  for (const [offset, value] of [[0xf78, 0], [0xf78, 2], [0xf81, 0], [0xf83, 0], [0xf84, 18]]) {
    const old = game.wram[offset]; game.wram[offset] = value;
    assert.equal(crystal.world(game).active, false);
    game.wram[offset] = old;
  }
  game.vram.fill(99, 0x1800, 0x1c00);
  assert.equal(crystal.world(game).active, false);
});

function dialogue(game) {
  const base = game.io[0x40] & 8 ? 0x1c00 : 0x1800;
  const tile = (x, y, value) => {
    game.vram[base + (((y * 8 + game.io[0x42]) & 255) >> 3) * 32
      + (((x * 8 + game.io[0x43]) & 255) >> 3)] = value;
  };
  for (let y = 12; y < 18; y++) for (let x = 0; x < 20; x++) {
    tile(x, y, y === 12 || y === 17 ? 122 : x === 0 || x === 19 ? 124 : 127);
  }
  tile(0, 12, 121); tile(19, 12, 123); tile(0, 17, 125); tile(19, 17, 126);
  tile(1, 14, 150); tile(2, 14, 160); tile(18, 16, 238);
  return tile;
}

test("dialogue keeps detailed and generic worlds in 3D with exact fixed pixels and unchanged state", () => {
  for (const generic of [false, true]) for (const alternateMap of [false, true]) {
    const game = town();
    if (generic) game.wram[0x1cb6] = 6;
    if (alternateMap) {
      game.io[0x40] |= 8;
      game.vram.fill(1, 0x1c00, 0x2000);
      game.io[0x42] = 240; game.io[0x43] = 248;
    }
    const tile = dialogue(game);
    assert.equal(crystal.terrain(game).active, false);
    const descriptor = crystal.world(game);
    assert.equal(descriptor.active, true);
    assert.equal(descriptor.overlay.reduce((a, b) => a + b, 0), 160 * 48);
    game.setVideoCapture(true); game.tick(70224);
    const before = States.capture(game, "0".repeat(64)), world = World.build(game, crystal, 14);
    assert.match(world.detail, /dialogue en surimpression/);
    for (let i = 0; i < 160 * 144; i++) {
      const offset = i * 4;
      if (i >= 160 * 96) {
        assert.deepEqual(world.textures.window.pixels.slice(offset, offset + 4), game.pixels.slice(offset, offset + 4));
        assert.equal(world.textures.sprites.pixels[offset + 3], 0);
      } else assert.equal(world.textures.window.pixels[offset + 3], 0);
    }
    const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
    tile(0, 12, 1);
    assert.equal(crystal.world(game).active, false);
    dialogue(game); tile(1, 12, 127);
    assert.equal(crystal.world(game).active, false);
    dialogue(game); tile(1, 14, 1);
    assert.equal(crystal.world(game).active, false);
    dialogue(game);
    const base = alternateMap ? 0x1c00 : 0x1800;
    game.vram.fill(99, base, base + 1024); dialogue(game);
    assert.equal(crystal.world(game).active, false);
    game.vram.fill(1, base, base + 1024);
    assert.equal(crystal.world(game).active, true);
    assert.equal(crystal.world(game).overlay, null);
  }
});

test("3D selects detailed town or generic maps, reads live blocks and tracks scrolling independent of CPU bus", () => {
  const game = town(), before = game.wram.slice();
  const world = crystal.world(game);
  assert.equal(world.active, true);
  assert.deepEqual([world.width, world.height, world.originX, world.originY], [10, 9, 144, 32]);
  assert.deepEqual(game.wram, before);
  game.io[0x70] = 7; game.dmaActive = true;
  assert.deepEqual(crystal.world(game), world);
  game.io[0x43] = 255; game.io[0x42] = 255;
  const scrolled = crystal.world(game);
  assert.deepEqual([scrolled.originX, scrolled.originY], [143, 15]);
  for (const [offset, value] of [[0x1cb5, 25], [0x1cb6, 6], [0x1199, 2], [0x119f, 11], [0x119e, 10]]) {
    const previous = game.wram[offset]; game.wram[offset] = value;
    assert.equal(crystal.world(game).active, true);
    assert.equal(crystal.world(game).generic, true);
    game.wram[offset] = previous;
  }
  setBlock(game, 9, 8, 120);
  assert.equal(crystal.world(game).active, true);
  assert.equal(crystal.world(game).generic, true);
  setBlock(game, 9, 8, 1);
  game.io[0x40] |= 16;
  assert.equal(World.build(game, crystal, 14).active, false);
  assert.equal(World.build(game, preset, 14).active, false);
  assert.throws(() => World.build(game, crystal, NaN), /invalide/);
});

test("generic 3D covers all 36 tilesets and seven environment classes without changing machine state", () => {
  const game = crystalMap();
  game.wram.set([0, 0x98], 0x1152);
  const before = States.capture(game, "0".repeat(64));
  for (let environment = 1; environment <= 7; environment++) {
    game.wram[0x119a] = environment;
    for (let tileset = 1; tileset <= 36; tileset++) {
      game.wram[0x1199] = tileset;
      const world = crystal.world(game);
      assert.equal(world.active, true, `environment ${environment}, tileset ${tileset}`);
      assert.equal(world.generic, true);
      assert.equal(world.tiles.length, 24 * 20);
      assert.equal(world.surfaces.length, 120);
      assert.deepEqual([...new Set(world.surfaces.map(cell => cell.depth))], [0, 20, -2, 12]);
    }
    const scene = World.build(game, crystal, 14);
    assert.ok([...scene.background, ...scene.models].every(Number.isFinite));
    assert.equal(scene.background.length, 120 * 36);
    assert.equal(scene.textures.background.width, 192);
    assert.equal(scene.textures.background.height, 160);
    assert.match(scene.detail, /3D générique/);
  }
  game.wram[0x119a] = 3; game.wram[0x1199] = 6;
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  game.wram[0x119a] = 8;
  assert.equal(crystal.world(game).active, false);
  game.wram[0x119a] = 3; game.wram[0x1199] = 37;
  assert.equal(crystal.world(game).active, false);
});

test("generic texture cache responds to animated graphics, palettes, collisions and block changes", () => {
  const game = crystalMap();
  game.wram.set([0, 0x98], 0x1152);
  const a = World.build(game, crystal, 14), b = World.build(game, crystal, 14);
  assert.equal(a.background, b.background);
  assert.equal(a.textures.background, b.textures.background);
  game.vram[0x1010] = 255;
  const animated = World.build(game, crystal, 14);
  assert.notEqual(animated.textures.background, b.textures.background);
  game.bgPalette[2] ^= 31;
  assert.notEqual(World.build(game, crystal, 14).textures.background, animated.textures.background);
  game.cartridge.rom[0x5008] = 0;
  const changed = World.build(game, crystal, 14);
  assert.notEqual(changed.models, animated.models);
  game.wram[0x800] = 4;
  assert.notEqual(World.build(game, crystal, 14).textures.background, changed.textures.background);
  game.io[0x70] = 7; game.dmaActive = true;
  assert.equal(World.build(game, crystal, 14).active, true);
});

test("3D has horizontal ground, volumetric trees, pitched roofs, signs and vertical characters without state writes", () => {
  const game = town();
  setBlock(game, 2, 0, 24); setBlock(game, 3, 0, 31); setBlock(game, 4, 0, 25);
  setBlock(game, 2, 1, 28); setBlock(game, 3, 1, 119); setBlock(game, 4, 1, 30);
  setBlock(game, 6, 1, 20); setBlock(game, 7, 1, 21);
  setBlock(game, 0, 0, 5); setBlock(game, 8, 7, 98); setBlock(game, 1, 7, 101);
  setBlock(game, 1, 1, 71); setBlock(game, 4, 4, 69);
  for (let y = 0; y < 8; y++) game.vram[16 + y * 2] = 255;
  game.oam.set([32, 88, 1, 0, 56, 120, 1, 0]);
  game.setVideoCapture(true); game.tick(70224);
  const before = States.capture(game, "0".repeat(64));
  const world = World.build(game, crystal, 14);
  assert.equal(world.active, true);
  assert.deepEqual(world.stats, { trees: 6, houses: 2, signs: 2, characters: 2 });
  assert.equal(world.background.length, 36);
  assert.deepEqual([world.textures.background.width, world.textures.background.height], [320, 288]);
  for (let i = 2; i < world.background.length; i += 6) assert.equal(world.background[i], 0);
  const levels = new Set();
  for (let i = 2; i < world.models.length; i += 6) levels.add(world.models[i]);
  for (const level of [0, 9, 20, 22, 29, 36]) assert.ok(levels.has(level), `model height ${level}`);
  // Roof quads have a ridge above both eaves, not a raised flat texture.
  let slopes = 0;
  for (let i = 0; i < world.models.length; i += 36) {
    const vertices = world.models.slice(i, i + 36);
    if (vertices[3] > 0.5 && vertices[3] < 0.58 && vertices[2] !== vertices[14]) slopes++;
  }
  assert.equal(slopes, 4);
  for (let i = 0; i < world.sprites.length; i += 36) {
    const vertices = world.sprites.slice(i, i + 36);
    assert.equal(vertices[1], vertices[13]);
    assert.ok(Math.abs(vertices[2] - vertices[14] - 1.4) < 0.000001);
  }
  assert.ok([...world.models, ...world.sprites].every(Number.isFinite));
  const flat = World.build(game, crystal, 0);
  for (let i = 2; i < flat.models.length; i += 6) assert.equal(flat.models[i], 0);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  // Object footprints use clean generated ground, never the original roof/tree pixels.
  const ground = world.textures.background;
  for (let i = 0; i < ground.pixels.length; i += 4) assert.equal(ground.pixels[i + 3], 255);
  const stationary = World.build(game, crystal, 14);
  const shifted = { ...crystal, world: machine => ({ ...crystal.world(machine), originX: 160, originY: 48 }) };
  const moved = World.build(game, shifted, 14);
  assert.equal(moved.models, stationary.models);
  assert.equal(moved.background, stationary.background);
  assert.equal(moved.textures.background, stationary.textures.background);
  assert.deepEqual(moved.origin, [160, 48]);
  assert.deepEqual(world.origin, [144, 32]);
  assert.notEqual(World.build(game, crystal, 12).models, world.models);
  setBlock(game, 0, 0, 1);
  assert.equal(World.build(game, crystal, 14).stats.trees, 4);
});

test("3D character shadows are flattened sprite silhouettes instead of a square footprint", () => {
  const game = town();
  for (let y = 0; y < 8; y++) { game.vram[16 + y * 2] = (0xff << (7 - y)) & 0xff; game.vram[17 + y * 2] = 0; }
  game.oam.set([32, 88, 1, 0, 56, 120, 1, 0]);
  game.setVideoCapture(true); game.tick(70224);
  const world = World.build(game, crystal, 14);
  assert.equal(world.stats.characters, 2);
  assert.equal(world.shadows.length / 36, 16);
  const widths = new Set();
  for (let i = 0; i < world.shadows.length; i += 36) widths.add(world.shadows[i + 6] - world.shadows[i]);
  assert.deepEqual([...widths].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok([...world.shadows].every(Number.isFinite));
});

test("Crystal preset requires the verified UE 1.1 header and decodes distinct collision heights", () => {
  const game = crystalMap();
  assert.equal(Scene.selectPreset(game, [preset, crystal]), crystal);
  game.cartridge.rom[0x14c] = 0;
  assert.equal(Scene.selectPreset(game, [preset, crystal]), null);
  game.cartridge.rom[0x14c] = 1;
  const terrain = crystal.terrain(game);
  assert.equal(terrain.active, true);
  assert.equal(terrain.coverage, 1);
  assert.deepEqual([terrain.depths[0], terrain.depths[8], terrain.depths[16], terrain.depths[24]], [0, 20, -2, 12]);
  game.io[0x70] = 7; game.dmaActive = true;
  assert.deepEqual(crystal.terrain(game), terrain);
  game.dmaActive = false;
  game.io[0x43] = 255; game.io[0x42] = 255;
  assert.equal(crystal.terrain(game).coverage, 1);
});

test("Crystal collisions depend on quadrant graphics, not tile IDs alone, with conservative ambiguity", () => {
  const game = crystalMap(), rom = game.cartridge.rom;
  rom.set([9, 10, 11, 12], 0x4010);
  game.vram.set([9, 10], 0x1800); game.vram.set([11, 12], 0x1820);
  const terrain = crystal.terrain(game);
  assert.equal(terrain.depths[0], 0);
  game.vram[0x1800] = 11;
  assert.equal(crystal.terrain(game).depths[0], 0);
  rom.fill(1, 0x4020, 0x4030);
  assert.equal(crystal.terrain(game).depths[8], 0);
});

test("Crystal distinguishes map graphics banks from signed font tiles and unsigned picture modes", () => {
  const game = crystalMap(), rom = game.cartridge.rom;
  rom.fill(129, 0x4010, 0x4020);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) game.vram[8192 + 0x1800 + y * 32 + x] = 8;
  assert.equal(crystal.terrain(game).coverage, 1);
  game.vram[0x1800] = 129;
  assert.ok(crystal.terrain(game).coverage < 1);
  game.io[0x40] |= 16;
  assert.equal(crystal.terrain(game).active, false);
  assert.match(crystal.terrain(game).reason, /hors carte/);
});

test("Crystal hides blank map borders but retains recognizable walls and validates all memory ranges", () => {
  const game = crystalMap();
  game.vram.fill(0, 0x1800, 0x1802); game.vram.fill(0, 0x1820, 0x1822);
  let terrain = crystal.terrain(game);
  assert.equal(terrain.hidden[0], 1);
  assert.equal(terrain.hidden[8], 0);
  for (const [offset, value] of [[0x1195, 0xc7], [0x1195, 255], [0x119f, 0], [0x11dc, 255],
    [0x11de, 0x80], [0x11e1, 0x80], [0x800, 128]]) {
    const previous = game.wram[offset]; game.wram[offset] = value;
    terrain = crystal.terrain(game);
    assert.equal(terrain.active, false, `guard at ${offset.toString(16)}`);
    assert.ok(terrain.reason);
    game.wram[offset] = previous;
  }
  game.io[0x40] = 0;
  assert.equal(crystal.terrain(game).active, false);
});

test("Crystal relief has multiple measurable levels and independently redresses disconnected characters", () => {
  const game = crystalMap();
  for (let y = 0; y < 8; y++) game.vram[16 + y * 2] = 255;
  game.oam.set([32, 8, 1, 0, 48, 32, 1, 0]);
  game.setVideoCapture(true); game.tick(70224);
  const before = States.capture(game, "0".repeat(64));
  const scene = Scene.buildScene(game, crystal, 12), levels = new Set();
  for (let i = 2; i < scene.background.length; i += 6) levels.add(scene.background[i]);
  for (const height of [0, 30, -3]) assert.ok(levels.has(height));
  const spriteZ = new Set();
  for (let i = 2; i < scene.sprites.length; i += 6) spriteZ.add(scene.sprites[i]);
  assert.ok(spriteZ.size >= 8);
  assert.equal(Math.min(...spriteZ), 1);
  assert.equal(Math.max(...spriteZ), 13);
  assert.equal(scene.sprites.length, 2 * 8 * 6 * 6);
  const max = Scene.buildScene(game, crystal, 16);
  assert.ok([...max.background].every(Number.isFinite));
  const flat = Scene.buildScene(game, crystal, 0);
  for (let i = 2; i < flat.background.length; i += 6) assert.equal(flat.background[i], 0);
  for (let i = 2; i < flat.sprites.length; i += 6) assert.equal(flat.sprites[i], 1);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
});

test("Crystal only enables relief above 85 percent recognized visible map area", () => {
  const game = crystalMap();
  const replace = cell => {
    const x = (cell % 10) * 2, y = Math.floor(cell / 10) * 2;
    for (const offset of [0, 1, 32, 33]) game.vram[0x1800 + y * 32 + x + offset] = 99;
  };
  for (let cell = 0; cell < 13; cell++) replace(cell);
  assert.equal(crystal.terrain(game).active, true);
  assert.equal(crystal.terrain(game).coverage, 77 / 90);
  replace(13);
  assert.equal(crystal.terrain(game).active, false);
  assert.equal(crystal.terrain(game).coverage, 76 / 90);
  assert.match(crystal.terrain(game).reason, /menu|combat/);
});

test("scene rebuilds clipped, wrapped background tile geometry with correct map UVs and depth", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.io[0x43] = 255; game.io[0x42] = 255;
  game.vram[0x1bff] = 7; game.vram[8192 + 0x1bff] = 8;
  const custom = { ...preset, tileDepths: { "1:7": 10 } };
  const scene = Scene.buildScene(game, custom, 0);
  assert.equal(scene.tiles, 21 * 19);
  assert.equal(scene.background.length, scene.tiles * 6 * 6);
  assert.deepEqual([...scene.background.slice(0, 6)], [-80, 72, -2, 255 / 256, 255 / 256, 1]);
  for (let i = 0; i < scene.background.length; i += 6) {
    assert.ok(scene.background[i] >= -80 && scene.background[i] <= 80);
    assert.ok(scene.background[i + 1] >= -72 && scene.background[i + 1] <= 72);
    assert.ok(scene.background[i + 3] >= 0 && scene.background[i + 3] <= 1);
    assert.ok(scene.background[i + 4] >= 0 && scene.background[i + 4] <= 1);
  }
  const extruded = Scene.buildScene(game, custom, 4);
  assert.equal(extruded.background.length, scene.background.length * 5);
  assert.ok([...extruded.background].every(Number.isFinite));
  assert.throws(() => Scene.buildScene(game, { ...preset, tileDepths: { "1:7": NaN } }, 4), /invalide/);
});

test("scene snapshot preserves sprites' transparency, OAM priority and ten-sprite line limit", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.io[0x40] = 0x93;
  game.bgPalette.fill(0); game.objPalette.fill(0);
  game.objPalette.set([0x1f, 0], 2);
  game.objPalette.set([0xe0, 3], 4);
  game.vram[16] = 255; game.vram[33] = 255;
  game.oam.set([16, 8, 1, 0, 16, 8, 2, 0]);
  for (let i = 2; i < 11; i++) game.oam.set([16, 8 + i * 8, 1, 0], i * 4);
  const data = Graphics.scene(game);
  assert.deepEqual(pixel(data.sprites, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(data.sprites, 80, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(data.sprites, 0, 8), [0, 0, 0, 0]);
});

test("window stays separate and sprite/BG priority is respected in scene textures", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.io[0x40] = 0xf3; game.io[0x4a] = 0; game.io[0x4b] = 15;
  game.vram[0] = 255; game.vram[16] = 255; game.vram[0x1c00] = 1;
  game.oam.set([16, 8, 1, 128]);
  const textures = Graphics.scene(game);
  assert.equal(pixel(textures.sprites, 0, 0)[3], 0);
  assert.equal(pixel(textures.window, 0, 0)[3], 0);
  assert.equal(pixel(textures.window, 8, 0)[3], 255);
});

test("scene build and camera changes never mutate the emulator or saved state schema", () => {
  const game = new GameBoy(makeROM({ color: true, type: 0x19 }));
  game.tick(456 * 10 + 100);
  const before = States.capture(game, "0".repeat(64));
  Scene.buildScene(game, preset, 4);
  Scene.validateCamera(camera);
  const after = States.capture(game, "0".repeat(64));
  after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  game.io[0x40] = 0;
  const off = Scene.buildScene(game, preset, 4);
  assert.equal(off.background.length, 0);
  assert.equal(off.sprites.length, 0);
});

test("opt-in raster layers retain scanline palettes and exactly compose the original frame", () => {
  const game = new GameBoy(makeROM({ color: true }));
  const control = new GameBoy(makeROM({ color: true }));
  control.cartridge.lastRTC = game.cartridge.lastRTC;
  for (const machine of [game, control]) {
    machine.io[0x40] = 0xf3;
    machine.io[0x4a] = 10; machine.io[0x4b] = 87;
    for (let row = 0; row < 8; row++) {
      machine.vram[row * 2] = 255;
      machine.vram[16 + row * 2 + 1] = 255;
    }
    machine.vram.fill(1, 0x1c00, 0x2000);
    machine.bgPalette.set([0, 124], 4);
    machine.objPalette.set([224, 3], 2);
    machine.oam.set([16, 8, 0, 0, 26, 100, 0, 0]);
  }
  game.setVideoCapture(true);
  for (let row = 0; row < 144; row++) {
    for (const machine of [game, control]) {
      machine.bgPalette.set(row < 72 ? [31, 0] : [255, 127], 2);
      machine.tick(456);
    }
  }
  const textures = Graphics.scene(game);
  assert.equal(textures.screenSpace, true);
  assert.deepEqual(pixel(textures.background, 16, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(textures.background, 16, 72), [255, 255, 255, 255]);
  assert.deepEqual(pixel(textures.sprites, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(textures.window, 92, 10), [0, 255, 0, 255]);
  for (let offset = 0; offset < game.pixels.length; offset += 4) {
    const layer = textures.window.pixels[offset + 3] ? textures.window
      : textures.sprites.pixels[offset + 3] ? textures.sprites : textures.background;
    assert.deepEqual(layer.pixels.slice(offset, offset + 4), game.pixels.slice(offset, offset + 4));
  }
  const original = States.capture(control, "0".repeat(64)), captured = States.capture(game, "0".repeat(64));
  captured.createdAt = original.createdAt;
  assert.deepEqual(captured, original);
  const scene = Scene.buildScene(game, preset, 0);
  assert.deepEqual([...scene.background.slice(3, 5)], [0, 0]);
  game.tick(456 * 11);
  assert.deepEqual(Graphics.scene(game), textures);
  textures.background.pixels.fill(0);
  assert.equal(pixel(Graphics.scene(game).background, 16, 0)[3], 255);
  game.setVideoCapture(false);
  assert.equal(game.videoLayers(), null);
});

test("capture started mid-frame waits for a complete image and restoration drops stale layers", () => {
  const game = new GameBoy(makeROM({ color: true }));
  game.tick(456 * 100);
  game.setVideoCapture(true);
  game.tick(456 * 44);
  assert.equal(pixel(Graphics.scene(game).background, 0, 0)[3], 255);
  assert.equal(pixel(Graphics.scene(game).sprites, 0, 0)[3], 0);
  game.tick(70224);
  const saved = States.capture(game, "0".repeat(64));
  game.bgPalette.fill(255);
  game.tick(70224);
  States.restore(game, saved, "0".repeat(64));
  assert.deepEqual(Graphics.scene(game).background.pixels, game.pixels);
  game.write(0xff40, 0);
  assert.deepEqual(Graphics.scene(game).background.pixels, game.pixels);
});

function fakeGL({ compile = true, link = true, error = 0 } = {}) {
  const gl = { calls: [], deleted: [], VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    TEXTURE_2D: 5, TEXTURE_MIN_FILTER: 6, TEXTURE_MAG_FILTER: 7, NEAREST: 8, TEXTURE_WRAP_S: 9, TEXTURE_WRAP_T: 10,
    CLAMP_TO_EDGE: 11, LINEAR: 24, RGB: 25, ARRAY_BUFFER: 12, DYNAMIC_DRAW: 13, STATIC_DRAW: 23, FLOAT: 14, TRIANGLES: 15, RGBA: 16, UNSIGNED_BYTE: 17,
    COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2, DEPTH_TEST: 18, LEQUAL: 19, BLEND: 20, CULL_FACE: 21, TEXTURE0: 22, NO_ERROR: 0,
    getShaderParameter: () => compile, getProgramParameter: () => link,
    getShaderInfoLog: () => "shader failed", getProgramInfoLog: () => "link failed",
    getUniformLocation: (_, name) => name,
    getAttribLocation: (_, name) => ["aPosition", "aUV", "aShade"].indexOf(name),
    isContextLost: () => false, getError: () => error };
  for (const kind of ["Shader", "Program", "Buffer", "Texture"]) {
    gl[`create${kind}`] = () => ({ kind });
    gl[`delete${kind}`] = resource => gl.deleted.push(resource);
  }
  for (const method of ["shaderSource", "compileShader", "attachShader", "linkProgram", "bindTexture", "texParameteri",
    "viewport", "clearColor", "clear", "enable", "depthFunc", "disable", "useProgram", "activeTexture", "uniform1i",
    "uniform4f", "uniform2f", "uniform1f", "texImage2D", "copyTexSubImage2D", "bindBuffer", "bufferData", "enableVertexAttribArray", "disableVertexAttribArray", "vertexAttribPointer", "drawArrays"]) {
    gl[method] = (...args) => gl.calls.push({ method, args });
  }
  return gl;
}

test("WebGL draws perspective tiles and sprite layer, then a camera-neutral HUD and cleans resources", () => {
  const gl = fakeGL(), renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const result = renderer.render(new GameBoy(makeROM({ color: true })), preset, camera);
  assert.equal(result.tiles, 20 * 18);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 3);
  const hud = gl.calls.findIndex(call => call.method === "uniform1f" && call.args[0] === "uHUD" && call.args[1] === 1);
  assert.ok(hud > gl.calls.findIndex(call => call.method === "disable" && call.args[0] === gl.DEPTH_TEST));
  renderer.dispose();
  assert.equal(gl.deleted.length, 13);
  renderer.dispose();
  assert.equal(gl.deleted.length, 13);
});

test("unrecognized Crystal menus draw original pixels without perspective, shading or sprite separation", () => {
  const game = crystalMap(), gl = fakeGL();
  game.vram.fill(99, 0x1800, 0x1c00);
  const renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const result = renderer.render(game, crystal, { ...crystal.camera, thickness: 12, light: 1 });
  assert.match(result.detail, /vue originale/);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 1);
  assert.equal(gl.calls.find(call => call.method === "texImage2D").args[8], game.pixels);
  assert.ok(gl.calls.some(call => call.method === "uniform1f" && call.args[0] === "uHUD" && call.args[1] === 1));
  assert.ok(gl.calls.some(call => call.method === "uniform1f" && call.args[0] === "uLight" && call.args[1] === 0));
  renderer.dispose();
});

test("3D reuses native WebGL, renders models before upright sprites and keeps the HUD camera-neutral", () => {
  const game = town(), gl = fakeGL();
  setBlock(game, 0, 0, 5);
  for (let row = 0; row < 8; row++) game.vram[16 + row * 2] = 255;
  game.oam.set([32, 88, 1, 0]); game.setVideoCapture(true); game.tick(70224);
  const renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const camera = { ...crystal.camera, thickness: 14, light: 0.73 };
  const result = renderer.render(game, crystal, camera, "3d");
  assert.match(result.detail, /Bourg Geon.*2 arbres.*1 silhouettes/);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 5);
  assert.deepEqual(gl.calls.find(call => call.method === "uniform2f").args, ["uOrigin", 144, 32]);
  assert.deepEqual(gl.calls.find(call => call.method === "uniform4f").args,
    ["uCamera", 0, -60 * Math.PI / 180, 0.83 * 0.6, 1]);
  assert.deepEqual(gl.calls.filter(call => call.method === "texImage2D").map(call => [call.args[3], call.args[4]]),
    [[320, 288], [192, 16], [192, 16], [160, 144], [160, 144]]);
  gl.calls.length = 0;
  renderer.render(game, crystal, camera, "3d");
  assert.ok(!gl.calls.some(call => call.method === "texImage2D" && call.args[3] === 320));
  assert.equal(gl.calls.filter(call => call.method === "bufferData").length, 2);
  assert.equal(gl.calls.filter(call => call.method === "texImage2D").length, 2);
  assert.ok(gl.calls.filter(call => call.method === "bufferData").every(call => call.args[2] === gl.DYNAMIC_DRAW));
  assert.ok(!gl.calls.some(call => call.method === "texImage2D" && call.args[3] === 192));
  startMenu(game); game.tick(70224); gl.calls.length = 0;
  assert.match(renderer.render(game, crystal, camera, "3d").detail, /menu Start en surimpression/);
  assert.ok(gl.calls.filter(call => call.method === "drawArrays").length >= 4);
  game.wram[0xf78] = 0; game.vram.fill(1, 0x1800, 0x1c00);
  game.wram[0x1cb6] = 6; gl.calls.length = 0;
  assert.match(renderer.render(game, crystal, camera, "3d").detail, /3D générique/);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 5);
  game.vram.fill(99, 0x1800, 0x1c00); gl.calls.length = 0;
  assert.match(renderer.render(game, crystal, camera, "3d").detail, /vue originale/);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 1);
  assert.equal(gl.calls.find(call => call.method === "texImage2D").args[8], game.pixels);
  renderer.dispose(); assert.equal(gl.deleted.length, 13);
});

test("GPU upload slots reuse immutable data and replace changed geometry and textures independently", () => {
  const gl = fakeGL(), renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const vertices = new Float32Array(36), image = { width: 1, height: 1, pixels: new Uint8Array(4) };
  renderer.draw(vertices, 0, image);
  renderer.draw(vertices, 2, image);
  gl.calls.length = 0;
  renderer.draw(vertices, 0, image);
  renderer.draw(vertices, 2, image);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 2);
  assert.ok(!gl.calls.some(call => ["bufferData", "texImage2D"].includes(call.method)));
  renderer.draw(new Float32Array(vertices), 0, image);
  assert.equal(gl.calls.filter(call => call.method === "bufferData").length, 1);
  assert.equal(gl.calls.filter(call => call.method === "texImage2D").length, 0);
  renderer.draw(vertices, 2, { ...image, pixels: new Uint8Array(4) });
  assert.equal(gl.calls.filter(call => call.method === "bufferData").length, 1);
  assert.equal(gl.calls.filter(call => call.method === "texImage2D").length, 1);
  renderer.dispose();
  assert.equal(gl.deleted.filter(resource => resource.kind === "Buffer").length, 5);
  assert.equal(renderer.uploadedVertices.size, 0);
  assert.equal(renderer.uploadedTextures.size, 0);
});
test("Red battle 3D uses existing GPU passes, filters before HUD and keeps 2.5D/fullscreen fallback intact", () => {
  const game = makeRedBattle(), before = States.capture(game, "0".repeat(64)), gl = fakeGL();
  const renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const camera = { ...red.camera, thickness: 14, light: 0.73 };
  assert.match(renderer.render(game, red, camera, "3d", true, "sharp").detail, /arène 3D.*2 silhouettes/);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 6);
  assert.deepEqual(gl.calls.find(call => call.method === "uniform4f").args,
    ["uCamera", 0, -50 * Math.PI / 180, 0.9, 1]);
  const copy = gl.calls.findIndex(call => call.method === "copyTexSubImage2D");
  const hud = gl.calls.findIndex(call => call.method === "uniform1f" && call.args[0] === "uHUD" && call.args[1] === 1);
  assert.ok(copy > 0 && hud > copy);
  gl.calls.length = 0;
  renderer.render(game, red, { ...camera, yaw: 20 }, "3d", true, "soft");
  assert.ok(!gl.calls.some(call => call.method === "bufferData"));
  assert.equal(gl.calls.filter(call => call.method === "texImage2D").length, 2);
  gl.calls.length = 0;
  assert.equal(renderer.render(game, red, camera, "2.5d", true).smoothed, false);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 1);
  assert.equal(gl.calls.find(call => call.method === "texImage2D").args[8], game.pixels);
  const moves = makeRedBattle({ moveInfo: true });
  assert.match(renderer.render(moves, red, camera, "3d", true).detail, /arène 3D/);
  game.vram.fill(0x7f, 0x1c00, 0x1d80); gl.calls.length = 0;
  const fallback = renderer.render(game, red, camera, "3d", true);
  assert.equal(fallback.smoothed, false); assert.match(fallback.detail, /sous-menu ou transition/);
  assert.equal(gl.calls.filter(call => call.method === "drawArrays").length, 1);
  game.vram.set(before.memory.vram);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  renderer.dispose(); assert.equal(gl.deleted.length, 18);
});
test("optional contour smoothing runs before HUD, reuses resources and resizes its screen texture", () => {
  const gl = fakeGL(), canvas = { width: 640, height: 576, getContext: () => gl };
  const renderer = new Scene.Renderer(canvas), game = new GameBoy(makeROM({ color: true }));
  renderer.render(game, preset, camera);
  assert.equal(renderer.smoothing, undefined);
  assert.ok(!gl.calls.some(c => c.method === "copyTexSubImage2D"));
  gl.calls.length = 0;
  assert.equal(renderer.render(game, preset, camera, "2.5d", true).smoothed, true);
  const effect = renderer.smoothing;
  const copy = gl.calls.findIndex(c => c.method === "copyTexSubImage2D");
  const post = gl.calls.findIndex(c => c.method === "useProgram" && c.args[0] === effect.program);
  const hud = gl.calls.findIndex(c => c.method === "uniform1f" && c.args[0] === "uHUD" && c.args[1] === 1);
  assert.ok(copy >= 0 && post > copy && hud > post);
  assert.equal(gl.calls.filter(c => c.method === "drawArrays").length, 4);
  assert.deepEqual(gl.calls.find(c => c.method === "uniform2f" && c.args[0] === "uPixel").args,
    ["uPixel", 1 / 640, 1 / 576]);
  assert.ok(gl.calls.some(c => c.method === "texParameteri" && c.args[2] === gl.LINEAR));
  assert.equal(gl.calls.find(c => c.method === "texImage2D" && c.args[8] === null).args[2], gl.RGB);
  gl.calls.length = 0;
  renderer.render(game, preset, camera, "2.5d", true);
  assert.equal(renderer.smoothing, effect);
  assert.ok(!gl.calls.some(c => c.method === "bufferData" && c.args[1] === renderer.hud || c.method === "shaderSource"
    || c.method === "texImage2D" && c.args[8] === null));
  canvas.width = 320; canvas.height = 288;
  gl.calls.length = 0;
  renderer.render(game, preset, camera, "2.5d", true);
  assert.deepEqual(gl.calls.find(c => c.method === "texImage2D" && c.args[8] === null).args.slice(3, 5), [320, 288]);
  gl.calls.length = 0;
  renderer.render(game, preset, camera, "2.5d", false);
  assert.ok(!gl.calls.some(c => c.method === "copyTexSubImage2D"));
  assert.throws(() => renderer.render(game, preset, camera, "2.5d", "yes"), /lissage invalide/);
  renderer.dispose();
  assert.equal(gl.deleted.length, 18);
  renderer.dispose();
  assert.equal(gl.deleted.length, 18);
});
test("smoothing bypasses unrecognized fullscreen menus and also supports the 3D world pass", () => {
  const gl = fakeGL(), renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const game = town(), view = { ...crystal.camera, thickness: 14, light: 0.73 };
  assert.equal(renderer.render(game, crystal, view, "3d", true).smoothed, true);
  game.vram.fill(99, 0x1800, 0x1c00); gl.calls.length = 0;
  assert.equal(renderer.render(game, crystal, view, "3d", true).smoothed, false);
  assert.equal(gl.calls.filter(c => c.method === "drawArrays").length, 1);
  assert.ok(!gl.calls.some(c => c.method === "copyTexSubImage2D"));
  renderer.dispose();
});
test("2D filtering uses the complete original image without presets, camera, capture or emulation changes", () => {
  const gl = fakeGL(), renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const game = new GameBoy(makeROM()), before = States.capture(game, "0".repeat(64));
  assert.equal(renderer.render2D(game).smoothed, true);
  assert.equal(gl.calls.filter(c => c.method === "drawArrays").length, 2);
  assert.equal(gl.calls.find(c => c.method === "texImage2D").args[8], game.pixels);
  assert.ok(gl.calls.some(c => c.method === "copyTexSubImage2D"));
  assert.ok(!gl.calls.some(c => c.method === "uniform4f"));
  assert.equal(game.videoLayers(), null);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  renderer.dispose();
  assert.equal(gl.deleted.length, 18);
});
test("shader choices reuse a single GPU program and supply source-pixel steps only in 2D", () => {
  const gl = fakeGL(), renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  const game = new GameBoy(makeROM());
  for (const [i, filter] of ["light", "soft", "sharp", "crt"].entries()) {
    gl.calls.length = 0;
    renderer.render2D(game, filter);
    assert.deepEqual(gl.calls.find(c => c.method === "uniform1f" && c.args[0] === "uFilter").args, ["uFilter", i]);
    assert.deepEqual(gl.calls.find(c => c.method === "uniform2f" && c.args[0] === "uStep").args, ["uStep", 1 / 160, 1 / 144]);
    assert.equal(renderer.resources.length, 18);
    if (i) assert.ok(!gl.calls.some(c => c.method === "shaderSource"));
  }
  gl.calls.length = 0;
  renderer.render(game, preset, camera, "2.5d", true, "soft");
  assert.deepEqual(gl.calls.find(c => c.method === "uniform2f" && c.args[0] === "uStep").args, ["uStep", 2 / 640, 2 / 576]);
  assert.throws(() => renderer.render2D(game, "invalid"), /shader invalide/);
  assert.throws(() => renderer.render(game, preset, camera, "2.5d", true, "invalid"), /shader invalide/);
  renderer.dispose();
  assert.equal(gl.deleted.length, 18);
});
test("optional shader compilation and resource failures are surfaced and allocated resources can be released", () => {
  for (const failure of ["compile", "link", "texture", "buffer"]) {
    const gl = fakeGL(), renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
    if (failure === "compile") gl.getShaderParameter = () => false;
    if (failure === "link") gl.getProgramParameter = () => false;
    if (failure === "texture") gl.createTexture = () => null;
    if (failure === "buffer") gl.createBuffer = () => null;
    assert.throws(() => renderer.render(new GameBoy(makeROM()), preset, camera, "2.5d", true),
      /failed|ressources de lissage/);
    const allocated = renderer.resources.length;
    renderer.dispose();
    assert.equal(gl.deleted.length, allocated);
    assert.equal(renderer.resources.length, 0);
  }
});

test("unsupported WebGL, bad shaders, context loss and invalid camera surface errors", () => {
  assert.throws(() => new Scene.Renderer({ getContext: () => null }), /indisponible/);
  for (const options of [{ compile: false }, { link: false }]) {
    const gl = fakeGL(options);
    assert.throws(() => new Scene.Renderer({ getContext: () => gl }), /failed/);
    assert.ok(gl.deleted.length > 0);
  }
  const gl = fakeGL(), renderer = new Scene.Renderer({ width: 640, height: 576, getContext: () => gl });
  gl.isContextLost = () => true;
  assert.throws(() => renderer.render(new GameBoy(makeROM()), preset, camera), /perdu/);
  for (const patch of [{ yaw: 46 }, { pitch: -36 }, { zoom: NaN }, { thickness: 17 }, { light: -1 }]) {
    assert.throws(() => Scene.validateCamera({ ...camera, ...patch }), /invalide/);
  }
});
