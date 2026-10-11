"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoy } = require("../../gbc/emulator.js");
const { makeROM, makeRedBattle } = require("./helpers.cjs");
const States = require("../../gbc/states.js");
const Scene = require("../../gbc/scene.js");
const World = require("../../gbc/world.js");
const red = require("../../gbc/preset/pokemon-red.js");
const yellow = require("../../gbc/preset/pokemon-yellow.js");

// Yellow WRAM: the map variables sit one byte below Red's; the block grid at 0x06e8 is shared.
function map(id = 0, tileset = 0, width = 10, height = 9) {
  const game = new GameBoy(makeROM({ color: true, type: 0x1b, sizeCode: 5, ramSize: 3 }));
  game.cartridge.title = "POKEMON YEL";
  const ram = game.wram, rom = game.cartridge.rom;
  rom[0x14c] = 0; rom[0x14e] = 0xb7; rom[0x14f] = 0xc1;
  ram[0x1362] = id; ram[0x136b] = tileset; ram[0x136c] = height; ram[0x136d] = width;
  const anchor = 0xc6e8 + 3 * (width + 6) + 3;
  ram.set([anchor & 255, anchor >> 8], 0x1363);
  ram.set([0, 0x98], 0x152a);
  ram[0x152f] = 1; ram.set([0, 0x40], 0x1530); ram.set([0, 2], 0x1534);
  ram.fill(1, 0x6e8, 0x6e8 + (width + 6) * (height + 6));
  rom.fill(1, 0x4010, 0x4020); rom.fill(16, 0x4020, 0x4030);
  rom.fill(2, 0x4030, 0x4040); rom.set([1, 255], 0x200);
  game.vram.fill(1, 0x1800, 0x1c00); game.io[0x40] = 0x83;
  game.vram[0x1010] = 255;
  return game;
}

test("Pokémon Jaune preset identifies revision 0 in colour and never matches Red", () => {
  assert.equal(yellow.label, "Pokémon Jaune");
  assert.deepEqual(yellow.match, { title: "POKEMON YEL", color: true, cartridgeType: 0x1b, revision: 0, checksum: 0xb7c1 });
  const game = map();
  assert.equal(Scene.selectPreset(game, [yellow, red]), yellow);
  assert.equal(Scene.selectPreset(game, [red]), null);
  game.cartridge.rom[0x14f] ^= 1;
  assert.equal(Scene.selectPreset(game, [yellow]), null);
});

test("Pokémon Jaune builds 2.5D and 3D for Pallet Town without writing state", () => {
  const game = map(0, 0, 10, 9);
  game.wram[0x6e8] = 3; game.vram.fill(2, 0x1800 + 8 * 32, 0x1800 + 10 * 32);
  const before = States.capture(game, "0".repeat(64));
  const terrain = yellow.terrain(game), descriptor = yellow.world(game), world = World.build(game, yellow, 14);
  assert.equal(terrain.active, true);
  assert.ok(terrain.depths.some(depth => depth > 0));
  assert.equal(descriptor.active, true);
  assert.equal(descriptor.generic, undefined);
  assert.equal(world.active, true);
  assert.equal(world.textures.background.width, 320);
  assert.equal(world.textures.background.height, 288);
  assert.equal(world.stats.houses, 3);
  assert.equal(world.stats.signs, 4);
  const after = States.capture(game, "0".repeat(64)); after.createdAt = before.createdAt;
  assert.deepEqual(after, before);
});

test("Pokémon Jaune builds the Reds' house, Blue's house and Oak's lab as 3D interiors", () => {
  for (const [id, tileset, width, height] of [[37, 1, 4, 4], [38, 4, 4, 4], [39, 8, 4, 4], [40, 5, 5, 6]]) {
    const game = map(id, tileset, width, height);
    const world = World.build(game, yellow, 14);
    assert.equal(world.active, true);
    assert.equal(world.textures.background.width, width * 32);
    assert.equal(world.textures.background.height, height * 32);
    assert.ok(world.models.length > 0);
  }
  const bedroom = yellow.world(map(38, 4, 4, 4));
  assert.ok(bedroom.objects.some(o => o.kind === "bed"));
});

test("Pokémon Jaune reads a collision table in the switched ROM bank, even when it is longer than 128 tiles", () => {
  const game = map(40, 5, 5, 6);
  game.cartridge.rom.fill(0x11, 0x4300, 0x4300 + 200);
  game.cartridge.rom[0x4300 + 200] = 255;
  game.wram.set([0x00, 0x43], 0x1534);
  const terrain = yellow.terrain(game);
  assert.equal(terrain.active, true);
  assert.match(terrain.reason, /relief de Jaune/);
});

test("Pokémon Jaune reads its battle flag at 0xD05B, not Red's 0xD05C", () => {
  for (const type of [1, 2]) {
    const game = makeRedBattle({ type });
    game.cartridge.title = "POKEMON YEL";
    game.wram[0x105c] = 0; game.wram[0x105b] = type;
    const descriptor = yellow.world(game);
    assert.equal(descriptor.active, true);
    assert.equal(descriptor.battle, true);
    assert.equal(descriptor.name, type === 2 ? "Combat de dresseur" : "Combat sauvage");
  }
  const red105c = makeRedBattle({ type: 1 });
  red105c.cartridge.title = "POKEMON YEL";
  red105c.wram[0x105c] = 1; red105c.wram[0x105b] = 0;
  const flat = yellow.world(red105c);
  assert.equal(flat.active, false);
  assert.doesNotMatch(flat.reason, /Rouge/);
});

test("Pokémon Jaune uses its own block coordinates for the camera", () => {
  const game = map(0, 0, 10, 9);
  const base = yellow.world(game);
  game.wram[0x1369] = 1;
  assert.equal(yellow.world(game).originX, base.originX);
  game.wram[0x1368] = 1;
  assert.notEqual(yellow.world(game).originX, base.originX);
  const vertical = yellow.world(game);
  game.wram[0x1367] = 1;
  assert.notEqual(yellow.world(game).originY, vertical.originY);
});

test("Pokémon Jaune names Jadielle from its shared Kanto table and labels unknown scenes as Jaune", () => {
  const jadielle = yellow.world(map(1, 0, 20, 18));
  assert.equal(jadielle.name, "Jadielle");
  assert.equal(jadielle.bounded, false);
  const unknown = yellow.world(map(60, 0, 10, 9));
  assert.equal(unknown.active, true);
  assert.match(unknown.name, /^Jaune · /);
  const unsupported = map(0); unsupported.wram[0x1362] = 250;
  const reason = yellow.world(unsupported).reason;
  assert.match(reason, /carte Jaune non reconnue/);
  assert.doesNotMatch(reason, /Rouge/);
});
