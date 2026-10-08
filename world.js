(function (root) {
  "use strict";
  const Graphics = typeof module !== "undefined" && module.exports ? require("./graphics.js") : root.PocketGraphics;

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
  const geometryCache = new WeakMap();

  function build(game, preset, thickness) {
    if (!Number.isFinite(thickness) || thickness < 0 || thickness > 16) throw new Error("Epaisseur 3D invalide.");
    const world = preset.world?.(game);
    if (!world?.active) return { active: false, reason: world?.reason || "Aucun preset 3D pour ce jeu." };
    const textures = Graphics.scene(game), models = [], background = [], sprites = [], shadows = [];
    const tileData = world.generic ? [...new Set([...world.tiles].map(code => code & 255))].map(tile => {
      const offset = (tile & 128 ? 8192 : 0) + 0x1000 + (tile & 127) * 16;
      return [tile, ...game.vram.subarray(offset, offset + 16)];
    }) : null;
    const key = JSON.stringify([preset.id, thickness, world.width, world.height, world.ground, world.objects,
      world.surfaces, world.tiles ? [...world.tiles] : null, tileData, world.generic ? [...game.bgPalette] : null]);
    const cached = geometryCache.get(game);
    const reusable = cached?.key === key;
    const scale = thickness / 14, stats = { trees: 0, houses: 0, signs: 0, characters: 0 };
    const width = world.width * 32, height = world.height * 32;
    const ground = reusable ? cached.ground : world.generic ? Graphics.tileGrid(game, world.tiles, 24, 20)
      : { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
    const groundColors = [[162, 193, 106], [221, 205, 155], [89, 160, 190], [195, 187, 120]];
    function pixel(x, y, kind) {
      const color = groundColors[kind];
      const shade = (x * 7 + y * 11) % 31 < 2 ? 0.92 : 1;
      const offset = (y * width + x) * 4;
      for (let i = 0; i < 3; i++) ground.pixels[offset + i] = Math.round(color[i] * shade);
      ground.pixels[offset + 3] = 255;
    }
    function quad(output, points, uv, shade = 1) {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const [x, y, z] = points[i];
        output.push(x - 80, 72 - y, z, ...uv[i], shade);
      }
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
    function shadow(x, y, w, d, output = models, elevation = 0) {
      const u = (9 * 16 + 0.5) / 192;
      const z = (elevation + 0.12) * scale;
      quad(output, [[x - 2, y + 2, z], [x + w + 4, y + 2, z],
        [x + w + 9, y + d + 5, z], [x + 3, y + d + 5, z]],
      [[u, 0], [u, 0], [u, 0], [u, 0]]);
    }
    function tree(x, y, tall = true) {
      const h = tall ? 29 : 20;
      shadow(x + 2, y + 2, 12, 12);
      box(x + 6, y + 6, 4, 4, 0, 9, 3);
      box(x + 2, y + 2, 12, 12, 6, h - 9, 1);
      box(x, y, 16, 16, h - 14, h - 7, 0);
      box(x + 2, y + 2, 12, 12, h - 7, h - 3, 0);
      box(x + 5, y + 5, 6, 6, h - 3, h, 2);
      stats.trees++;
    }
    function house(x, y, w, d, doorOffset) {
      const wall = 22, ridge = 36, middle = y + d / 2;
      shadow(x, y, w, d);
      box(x + 1, y + 2, w - 2, d - 4, 0, wall, 4);
      face([[x - 2, y - 2, wall], [x + w + 2, y - 2, wall],
        [x + w + 2, middle, ridge], [x - 2, middle, ridge]], 6, 0.9);
      face([[x - 2, middle, ridge], [x + w + 2, middle, ridge],
        [x + w + 2, y + d + 2, wall], [x - 2, y + d + 2, wall]], 6);
      face([[x - 2, y - 2, wall], [x - 2, middle, ridge],
        [x - 2, y + d + 2, wall], [x - 2, y + d + 2, wall]], 5, 0.65);
      face([[x + w + 2, y - 2, wall], [x + w + 2, middle, ridge],
        [x + w + 2, y + d + 2, wall], [x + w + 2, y + d + 2, wall]], 5, 0.85);
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
        for (let by = 0; by < world.height; by++) for (let bx = 0; bx < world.width; bx++) {
          const cell = world.ground[by * world.width + bx], x = bx * 32, y = by * 32;
          for (let dy = 0; dy < 32; dy++) for (let dx = 0; dx < 32; dx++) {
            pixel(x + dx, y + dy, dx < cell.shoreWidth ? cell.shore : cell.material);
          }
        }
        for (const object of world.objects) {
          if (object.type === "tree") tree(object.x, object.y, object.tall);
          else if (object.type === "house") house(object.x, object.y, object.width, object.depth, object.doorOffset);
          else if (object.type === "sign") sign(object.x, object.y);
          else throw new Error(`Type de modele 3D inconnu : ${object.type}.`);
        }
        quad(background, [[0, 0, 0], [width, 0, 0], [width, height, 0], [0, height, 0]],
          [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      geometryCache.set(game, { key, ground, background: new Float32Array(background),
        models: new Float32Array(models), stats: { ...stats } });
    }
    const geometry = geometryCache.get(game);
    Object.assign(stats, geometry.stats);
    if (world.overlay) {
      for (let i = 0; i < world.overlay.length; i++) {
        if (!world.overlay[i]) continue;
        const offset = i * 4, layer = textures.window.pixels[offset + 3] ? textures.window
          : textures.sprites.pixels[offset + 3] ? textures.sprites : textures.background;
        const source = layer === textures.background && !textures.screenSpace
          ? ((((Math.floor(i / 160) + game.io[0x42]) & 255) * 256 + ((i % 160 + game.io[0x43]) & 255)) * 4)
          : offset;
        textures.window.pixels.set(layer.pixels.subarray(source, source + 4), offset);
        textures.sprites.pixels[offset + 3] = 0;
      }
    }
    const { labels, components } = Graphics.spriteComponents(textures.sprites);
    for (const component of components) {
      const { left, right, bottom } = component, x = (left + right) / 2 + world.originX, y = bottom - 1 + world.originY;
      component.elevation = world.surfaces?.find(cell => x >= cell.x && x < cell.x + 16
        && y >= cell.y && y < cell.y + 16)?.depth || 0;
      shadow(left + world.originX, bottom - 4 + world.originY, right - left, 4, shadows, component.elevation);
      stats.characters++;
    }
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160;) {
      const id = labels[y * 160 + x];
      if (id < 0) { x++; continue; }
      const left = x;
      while (x < 160 && labels[y * 160 + x] === id) x++;
      const foot = components[id].bottom;
      const zTop = (foot - y + components[id].elevation) * scale + 0.2, zBottom = zTop - scale;
      quad(sprites, [[left + world.originX, foot + world.originY, zTop], [x + world.originX, foot + world.originY, zTop],
        [x + world.originX, foot + world.originY, zBottom], [left + world.originX, foot + world.originY, zBottom]],
      [[left / 160, y / 144], [x / 160, y / 144], [x / 160, (y + 1) / 144], [left / 160, (y + 1) / 144]]);
    }
    return { active: true, textures: { ...textures, background: ground }, background: geometry.background,
      models: geometry.models, shadows: new Float32Array(shadows), sprites: new Float32Array(sprites),
      zoomFactor: world.zoomFactor ?? 0.6, pitchOffset: world.pitchOffset ?? 40,
      clearColor: world.clearColor ?? [0.66, 0.79, 0.67, 1],
      origin: [world.originX, world.originY], material: world.generic ? ground : atlas, shadowMaterial: atlas, stats,
      detail: `${world.name}${world.overlay ? ` · ${world.overlayLabel || "interface"} en surimpression` : ""} · ${
        world.generic ? `${world.surfaces.length} secteurs texturés` : `${stats.houses} maisons · ${stats.trees} arbres`
      } · ${stats.characters} silhouettes` };
  }
  const api = { build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketWorld = api;
})(globalThis);
