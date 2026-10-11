(function (root) {
  "use strict";
  const Graphics = typeof module !== "undefined" && module.exports ? require("./graphics.js") : root.PocketGraphics;
  // Vertical sprite rows are foreshortened by the camera pitch (about 0.7 indoors); stretch them back.
  const CHARACTER_STATURE = 1.4, SHADOW_DEPTH = 0.35, SHADOW_TILE = (9 * 16 + 0.5) / 192;

  function materials() {
    const colors = [[94, 155, 54], [73, 120, 42], [129, 185, 68], [99, 72, 40],
      [233, 224, 162], [177, 157, 102], [44, 126, 69], [36, 76, 63],
      [78, 92, 80], [32, 55, 33], [89, 136, 171], [185, 211, 199]];
    const pixels = new Uint8ClampedArray(192 * 16 * 4);
    colors.forEach((color, slot) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const pattern = slot === 6 ? (y % 4 === 0 ? 0.72 : 1)
          : slot === 4 ? (y % 6 === 0 && x % 8 < 6 ? 0.92 : 1)
            : slot === 9 ? 1 : ((x * 7 + y * 11) % 13 < 3 ? 0.88 : 1);
        const offset = (y * 192 + slot * 16 + x) * 4;
        pixels.set(color.map(value => Math.round(value * pattern)), offset);
        pixels[offset + 3] = 255;
      }
    });
    return { width: 192, height: 16, pixels };
  }
  const atlas = materials();
  const monochromeAtlas = { ...atlas, pixels: atlas.pixels.slice() };
  for (let i = 0; i < monochromeAtlas.pixels.length; i += 4) {
    const light = (atlas.pixels[i] * 0.3 + atlas.pixels[i + 1] * 0.59 + atlas.pixels[i + 2] * 0.11) / 255;
    monochromeAtlas.pixels.set([30 + light * 185, 55 + light * 178, 40 + light * 135], i);
  }
  const geometryCache = new WeakMap();
  const battleCache = new WeakMap();

  function quad(output, points, uv, shade = 1) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z] = points[i];
      output.push(x - 80, 72 - y, z, ...uv[i], shade);
    }
  }
  function buildBattle(game, world, thickness) {
    const textures = Graphics.scene(game);
    if (world.screenMap) Graphics.mapWindow(game, textures);
    const overlay = world.overlay.slice();
    for (let i = 0; i < overlay.length; i++) if (textures.sprites.pixels[i * 4 + 3]) overlay[i] = 1;
    Graphics.overlay(game, textures, new Uint8Array(160 * 144).fill(1));
    const frame = textures.window.pixels;
    const pictures = { width: 160, height: 144, pixels: frame.slice() };
    const hud = { width: 160, height: 144, pixels: frame.slice() };
    const cached = battleCache.get(game), key = JSON.stringify([thickness, world.combatants]);
    const reusable = cached?.key === key && world.pictures.every((value, i) => value === cached.pictures[i]);
    const palette = game.io[0x47];
    let material = cached?.palette === palette ? cached.material : null;
    if (!material) {
      material = { width: 4, height: 1, pixels: new Uint8ClampedArray(16) };
      const view = Object.create(game);
      view.pixels = new Uint8ClampedArray(4); view.ly = 0;
      for (let color = 0; color < 4; color++) {
        view.paint(0, color, 0);
        material.pixels.set(view.pixels, color * 4);
      }
    }
    for (let i = 0; i < overlay.length; i++) {
      if (world.pictureColors?.[i] >= 0) {
        const offset = world.pictureColors[i] * 4;
        pictures.pixels.set(material.pixels.subarray(offset, offset + 4), i * 4);
      }
      if (!world.pictures[i]) pictures.pixels[i * 4 + 3] = 0;
      if (!overlay[i]) hud.pixels[i * 4 + 3] = 0;
    }
    let geometry = cached;
    if (!reusable) {
      const background = [], models = [], sprites = [], shadows = [];
      const base = thickness * 0.28, depth = thickness * 0.45;
      const uv = slot => Array.from({ length: 4 }, () => [(slot + 0.5) / 4, 0.5]);
      quad(background, [[-80, -80, -1], [240, -80, -1], [240, 240, -1], [-80, 240, -1]], uv(0));
      function ellipse(output, x, y, rx, ry, z, slot, shade = 1) {
        for (let i = 0; i < 32; i++) {
          const a = i * Math.PI / 16, b = (i + 1) * Math.PI / 16;
          quad(output, [[x, y, z], [x + Math.cos(a) * rx, y + Math.sin(a) * ry, z],
            [x + Math.cos(b) * rx, y + Math.sin(b) * ry, z], [x, y, z]], uv(slot), shade);
        }
      }
      const visible = [];
      for (const combatant of world.combatants) {
        const { id, x: cx, y: cy, sourceX, sourceBottom, size } = combatant;
        const rx = id === 1 ? 29 : 35, ry = id === 1 ? 15 : 18;
        for (let i = 0; i < 32; i++) {
          const a = i * Math.PI / 16, b = (i + 1) * Math.PI / 16;
          const x0 = cx + Math.cos(a) * rx, y0 = cy + Math.sin(a) * ry;
          const x1 = cx + Math.cos(b) * rx, y1 = cy + Math.sin(b) * ry;
          quad(models, [[x0, y0, 0], [x1, y1, 0], [x1, y1, base], [x0, y0, base]],
            uv(1), 0.65 + Math.sin(a) * 0.15);
        }
        ellipse(models, cx, cy, rx, ry, base, 1, 0.9);
        ellipse(models, cx, cy, rx - 2, ry - 2, base + 0.04, 0);
        if (!world.pictures.includes(id)) continue;
        visible.push(id);
        ellipse(shadows, cx, cy + 2, rx * 0.6, ry * 0.45, base + 0.08, 2, 0.85);
        const front = cy + depth / 2, back = cy - depth / 2;
        function edge(points, x, y, shade) {
          quad(sprites, points, Array.from({ length: 4 }, () => [(x + 0.5) / 160, (y + 0.5) / 144]), shade);
        }
        for (let y = 0; y < 96; y++) {
          const zTop = base + (sourceBottom - y) * size, zBottom = zTop - size;
          for (let x = 0; x < 160;) {
            if (world.pictures[y * 160 + x] !== id) { x++; continue; }
            const start = x;
            while (x < 160 && world.pictures[y * 160 + x] === id) x++;
            const left = cx + (start - sourceX) * size, right = cx + (x - sourceX) * size;
            const textureUV = [[start / 160, y / 144], [x / 160, y / 144],
              [x / 160, (y + 1) / 144], [start / 160, (y + 1) / 144]];
            quad(sprites, [[left, front, zTop], [right, front, zTop],
              [right, front, zBottom], [left, front, zBottom]], textureUV);
            if (depth) {
              quad(sprites, [[left, back, zTop], [right, back, zTop],
                [right, back, zBottom], [left, back, zBottom]], textureUV, 0.8);
              edge([[left, back, zBottom], [left, front, zBottom], [left, front, zTop], [left, back, zTop]], start, y, 0.6);
              edge([[right, front, zBottom], [right, back, zBottom], [right, back, zTop], [right, front, zTop]], x - 1, y, 0.8);
              for (let px = start; px < x; px++) {
                const x0 = cx + (px - sourceX) * size, x1 = x0 + size, i = y * 160 + px;
                if (!y || world.pictures[i - 160] !== id) {
                  edge([[x0, back, zTop], [x1, back, zTop], [x1, front, zTop], [x0, front, zTop]], px, y, 0.92);
                }
                if (y === 95 || world.pictures[i + 160] !== id) {
                  edge([[x0, front, zBottom], [x1, front, zBottom], [x1, back, zBottom], [x0, back, zBottom]], px, y, 0.65);
                }
              }
            }
          }
        }
      }
      geometry = { key, pictures: world.pictures.slice(), background: new Float32Array(background),
        models: new Float32Array(models), sprites: new Float32Array(sprites), shadows: new Float32Array(shadows),
        stats: { combatants: visible.length, platforms: world.combatants.length } };
    }
    battleCache.set(game, { ...geometry, palette, material });
    return { active: true, battle: true, textures: { background: material, sprites: pictures, window: hud },
      background: geometry.background, models: geometry.models, sprites: geometry.sprites, shadows: geometry.shadows,
      material, shadowMaterial: material, origin: [0, 0], zoomFactor: world.zoomFactor, pitchOffset: world.pitchOffset,
      clearColor: [...material.pixels.slice(0, 3)].map(value => value / 255).concat(1), stats: geometry.stats,
      detail: `${world.name} · arène 3D · ${geometry.stats.combatants} silhouettes en volume · interface originale` };
  }

  function build(game, preset, thickness) {
    if (!Number.isFinite(thickness) || thickness < 0 || thickness > 16) throw new Error("Epaisseur 3D invalide.");
    const world = preset.world?.(game);
    if (!world?.active) return { active: false, reason: world?.reason || "Aucun preset 3D pour ce jeu.",
      ...(world?.battle ? { battle: true } : {}) };
    if (world.battle) return buildBattle(game, world, thickness);
    const textures = Graphics.scene(game), models = [], background = [], sprites = [], shadows = [];
    if (world.screenMap) Graphics.mapWindow(game, textures);
    const tileData = world.tiles ? [...new Set([...world.tiles].map(code => code & 255))].map(tile => {
      const offset = (tile & 128 ? 8192 : 0) + 0x1000 + (tile & 127) * 16;
      return [tile, ...game.vram.subarray(offset, offset + 16)];
    }) : null;
    const sceneKey = [preset.id, thickness, world.width, world.height, world.ground, world.objects,
      world.surfaces, world.facades, world.tiles ? [...world.tiles] : null, world.monochrome, world.procedural, world.generic];
    const key = JSON.stringify([...sceneKey, tileData, world.tiles ? [...game.bgPalette] : null,
      world.tiles ? game.io[0x47] : null]);
    const sculptedTiles = new Set();
    if (world.procedural) for (const surface of world.surfaces) if (surface.sculpted) {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        sculptedTiles.add(world.tiles[((surface.y >> 3) + dy) * world.tileColumns + (surface.x >> 3) + dx] & 255);
      }
    }
    const geometryKey = world.procedural ? JSON.stringify([...sceneKey, tileData.filter(([tile]) => sculptedTiles.has(tile))]) : key;
    const cached = geometryCache.get(game);
    const reusable = cached?.geometryKey === geometryKey;
    const scale = thickness / 14, stats = { trees: 0, houses: 0, signs: 0, characters: 0 };
    const width = world.width * 32, height = world.height * 32;
    const ground = cached?.key === key ? cached.ground : world.tiles ? Graphics.tileGrid(game, world.tiles,
      world.tileColumns || 24, world.tileRows || 20)
      : { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
    const groundColors = [[162, 193, 106], [221, 205, 155], [89, 160, 190], [195, 187, 120]];
    function pixel(x, y, kind) {
      const color = groundColors[kind];
      const shade = (x * 7 + y * 11) % 31 < 2 ? 0.92 : 1;
      const offset = (y * width + x) * 4;
      for (let i = 0; i < 3; i++) ground.pixels[offset + i] = Math.round(color[i] * shade);
      ground.pixels[offset + 3] = 255;
    }
    function face(points, slot, shade = 1) {
      const u0 = (slot * 16 + 0.5) / 192, u1 = (slot * 16 + 15.5) / 192;
      quad(models, points.map(([x, y, z]) => [x, y, z * scale]),
        [[u0, 0.03], [u1, 0.03], [u1, 0.97], [u0, 0.97]], shade);
    }
    function box(x, y, w, d, bottom, top, slot) {
      face([[x, y, top], [x + w, y, top], [x + w, y + d, top], [x, y + d, top]], slot);
      face([[x, y + d, bottom], [x + w, y + d, bottom], [x + w, y + d, top], [x, y + d, top]], slot, 0.78);
      face([[x, y, bottom], [x, y + d, bottom], [x, y + d, top], [x, y, top]], slot, 0.62);
      face([[x + w, y, bottom], [x, y, bottom], [x, y, top], [x + w, y, top]], slot, 0.7);
      face([[x + w, y + d, bottom], [x + w, y, bottom], [x + w, y, top], [x + w, y + d, top]], slot, 0.88);
    }
    function shadow(x, y, w, d) {
      const z = 0.12 * scale;
      quad(models, [[x - 2, y + 2, z], [x + w + 4, y + 2, z],
        [x + w + 9, y + d + 5, z], [x + 3, y + d + 5, z]],
      [[SHADOW_TILE, 0], [SHADOW_TILE, 0], [SHADOW_TILE, 0], [SHADOW_TILE, 0]]);
    }
    function tree(x, y, tall = true, width = 16, depth = 16) {
      const h = (tall ? 29 : 20) + Math.max(0, width - 16) / 2;
      shadow(x + 2, y + 2, width - 4, depth - 4);
      box(x + width / 2 - 2, y + depth / 2 - 2, 4, 4, 0, 9, 3);
      box(x + 2, y + 2, width - 4, depth - 4, 6, h - 9, 1);
      box(x, y, width, depth, h - 14, h - 7, 0);
      box(x + 2, y + 2, width - 4, depth - 4, h - 7, h - 3, 0);
      box(x + width / 2 - 3, y + depth / 2 - 3, 6, 6, h - 3, h, 2);
      stats.trees++;
    }
    function house(x, y, w, d, doorOffset, roof) {
      const wall = 22, ridge = 36, middle = y + d / 2;
      shadow(x, y, w, d);
      box(x + 1, y + 2, w - 2, d - 4, 0, wall, 4);
      if (roof === "flat") box(x - 2, y - 2, w + 4, d + 4, wall, wall + 3, 6);
      else {
        face([[x - 2, y - 2, wall], [x + w + 2, y - 2, wall],
          [x + w + 2, middle, ridge], [x - 2, middle, ridge]], 6, 0.9);
        face([[x - 2, middle, ridge], [x + w + 2, middle, ridge],
          [x + w + 2, y + d + 2, wall], [x - 2, y + d + 2, wall]], 6);
        face([[x - 2, y - 2, wall], [x - 2, middle, ridge],
          [x - 2, y + d + 2, wall], [x - 2, y + d + 2, wall]], 5, 0.65);
        face([[x + w + 2, y - 2, wall], [x + w + 2, middle, ridge],
          [x + w + 2, y + d + 2, wall], [x + w + 2, y + d + 2, wall]], 5, 0.85);
      }
      const front = y + d - 1.9;
      const door = x + w / 2 + doorOffset;
      face([[door - 5, front, 0.2], [door + 5, front, 0.2],
        [door + 5, front, 16], [door - 5, front, 16]], 3);
      for (const wx of [x + 7, x + w - 17]) {
        face([[wx, front, 9], [wx + 10, front, 9], [wx + 10, front, 17], [wx, front, 17]], 7);
        face([[wx + 1, front + 0.1, 10], [wx + 9, front + 0.1, 10],
          [wx + 9, front + 0.1, 16], [wx + 1, front + 0.1, 16]], 11);
      }
      stats.houses++;
    }
    function sign(x, y) {
      shadow(x, y, 14, 5);
      box(x + 3, y + 2, 2, 3, 0, 10, 3);
      box(x + 11, y + 2, 2, 3, 0, 10, 3);
      box(x + 1, y + 1, 14, 4, 7, 15, 5);
      face([[x + 3, y + 5.1, 9], [x + 13, y + 5.1, 9], [x + 13, y + 5.1, 13], [x + 3, y + 5.1, 13]], 4);
      stats.signs++;
    }
    function vegetation({ type, x, y }) {
      if (type === "grass") {
        for (const [dx, dy, h] of [[1, 2, 5], [5, 1, 7], [3, 5, 6]]) {
          face([[x + dx, y + dy, 0.2], [x + dx + 2, y + dy, 0.2],
            [x + dx + 1, y + dy, h], [x + dx + 1, y + dy, h]], 2);
          face([[x + dx + 1, y + dy - 1, 0.2], [x + dx + 1, y + dy + 1, 0.2],
            [x + dx + 1, y + dy, h], [x + dx + 1, y + dy, h]], 0);
        }
      } else {
        box(x + 3, y + 3, 1, 1, 0, 4, 1);
        box(x + 2, y + 1, 3, 5, 4, 5, 11);
        box(x + 1, y + 2, 5, 3, 4, 5, 11);
        box(x + 3, y + 3, 1, 1, 5, 6, 2);
      }
      stats[type] = (stats[type] || 0) + 1;
    }
    function ledge({ x, y, direction }) {
      // Rotate the same rocky south-facing slope for the two lateral jump directions.
      const point = (u, v, z) => direction === "left" ? [x + 16 - v, y + u, z]
        : direction === "right" ? [x + v, y + 16 - u, z] : [x + u, y + v, z];
      for (let i = 0; i < 4; i++) {
        const u = i * 4, top = 7 + i % 2;
        face([[u, 0, 0.1], [u + 4, 0, 0.1], [u + 4, 3, top], [u, 3, top]].map(p => point(...p)), 8);
        face([[u, 3, top], [u + 4, 3, top], [u + 4, 12, 0.1], [u, 12, 0.1]].map(p => point(...p)), 3, 0.78);
      }
      face([[0, 0, 0.1], [0, 3, 7], [0, 12, 0.1], [0, 12, 0.1]].map(p => point(...p)), 8, 0.62);
      face([[16, 0, 0.1], [16, 3, 8], [16, 12, 0.1], [16, 12, 0.1]].map(p => point(...p)), 8, 0.88);
      stats.ledges = (stats.ledges || 0) + 1;
    }
    function prop({ type, x, y }) {
      if (type === "rock") {
        box(x + 1, y + 2, 14, 12, 0, 5, 8);
        box(x + 2, y + 3, 12, 10, 5, 10, 8);
        box(x + 4, y + 4, 8, 7, 10, 14, 5);
        box(x + 3, y + 5, 3, 2, 10, 11, 11);
      } else if (type === "grave") {
        box(x + 2, y + 4, 12, 10, 0, 3, 8);
        box(x + 4, y + 5, 8, 4, 3, 16, 8);
        box(x + 5, y + 6, 6, 3, 16, 18, 11);
        face([[x + 6, y + 9.1, 6], [x + 10, y + 9.1, 6],
          [x + 10, y + 9.1, 13], [x + 6, y + 9.1, 13]], 9);
      } else if (type === "barrel") {
        box(x + 3, y + 2, 10, 12, 0, 12, 3);
        for (const z of [2, 9]) box(x + 2, y + 1, 12, 14, z, z + 2, 8);
        box(x + 4, y + 3, 8, 10, 12, 14, 5);
      } else if (type === "fence") {
        for (const dx of [1, 13]) {
          box(x + dx, y + 6, 2, 3, 0, 13, 3);
          box(x + dx, y + 6, 2, 3, 13, 14, 11);
        }
        for (const z of [4, 9]) box(x, y + 6, 16, 2, z, z + 2, 5);
      } else if (type === "statue") {
        box(x + 2, y + 3, 12, 12, 0, 4, 8);
        box(x + 3, y + 4, 10, 10, 4, 7, 11);
        box(x + 5, y + 6, 6, 6, 7, 15, 8);
        box(x + 4, y + 4, 8, 8, 15, 23, 11);
        box(x + 4, y + 4, 2, 3, 23, 27, 8);
        box(x + 10, y + 4, 2, 3, 23, 27, 8);
        box(x + 6, y + 11, 4, 3, 17, 20, 8);
        for (const dx of [5, 10]) box(x + dx, y + 12, 1, 1, 21, 22, 9);
      } else if (type === "shrub") {
        box(x + 6, y + 7, 4, 4, 0, 5, 3);
        box(x + 2, y + 4, 12, 10, 4, 10, 1);
        box(x + 3, y + 3, 10, 10, 10, 14, 0);
        box(x + 6, y + 5, 4, 5, 14, 17, 2);
      } else if (type === "stump") {
        box(x + 3, y + 4, 10, 9, 0, 7, 3);
        box(x + 2, y + 3, 12, 10, 7, 9, 5);
        box(x + 4, y + 5, 8, 6, 9, 10, 11);
        box(x + 6, y + 6, 4, 4, 10, 11, 3);
      } else {
        box(x + 2, y + 2, 12, 12, 0, 3, 8);
        box(x + 5, y + 5, 6, 6, 3, 25, 4);
        box(x + 3, y + 3, 10, 10, 25, 28, 11);
      }
      stats[type] = (stats[type] || 0) + 1;
    }
    function relief() {
      const heights = new Int8Array(width * height).fill(-128), used = new Uint8Array(heights.length);
      for (const { x, y, depth, sculpted, slope } of world.surfaces) {
        for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) {
          const px = x + dx, py = y + dy, tile = world.tiles[(py >> 3) * world.tileColumns + (px >> 3)];
          heights[py * width + px] = scale === 0 ? 0
            : slope ? Math.round(depth * (slope === "right" ? (15 - dx) / 15
              : slope === "left" ? dx / 15 : slope === "up" ? dy / 15 : slope === "down" ? (15 - dy) / 15
                : Math.min((15 - dx) / 15, dy / 15)))
              : sculpted ? 3 + game.tilePixel(tile, 0, px & 7, py & 7, false) * 4 : depth;
        }
        if (sculpted) stats.sculpted = (stats.sculpted || 0) + 1;
      }
      const uv = (x, y, w, h) => [[x / width, y / height], [(x + w) / width, y / height],
        [(x + w) / width, (y + h) / height], [x / width, (y + h) / height]];
      const at = (x, y) => x < 0 || y < 0 || x >= width || y >= height ? -128 : heights[y * width + x];
      let quads = 0;
      // Merge coplanar rectangles without losing a single texture pixel or height sample.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = y * width + x, z = heights[index];
        if (z === -128 || used[index]) continue;
        let w = 1, h = 1;
        while (x + w < width && !used[index + w] && heights[index + w] === z) w++;
        rows: while (y + h < height) {
          for (let dx = 0; dx < w; dx++) {
            const i = (y + h) * width + x + dx;
            if (used[i] || heights[i] !== z) break rows;
          }
          h++;
        }
        for (let dy = 0; dy < h; dy++) used.fill(1, (y + dy) * width + x, (y + dy) * width + x + w);
        quad(background, [[x, y, z * scale], [x + w, y, z * scale],
          [x + w, y + h, z * scale], [x, y + h, z * scale]], uv(x, y, w, h));
        quads++;
      }
      const edge = (x, y, vertical) => {
        const a = at(x - Number(vertical), y - Number(!vertical)), b = at(x, y);
        if (a === b) return null;
        if ((a === -128 && b === 0) || (b === -128 && a === 0)) return null;
        return [a === -128 ? 0 : a, b === -128 ? 0 : b, a === -128 ? 1 : b === -128 ? -1 : Math.sign(b - a)];
      };
      for (const vertical of [false, true]) {
        const lines = (vertical ? width : height) + 1, length = vertical ? height : width;
        for (let line = 0; line < lines; line++) for (let along = 0; along < length;) {
          const x = vertical ? line : along, y = vertical ? along : line, pair = edge(x, y, vertical);
          if (!pair) { along++; continue; }
          let end = along + 1;
          while (end < length) {
            const next = edge(vertical ? line : end, vertical ? end : line, vertical);
            if (!next || next.some((value, i) => value !== pair[i])) break;
            end++;
          }
          const low = Math.min(pair[0], pair[1]) * scale, high = Math.max(pair[0], pair[1]) * scale;
          const ex = vertical ? x : end, ey = vertical ? end : y;
          const tx = x - Number(vertical && pair[2] < 0), ty = y - Number(!vertical && pair[2] < 0);
          const shade = vertical ? pair[2] > 0 ? 0.62 : 0.88 : pair[2] > 0 ? 0.7 : 0.78;
          quad(background, [[x, y, low], [ex, ey, low], [ex, ey, high], [x, y, high]],
            vertical ? uv(tx, ty, 1, end - along) : uv(tx, ty, end - along, 1), shade);
          quads++;
          along = end;
        }
      }
      stats.reliefQuads = quads;
    }
    function furniture({ kind, x, y, width: w, depth: d }) {
      const legs = height => {
        for (const dx of [1, w - 4]) for (const dy of [1, d - 4]) box(x + dx, y + dy, 3, 3, 0, height, 3);
      };
      if (kind === "wall") box(x, y, w, d, 0, 24, 4);
      else if (kind === "table" || kind === "desk") {
        legs(11); box(x, y, w, d, 11, 14, 5);
      } else if (kind === "counter") box(x, y, w, d, 0, 12, 5);
      else if (kind === "chair") {
        legs(6); box(x, y + d / 2, w, d / 2, 6, 8, 3); box(x, y, w, 3, 0, 17, 5);
      } else if (kind === "bed") {
        box(x, y, w, d, 0, 5, 3); box(x, y + 2, w, d - 4, 5, 8, 11);
        box(x + 1, y + 3, w - 2, 7, 8, 10, 4); box(x, y, w, 2, 0, 16, 3);
      } else if (kind === "merchandise") {
        box(x, y, w, d - 2, 0, 23, 3);
        for (const z of [2, 11, 21]) box(x, y + d - 4, w, 2, z, z + 2, 5);
      } else if (kind === "panel" || kind === "display") {
        box(x, y, w, d - 2, 0, 23, 3);
        if (kind === "display") {
          box(x, y + d - 2, 1, 1, 0, 24, 5);
          box(x + w - 1, y + d - 2, 1, 1, 0, 24, 5);
          box(x, y + d - 2, w, 1, 0, 1, 5);
          box(x, y + d - 2, w, 1, 23, 24, 5);
        }
      } else if (kind === "healing") {
        box(x + 1, y + 1, w - 2, d - 3, 0, 23, 8);
        box(x + 2, y + 2, w - 4, 9, 23, 27, 3);
        for (const dx of [3, w - 7]) box(x + dx, y + d - 6, 4, 3, 23, 25, 4);
      } else if (kind === "lectern") {
        box(x + 3, y + 2, w - 6, d - 4, 0, 17, 3);
        box(x, y + 1, w, d - 2, 17, 23, 5);
      } else if (kind === "shelf") {
        box(x, y, w, d, 0, 23, 3);
        for (const z of [5, 12, 19]) {
          box(x + 1, y + d - 3, w - 2, 3, z, z + 1, 5);
          for (let bx = 2; bx < w - 3; bx += 5) box(x + bx, y + d - 2, 3, 2, z + 1, z + 5, bx % 2 ? 11 : 2);
        }
      } else if (kind === "tv" || kind === "pc" || kind === "machine") {
        box(x, y, w, d, kind === "pc" ? 14 : 0, kind === "pc" ? 27 : 17, 8);
        const z = kind === "pc" ? 18 : 5;
        face([[x + 2, y + d + 0.1, z], [x + w - 2, y + d + 0.1, z],
          [x + w - 2, y + d + 0.1, z + 9], [x + 2, y + d + 0.1, z + 9]], 7);
        box(x + 3, y + d + 1, w - 6, 4, 0, 3, 11);
      } else if (kind === "console") {
        box(x + 2, y + 1, w - 4, d - 2, 0, 3, 8); box(x + 5, y + 2, 5, 3, 3, 4, 11);
      } else if (kind === "plant") {
        box(x + 4, y + 4, 8, 8, 0, 8, 3); box(x + 1, y + 1, 14, 14, 8, 18, 1);
        box(x + 5, y + 5, 6, 6, 18, 23, 2);
      } else if (kind === "ladder") {
        for (const dx of [1, w - 3]) box(x + dx, y + d / 2, 2, 2, 0, 24, 3);
        for (let z = 3; z < 24; z += 5) box(x + 2, y + d / 2, w - 4, 2, z, z + 2, 5);
      } else if (kind === "stairs") {
        for (let i = 0; i < 4; i++) box(x, y + i * d / 4, w, d / 4, 0, (4 - i) * 3, 5);
      } else if (kind === "picture") {
        box(x, y, w, 2, 12, 24, 3);
        face([[x + 2, y + 2.1, 14], [x + w - 2, y + 2.1, 14],
          [x + w - 2, y + 2.1, 22], [x + 2, y + 2.1, 22]], 11);
      } else throw new Error(`Meuble 3D inconnu : ${kind}.`);
      stats.furniture = (stats.furniture || 0) + 1;
    }
    if (!reusable) {
      if (world.generic) {
        for (const { x, y, depth } of world.surfaces) {
          const z = depth * scale, bottom = Math.min(0, z), top = Math.max(0, z);
          const uv = [[x / width, y / height], [(x + 16) / width, y / height],
            [(x + 16) / width, (y + 16) / height], [x / width, (y + 16) / height]];
          quad(background, [[x, y, z], [x + 16, y, z], [x + 16, y + 16, z], [x, y + 16, z]], uv);
          if (!depth) continue;
          quad(models, [[x, y + 16, bottom], [x + 16, y + 16, bottom],
            [x + 16, y + 16, top], [x, y + 16, top]], uv, 0.78);
          quad(models, [[x, y, bottom], [x, y + 16, bottom], [x, y + 16, top], [x, y, top]], uv, 0.62);
          quad(models, [[x + 16, y, bottom], [x, y, bottom], [x, y, top], [x + 16, y, top]], uv, 0.7);
          quad(models, [[x + 16, y + 16, bottom], [x + 16, y, bottom],
            [x + 16, y, top], [x + 16, y + 16, top]], uv, 0.88);
        }
      } else {
        if (world.procedural) relief();
        for (const facade of world.facades || []) {
          const { x, y, width: w, height: h, sourceX: sx, sourceY: sy, sourceWidth: sw, sourceHeight: sh } = facade;
          const points = facade.roof ? [[x, y, h * scale + 0.1], [x + w, y, h * scale + 0.1],
            [x + w, y + facade.depth, h * scale + 0.1], [x, y + facade.depth, h * scale + 0.1]]
            : [[x, y, h * scale], [x + w, y, h * scale], [x + w, y, 0.1], [x, y, 0.1]];
          quad(background, points,
            [[sx / width, sy / height], [(sx + sw) / width, sy / height],
              [(sx + sw) / width, (sy + sh) / height], [sx / width, (sy + sh) / height]], 0.78);
        }
        for (let by = 0; !world.texturedGround && by < world.height; by++) for (let bx = 0; bx < world.width; bx++) {
          const cell = world.ground[by * world.width + bx], x = bx * 32, y = by * 32;
          for (let dy = 0; dy < 32; dy++) for (let dx = 0; dx < 32; dx++) {
            pixel(x + dx, y + dy, dx < cell.shoreWidth ? cell.shore : cell.material);
          }
        }
        for (const object of world.objects) {
          if (object.type === "tree") tree(object.x, object.y, object.tall, object.width, object.depth);
          else if (object.type === "house") house(object.x, object.y, object.width, object.depth, object.doorOffset, object.roof);
          else if (object.type === "sign") sign(object.x, object.y);
          else if (object.type === "grass" || object.type === "flower") vegetation(object);
          else if (object.type === "ledge") ledge(object);
          else if (["rock", "grave", "barrel", "pillar", "fence", "statue", "shrub", "stump"].includes(object.type)) prop(object);
          else if (object.type === "furniture") furniture(object);
          else throw new Error(`Type de modele 3D inconnu : ${object.type}.`);
        }
        if (!world.procedural) quad(background, [[0, 0, 0], [width, 0, 0], [width, height, 0], [0, height, 0]],
          [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      geometryCache.set(game, { key, geometryKey, ground, background: new Float32Array(background),
        models: new Float32Array(models), stats: { ...stats } });
    } else if (cached.key !== key) {
      cached.key = key;
      cached.ground = ground;
    }
    const geometry = geometryCache.get(game);
    Object.assign(stats, geometry.stats);
    if (world.overlay) Graphics.overlay(game, textures, world.overlay);
    const { labels, components } = Graphics.spriteComponents(textures.sprites);
    for (const component of components) {
      const { left, right, bottom } = component, x = (left + right) / 2 + world.originX, y = bottom - 1 + world.originY;
      component.elevation = world.spriteSurfaces?.find(cell => x >= cell.x && x < cell.x + cell.width
        && y >= cell.y && y < cell.y + cell.depth)?.height
        ?? world.surfaces?.find(cell => !cell.sculpted && x >= cell.x && x < cell.x + 16
          && y >= cell.y && y < cell.y + 16)?.depth ?? 0;
      stats.characters++;
    }
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160;) {
      const id = labels[y * 160 + x];
      if (id < 0) { x++; continue; }
      const left = x;
      while (x < 160 && labels[y * 160 + x] === id) x++;
      const { bottom: foot, elevation } = components[id];
      const zTop = ((foot - y) * CHARACTER_STATURE + elevation) * scale + 0.2, zBottom = zTop - CHARACTER_STATURE * scale;
      quad(sprites, [[left + world.originX, foot + world.originY, zTop], [x + world.originX, foot + world.originY, zTop],
        [x + world.originX, foot + world.originY, zBottom], [left + world.originX, foot + world.originY, zBottom]],
      [[left / 160, y / 144], [x / 160, y / 144], [x / 160, (y + 1) / 144], [left / 160, (y + 1) / 144]]);
      const from = foot + (foot - y - 1) * SHADOW_DEPTH + world.originY, to = from + SHADOW_DEPTH, z = (elevation + 0.12) * scale;
      quad(shadows, [[left + world.originX, from, z], [x + world.originX, from, z],
        [x + world.originX, to, z], [left + world.originX, to, z]],
      [[SHADOW_TILE, 0], [SHADOW_TILE, 0], [SHADOW_TILE, 0], [SHADOW_TILE, 0]]);
    }
    return { active: true, textures: { ...textures, background: ground }, background: geometry.background,
      models: geometry.models, shadows: new Float32Array(shadows), sprites: new Float32Array(sprites),
      zoomFactor: world.zoomFactor ?? 0.6, pitchOffset: world.pitchOffset ?? 40,
      clearColor: world.clearColor ?? [0.66, 0.79, 0.67, 1],
      origin: [world.originX, world.originY], material: world.generic ? ground : world.monochrome ? monochromeAtlas : atlas,
      shadowMaterial: world.monochrome ? monochromeAtlas : atlas, stats,
      detail: `${world.name}${world.overlay ? ` · ${world.overlayLabel || "interface"} en surimpression` : ""} · ${
        world.procedural ? `décors procéduraux · ${world.objects.length} objets · ${stats.sculpted || 0} motifs sculptés${world.bounded ? " · région locale" : ""}`
          : world.generic ? `${world.surfaces.length} secteurs texturés`
          : stats.furniture ? `${stats.furniture} meubles et parois` : `${stats.houses} maisons · ${stats.trees} arbres`
      } · ${stats.characters} silhouettes` };
  }
  const api = { build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketWorld = api;
})(globalThis);
