(function (root) {
  "use strict";

  function image(width, height) {
    return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  }
  function inspect(game, { bank = 0, palette = 0, object = false,
    background = true, window = true, sprites = true, sceneOnly = false } = {}) {
    if (!Number.isInteger(bank) || bank < 0 || bank > (game.color ? 1 : 0)
      || !Number.isInteger(palette) || palette < 0 || palette > (game.color ? 7 : 1)) {
      throw new Error("Banque ou palette graphique invalide.");
    }
    // Only these scalar/output fields are changed by the shared scanline renderer.
    const view = Object.create(game);
    view.pixels = new Uint8ClampedArray(160 * 144 * 4);
    view.ly = 0;
    view.windowLine = 0;
    const colors = (isObject, number) => {
      const result = [];
      for (let color = 0; color < 4; color++) {
        view.paint(0, color, number, isObject);
        result.push(view.pixels.slice(0, 4));
      }
      return result;
    };
    const bgColors = Array.from({ length: game.color ? 8 : 1 }, (_, i) => colors(false, i));
    const objColors = Array.from({ length: game.color ? 8 : 2 }, (_, i) => colors(true, i));
    const put = (output, x, y, color) => output.pixels.set(color, (y * output.width + x) * 4);
    const tiles = image(128, 192);
    const tileColors = (object ? objColors : bgColors)[game.color || object ? palette : 0];
    for (let tile = 0; !sceneOnly && tile < 384; tile++) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const offset = bank * 8192 + tile * 16 + y * 2, bit = 7 - x;
        const color = ((game.vram[offset] >> bit) & 1) | (((game.vram[offset + 1] >> bit) & 1) << 1);
        put(tiles, (tile % 16) * 8 + x, Math.floor(tile / 16) * 8 + y, tileColors[color]);
      }
    }
    const maps = [0x1800, 0x1c00].map(base => {
      const output = image(256, 256);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const index = base + (y >> 3) * 32 + (x >> 3);
        const attr = game.color ? game.vram[8192 + index] : 0;
        const color = game.tilePixel(game.vram[index], attr, x & 7, y & 7, !!(game.io[0x40] & 16));
        put(output, x, y, bgColors[attr & 7][color]);
      }
      return output;
    });
    const objects = image(80, 64), height = game.io[0x40] & 4 ? 16 : 8, entries = [];
    for (let i = 0; !sceneOnly && i < 40; i++) {
      const [rawY, rawX, tile, attr] = game.oam.slice(i * 4, i * 4 + 4);
      const number = game.color ? attr & 7 : (attr >> 4) & 1;
      entries.push({ index: i, x: rawX - 8, y: rawY - 16, tile, height,
        bank: game.color && (attr & 8) ? 1 : 0, palette: number,
        flipX: !!(attr & 32), flipY: !!(attr & 64), behind: !!(attr & 128) });
      for (let y = 0; y < height; y++) for (let x = 0; x < 8; x++) {
        const row = attr & 64 ? height - 1 - y : y;
        const id = height === 16 ? (tile & 0xfe) + (row >> 3) : tile;
        const color = game.tilePixel(id, attr & ~64, x, row & 7, true);
        if (color) put(objects, (i % 10) * 8 + x, Math.floor(i / 10) * 16 + y, objColors[number][color]);
      }
    }
    const palettes = image(64, 64);
    for (const [isObject, collection] of sceneOnly ? [] : [[false, bgColors], [true, objColors]]) {
      collection.forEach((list, row) => list.forEach((color, column) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          put(palettes, (isObject ? 32 : 0) + column * 8 + x, row * 8 + y, color);
        }
      }));
    }
    const preview = image(160, 144);
    view.pixels = preview.pixels;
    for (view.ly = 0; view.ly < 144; view.ly++) view.renderLine({ background, window, sprites });
    return { tiles, maps, objects, palettes, preview, entries,
      registers: { lcd: game.io[0x40], scrollX: game.io[0x43], scrollY: game.io[0x42],
        windowX: game.io[0x4b] - 7, windowY: game.io[0x4a], line: game.readIO(0x44),
        mode: game.mode(), frames: game.frames } };
  }
  function scene(game) {
    const frame = game.videoLayers();
    if (frame) return { ...frame, screenSpace: true };
    if (game.frames > 0) {
      return { background: { width: 160, height: 144, pixels: game.pixels.slice() },
        sprites: image(160, 144), window: image(160, 144), screenSpace: true };
    }
    const data = inspect(game, { background: false, sprites: false, sceneOnly: true });
    const sprites = spriteLayer(game, false);
    return { background: data.maps[game.io[0x40] & 8 ? 1 : 0], sprites, window: data.preview, screenSpace: false };
  }
  function spriteLayer(game, window) {
    const sprites = image(160, 144), view = Object.create(game);
    view.pixels = sprites.pixels;
    view.windowLine = 0;
    view.paint = function (x, color, palette, object = false) {
      if (object) game.paint.call(this, x, color, palette, true);
    };
    for (view.ly = 0; view.ly < 144; view.ly++) view.renderLine({ window });
    return sprites;
  }
  function mapWindow(game, textures) {
    // Red uses a full-screen hardware window for dialogue, not just the text rectangle.
    const background = image(160, 144);
    background.pixels.set(textures.window.pixels[3] ? textures.window.pixels : textures.background.pixels);
    const sprites = spriteLayer(game, true);
    if (textures.screenSpace) for (let i = 0; i < 160 * 144; i++) {
      if (sprites.pixels[i * 4 + 3]) background.pixels.set(textures.background.pixels.subarray(i * 4, i * 4 + 4), i * 4);
    }
    textures.background = background;
    textures.sprites = sprites;
    textures.window = image(160, 144);
    textures.screenSpace = true;
  }
  function spriteComponents(image) {
    const { width, height, pixels } = image, labels = new Int16Array(width * height).fill(-1), components = [];
    for (let i = 0; i < labels.length; i++) {
      if (!pixels[i * 4 + 3] || labels[i] !== -1) continue;
      const id = components.length, queue = [i];
      let bottom = 0, left = width, right = 0;
      labels[i] = id;
      for (let n = 0; n < queue.length; n++) {
        const index = queue[n], x = index % width, y = Math.floor(index / width);
        bottom = Math.max(bottom, y + 1); left = Math.min(left, x); right = Math.max(right, x + 1);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy, next = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || labels[next] !== -1 || !pixels[next * 4 + 3]) continue;
          labels[next] = id; queue.push(next);
        }
      }
      components.push({ bottom, left, right });
    }
    return { labels, components };
  }
  function tileGrid(game, tiles, columns, rows, wide = false,
    unsignedTiles = !!(game.io[0x40] & 16)) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1
      || columns > 128 || rows > 128 || tiles.length !== columns * rows) {
      throw new Error("Dimensions de texture de carte invalides.");
    }
    const output = image(columns * 8, rows * 8), view = Object.create(game);
    view.pixels = new Uint8ClampedArray(4); view.ly = 0;
    const colors = Array.from({ length: 8 }, (_, palette) => Array.from({ length: 4 }, (_, color) => {
      view.paint(0, color, palette);
      return view.pixels.slice();
    }));
    for (let i = 0; i < tiles.length; i++) {
      const code = tiles[i];
      if (!Number.isInteger(code) || code < 0 || code > (wide ? 0xffff : 0x7ff)) {
        throw new Error("Tuile de texture de carte invalide.");
      }
      const tile = code & (wide ? 255 : 127);
      const attributes = wide ? code >> 8 : ((code & 128) ? 8 : 0) | (code >> 8);
      const unsigned = wide && unsignedTiles;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const color = game.tilePixel(tile, attributes, x, y, unsigned);
        const index = ((Math.floor(i / columns) * 8 + y) * output.width + (i % columns) * 8 + x) * 4;
        output.pixels.set(colors[attributes & 7][color], index);
      }
    }
    return output;
  }
  function overlay(game, textures, mask) {
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const offset = i * 4, layer = textures.window.pixels[offset + 3] ? textures.window
        : textures.sprites.pixels[offset + 3] ? textures.sprites : textures.background;
      const source = layer === textures.background && !textures.screenSpace
        ? ((((Math.floor(i / 160) + game.io[0x42]) & 255) * 256 + ((i % 160 + game.io[0x43]) & 255)) * 4)
        : offset;
      textures.window.pixels.set(layer.pixels.subarray(source, source + 4), offset);
      textures.sprites.pixels[offset + 3] = 0;
    }
  }
  const api = { inspect, scene, spriteComponents, tileGrid, overlay, mapWindow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketGraphics = api;
})(globalThis);
