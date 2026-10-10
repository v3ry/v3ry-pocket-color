(function (root) {
  "use strict";

  function collisionHeight(code) {
    if ([0x07, 0x12, 0x15, 0x1a, 0x1d].includes(code)) return 20;
    if ((code & 0xf0) === 0x90) return 12;
    if ((code & 0xf0) === 0xb0) return 8;
    if ((code & 0xf0) === 0xa0) return 5;
    if ([0x10, 0x14, 0x18, 0x1c].includes(code)) return 2;
    if ([0x21, 0x24, 0x27, 0x29, 0x2c, 0x33].includes(code)) return -2;
    return 0;
  }

  function startMenu(game) {
    const ram = game.wram, lcd = game.io[0x40];
    if (!(lcd & 128) || (lcd & 16) || ram[0xf78] !== 1 || ram[0xf81] !== 0x40
      || ram[0xf82] !== 0 || ram[0xf83] !== 10 || ram[0xf85] !== 19
      || ram[0xf84] < 3 || ram[0xf84] > 17) return null;
    const base = lcd & 8 ? 0x1c00 : 0x1800, sx = game.io[0x43], sy = game.io[0x42];
    if ((sx & 7) || (sy & 7)) return null;
    const tile = (x, y) => game.vram[base + (((y * 8 + sy) & 255) >> 3) * 32 + (((x * 8 + sx) & 255) >> 3)];
    const bottom = ram[0xf84];
    if (tile(10, 0) !== 121 || tile(19, 0) !== 123
      || tile(10, bottom) !== 125 || tile(19, bottom) !== 126) return null;
    const mask = new Uint8Array(160 * 144);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) {
      const description = x < 80 && y >= 104 && tile(x >> 3, y >> 3) >= 127;
      if ((x >= 80 && y < (bottom + 1) * 8) || description) mask[y * 160 + x] = 1;
    }
    return mask;
  }

  function dialogue(game) {
    const lcd = game.io[0x40], sx = game.io[0x43], sy = game.io[0x42];
    if (!(lcd & 128) || (lcd & 16) || (sx & 7) || (sy & 7)) return null;
    const base = lcd & 8 ? 0x1c00 : 0x1800;
    const tile = (x, y) => game.vram[base + (((y * 8 + sy) & 255) >> 3) * 32 + (((x * 8 + sx) & 255) >> 3)];
    if (tile(0, 12) !== 121 || tile(19, 12) !== 123
      || tile(0, 17) !== 125 || tile(19, 17) !== 126) return null;
    for (let x = 1; x < 19; x++) {
      if (tile(x, 12) !== 122 || tile(x, 17) !== 122) return null;
    }
    for (let y = 13; y < 17; y++) {
      if (tile(0, y) !== 124 || tile(19, y) !== 124) return null;
      for (let x = 1; x < 19; x++) if (tile(x, y) < 127) return null;
    }
    const mask = new Uint8Array(160 * 144);
    mask.fill(1, 160 * 96);
    return mask;
  }

  function terrain(game, overlay = null) {
    const flat = reason => ({ active: false, reason, depths: new Float32Array(1024), coverage: 0 });
    if (!(game.io[0x40] & 128)) return flat("LCD éteint");
    if (game.io[0x40] & 16) return flat("mode graphique hors carte · vue originale");
    // Crystal UE 1.1: physical WRAM bank 1, independent of the CPU's current SVBK/DMA bus.
    const ram = game.wram, rom = game.cartridge.rom;
    const word = offset => ram[offset] | (ram[offset + 1] << 8);
    const anchor = word(0x1194), width = ram[0x119f], height = ram[0x119e], border = ram[0x119d];
    const tileset = ram[0x1199], environment = ram[0x119a];
    const romOffset = (bank, address, size) => bank > 0 && address >= 0x4000 && address + size <= 0x8000
      && bank * 0x4000 + (address & 0x3fff) + size <= rom.length
      ? bank * 0x4000 + (address & 0x3fff) : -1;
    const blocks = romOffset(ram[0x11dc], word(0x11dd), 16);
    const collisions = romOffset(ram[0x11df], word(0x11e0), 4);
    const start = anchor - 0xc000, stride = width + 6;
    if (tileset < 1 || tileset > 36 || environment < 1 || environment > 7
      || width < 1 || width > 100 || height < 1 || height > 100 || border >= 128
      || anchor < 0xc800 || start + 4 * stride + 5 >= 0x1000 || blocks < 0 || collisions < 0) {
      return flat("carte non reconnue · titre, combat ou transition");
    }
    const ids = new Set([border]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) {
      const block = ram[start + y * stride + x] || border;
      if (block >= 128) return flat("format de carte non pris en charge");
      ids.add(block);
    }
    const count = Math.max(...ids) + 1;
    if (romOffset(ram[0x11dc], word(0x11dd), count * 16) < 0
      || romOffset(ram[0x11df], word(0x11e0), count * 4) < 0) return flat("tables de carte hors limites");
    const definitions = new Map();
    for (const block of ids) for (let quadrant = 0; quadrant < 4; quadrant++) {
      const index = blocks + block * 16 + (quadrant >> 1) * 8 + (quadrant & 1) * 2;
      const key = [0, 1, 4, 5].map(offset => rom[index + offset]).join(",");
      const depth = collisionHeight(rom[collisions + block * 4 + quadrant]);
      // Identical graphics with conflicting collisions stay at the lowest known height.
      const hidden = block === border && [0, 1, 4, 5].every(offset => rom[index + offset] === rom[index]);
      const previous = definitions.get(key);
      definitions.set(key, { depth: previous ? Math.min(previous.depth, depth) : depth,
        hidden: previous ? previous.hidden && hidden : hidden });
    }
    const map = game.io[0x40] & 8 ? 0x1c00 : 0x1800;
    const depths = new Float32Array(1024), recognized = new Uint8Array(1024), hidden = new Uint8Array(1024);
    for (let y = 0; y < 32; y += 2) for (let x = 0; x < 32; x += 2) {
      const index = map + y * 32 + x;
      const key = [0, 1, 32, 33].map(offset => {
        const tile = game.vram[index + offset], attr = game.vram[8192 + index + offset];
        return tile & 128 ? -1 : tile | (attr & 8 ? 128 : 0);
      }).join(",");
      if (!definitions.has(key)) continue;
      for (const offset of [0, 1, 32, 33]) {
        depths[y * 32 + x + offset] = definitions.get(key).depth;
        hidden[y * 32 + x + offset] = Number(definitions.get(key).hidden);
        recognized[y * 32 + x + offset] = 1;
      }
    }
    let matched = 0, total = 0;
    const sx = game.io[0x43], sy = game.io[0x42];
    for (let y = -(sy & 7); y < 144; y += 8) for (let x = -(sx & 7); x < 160; x += 8) {
      let area = (Math.min(160, x + 8) - Math.max(0, x)) * (Math.min(144, y + 8) - Math.max(0, y));
      if (overlay) {
        for (let py = Math.max(0, y); py < Math.min(144, y + 8); py++) {
          for (let px = Math.max(0, x); px < Math.min(160, x + 8); px++) area -= overlay[py * 160 + px];
        }
      }
      const index = (((y + sy) & 255) >> 3) * 32 + (((x + sx) & 255) >> 3);
      matched += area * recognized[index]; total += area;
    }
    const coverage = total ? matched / total : 0;
    if (coverage < 0.85) return { ...flat("menu, combat ou carte non reconnue · vue originale"), coverage };
    return { active: true, depths, hidden, coverage, reason: "relief des collisions · personnages redressés" };
  }

  function genericWorld(game, overlay, bgAnchor) {
    const ram = game.wram, rom = game.cartridge.rom, stride = ram[0x119f] + 6;
    const anchor = (ram[0x1194] | ram[0x1195] << 8) - 0xc000;
    const offset = (bank, pointer) => bank * 0x4000 + (pointer & 0x3fff);
    const definitions = offset(ram[0x11dc], ram[0x11dd] | ram[0x11de] << 8);
    const collisions = offset(ram[0x11df], ram[0x11e0] | ram[0x11e1] << 8);
    const tiles = new Uint16Array(24 * 20), surfaces = [], palettes = new Uint8Array(256);
    const votes = Array.from({ length: 256 }, () => new Uint16Array(8));
    const base = game.io[0x40] & 8 ? 0x1c00 : 0x1800;
    for (let i = 0; i < 1024; i++) {
      const tile = game.vram[base + i], attr = game.vram[8192 + base + i];
      if (tile < 128) votes[tile | (attr & 8 ? 128 : 0)][attr & 7]++;
    }
    votes.forEach((counts, tile) => {
      for (let palette = 1; palette < 8; palette++) {
        if (counts[palette] > counts[palettes[tile]]) palettes[tile] = palette;
      }
    });
    for (let by = 0; by < 5; by++) for (let bx = 0; bx < 6; bx++) {
      const block = ram[anchor + by * stride + bx] || ram[0x119d];
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        const tile = rom[definitions + block * 16 + ty * 4 + tx];
        tiles[(by * 4 + ty) * 24 + bx * 4 + tx] = tile | palettes[tile] << 8;
      }
      for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
        const index = definitions + block * 16 + qy * 8 + qx * 2;
        const hidden = block === ram[0x119d] && [0, 1, 4, 5].every(i => rom[index + i] === rom[index]);
        if (!hidden) surfaces.push({ x: bx * 32 + qx * 16, y: by * 32 + qy * 16,
          depth: collisionHeight(rom[collisions + block * 4 + qy * 2 + qx]) });
      }
    }
    const environments = ["", "ville", "route", "intérieur", "grotte", "environnement spécial", "passage", "donjon"];
    const delta = (scroll, target) => ((scroll - target + 128) & 255) - 128;
    return { active: true, generic: true, width: 6, height: 5, tiles, surfaces, overlay,
      name: `3D générique · ${environments[ram[0x119a]]} · carte ${ram[0x1cb5]}/${ram[0x1cb6]}`,
      zoomFactor: 0.9, pitchOffset: 25,
      clearColor: [1, 2, 5].includes(ram[0x119a]) ? [0.66, 0.79, 0.67, 1] : [0.06, 0.07, 0.08, 1],
      originX: ram[0x1197] * 16 + delta(game.io[0x43], (bgAnchor & 31) * 8),
      originY: ram[0x1196] * 16 + delta(game.io[0x42], ((bgAnchor - 0x9800) >> 5) * 8) };
  }

  function world(game) {
    const menu = startMenu(game), overlay = menu || dialogue(game);
    const overlayLabel = menu ? "menu Start" : "dialogue";
    const map = terrain(game, overlay);
    if (!map.active) return { active: false, reason: map.reason };
    const ram = game.wram;
    const bgAnchor = ram[0x1152] | ram[0x1153] << 8;
    if (bgAnchor < 0x9800 || bgAnchor >= 0x9c00) {
      return { active: false, reason: "3D : ancrage graphique invalide · relief 2.5D conservé" };
    }
    if (ram[0x1cb5] !== 24 || ram[0x1cb6] !== 4 || ram[0x1199] !== 1
      || ram[0x119f] !== 10 || ram[0x119e] !== 9) return { ...genericWorld(game, overlay, bgAnchor), overlayLabel };
    const stride = 16, anchor = (ram[0x1194] | ram[0x1195] << 8) - 0xc800;
    const blocks = new Uint8Array(90);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 10; x++) {
      blocks[y * 10 + x] = ram[0x800 + (y + 3) * stride + x + 3];
    }
    const known = new Set([1, 2, 4, 5, 20, 21, 22, 24, 25, 28, 30, 31, 69, 71, 84, 88, 98, 101, 119]);
    if (blocks.some(block => !known.has(block))) {
      return { ...genericWorld(game, overlay, bgAnchor), overlayLabel };
    }
    const ground = [], objects = [];
    for (let by = 0; by < 9; by++) for (let bx = 0; bx < 10; bx++) {
      const id = blocks[by * 10 + bx], x = bx * 32, y = by * 32;
      ground.push([84, 88].includes(id) ? { material: 2, shore: 3, shoreWidth: 8 }
        : { material: [1, 4, 5, 69, 98, 101].includes(id) ? 0 : 1 });
      if (id === 5) objects.push({ type: "tree", x, y: y + 8 }, { type: "tree", x: x + 16, y: y + 8 });
      if (id === 98) objects.push({ type: "tree", x: x + 16, y, tall: false },
        { type: "tree", x: x + 16, y: y + 16, tall: false });
      if (id === 101) objects.push({ type: "tree", x, y: y + 16, tall: false },
        { type: "tree", x: x + 16, y: y + 16, tall: false });
      if (id === 71) objects.push({ type: "sign", x: x + 16, y: y + 16 });
      if (id === 69) objects.push({ type: "sign", x, y });
      if (id === 24) objects.push({ type: "house", x, y: y + 14,
        width: blocks[by * 10 + bx + 1] === 31 ? 96 : 64, depth: 48, doorOffset: -8 });
      if (id === 20) objects.push({ type: "house", x, y: y + 10, width: 64, depth: 22, doorOffset: -8 });
    }
    // The block anchor targets the next cell before SCX/SCY finish moving to it.
    const delta = (scroll, target) => ((scroll - target + 128) & 255) - 128;
    return { active: true, name: "Bourg Geon / New Bark Town", width: 10, height: 9, blocks, ground, objects, overlay, overlayLabel,
      originX: ((anchor % stride) - 3) * 32 + ram[0x1197] * 16 + delta(game.io[0x43], (bgAnchor & 31) * 8),
      originY: (Math.floor(anchor / stride) - 3) * 32 + ram[0x1196] * 16
        + delta(game.io[0x42], ((bgAnchor - 0x9800) >> 5) * 8) };
  }

  const preset = {
    id: "pokemon-crystal-ue-1-1",
    name: "Pokémon Cristal UE 1.1 · relief de carte",
    label: "Pokémon Cristal",
    match: { title: "PM_CRYSTAL", color: true, cartridgeType: 0x10, revision: 1 },
    camera: { yaw: 0, pitch: -20, zoom: 0.83 },
    backgroundDepth: 0, spriteDepth: 1, thickness: 14, light: 0.73,
    tileDepths: {}, terrain, raisedSprites: true, world,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = preset;
  else {
    root.PocketPresets = root.PocketPresets || [];
    root.PocketPresets.push(preset);
  }
})(globalThis);
