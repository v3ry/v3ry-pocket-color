(function (root) {
  "use strict";

  // French Red revision 0: physical WRAM offsets, verified in the running cartridge.
  const RAM = { map: 0x1363, anchor: 0x1364, tileset: 0x136c, height: 0x136d, width: 0x136e,
    bank: 0x1530, definitions: 0x1531, collision: 0x1535, bgAnchor: 0x152b, blocks: 0x6e8, battle: 0x105c };
  const word = (data, offset) => data[offset] | data[offset + 1] << 8;
  const screenMap = game => !!(game.io[0x40] & 32) && game.io[0x4a] === 0 && game.io[0x4b] === 7;
  const locations = {
    0: { name: "Bourg Palette", width: 10, height: 9, tileset: 0 },
    12: { name: "Route 1", width: 10, height: 18, tileset: 0 },
    37: { name: "Maison du joueur · rez-de-chaussée", width: 4, height: 4, tileset: 1 },
    38: { name: "Maison du joueur · chambre", width: 4, height: 4, tileset: 4 },
    39: { name: "Maison du rival", width: 4, height: 4, tileset: 8 },
    40: { name: "Laboratoire du Professeur Chen", width: 5, height: 6, tileset: 5 },
  };
  const environments = [
    "villes et routes", "maison", "boutique", "forêt", "chambre", "dojo",
    "Centre Pokémon", "arène", "maison", "poste forestier", "musée", "souterrain",
    "poste de passage", "bateau", "port", "cimetière", "immeuble", "grotte",
    "hall", "manoir", "laboratoire", "club", "installation", "Plateau Indigo",
  ];
  const namedRegions = {
    1: { name: "Jadielle", width: 20, height: 18, tileset: 0 },
    41: { name: "Jadielle · Centre Pokémon", width: 7, height: 4, tileset: 6 },
    42: { name: "Jadielle · boutique", width: 4, height: 4, tileset: 2 },
    43: { name: "Jadielle · école", width: 4, height: 4, tileset: 8 },
    44: { name: "Jadielle · maison", width: 4, height: 4, tileset: 8 },
    45: { name: "Jadielle · arène", width: 10, height: 9, tileset: 7 },
    51: { name: "Forêt de Jade", width: 17, height: 24, tileset: 3 },
  };
  const decor = [
    [[0], "42,43,58,59", "tree"],
    [[0], "64,65,80,81", "tree"],
    [[0], "70,71,86,87", "sign"],
    [[0], "14,14,85,85", "fence"],
    [[0], "45,46,61,62", "shrub"],
    [[3], "4,5,35,21", "tree"],
    [[3], "6,7,22,23", "tree"],
    [[3], "2,3,18,19", "stump"],
    [[3], "84,85,86,87", "rock"],
    [[3], "33,34,49,50", "sign"],
    [[3], "62,62,62,62", "rock"],
    [[3], "47,47,47,47", "fence"],
    [[23], "42,43,34,29", "tree"],
    [[23], "16,18,40,41", "rock"],
    [[23], "21,22,48,49", "rock"],
    [[23], "46,47,46,47", "panel"],
    [[17], "2,3,18,19", "rock"],
    [[17], "12,13,28,29", "rock"],
    [[17], "14,15,30,31", "ladder"],
    [[15, 22], "5,6,21,22", "grave"],
    [[15], "17,17,17,17", "panel"],
    [[15, 22], "9,10,25,26", "panel"],
    [[22], "43,44,43,44", "panel"],
    [[22], "51,51,51,51", "panel"],
    [[22], "42,42,58,58", "panel"],
    [[22], "74,75,76,77", "panel"],
    [[22], "42,42,13,14", "panel"],
    [[22], "87,87,89,89", "panel"],
    [[22], "42,46,58,60", "panel"],
    [[22], "83,84,54,38", "rock"],
    [[22], "7,15,23,31", "plant"],
    [[22], "45,42,59,58", "panel"],
    [[22], "42,46,43,44", "panel"],
    [[22], "13,2,29,53", "panel"],
    [[22], "2,14,53,30", "panel"],
    [[22], "45,42,43,44", "panel"],
    [[22], "29,53,29,53", "panel"],
    [[22], "53,30,53,30", "panel"],
    [[22], "45,46,43,44", "panel"],
    [[22], "29,53,68,69", "panel"],
    [[22], "53,30,69,68", "panel"],
    [[22], "43,44,59,60", "panel"],
    [[1, 4], "8,9,24,25", "plant"],
    [[1, 4], "14,15,30,31", "tv"],
    [[1, 4], "34,35,50,51", "table"],
    [[1, 4], "36,37,52,53", "table"],
    [[1, 4], "6,7,22,23", "shelf"],
    [[8], "10,11,8,9", "plant"],
    [[8], "26,27,24,25", "plant"],
    [[8], "14,15,30,31", "shelf"],
    [[8], "36,36,52,52", "table"],
    [[8], "64,65,32,33", "tv"],
    [[8], "0,0,0,0", "panel"],
    [[8], "72,73,88,89", "panel"],
    [[8], "73,75,90,91", "panel"],
    [[8], "38,41,48,49", "merchandise"],
    [[8], "48,49,30,31", "merchandise"],
    [[8], "38,41,14,15", "merchandise"],
    [[8], "45,46,61,62", "panel"],
    [[2, 6], "4,5,20,21", "counter"],
    [[2, 6], "32,33,48,49", "plant"],
    [[2, 6], "34,35,50,51", "plant"],
    [[2, 6], "14,15,30,31", "pc"],
    [[2, 6], "36,37,52,53", "stairs"],
    [[2, 6], "64,65,80,81", "merchandise"],
    [[2, 6], "65,67,81,83", "merchandise"],
    [[2, 6], "68,69,84,85", "merchandise"],
    [[2, 6], "69,71,85,87", "merchandise"],
    [[2, 6], "90,91,44,45", "display"],
    [[2, 6], "90,91,20,40", "display"],
    [[2, 6], "90,91,40,40", "display"],
    [[2, 6], "90,91,25,24", "display"],
    [[2, 6], "46,47,62,63", "display"],
    [[2, 6], "40,40,78,79", "display"],
    [[2, 6], "76,77,23,29", "display"],
    [[2, 6], "40,40,40,40", "panel"],
    [[2, 6], "16,41,16,41", "panel"],
    [[2, 6], "40,2,40,18", "panel"],
    [[2, 6], "3,40,19,40", "panel"],
    [[2, 6], "40,89,16,41", "panel"],
    [[2, 6], "16,41,25,24", "counter"],
    [[2, 6], "56,8,24,25", "counter"],
    [[2, 6], "56,8,25,24", "counter"],
    [[2, 6], "8,8,24,25", "counter"],
    [[2, 6], "8,10,24,25", "counter"],
    [[2, 6], "66,70,82,86", "machine"],
    [[2, 6], "38,39,42,43", "stairs"],
    [[5, 7], "7,8,23,24", "plant"],
    [[5, 7], "2,56,18,19", "statue"],
    [[5, 7], "32,33,48,49", "shelf"],
    [[5, 7], "36,39,37,53", "panel"],
    [[5, 7], "5,5,16,16", "panel"],
    [[5, 7], "37,53,37,53", "panel"],
    [[5, 7], "37,53,66,62", "panel"],
    [[5, 7], "38,39,16,62", "panel"],
    [[5, 7], "36,38,37,53", "panel"],
    [[5, 7], "36,38,66,16", "panel"],
    [[5, 7], "38,39,37,53", "panel"],
    [[5, 7], "37,15,66,16", "panel"],
    [[5, 7], "36,38,37,15", "panel"],
    [[5, 7], "38,39,15,53", "panel"],
    [[5, 7], "37,15,37,15", "panel"],
    [[5, 7], "15,53,15,53", "panel"],
    [[5, 7], "15,53,16,62", "panel"],
    [[7], "34,35,50,51", "lectern"],
    [[9, 10, 12], "5,6,21,22", "plant"],
    [[9, 10, 12], "37,38,53,54", "plant"],
    [[9, 10, 12], "7,8,34,35", "shelf"],
    [[9, 10, 12], "34,35,34,35", "shelf"],
    [[9, 10, 12], "32,33,50,51", "counter"],
    [[11], "6,6,9,9", "stairs"],
    [[11], "5,6,8,9", "stairs"],
    [[11], "6,7,9,10", "stairs"],
    [[11], "2,2,16,16", "panel"],
    [[11], "16,22,16,22", "panel"],
    [[11], "23,16,23,16", "panel"],
    [[12], "23,24,23,24", "panel"],
    [[12], "0,0,0,0", "panel"],
    [[12], "9,9,50,51", "panel"],
    [[15, 22], "7,8,23,24", "shelf"],
    [[15], "55,63,61,62", "plant"],
    [[13], "2,3,18,19", "plant"],
    [[13], "9,10,25,26", "table"],
    [[13], "1,1,1,1", "panel"],
    [[13], "1,1,17,17", "panel"],
    [[13], "51,51,1,1", "panel"],
    [[13], "16,16,18,19", "panel"],
    [[13], "21,1,21,1", "panel"],
    [[13], "1,22,1,22", "panel"],
    [[13], "46,47,62,63", "panel"],
    [[14], "2,3,18,19", "barrel"],
    [[14], "4,5,0,21", "barrel"],
    [[14], "6,7,22,23", "barrel"],
    [[16], "11,12,27,28", "table"],
    [[16], "13,14,29,30", "table"],
    [[16], "89,90,89,90", "panel"],
    [[18], "2,3,18,19", "plant"],
    [[18], "36,37,52,53", "machine"],
    [[18], "1,1,1,1", "panel"],
    [[18], "1,1,33,33", "panel"],
    [[18], "54,57,54,57", "panel"],
    [[18], "39,39,21,21", "panel"],
    [[19], "8,9,24,25", "plant"],
    [[19], "36,37,64,65", "pillar"],
    [[19], "52,53,66,67", "pillar"],
    [[19], "74,75,74,75", "panel"],
    [[20], "2,3,18,19", "machine"],
    [[20], "4,5,20,21", "machine"],
    [[21], "11,12,27,28", "table"],
    [[21], "2,3,18,19", "shelf"],
  ];
  const cliffs = new Map([
    ["17,17,17,17", { depth: 24 }],
    ["36,36,36,36", { depth: 24, slope: "right" }],
    ["1,1,17,17", { depth: 24, slope: "up" }],
    ["2,57,36,2", { depth: 24, slope: "up-right" }],
  ]);
  const cavernRelief = new Map([
    ["0,0,0,0", { depth: 0 }],
    ["60,60,60,60", { depth: 0 }],
    ["49,49,49,49", { depth: 24 }],
    ["23,23,23,23", { depth: 24 }],
    ["4,41,49,5", { depth: 24, slope: "right" }],
    ["49,5,40,16", { depth: 24, slope: "right" }],
    ["49,5,49,5", { depth: 24, slope: "right" }],
    ["32,4,4,49", { depth: 24, slope: "up" }],
    ["49,40,40,16", { depth: 24, slope: "down" }],
    ["5,23,16,17", { depth: 24, slope: "left" }],
    ["7,32,23,7", { depth: 24, slope: "up" }],
    ["17,23,16,17", { depth: 24, slope: "left" }],
    ["5,5,16,16", { depth: 24, slope: "up" }],
    ["16,38,38,49", { depth: 24, slope: "up" }],
    ["37,16,23,37", { depth: 24, slope: "down" }],
    ["6,39,36,1", { depth: -2 }],
  ]);

  function interfaceMask(game) {
    const lcd = game.io[0x40], sx = screenMap(game) ? 0 : game.io[0x43], sy = screenMap(game) ? 0 : game.io[0x42];
    if ((sx & 7) || (sy & 7)) return null;
    const base = lcd & (screenMap(game) ? 0x40 : 8) ? 0x1c00 : 0x1800;
    const tile = (x, y) => game.vram[base + (((y * 8 + sy) & 255) >> 3) * 32 + (((x * 8 + sx) & 255) >> 3)];
    function frame(left, top, right, bottom) {
      if (tile(left, top) !== 0x79 || tile(right, top) !== 0x7b
        || tile(left, bottom) !== 0x7d || tile(right, bottom) !== 0x7e) return false;
      for (let x = left + 1; x < right; x++) {
        if (tile(x, top) !== 0x7a || tile(x, bottom) !== 0x7a) return false;
      }
      for (let y = top + 1; y < bottom; y++) {
        if (tile(left, y) !== 0x7c || tile(right, y) !== 0x7c) return false;
        for (let x = left + 1; x < right; x++) if (tile(x, y) < 0x7f) return false;
      }
      return true;
    }
    const mask = new Uint8Array(160 * 144);
    if (frame(0, 12, 19, 17)) {
      mask.fill(1, 160 * 96);
      return { mask, label: "dialogue" };
    }
    // Red's Start menu grows by two rows when the Pokédex is obtained.
    for (const bottom of [13, 15]) if (frame(10, 0, 19, bottom)) {
      for (let y = 0; y < (bottom + 1) * 8; y++) mask.fill(1, y * 160 + 80, (y + 1) * 160);
      return { mask, label: "menu Start" };
    }
    return null;
  }

  function mapData(game) {
    const ram = game.wram, rom = game.cartridge.rom;
    if (!(game.io[0x40] & 128) || (game.io[0x40] & 16) || !(game.io[0x40] & 1)) return null;
    const width = ram[RAM.width], height = ram[RAM.height], stride = width + 6;
    const anchor = word(ram, RAM.anchor) - 0xc000, bank = ram[RAM.bank];
    const pointer = word(ram, RAM.definitions), collision = word(ram, RAM.collision);
    const bgAnchor = word(ram, RAM.bgAnchor);
    if (ram[RAM.map] >= 248 || ram[RAM.tileset] >= 24 || !width || !height
      || stride * (height + 6) > 1300 || anchor < RAM.blocks
      || (anchor - RAM.blocks) % stride >= width + 3
      || Math.floor((anchor - RAM.blocks) / stride) >= height + 3
      || bank < 1 || bank * 16384 >= rom.length || pointer < 0x4000 || pointer >= 0x8000
      || collision < 1 || collision >= 0x4000 || bgAnchor < 0x9800 || bgAnchor >= 0x9c00) return null;
    const blocks = new Uint8Array(width * height), ids = new Set();
    for (let y = 0; y < height + 6; y++) for (let x = 0; x < stride; x++) {
      const id = ram[RAM.blocks + y * stride + x];
      ids.add(id);
      if (x >= 3 && x < width + 3 && y >= 3 && y < height + 3) blocks[(y - 3) * width + x - 3] = id;
    }
    if (pointer + (Math.max(...ids) + 1) * 16 > 0x8000
      || bank * 16384 + (pointer & 16383) + (Math.max(...ids) + 1) * 16 > rom.length) return null;
    const walkable = new Set();
    let end = collision;
    while (end < Math.min(collision + 128, 0x4000) && rom[end] !== 255) walkable.add(rom[end++]);
    if (rom[end] !== 255 || !walkable.size) return null;
    return { width, height, stride, anchor, bgAnchor, blocks, ids, walkable,
      definitions: bank * 16384 + (pointer & 16383), tileset: ram[RAM.tileset], map: ram[RAM.map] };
  }

  function terrain(game) {
    const flat = reason => ({ active: false, reason, depths: new Float32Array(1024), coverage: 0 });
    if ([1, 2].includes(game.wram[RAM.battle])) return flat("combat Rouge · disponible en mode 3D");
    const map = mapData(game);
    if (!map) return flat("carte Rouge non reconnue · titre, combat ou transition");
    const rom = game.cartridge.rom, definitions = new Map(), ui = interfaceMask(game);
    for (const id of map.ids) for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
      const offset = map.definitions + id * 16 + qy * 8 + qx * 2;
      const tiles = [0, 1, 4, 5].map(i => rom[offset + i]);
      const foot = tiles[2], depth = map.tileset === 0 && foot === 0x14 ? -2 : map.walkable.has(foot) ? 0 : 12;
      const key = tiles.join(","), old = definitions.get(key);
      definitions.set(key, { depth: old ? Math.min(old.depth, depth) : depth,
        hidden: tiles.every(tile => tile === 0x10) });
    }
    const base = game.io[0x40] & (screenMap(game) ? 0x40 : 8) ? 0x1c00 : 0x1800;
    const depths = new Float32Array(1024), hidden = new Uint8Array(1024), recognized = new Uint8Array(1024);
    for (let y = 0; y < 32; y += 2) for (let x = 0; x < 32; x += 2) {
      const cell = y * 32 + x;
      const match = definitions.get([0, 1, 32, 33].map(i => game.vram[base + cell + i]).join(","));
      if (match) for (const i of [0, 1, 32, 33]) {
        depths[cell + i] = match.depth; hidden[cell + i] = Number(match.hidden); recognized[cell + i] = 1;
      }
    }
    let total = 0, matched = 0;
    const sx = screenMap(game) ? 0 : game.io[0x43], sy = screenMap(game) ? 0 : game.io[0x42];
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) {
      if (ui?.mask[y * 160 + x]) continue;
      total++;
      matched += recognized[(((y + sy) & 255) >> 3) * 32 + (((x + sx) & 255) >> 3)];
    }
    const coverage = total ? matched / total : 0;
    if (coverage < 0.85) return { ...flat("menu, combat ou carte Rouge non reconnue · vue originale"), coverage };
    return { active: true, depths, hidden, coverage, screenMap: screenMap(game), overlay: ui?.mask, overlayLabel: ui?.label,
      reason: `relief de Rouge${ui ? ` · ${ui.label} en surimpression` : ""}` };
  }

  function furniture(kind, x, y, width = 16, depth = 16) {
    return { type: "furniture", kind, x, y, width, depth };
  }
  function cameraOrigin(game, map) {
    const anchor = map.anchor - RAM.blocks, delta = (scroll, target) => ((scroll - target + 128) & 255) - 128;
    return {
      originX: ((anchor % map.stride) - 3) * 32 + game.wram[0x1369] * 16
        + delta(game.io[0x43], (map.bgAnchor & 31) * 8),
      originY: (Math.floor(anchor / map.stride) - 3) * 32 + game.wram[0x1368] * 16
        + delta(game.io[0x42], ((map.bgAnchor - 0x9800) >> 5) * 8),
    };
  }
  function regionalWorld(game, map, surface) {
    const camera = cameraOrigin(game, map), bounded = map.width > 32 || map.height > 32;
    const width = bounded ? Math.min(12, map.width) : map.width;
    const height = bounded ? Math.min(12, map.height) : map.height;
    const startX = bounded ? Math.max(0, Math.min(map.width - width, Math.floor(camera.originX / 32) - 2)) : 0;
    const startY = bounded ? Math.max(0, Math.min(map.height - height, Math.floor(camera.originY / 32) - 2)) : 0;
    const columns = width * 4, rows = height * 4, tiles = new Uint16Array(columns * rows);
    const rom = game.cartridge.rom, objects = [], surfaces = [], facades = [];
    for (let by = 0; by < height; by++) for (let bx = 0; bx < width; bx++) {
      const id = map.blocks[(by + startY) * map.width + bx + startX], offset = map.definitions + id * 16;
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        tiles[(by * 4 + ty) * columns + bx * 4 + tx] = rom[offset + ty * 4 + tx];
      }
    }
    if (tiles.some(tile => tile >= 128)) return { active: false, reason: "3D Rouge : graphismes modifiés non pris en charge" };
    const outdoor = [0, 3, 23].includes(map.tileset), floor = outdoor ? (map.tileset === 0 ? 35 : map.tileset === 3 ? 48 : 44)
      : [...map.walkable][0];
    const recipes = new Map(decor.filter(([sets]) => sets.includes(map.tileset)).map(([, signature, kind]) => [signature, kind]));
    const occupied = new Uint8Array(tiles.length);
    if (map.tileset === 3) for (let y = 0; y + 1 < rows; y += 2) for (let x = 0; x + 3 < columns; x += 2) {
      if (tiles[y * columns + x] !== 36 || tiles[y * columns + x + 1] !== 37
        || tiles[y * columns + x + 2] !== 38 || tiles[y * columns + x + 3] !== 39
        || tiles[(y + 1) * columns + x] !== 0 || tiles[(y + 1) * columns + x + 1] !== 53
        || tiles[(y + 1) * columns + x + 2] !== 54 || tiles[(y + 1) * columns + x + 3] !== 48) continue;
      objects.push({ type: "tree", x: x * 8, y: y * 8, width: 32, depth: 16 });
      for (let dy = 0; dy < 2; dy++) {
        occupied.fill(1, (y + dy) * columns + x, (y + dy) * columns + x + 4);
        tiles.fill(floor, (y + dy) * columns + x, (y + dy) * columns + x + 4);
      }
    }
    if (map.tileset === 0) for (let y = 1; y < rows; y++) for (let x = 0; x < columns; x++) {
      const flatRoof = tiles[y * columns + x] === 76;
      if ((!flatRoof && tiles[y * columns + x] !== 5) || occupied[y * columns + x]) continue;
      let right = x + 1;
      while (right < Math.min(columns, x + 32) && [6, 7, 8, 83].includes(tiles[y * columns + right])) right++;
      if (right >= columns || tiles[y * columns + right] !== (flatRoof ? 77 : 9) || right - x < 3) continue;
      let bottom = y + 1, closed = false;
      for (; bottom < Math.min(rows, y + 12); bottom++) {
        const row = tiles.subarray(bottom * columns + x, bottom * columns + right + 1);
        if ([...row].every(tile => [26, 27, 28, 74, 78, 79].includes(tile))) { closed = true; break; }
        if ([...row].every(tile => [35, 44, 57].includes(tile))) break;
      }
      if (!closed) continue;
      const top = flatRoof ? y : y - 1;
      const px = x * 8, py = top * 8, w = (right - x + 1) * 8, d = (bottom - top + 1) * 8;
      const door = [...tiles.subarray(bottom * columns + x, bottom * columns + right + 1)].indexOf(27);
      objects.push({ type: "house", x: px, y: py, width: w, depth: d,
        doorOffset: door < 0 ? 0 : door * 8 + 8 - w / 2, ...(flatRoof ? { roof: "flat" } : {}) });
      facades.push({ x: px + 1, y: py + d - 1.8, width: w - 2, height: 22,
        sourceX: px, sourceY: (bottom - (flatRoof ? 3 : 1)) * 8, sourceWidth: w, sourceHeight: flatRoof ? 32 : 16 });
      if (flatRoof) facades.push({ roof: true, x: px, y: py, width: w, depth: d, height: 25,
        sourceX: px + 8, sourceY: y * 8 + 8, sourceWidth: w - 16, sourceHeight: 16 });
      for (let ty = top; ty <= bottom; ty++) occupied.fill(1, ty * columns + x, ty * columns + right + 1);
    }
    if ([2, 6, 8].includes(map.tileset)) for (let y = 0; y + 3 < rows; y += 2) for (let x = 0; x + 3 < columns; x += 2) {
      const codes = [];
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) codes.push(tiles[(y + dy) * columns + x + dx]);
      const signature = codes.join(",");
      const healing = [2, 6].includes(map.tileset) && [
        "40,58,59,40,40,74,75,40,72,76,77,73,72,6,22,73",
        "40,58,59,40,40,74,75,40,72,76,77,7,72,6,22,13",
      ].includes(signature);
      const desk = map.tileset === 8 && [
        "38,39,39,41,70,71,47,57,86,87,47,57,60,58,58,59",
        "38,39,39,41,54,47,47,57,54,47,47,57,60,58,58,59",
      ].includes(signature);
      if (!healing && !desk) continue;
      objects.push(furniture(healing ? "healing" : "desk", x * 8, y * 8, 32, 32));
      facades.push(desk
        ? { roof: true, x: x * 8, y: y * 8, width: 32, depth: 32, height: 14,
          sourceX: x * 8, sourceY: y * 8, sourceWidth: 32, sourceHeight: 32 }
        : { x: x * 8 + 0.5, y: y * 8 + 30.2, width: 31, height: 27,
          sourceX: x * 8, sourceY: y * 8, sourceWidth: 32, sourceHeight: 32 });
      for (let dy = 0; dy < 4; dy++) occupied.fill(1, (y + dy) * columns + x, (y + dy) * columns + x + 4);
    }
    for (let y = 0; y < rows; y += 2) for (let x = 0; x < columns; x += 2) {
      const cell = y * columns + x, indices = [cell, cell + 1, cell + columns, cell + columns + 1];
      const codes = indices.map(i => tiles[i]), foot = codes[2], px = x * 8, py = y * 8;
      if (codes.every(tile => tile === 16)) continue;
      const covered = indices.some(i => occupied[i]);
      const signature = codes.join(","), kind = covered ? null : recipes.get(signature);
      const cliff = covered ? null : map.tileset === 0 ? cliffs.get(signature)
        : map.tileset === 17 ? cavernRelief.get(signature) : null;
      const direction = map.tileset === 0 ? [0x36, 0x37].includes(foot) ? "down"
        : foot === 0x27 ? "left" : [0x0d, 0x1d].includes(foot) ? "right" : null : null;
      let depth = covered ? 0 : [0, 3, 7, 14, 17, 22, 23].includes(map.tileset) && codes.includes(0x14) ? -2
        : map.walkable.has(foot) ? 0 : 12;
      if (kind || (direction && !covered)) {
        objects.push(direction ? { type: "ledge", x: px, y: py, direction }
          : ["tree", "sign", "rock", "grave", "barrel", "pillar", "fence", "statue", "shrub", "stump"].includes(kind)
            ? { type: kind, x: px, y: py } : furniture(kind, px, py));
        const textured = ["merchandise", "display", "panel", "lectern"].includes(kind);
        if (textured) facades.push({ x: px + 0.5, y: py + 14.2, width: 15, height: 23,
          sourceX: px, sourceY: py, sourceWidth: 16, sourceHeight: 16 });
        if (!textured) for (const i of indices) tiles[i] = floor;
        depth = 0;
      }
      surfaces.push(cliff ? { x: px, y: py, ...cliff, sculpted: false }
        : { x: px, y: py, depth, sculpted: depth > 0 });
    }
    if (outdoor) for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const tile = tiles[y * columns + x];
      if (tile === (map.tileset === 0 ? 82 : map.tileset === 3 ? 32 : 69)) {
        objects.push({ type: "grass", x: x * 8, y: y * 8 });
      } else if (map.tileset === 0 && tile === 3) objects.push({ type: "flower", x: x * 8, y: y * 8 });
    }
    const named = namedRegions[map.map];
    const name = named && named.width === map.width && named.height === map.height && named.tileset === map.tileset
      ? named.name : `Rouge · ${environments[map.tileset]} · carte ${map.map}`;
    return { active: true, procedural: true, bounded, name,
      width, height, tileColumns: columns, tileRows: rows, tiles, surfaces, objects, facades, monochrome: true, texturedGround: true,
      spriteSurfaces: objects.filter(object => object.type === "furniture" && ["table", "desk", "counter", "chair"].includes(object.kind))
        .map(object => ({ x: object.x, y: object.y, width: object.width, depth: object.depth,
          height: object.kind === "chair" ? 8 : object.kind === "counter" ? 12 : 14 })),
      screenMap: surface.screenMap, overlay: surface.overlay, overlayLabel: surface.overlayLabel,
      originX: camera.originX - startX * 32, originY: camera.originY - startY * 32,
      regionX: startX * 32, regionY: startY * 32,
      zoomFactor: outdoor ? 0.7 : 1, pitchOffset: outdoor ? 35 : 25,
      clearColor: outdoor ? [0.64, 0.73, 0.44, 1] : [0.06, 0.09, 0.07, 1] };
  }
  function battle(game) {
    const flat = () => ({ active: false, battle: true, reason: "combat Rouge · sous-menu ou transition non reconnu" });
    const lcd = game.io[0x40], fullWindow = screenMap(game);
    if (!(lcd & 128) || !(lcd & 1)) return flat();
    function tileAt(x, y) {
      const window = !!(lcd & 32) && y >= game.io[0x4a] && x >= game.io[0x4b] - 7;
      const tx = window ? x - (game.io[0x4b] - 7) : (x + game.io[0x43]) & 255;
      const ty = window ? y - game.io[0x4a] : (y + game.io[0x42]) & 255;
      const base = lcd & (window ? 64 : 8) ? 0x1c00 : 0x1800;
      return { tile: game.vram[base + (ty >> 3) * 32 + (tx >> 3)], x: tx & 7, y: ty & 7 };
    }
    const tile = (x, y) => tileAt(x * 8, y * 8).tile;
    const moveInfo = tile(0, 8) === 0x79 && tile(10, 8) === 0x7b
      && tile(0, 12) === 0x7d && tile(10, 12) === 0x7e;
    if ((!moveInfo && tile(0, 12) !== 0x79) || tile(19, 12) !== 0x7b
      || tile(0, 17) !== 0x7d || tile(19, 17) !== 0x7e) return flat();
    let pictureTiles = 0;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      pictureTiles += Number(tile(12 + x, y) === x * 7 + y);
      pictureTiles += Number(tile(1 + x, 5 + y) === 49 + x * 7 + y);
    }
    const enemyHUD = tile(1, 3) === 0x74 && tile(10, 3) === 0x78;
    const playerHUD = tile(9, 11) === 0x6f && tile(18, 11) === 0x77;
    if (pictureTiles < 14 && !enemyHUD && !playerHUD) return flat();

    const count = 160 * 96, ink = new Uint8Array(count), allocated = new Uint8Array(count);
    const pictures = new Uint8Array(160 * 144), overlay = new Uint8Array(160 * 144);
    const pictureColors = moveInfo ? new Int8Array(160 * 144).fill(-1) : null;
    overlay.fill(1, count);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 160; x++) {
      const i = y * 160 + x, occluded = moveInfo && x >= 8 && x < 64 && y >= 64;
      const data = occluded ? { tile: 49 + ((x - 8) >> 3) * 7 + ((y - 40) >> 3), x: x & 7, y: y & 7 } : tileAt(x, y);
      if ((y < 32 && x < 96) || (y >= 56 && x >= 72)
        || (moveInfo && y >= 64 && x < 88) || (data.tile >= 98 && data.tile !== 0x7f)) {
        overlay[i] = 1;
        if (!occluded) continue;
      }
      const role = data.tile < 49 ? 1 : data.tile < 98 ? 2 : 0;
      allocated[i] = role;
      if (role) {
        const color = game.tilePixel(data.tile, 0, data.x, data.y, !!(lcd & 16));
        if (color) ink[i] = role;
        if (occluded) pictureColors[i] = color;
      }
    }
    // Flood only exterior colour-zero pixels; enclosed white details stay solid, even during palette flashes.
    for (const role of [1, 2]) {
      const exterior = new Uint8Array(count), queue = new Int32Array(count);
      let end = 0;
      function visit(i) {
        if (exterior[i] || ink[i] === role) return;
        exterior[i] = 1; queue[end++] = i;
      }
      for (let x = 0; x < 160; x++) { visit(x); visit(count - 160 + x); }
      for (let y = 0; y < 96; y++) { visit(y * 160); visit(y * 160 + 159); }
      for (let n = 0; n < end; n++) {
        const i = queue[n], x = i % 160;
        if (x) visit(i - 1);
        if (x < 159) visit(i + 1);
        if (i >= 160) visit(i - 160);
        if (i < count - 160) visit(i + 160);
      }
      for (let i = 0; i < count; i++) {
        if (ink[i] === role || (allocated[i] === role && !exterior[i])) pictures[i] = role;
      }
    }
    return { active: true, battle: true, name: game.wram[RAM.battle] === 2 ? "Combat de dresseur" : "Combat sauvage",
      screenMap: fullWindow, pictures, pictureColors, overlay,
      combatants: [
        { id: 1, sourceX: 124, sourceBottom: 56, x: 128, y: 34, size: 1.1 },
        { id: 2, sourceX: 36, sourceBottom: 96, x: 36, y: 100, size: 1.15 },
      ], zoomFactor: 1, pitchOffset: 30 };
  }
  function world(game) {
    // The FR ROM writes 2/1 to $D05C at ROM offsets $3EF98/$3EFA0 for trainer/wild battles.
    if ([1, 2].includes(game.wram[RAM.battle])) return battle(game);
    const surface = terrain(game);
    if (!surface.active) return { active: false, reason: surface.reason };
    const map = mapData(game), location = locations[map.map];
    if (!location) return regionalWorld(game, map, surface);
    if (location.width !== map.width || location.height !== map.height || location.tileset !== map.tileset) {
      return { active: false, reason: "3D Rouge : lieu non modélisé · relief 2.5D conservé" };
    }
    const rom = game.cartridge.rom, columns = map.width * 4, rows = map.height * 4;
    const tiles = new Uint16Array(columns * rows), objects = [];
    for (let by = 0; by < map.height; by++) for (let bx = 0; bx < map.width; bx++) {
      const id = map.blocks[by * map.width + bx];
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        tiles[(by * 4 + ty) * columns + bx * 4 + tx] = rom[map.definitions + id * 16 + ty * 4 + tx];
      }
    }
    const replace = (x, y, w, h, tile) => {
      for (let ty = y / 8; ty < (y + h) / 8; ty++) for (let tx = x / 8; tx < (x + w) / 8; tx++) {
        if (tx >= 0 && tx < columns && ty >= 0 && ty < rows) tiles[ty * columns + tx] = tile;
      }
    };
    const add = (kind, x, y, w = 16, d = 16, floor = 1) => {
      objects.push(furniture(kind, x, y, w, d)); replace(x, y, w, d, floor);
    };
    const outdoor = map.tileset === 0;
    if (outdoor) {
      for (const [x, y, w, d] of map.map === 0 ? [[64, 32, 64, 64], [192, 32, 64, 64], [160, 128, 96, 64]] : []) {
        objects.push({ type: "house", x, y: y + 8, width: w, depth: d - 8, doorOffset: -8 });
        replace(x, y, w, d, 35);
      }
      for (const [x, y] of map.map === 0 ? [[48, 80], [176, 80], [112, 144], [208, 208]] : [[144, 432]]) {
        objects.push({ type: "sign", x, y }); replace(x, y, 16, 16, 35);
      }
      // The surrounding forest and fences follow the active tile map, including connected edges.
      for (let y = 0; y < rows; y += 2) for (let x = 0; x < columns; x += 2) {
        const cell = y * columns + x;
        if (tiles[cell] === 42 && tiles[cell + 1] === 43
          && tiles[cell + columns] === 58 && tiles[cell + columns + 1] === 59) {
          objects.push({ type: "tree", x: x * 8, y: y * 8 });
          replace(x * 8, y * 8, 16, 16, 35);
        } else if (tiles[cell] === 14 && tiles[cell + 1] === 14
          && tiles[cell + columns] === 85 && tiles[cell + columns + 1] === 85) {
          objects.push({ type: "fence", x: x * 8, y: y * 8 });
          replace(x * 8, y * 8, 16, 16, 35);
        }
      }
      if (map.map === 12) {
        for (let y = 0; y < rows; y += 2) for (let x = 0; x < columns; x += 2) {
          const foot = tiles[(y + 1) * columns + x];
          const direction = [0x36, 0x37].includes(foot) ? "down"
            : foot === 0x27 ? "left" : [0x0d, 0x1d].includes(foot) ? "right" : null;
          if (direction) {
            objects.push({ type: "ledge", x: x * 8, y: y * 8, direction });
            replace(x * 8, y * 8, 16, 16, 44);
          }
        }
        for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
          const tile = tiles[y * columns + x];
          if (tile === 0x52 || tile === 3) {
            objects.push({ type: tile === 0x52 ? "grass" : "flower", x: x * 8, y: y * 8 });
          }
        }
      }
    } else {
      const floor = map.map === 40 ? 17 : 1;
      if (map.map === 38) {
        add("shelf", 0, 0, 16, 32); add("bed", 0, 96, 16, 32);
        add("tv", 48, 64); add("console", 48, 80, 16, 8);
        add("desk", 16, 16, 32, 16); add("pc", 16, 16);
        add("plant", 96, 112); add("stairs", 112, 16);
      } else if (map.map === 37 || map.map === 39) {
        const tableY = map.map === 37 ? 64 : 48;
        add("shelf", 0, 0, 32, 32); add("table", 48, tableY, 32, 32);
        for (const x of [32, 80]) for (const y of [tableY, tableY + 16]) add("chair", x, y);
        if (map.map === 37) { add("tv", 48, 16); add("stairs", 112, 16); }
        else {
          add("plant", 0, 96, 16, 32); add("plant", 112, 96, 16, 32);
          add("shelf", 112, 0, 16, 32); add("picture", 48, 0, 16, 16);
        }
      } else {
        add("machine", 0, 16, 32, 16, floor); add("table", 32, 16, 32, 16, floor);
        add("shelf", 64, 0, 32, 16, floor);
        add("table", 96, 48, 48, 24, floor);
        for (const [x, y, w] of [[96, 72, 48], [0, 32, 64]]) add("counter", x, y, w, 8, floor);
        for (const [x, y] of [[96, 0], [128, 0], [0, 96], [32, 96], [96, 96], [128, 96]]) {
          add("shelf", x, y, 32, 32, floor);
        }
      }
      objects.push(furniture("wall", 0, 0, map.width * 32, 8));
    }
    if (tiles.some(tile => tile >= 128)) return { active: false, reason: "3D Rouge : graphismes modifiés non pris en charge" };
    return { active: true, name: location.name, width: map.width, height: map.height, tiles, texturedGround: true,
      tileColumns: columns, tileRows: rows, objects, monochrome: true, screenMap: surface.screenMap,
      overlay: surface.overlay, overlayLabel: surface.overlayLabel,
      spriteSurfaces: objects.filter(object => ["table", "desk", "counter", "chair"].includes(object.kind))
        .map(object => ({ x: object.x, y: object.y, width: object.width, depth: object.depth,
          height: object.kind === "chair" ? 8 : object.kind === "counter" ? 12 : 14 })),
      zoomFactor: outdoor ? 0.7 : 1, pitchOffset: outdoor ? 35 : 25,
      clearColor: outdoor ? [0.64, 0.73, 0.44, 1] : [0.06, 0.09, 0.07, 1],
      ...cameraOrigin(game, map) };
  }

  const preset = { id: "pokemon-red-fr-0", name: "Pokémon Rouge français · Kanto", label: "Pokémon Rouge FR",
    match: { title: "POKEMON RED", color: false, cartridgeType: 0x1b, revision: 0, checksum: 0x7afc },
    camera: { yaw: 0, pitch: -20, zoom: 0.9 }, thickness: 14, light: 0.73,
    backgroundDepth: 0, spriteDepth: 1, tileDepths: {}, raisedSprites: true, terrain, world };
  if (typeof module !== "undefined" && module.exports) module.exports = preset;
  else { root.PocketPresets = root.PocketPresets || []; root.PocketPresets.push(preset); }
})(globalThis);
