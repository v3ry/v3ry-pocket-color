"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoy } = require("../emulator.js");
const { makeROM, makeRedBattle } = require("./helpers.cjs");
const States = require("../states.js");
const Scene = require("../scene.js");
const World = require("../world.js");
const red = require("../preset/pokemon-red.js");

function map(id = 38, tileset = 4, width = 4, height = 4) {
  const game = new GameBoy(makeROM({ type: 0x1b, sizeCode: 5, ramSize: 3 }));
  game.cartridge.title = "POKEMON RED";
  const ram = game.wram, rom = game.cartridge.rom;
  rom[0x14c] = 0; rom[0x14e] = 0x7a; rom[0x14f] = 0xfc;
  ram[0x1363] = id; ram[0x136c] = tileset; ram[0x136d] = height; ram[0x136e] = width;
  const anchor = 0xc6e8 + 3 * (width + 6) + 3;
  ram.set([anchor & 255, anchor >> 8], 0x1364);
  ram.set([0, 0x98], 0x152b);
  ram.set([1, 0, 0x40, 0, 0x48, 0, 2], 0x1530);
  ram.fill(1, 0x6e8, 0x6e8 + (width + 6) * (height + 6));
  rom.fill(1, 0x4010, 0x4020); rom.fill(16, 0x4020, 0x4030);
  rom.fill(2, 0x4030, 0x4040); rom.set([1, 255], 0x200);
  game.vram.fill(1, 0x1800, 0x1c00); game.io[0x40] = 0x83;
  game.vram[0x1010] = 255;
  return game;
}
function dialogue(game) {
  for (let y = 12; y < 18; y++) for (let x = 0; x < 20; x++) {
    game.vram[0x1800 + y * 32 + x] = y === 12 || y === 17 ? 122 : x === 0 || x === 19 ? 124 : 127;
  }
  for (const [x, y, tile] of [[0, 12, 121], [19, 12, 123], [0, 17, 125], [19, 17, 126], [1, 14, 150]]) {
    game.vram[0x1800 + y * 32 + x] = tile;
  }
}
test("Red FR matching excludes other languages and revisions with identical titles", () => {
  const game = map();
  assert.equal(Scene.selectPreset(game, [red]), red);
  game.cartridge.rom[0x14f] ^= 1;
  assert.equal(Scene.selectPreset(game, [red]), null);
  game.cartridge.rom[0x14f] ^= 1; game.cartridge.rom[0x14c] = 1;
  assert.equal(Scene.selectPreset(game, [red]), null);
});
test("all five Pallet locations have full-map textured floors and detailed semantic models without state writes", () => {
  for (const [id, tileset, width, height] of [[0, 0, 10, 9], [37, 1, 4, 4], [38, 4, 4, 4], [39, 8, 4, 4], [40, 5, 5, 6]]) {
    const game = map(id, tileset, width, height), before = States.capture(game, "0".repeat(64));
    const descriptor = red.world(game), world = World.build(game, red, 14);
    assert.equal(world.active, true);
    assert.equal(descriptor.generic, undefined);
    assert.equal(world.textures.background.width, width * 32);
    assert.equal(world.textures.background.height, height * 32);
    assert.ok(world.models.length > 0);
    assert.deepEqual(world.origin, [0, 0]);
    if (id === 0) { assert.equal(world.stats.houses, 3); assert.equal(world.stats.signs, 4); }
    else {
      assert.ok(world.stats.furniture >= 7);
      assert.ok(descriptor.objects.some(o => o.kind === "wall"));
      if (id === 38) for (const kind of ["bed", "pc", "console", "stairs", "plant"]) {
        assert.ok(descriptor.objects.some(o => o.kind === kind));
      }
      if (id === 39) {
        assert.equal(descriptor.objects.find(o => o.kind === "table").y, 48);
        assert.equal(descriptor.objects.filter(o => o.kind === "chair").length, 4);
        assert.ok(descriptor.spriteSurfaces.some(surface => surface.height === 8));
      }
    }
    const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
    const cached = World.build(game, red, 14);
    assert.equal(cached.models, world.models);
    assert.equal(cached.textures.background, world.textures.background);
    game.io[0x47] ^= 3;
    assert.notEqual(World.build(game, red, 14).textures.background, world.textures.background);
  }
});
test("Red recognizes all 24 tilesets and builds enriched regional scenes without state writes", () => {
  for (let tileset = 0; tileset < 24; tileset++) {
    const game = map(13, tileset);
    game.wram[0x6e8] = 3;
    game.vram.fill(2, 0x1800 + 8 * 32, 0x1800 + 10 * 32);
    const terrain = red.terrain(game);
    assert.equal(terrain.active, true);
    assert.ok(terrain.depths.some(depth => depth > 0));
    assert.ok(terrain.depths.some(depth => depth === 0));
    const before = States.capture(game, "0".repeat(64)), descriptor = red.world(game);
    assert.equal(descriptor.active, true);
    assert.equal(descriptor.procedural, true);
    assert.equal(descriptor.generic, undefined);
    const world = World.build(game, red, 14);
    assert.equal(world.active, true);
    assert.equal(world.textures.background.width, 128);
    assert.equal(world.textures.background.height, 128);
    assert.ok(world.background.length >= 36);
    assert.ok(world.background.every(Number.isFinite));
    assert.match(world.detail, /procéduraux/);
    const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
    assert.equal(Scene.buildScene(game, red, 14).terrain.active, true);
  }
});
test("Route 1 models a full-length map with semantic vegetation, trees, sign and directional ledges", () => {
  const game = map(12, 0, 10, 18), ram = game.wram, rom = game.cartridge.rom, stride = 16;
  const block = (id, x, y, tiles) => {
    ram[0x6e8 + (y + 3) * stride + x + 3] = id;
    rom.set(tiles, 0x4000 + id * 16);
  };
  block(4, 1, 1, [42, 43, 1, 1, 58, 59, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  block(5, 2, 1, [82, 82, 1, 1, 82, 82, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  block(6, 3, 1, [3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  block(7, 4, 1, [1, 1, 1, 1, 0x36, 0x37, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  block(8, 5, 1, [1, 1, 1, 1, 0x27, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  block(9, 6, 1, [1, 1, 1, 1, 0x0d, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const before = States.capture(game, "0".repeat(64));
  const descriptor = red.world(game), world = World.build(game, red, 14);
  assert.equal(descriptor.name, "Route 1");
  assert.equal(descriptor.generic, undefined);
  assert.equal(world.textures.background.width, 320);
  assert.equal(world.textures.background.height, 576);
  assert.equal(world.stats.trees, 1);
  assert.equal(world.stats.grass, 4);
  assert.equal(world.stats.flower, 1);
  assert.equal(world.stats.ledges, 3);
  assert.equal(world.stats.signs, 1);
  assert.equal(world.stats.houses, 0);
  assert.deepEqual(descriptor.objects.filter(o => o.type === "ledge").map(o => o.direction), ["down", "left", "right"]);
  assert.deepEqual(descriptor.objects.find(o => o.type === "sign"), { type: "sign", x: 144, y: 432 });
  assert.ok(world.models.every(Number.isFinite));
  assert.ok(world.models.some((value, i) => i % 6 === 2 && value > 20));
  assert.equal(World.build(game, red, 14).models, world.models);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  ram[0x6e8 + 4 * stride + 4] = 1;
  assert.equal(World.build(game, red, 14).stats.trees, 0);
  game.wram[0x136d] = 17;
  assert.equal(red.world(game).active, false);
});
test("Route 1 keeps dialogue pixels exact and other routes use enriched procedural scenes", () => {
  const game = map(12, 0, 10, 18);
  dialogue(game);
  game.setVideoCapture(true); game.tick(70224);
  const world = World.build(game, red, 14);
  assert.equal(world.active, true);
  for (let i = 160 * 96; i < 160 * 144; i++) {
    assert.deepEqual(world.textures.window.pixels.slice(i * 4, i * 4 + 4), game.pixels.slice(i * 4, i * 4 + 4));
  }
  game.wram[0x1363] = 13;
  assert.equal(World.build(game, red, 14).active, true);
  assert.equal(red.world(game).procedural, true);
  assert.equal(Scene.buildScene(game, red, 14).terrain.active, true);
});
test("regional scenes recognize environment-specific props rather than turning every obstacle into a box", () => {
  for (const [tileset, codes, type, kind] of [
    [0, [42, 43, 58, 59], "tree"], [3, [4, 5, 35, 21], "tree"],
    [0, [14, 14, 85, 85], "fence"],
    [0, [45, 46, 61, 62], "shrub"],
    [5, [2, 56, 18, 19], "statue"], [7, [2, 56, 18, 19], "statue"],
    [10, [7, 8, 34, 35], "furniture", "shelf"],
    [11, [6, 6, 9, 9], "furniture", "stairs"],
    [23, [42, 43, 34, 29], "tree"], [17, [2, 3, 18, 19], "rock"],
    [17, [12, 13, 28, 29], "rock"],
    [17, [14, 15, 30, 31], "furniture", "ladder"],
    [15, [5, 6, 21, 22], "grave"], [14, [2, 3, 18, 19], "barrel"],
    [19, [36, 37, 64, 65], "pillar"], [6, [4, 5, 20, 21], "furniture", "counter"],
    [2, [32, 33, 48, 49], "furniture", "plant"],
    [6, [34, 35, 50, 51], "furniture", "plant"],
    [6, [14, 15, 30, 31], "furniture", "pc"],
    [2, [36, 37, 52, 53], "furniture", "stairs"],
    [2, [64, 65, 80, 81], "furniture", "merchandise"],
    [2, [65, 67, 81, 83], "furniture", "merchandise"],
    [2, [68, 69, 84, 85], "furniture", "merchandise"],
    [2, [69, 71, 85, 87], "furniture", "merchandise"],
    [6, [90, 91, 44, 45], "furniture", "display"],
    [6, [90, 91, 20, 40], "furniture", "display"],
    [6, [90, 91, 40, 40], "furniture", "display"],
    [6, [90, 91, 25, 24], "furniture", "display"],
    [2, [46, 47, 62, 63], "furniture", "display"],
    [2, [40, 40, 78, 79], "furniture", "display"],
    [2, [76, 77, 23, 29], "furniture", "display"],
    [6, [40, 40, 40, 40], "furniture", "panel"],
    [6, [16, 41, 16, 41], "furniture", "panel"],
    [6, [40, 2, 40, 18], "furniture", "panel"],
    [6, [3, 40, 19, 40], "furniture", "panel"],
    [2, [40, 89, 16, 41], "furniture", "panel"],
    [2, [16, 41, 25, 24], "furniture", "counter"],
    [6, [56, 8, 24, 25], "furniture", "counter"],
    [2, [56, 8, 25, 24], "furniture", "counter"],
    [6, [8, 8, 24, 25], "furniture", "counter"],
    [6, [8, 10, 24, 25], "furniture", "counter"],
    [6, [66, 70, 82, 86], "furniture", "machine"],
    [6, [38, 39, 42, 43], "furniture", "stairs"],
    [8, [0, 0, 0, 0], "furniture", "panel"],
    [8, [72, 73, 88, 89], "furniture", "panel"],
    [8, [73, 75, 90, 91], "furniture", "panel"],
    [8, [38, 41, 48, 49], "furniture", "merchandise"],
    [8, [48, 49, 30, 31], "furniture", "merchandise"],
    [8, [38, 41, 14, 15], "furniture", "merchandise"],
    [8, [45, 46, 61, 62], "furniture", "panel"],
    ...["36,39,37,53", "5,5,16,16", "37,53,37,53", "37,53,66,62", "38,39,16,62",
      "36,38,37,53", "36,38,66,16", "38,39,37,53", "37,15,66,16", "36,38,37,15",
      "38,39,15,53", "37,15,37,15", "15,53,15,53", "15,53,16,62"]
      .map(signature => [7, signature.split(",").map(Number), "furniture", "panel"]),
    [7, [34, 35, 50, 51], "furniture", "lectern"],
    [3, [2, 3, 18, 19], "stump"],
    [3, [84, 85, 86, 87], "rock"],
    [3, [33, 34, 49, 50], "sign"],
    [22, [83, 84, 54, 38], "rock"],
    [15, [17, 17, 17, 17], "furniture", "panel"],
    [15, [9, 10, 25, 26], "furniture", "panel"],
    ...["9,10,25,26", "43,44,43,44", "51,51,51,51", "42,42,58,58",
      "74,75,76,77", "42,42,13,14", "87,87,89,89", "42,46,58,60"]
      .map(signature => [22, signature.split(",").map(Number), "furniture", "panel"]),
    ...["1,1,1,1", "1,1,17,17", "51,51,1,1"]
      .map(signature => [13, signature.split(",").map(Number), "furniture", "panel"]),
    [20, [2, 3, 18, 19], "furniture", "machine"],
    [21, [11, 12, 27, 28], "furniture", "table"],
  ]) {
    const game = map(13, tileset), rom = game.cartridge.rom;
    for (const [i, code] of codes.entries()) rom[0x4010 + [0, 1, 4, 5][i]] = code;
    const descriptor = red.world(game), world = World.build(game, red, 14);
    assert.ok(descriptor.objects.some(object => object.type === type && (!kind || object.kind === kind)));
    assert.ok(world.models.length >= 180);
    assert.ok(world.models.every(Number.isFinite));
    if (kind) assert.ok(world.stats.furniture > 0);
    else assert.ok(world.stats[type === "tree" ? "trees" : type === "sign" ? "signs" : type] > 0);
    assert.equal(World.build(game, red, 14).models, world.models);
  }
});
test("verified passage, ship, lobby and facility motifs use textured walls rather than color-derived relief", () => {
  const patterns = [
    [23, "46,47,46,47"], [16, "89,90,89,90"], [19, "74,75,74,75"],
    ...["45,42,59,58", "42,46,43,44", "13,2,29,53", "2,14,53,30", "45,42,43,44",
      "29,53,29,53", "53,30,53,30", "45,46,43,44", "29,53,68,69", "53,30,69,68",
      "43,44,59,60"].map(signature => [22, signature]),
    ...["2,2,16,16", "16,22,16,22", "23,16,23,16"].map(signature => [11, signature]),
    ...["23,24,23,24", "0,0,0,0", "9,9,50,51"].map(signature => [12, signature]),
    ...["16,16,18,19", "21,1,21,1", "1,22,1,22", "46,47,62,63"].map(signature => [13, signature]),
    ...["1,1,1,1", "1,1,33,33", "54,57,54,57", "39,39,21,21"].map(signature => [18, signature]),
    ...["36,39,37,53", "5,5,16,16", "37,53,37,53", "37,53,66,62", "38,39,16,62",
      "36,38,37,53", "36,38,66,16", "38,39,37,53", "37,15,66,16", "36,38,37,15",
      "38,39,15,53", "37,15,37,15", "15,53,15,53", "15,53,16,62"].map(signature => [5, signature]),
  ];
  for (const [tileset, signature] of patterns) {
    const game = map(13, tileset), rom = game.cartridge.rom, codes = signature.split(",").map(Number);
    rom.fill(10, 0x4010, 0x4020); rom[0x200] = 10;
    game.vram.fill(10, 0x1800, 0x1c00);
    rom.fill(10, 0x4040, 0x4050);
    for (const [i, code] of codes.entries()) rom[0x4040 + [0, 1, 4, 5][i]] = code;
    game.wram[0x6e8 + 4 * 10 + 4] = 4;
    const descriptor = red.world(game), scene = World.build(game, red, 14);
    assert.deepEqual(descriptor.objects, [{ type: "furniture", kind: "panel", x: 32, y: 32, width: 16, depth: 16 }]);
    assert.equal(scene.stats.sculpted, undefined);
    assert.equal(descriptor.facades.length, 1);
    assert.equal(descriptor.tiles[4 * 16 + 4], codes[0]);
    assert.equal(descriptor.tiles[5 * 16 + 5], codes[3]);
    assert.ok(scene.background.every(Number.isFinite));
  }
});
test("regional water shore quadrants are lowered rather than sculpted into raised obstacles", () => {
  for (const tileset of [0, 3, 7, 14, 17, 22, 23]) {
    const game = map(13, tileset), rom = game.cartridge.rom;
    rom.set([50, 20, 50, 20, 50, 20, 50, 20, 50, 20, 50, 20, 50, 20, 50, 20], 0x4010);
    for (let i = 0; i < 1024; i++) game.vram[0x1800 + i] = i % 2 ? 20 : 50;
    const descriptor = red.world(game), world = World.build(game, red, 14);
    assert.ok(descriptor.surfaces.length > 0);
    assert.ok(descriptor.surfaces.every(cell => cell.depth === -2 && !cell.sculpted));
    assert.equal(world.stats.sculpted, undefined);
    assert.ok(world.background.some((value, i) => i % 6 === 2 && value === -2));
  }
});
test("shop merchandise retains cartridge graphics on vertical shelving and caches its immutable geometry", () => {
  const game = map(42, 2), rom = game.cartridge.rom, ram = game.wram;
  rom.set([64, 65, 1, 1, 80, 81, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 0x4040);
  ram[0x6e8 + 4 * 10 + 4] = 4;
  const descriptor = red.world(game), scene = World.build(game, red, 14);
  assert.deepEqual(descriptor.facades, [{ x: 32.5, y: 46.2, width: 15, height: 23,
    sourceX: 32, sourceY: 32, sourceWidth: 16, sourceHeight: 16 }]);
  assert.equal(descriptor.tiles[4 * 16 + 4], 64);
  assert.equal(descriptor.tiles[5 * 16 + 5], 81);
  assert.ok(scene.background.some((v, i) => i % 6 === 2 && v === 23));
  assert.ok(scene.models.every(Number.isFinite));
  game.vram[0x1400] ^= 255;
  const updated = World.build(game, red, 14);
  assert.equal(updated.models, scene.models);
  assert.equal(updated.background, scene.background);
  assert.notEqual(updated.textures.background, scene.textures.background);
});
test("Pokemon Center healing equipment is a single textured composite with no overlapping pixel relief", () => {
  const game = map(41, 6, 7, 4), rom = game.cartridge.rom, ram = game.wram;
  const codes = [40, 58, 59, 40, 40, 74, 75, 40, 72, 76, 77, 73, 72, 6, 22, 73];
  rom.set(codes, 0x4040); ram[0x6e8 + 4 * 13 + 4] = 4;
  const before = States.capture(game, "0".repeat(64)), descriptor = red.world(game), scene = World.build(game, red, 14);
  assert.deepEqual(descriptor.objects, [{ type: "furniture", kind: "healing", x: 32, y: 32, width: 32, depth: 32 }]);
  assert.deepEqual(descriptor.facades, [{ x: 32.5, y: 62.2, width: 31, height: 27,
    sourceX: 32, sourceY: 32, sourceWidth: 32, sourceHeight: 32 }]);
  assert.equal(scene.stats.sculpted, undefined);
  assert.equal(scene.stats.furniture, 1);
  assert.ok(scene.models.every(Number.isFinite));
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    assert.equal(descriptor.tiles[(y + 4) * 28 + x + 4], codes[y * 4 + x]);
  }
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  rom[0x404b] = 7; rom[0x404f] = 13;
  assert.equal(red.world(game).objects.filter(o => o.kind === "healing").length, 1);
  rom[0x404b] = 1;
  assert.equal(red.world(game).objects.filter(o => o.kind === "healing").length, 0);
});
test("Viridian school and house desks preserve their different original tabletops on complete legged models", () => {
  for (const [id, codes] of [
    [43, [38, 39, 39, 41, 70, 71, 47, 57, 86, 87, 47, 57, 60, 58, 58, 59]],
    [44, [38, 39, 39, 41, 54, 47, 47, 57, 54, 47, 47, 57, 60, 58, 58, 59]],
  ]) {
    const game = map(id, 8), ram = game.wram, rom = game.cartridge.rom;
    rom.set(codes, 0x4040); ram[0x6e8 + 4 * 10 + 4] = 4;
    const descriptor = red.world(game), scene = World.build(game, red, 14);
    assert.equal(descriptor.name, id === 43 ? "Jadielle · école" : "Jadielle · maison");
    assert.deepEqual(descriptor.objects, [{ type: "furniture", kind: "desk", x: 32, y: 32, width: 32, depth: 32 }]);
    assert.deepEqual(descriptor.facades, [{ roof: true, x: 32, y: 32, width: 32, depth: 32, height: 14,
      sourceX: 32, sourceY: 32, sourceWidth: 32, sourceHeight: 32 }]);
    assert.equal(scene.stats.sculpted, undefined);
    assert.equal(scene.stats.furniture, 1);
    assert.equal(descriptor.spriteSurfaces[0].height, 14);
    assert.ok(scene.background.some((v, i) => i % 6 === 2 && Math.abs(v - 14.1) < 0.001));
    assert.ok(scene.models.every(Number.isFinite));
    assert.equal(World.build(game, red, 14).models, scene.models);
    game.vram[0x1260] ^= 255;
    const changed = World.build(game, red, 14);
    assert.equal(changed.models, scene.models);
    assert.notEqual(changed.textures.background, scene.textures.background);
  }
});
test("Viridian cliff terrain has continuous oriented slopes instead of color-derived obstacle heights", () => {
  const game = map(1, 0, 20, 18), ram = game.wram, rom = game.cartridge.rom;
  const block = (id, x, y, codes) => {
    rom.fill(1, 0x4000 + id * 16, 0x4010 + id * 16);
    for (const [i, code] of codes.entries()) rom[0x4000 + id * 16 + [0, 1, 4, 5][i]] = code;
    ram[0x6e8 + (y + 3) * 26 + x + 3] = id;
  };
  block(4, 1, 1, [17, 17, 17, 17]);
  block(5, 2, 1, [36, 36, 36, 36]);
  block(6, 3, 1, [1, 1, 17, 17]);
  block(7, 4, 1, [2, 57, 36, 2]);
  block(8, 5, 1, [45, 46, 61, 62]);
  const before = States.capture(game, "0".repeat(64)), descriptor = red.world(game), world = World.build(game, red, 14);
  assert.equal(descriptor.name, "Jadielle");
  assert.equal(world.stats.sculpted, undefined);
  assert.equal(world.stats.shrub, 1);
  assert.deepEqual(descriptor.surfaces.find(s => s.x === 64 && s.y === 32),
    { x: 64, y: 32, depth: 24, slope: "right", sculpted: false });
  assert.equal(descriptor.surfaces.find(s => s.x === 96 && s.y === 32).slope, "up");
  assert.equal(descriptor.surfaces.find(s => s.x === 128 && s.y === 32).slope, "up-right");
  const tops = [];
  for (let i = 0; i < world.background.length; i += 36) {
    const p = [0, 6, 12].map(o => [...world.background.slice(i + o, i + o + 3)]);
    if (p.every(point => point[2] === p[0][2])) tops.push({
      x: p[0][0] + 80, y: 72 - p[0][1], right: p[1][0] + 80, bottom: 72 - p[2][1], z: p[0][2],
    });
  }
  for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) {
    for (const [x, expected] of [[32, 24], [64, Math.round(24 * (15 - dx) / 15)],
      [96, Math.round(24 * dy / 15)], [128, Math.round(24 * Math.min((15 - dx) / 15, dy / 15))]]) {
      const face = tops.find(f => x + dx + 0.5 > f.x && x + dx + 0.5 < f.right
        && 32 + dy + 0.5 > f.y && 32 + dy + 0.5 < f.bottom);
      assert.ok(face);
      assert.equal(face.z, expected);
    }
  }
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  assert.equal(World.build(game, red, 14).background, world.background);
});
test("forest canopy pairs form single wide trees across block boundaries without covering lower vegetation", () => {
  const game = map(51, 3, 17, 24), ram = game.wram, rom = game.cartridge.rom;
  rom.fill(1, 0x4040, 0x4060);
  rom.set([36, 37], 0x4042); rom.set([0, 53], 0x4046);
  rom.set([38, 39], 0x4050); rom.set([54, 48], 0x4054);
  ram[0x6e8 + 4 * 23 + 4] = 4; ram[0x6e8 + 4 * 23 + 5] = 5;
  const before = States.capture(game, "0".repeat(64)), descriptor = red.world(game), scene = World.build(game, red, 14);
  assert.equal(descriptor.name, "Forêt de Jade");
  assert.deepEqual(descriptor.objects, [{ type: "tree", x: 48, y: 32, width: 32, depth: 16 }]);
  assert.equal(scene.stats.trees, 1);
  assert.equal(scene.stats.sculpted, undefined);
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 4; dx++) {
    assert.equal(descriptor.tiles[(4 + dy) * 68 + 6 + dx], 48);
  }
  assert.equal(descriptor.tiles[6 * 68 + 6], 1);
  assert.ok(scene.models.every(Number.isFinite));
  assert.ok(scene.models.some((v, i) => i % 6 === 2 && v === 37));
  assert.equal(World.build(game, red, 14).models, scene.models);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  rom[0x4055] = 1;
  assert.equal(red.world(game).objects.filter(o => o.width === 32).length, 0);
});
test("cavern walls use fixed oriented relief, retain the cartridge texture and do not rebuild for palette changes", () => {
  const patterns = [
    [[0, 0, 0, 0], 0], [[60, 60, 60, 60], 0],
    [[49, 49, 49, 49], 24], [[23, 23, 23, 23], 24],
    [[4, 41, 49, 5], 24, "right"], [[49, 5, 40, 16], 24, "right"],
    [[49, 5, 49, 5], 24, "right"], [[32, 4, 4, 49], 24, "up"],
    [[49, 40, 40, 16], 24, "down"], [[5, 23, 16, 17], 24, "left"],
    [[7, 32, 23, 7], 24, "up"], [[17, 23, 16, 17], 24, "left"],
    [[5, 5, 16, 16], 24, "up"], [[16, 38, 38, 49], 24, "up"],
    [[37, 16, 23, 37], 24, "down"], [[6, 39, 36, 1], -2],
  ];
  for (const [codes, depth, slope] of patterns) {
    const game = map(59, 17), rom = game.cartridge.rom, ram = game.wram;
    rom.fill(1, 0x4040, 0x4050);
    for (const [i, code] of codes.entries()) rom[0x4040 + [0, 1, 4, 5][i]] = code;
    ram[0x6e8 + 4 * 10 + 4] = 4;
    const before = States.capture(game, "0".repeat(64)), descriptor = red.world(game), scene = World.build(game, red, 14);
    const surface = descriptor.surfaces.find(s => s.x === 32 && s.y === 32);
    assert.equal(surface.sculpted, false, codes.join(","));
    assert.equal(surface.depth, depth);
    assert.equal(surface.slope, slope);
    assert.equal(scene.stats.sculpted, undefined);
    for (let i = 0; i < 4; i++) assert.equal(descriptor.tiles[[4 * 16 + 4, 4 * 16 + 5, 5 * 16 + 4, 5 * 16 + 5][i]], codes[i]);
    assert.ok(scene.background.every(Number.isFinite));
    const tops = [];
    for (let i = 0; i < scene.background.length; i += 36) {
      const p = [0, 6, 12].map(o => [...scene.background.slice(i + o, i + o + 3)]);
      if (p.every(v => v[2] === p[0][2])) tops.push({
        x: p[0][0] + 80, y: 72 - p[0][1], right: p[1][0] + 80, bottom: 72 - p[2][1], z: p[0][2],
      });
    }
    for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) {
      const expected = slope ? Math.round(depth * (slope === "right" ? (15 - dx) / 15
        : slope === "left" ? dx / 15 : slope === "up" ? dy / 15 : (15 - dy) / 15)) : depth;
      const face = tops.find(f => 32 + dx + 0.5 > f.x && 32 + dx + 0.5 < f.right
        && 32 + dy + 0.5 > f.y && 32 + dy + 0.5 < f.bottom);
      assert.ok(face);
      assert.equal(face.z, expected);
    }
    const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
    game.io[0x47] ^= 3;
    const colored = World.build(game, red, 14);
    assert.equal(colored.background, scene.background);
    assert.notEqual(colored.textures.background, scene.textures.background);
  }
});
test("regional obstacles are sculpted from their graphics and invalidate only when scene data changes", () => {
  const game = map(13, 11), ram = game.wram;
  ram[0x6e8 + 3 * 10 + 3] = 3;
  game.vram.set([255, 0, 255, 0, 240, 15, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0], 0x1020);
  const first = World.build(game, red, 14);
  assert.ok(first.stats.sculpted > 0);
  const heights = new Set([...first.background].filter((_, i) => i % 6 === 2 && first.background[i] > 0));
  assert.ok(heights.size >= 3);
  assert.equal(World.build(game, red, 14).background, first.background);
  game.vram[0x1020 + 4] ^= 255;
  assert.notEqual(World.build(game, red, 14).background, first.background);
  const second = World.build(game, red, 14);
  game.vram[0x1500] ^= 255;
  assert.equal(World.build(game, red, 14).background, second.background);
  game.io[0x47] ^= 3;
  assert.notEqual(World.build(game, red, 14).textures.background, second.textures.background);
  game.cartridge.rom[0x4030] = 128;
  assert.equal(red.world(game).active, false);
});
test("sculpted obstacles retain every source pixel height, not just one sample per 4x4 cell", () => {
  const game = map(13, 11), ram = game.wram;
  ram[0x6e8 + 4 * 10 + 4] = 3;
  game.cartridge.rom.fill(1, 0x4030, 0x4040);
  for (const i of [0, 1, 4, 5]) game.cartridge.rom[0x4030 + i] = 2;
  for (let y = 0; y < 8; y++) {
    let low = 0, high = 0;
    for (let x = 0; x < 8; x++) {
      const color = (x + y) % 4;
      low |= (color & 1) << (7 - x); high |= (color >> 1) << (7 - x);
    }
    game.vram.set([low, high], 0x1020 + y * 2);
  }
  const world = World.build(game, red, 14), tops = [];
  for (let i = 0; i < world.background.length; i += 36) {
    const points = [0, 6, 12, 30].map(offset => [...world.background.slice(i + offset, i + offset + 3)]);
    if (points.every(point => point[2] === points[0][2])) {
      tops.push({ left: points[0][0] + 80, right: points[1][0] + 80,
        top: 72 - points[0][1], bottom: 72 - points[2][1], z: points[0][2] });
    }
  }
  for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) {
    const x = 32 + dx + 0.5, y = 32 + dy + 0.5;
    const matches = tops.filter(face => x > face.left && x < face.right && y > face.top && y < face.bottom);
    assert.equal(matches.length, 1, `pixel ${dx},${dy}`);
    assert.equal(matches[0].z, 3 + ((dx + dy) % 4) * 4, `height at ${dx},${dy}`);
  }
  assert.ok(world.stats.reliefQuads < 256 * 5 + 20);
  assert.equal(World.build(game, red, 14).background, world.background);
});
test("coplanar procedural terrain is merged across sectors without internal walls", () => {
  const game = map(13, 11);
  const world = World.build(game, red, 14);
  assert.equal(world.stats.reliefQuads, 1);
  assert.equal(world.background.length, 36);
  assert.equal(world.background[0], -80);
  assert.equal(world.background[1], 72);
  assert.equal(world.background[6], 48);
  assert.equal(world.background[13], -56);
  assert.equal(World.build(game, red, 0).background.length, 36);
  game.wram.fill(3, 0x6e8, 0x6e8 + 100);
  game.wram[0x6e8] = 1;
  const raised = World.build(game, red, 14);
  assert.equal(raised.stats.reliefQuads, 5);
  assert.equal(raised.background.length, 180);
  assert.equal(World.build(game, red, 0).background.length, 36);
});
test("floor animations and palette changes upload fresh textures without rebuilding pixel-detail geometry", () => {
  const game = map(13, 11);
  game.wram[0x6e8 + 4 * 10 + 4] = 3;
  const first = World.build(game, red, 14);
  game.vram[0x1010] ^= 255;
  const animated = World.build(game, red, 14);
  assert.notEqual(animated.textures.background, first.textures.background);
  assert.equal(animated.background, first.background);
  assert.equal(animated.models, first.models);
  game.io[0x47] ^= 3;
  const recolored = World.build(game, red, 14);
  assert.notEqual(recolored.textures.background, animated.textures.background);
  assert.equal(recolored.background, first.background);
  game.vram[0x1020] ^= 255;
  assert.notEqual(World.build(game, red, 14).background, first.background);
});
test("regional closed roof patterns produce complete houses and preserve textured front facades", () => {
  const game = map(1, 0, 10, 9), rom = game.cartridge.rom, ram = game.wram;
  rom.set([35, 35, 35, 35, 35, 35, 35, 35, 5, 6, 8, 9, 21, 22, 24, 25], 0x4040);
  rom.set([37, 38, 40, 41, 23, 23, 23, 23, 15, 34, 11, 12, 78, 26, 27, 28], 0x4050);
  ram[0x6e8 + 4 * 16 + 5] = 4;
  ram[0x6e8 + 5 * 16 + 5] = 5;
  const descriptor = red.world(game), world = World.build(game, red, 14);
  assert.equal(world.stats.houses, 1);
  assert.equal(descriptor.facades.length, 1);
  assert.deepEqual(descriptor.objects.find(object => object.type === "house"),
    { type: "house", x: 64, y: 40, width: 32, depth: 56, doorOffset: 8 });
  assert.equal(descriptor.tiles[6 * 40 + 8], 5);
  assert.ok(world.background.every(Number.isFinite));
  const cached = World.build(game, red, 14);
  assert.equal(cached.background, world.background);
  ram[0x6e8 + 5 * 16 + 5] = 1;
  assert.equal(World.build(game, red, 14).stats.houses, 0);
});
test("regional shops and Pokemon Centers use flat textured roofs and four-row original facades", () => {
  const game = map(1, 0, 10, 9), rom = game.cartridge.rom, ram = game.wram;
  rom.set([76, 83, 83, 77, 90, 18, 18, 90, 90, 18, 18, 90, 92, 23, 23, 93], 0x4040);
  rom.set([15, 10, 10, 31, 15, 75, 75, 31, 15, 11, 12, 31, 78, 27, 28, 79], 0x4050);
  ram[0x6e8 + 4 * 16 + 5] = 4; ram[0x6e8 + 5 * 16 + 5] = 5;
  const descriptor = red.world(game), world = World.build(game, red, 14);
  assert.equal(world.stats.houses, 1);
  assert.equal(descriptor.objects.find(o => o.type === "house").roof, "flat");
  assert.equal(descriptor.facades.length, 2);
  assert.equal(descriptor.facades.find(f => !f.roof).sourceHeight, 32);
  assert.ok(world.background.some((value, i) => i % 6 === 2 && value > 25 && value < 26));
  assert.ok(world.models.every(Number.isFinite));
});
test("long and wide regional maps stay within texture limits and retain absolute camera continuity", () => {
  for (const [width, height] of [[10, 72], [72, 10]]) {
    const game = map(13, 0, width, height), ram = game.wram, stride = width + 6;
    const set = (bx, by, mx, my, bg, sx, sy) => {
      const anchor = 0xc6e8 + (by + 3) * stride + bx + 3;
      ram.set([anchor & 255, anchor >> 8], 0x1364);
      ram[0x1369] = mx; ram[0x1368] = my;
      ram.set([bg & 255, bg >> 8], 0x152b); game.io[0x43] = sx; game.io[0x42] = sy;
      const descriptor = red.world(game), world = World.build(game, red, 14);
      assert.equal(descriptor.bounded, true);
      assert.ok(world.textures.background.width <= 384);
      assert.ok(world.textures.background.height <= 384);
      assert.match(world.detail, /région locale/);
      return [descriptor.regionX + world.origin[0], descriptor.regionY + world.origin[1]];
    };
    assert.deepEqual(set(3, 3, 1, 1, 0x9800, 0, 0), [112, 112]);
    assert.deepEqual(set(4, 3, 0, 1, 0x9802, 0, 0), [112, 112]);
    assert.deepEqual(set(4, 3, 0, 1, 0x9802, 2, 0), [114, 112]);
  }
});
test("map IDs are not a whitelist for procedural scenery and invalid detailed-map dimensions stay guarded", () => {
  const game = map(13, 11);
  for (let id = 0; id < 248; id++) {
    if ([0, 12, 37, 38, 39, 40].includes(id)) continue;
    game.wram[0x1363] = id;
    assert.equal(red.world(game).active, true, `synthetic map ID ${id}`);
  }
  game.wram[0x1363] = 38;
  assert.equal(red.world(game).active, false);
});
test("procedural scenes preserve dialogue and fullscreen-window sprites without opaque HUDs", () => {
  const game = map(13, 17);
  dialogue(game);
  game.vram.set(game.vram.slice(0x1800, 0x1c00), 0x1c00);
  game.vram.fill(99, 0x1800, 0x1c00);
  game.vram.fill(255, 16, 32); game.oam.set([56, 64, 1, 0]);
  game.io[0x40] = 0xe3; game.io[0x4a] = 0; game.io[0x4b] = 7;
  game.setVideoCapture(true); game.tick(70224);
  const before = States.capture(game, "0".repeat(64)), scene = World.build(game, red, 14);
  assert.ok(scene.sprites.length > 0);
  for (let i = 0; i < 160 * 144; i++) {
    if (i < 160 * 96) assert.equal(scene.textures.window.pixels[i * 4 + 3], 0);
    else assert.deepEqual(scene.textures.window.pixels.slice(i * 4, i * 4 + 4), game.pixels.slice(i * 4, i * 4 + 4));
  }
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
});
test("Red dialogue pixels remain exact overlays in both render modes while unknown screens stay flat", () => {
  const game = map();
  dialogue(game);
  game.setVideoCapture(true); game.tick(70224);
  const before = States.capture(game, "0".repeat(64));
  for (const scene of [World.build(game, red, 14), Scene.buildScene(game, red, 14)]) {
    assert.ok(scene.textures.window.pixels.some(Boolean));
    for (let i = 160 * 96; i < 160 * 144; i++) {
      assert.deepEqual(scene.textures.window.pixels.slice(i * 4, i * 4 + 4), game.pixels.slice(i * 4, i * 4 + 4));
      assert.equal(scene.textures.sprites.pixels[i * 4 + 3], 0);
    }
  }
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
  game.vram.fill(99, 0x1800, 0x1c00); dialogue(game);
  assert.equal(red.world(game).active, false);
  assert.equal(red.terrain(game).active, false);
});
test("Red battles activate for verified wild/trainer flags and either visible hardware tile map", () => {
  for (const type of [1, 2]) for (const fullWindow of [false, true]) {
    const game = makeRedBattle({ type, fullWindow }), descriptor = red.world(game);
    assert.equal(Scene.selectPreset(game, [red]), red);
    assert.equal(descriptor.active, true);
    assert.equal(descriptor.battle, true);
    assert.match(descriptor.name, type === 1 ? /sauvage/ : /dresseur/);
    assert.equal(World.build(game, red, 14).stats.combatants, 2);
    assert.equal(Scene.buildScene(game, red, 14).terrain.active, false);
  }
  for (const type of [0, 3, 255]) {
    assert.equal(red.world(makeRedBattle({ type })).active, false);
  }
});
test("battle flags do not turn off-LCD, malformed or fullscreen submenus into stale 3D maps", () => {
  for (const lcd of [0, 0x63, 0xe2]) {
    const game = makeRedBattle(); game.io[0x40] = lcd;
    assert.equal(red.world(game).active, false);
  }
  for (const [x, y] of [[0, 12], [19, 12], [0, 17], [19, 17]]) {
    const game = makeRedBattle(); game.vram[0x1c00 + y * 32 + x] = 0x7f;
    assert.equal(red.world(game).active, false);
  }
  const game = map(); game.wram[0x105c] = 2; dialogue(game);
  assert.equal(red.world(game).active, false);
  assert.equal(red.terrain(game).active, false);
  const menu = makeRedBattle(); menu.vram.fill(0x7f, 0x1c00, 0x1d80);
  assert.equal(red.world(menu).active, false);
});
test("battle meshes have upright faces, backs, exposed edges, platforms and finite texture coordinates", () => {
  const game = makeRedBattle();
  for (const thickness of [0, 14, 16]) {
    const world = World.build(game, red, thickness);
    assert.equal(world.active, true); assert.equal(world.battle, true);
    assert.deepEqual(world.stats, { combatants: 2, platforms: 2 });
    assert.ok(world.background.length > 0 && world.models.length > 0 && world.shadows.length > 0);
    const planes = new Set();
    for (let i = 0; i < world.sprites.length; i += 6) planes.add(world.sprites[i + 1]);
    assert.equal(planes.size, thickness ? 4 : 2);
    assert.ok(world.sprites.some((value, i) => i % 6 === 2 && value > 40));
    for (const vertices of [world.background, world.models, world.shadows, world.sprites]) {
      assert.equal(vertices.length % 36, 0);
      assert.ok(vertices.every(Number.isFinite));
      for (let i = 0; i < vertices.length; i += 6) {
        assert.ok(vertices[i + 3] >= 0 && vertices[i + 3] <= 1);
        assert.ok(vertices[i + 4] >= 0 && vertices[i + 4] <= 1);
      }
    }
  }
  assert.throws(() => World.build(game, red, NaN), /invalide/);
});
test("battle HUD pixels and enclosed white details stay exact without mutating machine or state", () => {
  const game = makeRedBattle(), before = States.capture(game, "0".repeat(64));
  const descriptor = red.world(game), world = World.build(game, red, 14);
  for (let i = 0; i < 160 * 144; i++) {
    const offset = i * 4;
    if (descriptor.overlay[i]) {
      assert.deepEqual(world.textures.window.pixels.slice(offset, offset + 4), game.pixels.slice(offset, offset + 4));
    } else assert.equal(world.textures.window.pixels[offset + 3], 0);
    if (descriptor.pictures[i]) {
      assert.deepEqual(world.textures.sprites.pixels.slice(offset, offset + 4), game.pixels.slice(offset, offset + 4));
    } else assert.equal(world.textures.sprites.pixels[offset + 3], 0);
  }
  assert.equal(world.textures.sprites.pixels[(3 * 160 + 99) * 4 + 3], 255);
  assert.deepEqual([...world.textures.sprites.pixels.slice((3 * 160 + 99) * 4, (3 * 160 + 99) * 4 + 3)], [232, 240, 208]);
  assert.equal(world.textures.sprites.pixels[96 * 4 + 3], 0);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
});
test("live palettes refresh textures without rebuilding masks or losing white silhouette interiors", () => {
  const game = makeRedBattle(), first = World.build(game, red, 14), mask = red.world(game).pictures;
  const same = World.build(game, red, 14);
  assert.equal(same.sprites, first.sprites); assert.equal(same.models, first.models);
  assert.equal(same.material, first.material);
  game.io[0x47] = 0x1b; game.tick(70224);
  const flash = World.build(game, red, 14);
  assert.deepEqual(red.world(game).pictures, mask);
  assert.equal(flash.sprites, first.sprites);
  assert.notEqual(flash.material, first.material);
  assert.notDeepEqual(flash.textures.sprites.pixels, first.textures.sprites.pixels);
  assert.equal(flash.textures.sprites.pixels[(3 * 160 + 99) * 4 + 3], 255);
  assert.deepEqual(flash.textures.sprites.pixels.slice((3 * 160 + 99) * 4, (3 * 160 + 99) * 4 + 4),
    game.pixels.slice((3 * 160 + 99) * 4, (3 * 160 + 99) * 4 + 4));
  game.vram.fill(0, 0x1000, 0x1010); game.tick(70224);
  assert.notEqual(World.build(game, red, 14).sprites, first.sprites);
});
test("move selection preserves the covered Pokemon mesh and exact type/PP panel in either hardware map", () => {
  for (const fullWindow of [false, true]) {
    const game = makeRedBattle({ fullWindow }), menu = makeRedBattle({ fullWindow, moveInfo: true });
    const before = States.capture(menu, "0".repeat(64)), original = World.build(game, red, 14);
    const descriptor = red.world(menu), world = World.build(menu, red, 14);
    assert.equal(world.active, true); assert.equal(world.stats.combatants, 2);
    assert.deepEqual(descriptor.pictures, red.world(game).pictures);
    assert.deepEqual(world.sprites, original.sprites);
    for (let i = 0; i < descriptor.pictures.length; i++) if (descriptor.pictures[i]) {
      assert.deepEqual(world.textures.sprites.pixels.slice(i * 4, i * 4 + 4),
        original.textures.sprites.pixels.slice(i * 4, i * 4 + 4));
    }
    for (let y = 64; y < 104; y++) for (let x = 0; x < 88; x++) {
      const offset = (y * 160 + x) * 4;
      assert.deepEqual(world.textures.window.pixels.slice(offset, offset + 4), menu.pixels.slice(offset, offset + 4));
    }
    const after = States.capture(menu, "0".repeat(64)); after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
  }
});
test("battle pictures disappear live on recall/fainting without stale meshes or shadows", () => {
  const game = makeRedBattle(), first = World.build(game, red, 14);
  for (let y = 0; y < 7; y++) game.vram.fill(0x7f, 0x1c00 + y * 32 + 12, 0x1c00 + y * 32 + 19);
  game.tick(70224);
  const one = World.build(game, red, 14);
  assert.equal(one.active, true); assert.equal(one.stats.combatants, 1);
  assert.ok(one.sprites.length < first.sprites.length && one.shadows.length < first.shadows.length);
  for (let y = 5; y < 12; y++) game.vram.fill(0x7f, 0x1c00 + y * 32 + 1, 0x1c00 + y * 32 + 8);
  game.tick(70224);
  const empty = World.build(game, red, 14);
  assert.equal(empty.active, true); assert.equal(empty.stats.combatants, 0);
  assert.equal(empty.sprites.length, 0); assert.equal(empty.shadows.length, 0);
});
test("OAM battle effects retain their live screen pixels without becoming Pokemon voxels", () => {
  const game = makeRedBattle();
  game.vram.fill(255, 0xfe0, 0xff0); game.oam.set([64, 88, 254, 0]); game.tick(70224);
  const world = World.build(game, red, 14), offset = (48 * 160 + 80) * 4;
  assert.deepEqual(world.textures.window.pixels.slice(offset, offset + 4), game.pixels.slice(offset, offset + 4));
  assert.equal(world.textures.window.pixels[offset + 3], 255);
  assert.equal(world.textures.sprites.pixels[offset + 3], 0);
});
test("returning from a battle or restoring a map resumes the same overworld geometry", () => {
  const game = map(), before = States.capture(game, "0".repeat(64)), original = World.build(game, red, 14);
  const fight = makeRedBattle();
  game.wram[0x105c] = 2; game.vram.set(fight.vram); game.io.set(fight.io);
  game.setVideoCapture(true); game.tick(70224);
  assert.equal(World.build(game, red, 14).battle, true);
  States.restore(game, before, "0".repeat(64));
  const restored = World.build(game, red, 14);
  assert.equal(restored.battle, undefined); assert.equal(restored.active, true);
  assert.equal(restored.models, original.models);
});
test("Red validates map memory and tables instead of enabling stale or malformed scenes", () => {
  for (const [offset, value] of [[0x1363, 255], [0x136c, 24], [0x136d, 0], [0x136e, 200],
    [0x1365, 0], [0x1530, 0], [0x1532, 0], [0x1536, 0x80], [0x152c, 0]]) {
    const game = map(); game.wram[offset] = value;
    assert.equal(red.terrain(game).active, false);
    assert.equal(red.world(game).active, false);
  }
  const game = map(); game.cartridge.rom.fill(1, 0x200, 0x280);
  assert.equal(red.world(game).active, false);
});
test("two-block elevator maps accept an interior camera anchor without demanding nonexistent viewport blocks", () => {
  for (const id of [127, 236]) {
    const game = map(id, 18, 2, 2), ram = game.wram;
    const before = States.capture(game, "0".repeat(64)), scene = World.build(game, red, 14);
    assert.equal(scene.active, true);
    assert.equal(scene.textures.background.width, 64);
    assert.equal(scene.textures.background.height, 64);
    assert.deepEqual(scene.origin, [0, 0]);
    const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
    assert.deepEqual(after, before);
    for (const offset of [5, 40, 64]) {
      const anchor = 0xc6e8 + offset;
      ram.set([anchor & 255, anchor >> 8], 0x1364);
      assert.equal(red.world(game).active, false);
    }
  }
});
test("Red full-screen hardware window keeps map and OAM in 3D, not an opaque full-screen HUD", () => {
  const game = map();
  dialogue(game);
  game.vram.set(game.vram.slice(0x1800, 0x1c00), 0x1c00);
  game.vram.fill(99, 0x1800, 0x1c00);
  game.vram.fill(255, 16, 32); game.oam.set([56, 64, 1, 0]);
  game.io[0x40] = 0xe3; game.io[0x4a] = 0; game.io[0x4b] = 7;
  game.setVideoCapture(true); game.tick(70224);
  const before = States.capture(game, "0".repeat(64));
  for (const scene of [World.build(game, red, 14), Scene.buildScene(game, red, 14)]) {
    assert.ok(scene.sprites.length > 0);
    for (let i = 0; i < 160 * 144; i++) {
      if (i < 160 * 96) assert.equal(scene.textures.window.pixels[i * 4 + 3], 0);
      else assert.deepEqual(scene.textures.window.pixels.slice(i * 4, i * 4 + 4), game.pixels.slice(i * 4, i * 4 + 4));
    }
  }
  assert.equal(red.terrain(game).screenMap, true);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
});
test("Red Start menu is recognized with and without the Pokedex, while malformed frames remain flat", () => {
  for (const [id, tileset] of [[38, 4], [13, 11]]) for (const bottom of [13, 15]) {
    const game = map(id, tileset);
    for (let y = 0; y <= bottom; y++) for (let x = 10; x < 20; x++) {
      game.vram[0x1800 + y * 32 + x] = y === 0 || y === bottom ? 122 : x === 10 || x === 19 ? 124 : 127;
    }
    for (const [x, y, tile] of [[10, 0, 121], [19, 0, 123], [10, bottom, 125], [19, bottom, 126]]) {
      game.vram[0x1800 + y * 32 + x] = tile;
    }
    assert.equal(red.world(game).active, true);
    assert.equal(red.world(game).overlayLabel, "menu Start");
    game.setVideoCapture(true); game.tick(70224);
    const scene = World.build(game, red, 14);
    for (let y = 0; y < (bottom + 1) * 8; y++) for (let x = 80; x < 160; x++) {
      const i = (y * 160 + x) * 4;
      assert.deepEqual(scene.textures.window.pixels.slice(i, i + 4), game.pixels.slice(i, i + 4));
      assert.equal(scene.textures.sprites.pixels[i + 3], 0);
    }
    game.vram[0x1800 + bottom * 32 + 19] = 99;
    assert.equal(red.world(game).active, false);
  }
});
test("Red full-map camera compensates early destination anchors in both directions and scroll wrapping", () => {
  const game = map(0, 0, 10, 9), ram = game.wram;
  const set = (anchor, mx, my, bg, sx, sy) => {
    ram.set([anchor & 255, anchor >> 8, 6, 5, my, mx], 0x1364);
    ram.set([bg & 255, bg >> 8], 0x152b);
    game.io[0x43] = sx; game.io[0x42] = sy;
    return World.build(game, red, 14).origin;
  };
  const anchor = 0xc6e8 + 4 * 16 + 3;
  assert.deepEqual(set(anchor, 1, 0, 0x9840, 0, 16), [16, 32]);
  assert.deepEqual(set(anchor + 1, 0, 0, 0x9842, 0, 16), [16, 32]);
  assert.deepEqual(set(anchor + 1, 0, 0, 0x9842, 2, 16), [18, 32]);
  assert.deepEqual(set(anchor, 0, 0, 0x985e, 0, 16), [16, 32]);
  assert.deepEqual(set(anchor, 0, 0, 0x985e, 254, 16), [14, 32]);
});
