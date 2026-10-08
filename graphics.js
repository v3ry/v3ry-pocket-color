(function (root) {
  "use strict";

  function image(width, height) {
    return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  }
  function inspect(game, { bank = 0, palette = 0, object = false,
    background = true, window = true, sprites = true } = {}) {
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
    for (let tile = 0; tile < 384; tile++) {
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
    for (let i = 0; i < 40; i++) {
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
    for (const [isObject, collection] of [[false, bgColors], [true, objColors]]) {
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
  if (typeof module !== "undefined" && module.exports) module.exports = { inspect };
  else root.PocketGraphics = { inspect };
})(globalThis);
