(function (root) {
  "use strict";

  const sizes = [[[8, 8], [16, 16], [32, 32], [64, 64]], [[16, 8], [32, 8], [32, 16], [64, 32]],
    [[8, 16], [8, 32], [16, 32], [32, 64]]];
  const word = (bytes, at) => (bytes[at] || 0) | (bytes[at + 1] || 0) << 8;
  const signed16 = value => value << 16 >> 16;
  const signed28 = value => value << 4 >> 4;
  const inside = (value, start, end) => start <= end ? value >= start && value < end : value >= start || value < end;

  class Graphics {
    constructor(game) {
      this.game = game;
      this.bgColors = new Int32Array(240 * 4);
      this.objColors = new Int32Array(240);
      this.objPriority = new Int8Array(240);
      this.objAlpha = new Uint8Array(240);
      this.objWindow = new Uint8Array(240);
      this.affineRefs = new Int32Array(4);
      this.affineLineRefs = new Int32Array(160 * 4);
      this.affineLineMatrices = new Int16Array(160 * 8);
      this.lineDisplay = 128;
      this.latchedLine = -1;
      this.lineReady = false;
    }
    tile(base, x, y, depth, palette) {
      const v = this.game.vram;
      const index = depth ? v[base + y * 8 + x] : ((v[base + y * 4 + (x >>> 1)] || 0) >>> ((x & 1) * 4)) & 15;
      return index ? word(this.game.palette, (palette + index) * 2) : -1;
    }
    background(bg, line, mode) {
      const g = this.game, io = g.io, v = g.vram, control = g.io16(8 + bg * 2);
      const target = bg * 240, mosaic = g.io16(0x4c);
      const mx = control & 64 ? (mosaic & 15) + 1 : 1, my = control & 64 ? (mosaic >>> 4 & 15) + 1 : 1;
      const yline = line - line % my;
      if (mode >= 3) {
        if (bg !== 2) return;
        const frame = g.io16(0) & 16 ? 0xa000 : 0;
        for (let x = 0; x < 240; x++) {
          const [sx, sy] = this.affine(bg, x - x % mx, yline);
          const width = mode === 5 ? 160 : 240, height = mode === 5 ? 128 : 160;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
          if (mode === 4) {
            const index = v[frame + sy * 240 + sx];
            this.bgColors[target + x] = index ? word(g.palette, index * 2) : -1;
          } else this.bgColors[target + x] = word(v, (mode === 5 ? frame : 0) + (sy * width + sx) * 2);
        }
        return;
      }
      const affine = mode === 2 || mode === 1 && bg === 2;
      const character = (control >>> 2 & 3) * 0x4000, map = (control >>> 8 & 31) * 2048;
      const size = control >>> 14, depth = !!(control & 128);
      for (let x = 0; x < 240; x++) {
        let sx, sy, tile, palette = 0, tx, ty;
        if (affine) {
          [sx, sy] = this.affine(bg, x - x % mx, yline);
          const extent = 128 << size;
          if (!(control & 0x2000) && (sx < 0 || sx >= extent || sy < 0 || sy >= extent)) continue;
          sx &= extent - 1; sy &= extent - 1;
          tile = v[map + (sy >>> 3) * (extent >>> 3) + (sx >>> 3)];
          tx = sx & 7; ty = sy & 7;
        } else {
          const width = size & 1 ? 512 : 256, height = size & 2 ? 512 : 256;
          sx = ((x - x % mx) + g.io16(0x10 + bg * 4)) & (width - 1);
          sy = (yline + g.io16(0x12 + bg * 4)) & (height - 1);
          const block = (sx >>> 8) + (sy >>> 8) * (width >>> 8);
          const entry = word(v, map + block * 2048 + ((sy >>> 3 & 31) * 32 + (sx >>> 3 & 31)) * 2);
          tile = entry & 1023; palette = depth ? 0 : (entry >>> 12) * 16;
          tx = entry & 1024 ? 7 - (sx & 7) : sx & 7; ty = entry & 2048 ? 7 - (sy & 7) : sy & 7;
        }
        this.bgColors[target + x] = this.tile(character + tile * (affine || depth ? 64 : 32), tx, ty, affine || depth, palette);
      }
    }
    affineReferenceWrite(offset) {
      const base = offset >= 0x28 && offset < 0x30 ? 0x20 : offset >= 0x38 && offset < 0x40 ? 0x30 : 0;
      if (!base) return;
      const axis = offset < base + 12 ? 0 : 1, index = (base === 0x20 ? 0 : 2) + axis;
      this.affineRefs[index] = signed28(this.game.io32(base + 8 + axis * 4));
    }
    resetAffineReferences() {
      for (let bg = 0; bg < 2; bg++) {
        const base = bg ? 0x30 : 0x20, index = bg * 2;
        this.affineRefs[index] = signed28(this.game.io32(base + 8));
        this.affineRefs[index + 1] = signed28(this.game.io32(base + 12));
      }
    }
    latchLine(line) {
      if (line === 0) this.resetAffineReferences();
      this.affineLineRefs.set(this.affineRefs, line * 4);
      const matrix = line * 8;
      for (let bg = 0; bg < 2; bg++) {
        const base = bg ? 0x30 : 0x20;
        for (let register = 0; register < 4; register++) {
          this.affineLineMatrices[matrix + bg * 4 + register] = this.game.io16(base + register * 2);
        }
      }
      this.lineDisplay = this.game.io16(0);
      this.latchedLine = line;
      this.lineReady = true;
    }
    advanceAffineReferences(line) {
      const matrix = line * 8;
      for (let bg = 0; bg < 2; bg++) {
        const index = bg * 2, parameters = matrix + bg * 4;
        this.affineRefs[index] = signed28(this.affineRefs[index] + signed16(this.affineLineMatrices[parameters + 1]));
        this.affineRefs[index + 1] = signed28(this.affineRefs[index + 1] + signed16(this.affineLineMatrices[parameters + 3]));
      }
    }
    affine(bg, x, line) {
      const index = line * 4 + (bg - 2) * 2, matrix = line * 8 + (bg - 2) * 4;
      return [(this.affineLineRefs[index] + signed16(this.affineLineMatrices[matrix]) * x) >> 8,
        (this.affineLineRefs[index + 1] + signed16(this.affineLineMatrices[matrix + 2]) * x) >> 8];
    }
    objects(line, display) {
      const g = this.game, oam = g.oam, mosaic = g.io16(0x4c), mode = display & 7;
      this.objColors.fill(-1); this.objPriority.fill(4); this.objAlpha.fill(0); this.objWindow.fill(0);
      if (!(display & 0x1000)) return;
      for (let i = 0; i < 128; i++) {
        const a = word(oam, i * 8), b = word(oam, i * 8 + 2), c = word(oam, i * 8 + 4);
        const affine = !!(a & 256), shape = a >>> 14, kind = a >>> 10 & 3;
        if (shape === 3 || kind === 3 || !affine && a & 512) continue;
        const [width, height] = sizes[shape][b >>> 14], boxW = affine && a & 512 ? width * 2 : width;
        const boxH = affine && a & 512 ? height * 2 : height;
        const y = (line - (a & 255)) & 255;
        if (y >= boxH) continue;
        const left = (b & 511) >= 256 ? (b & 511) - 512 : b & 511;
        const depth = !!(a & 0x2000), tileBase = c & (depth ? 1022 : 1023), priority = c >>> 10 & 3;
        if (mode >= 3 && tileBase < 512) continue;
        const palette = 256 + (depth ? 0 : (c >>> 12) * 16), rowStride = display & 64 ? width / 8 * (depth ? 2 : 1) : 32;
        const matrix = (b >>> 9 & 31) * 32;
        for (let x = Math.max(0, left); x < Math.min(240, left + boxW); x++) {
          let px = x - left, py = y;
          if (a & 4096) { px -= px % ((mosaic >>> 8 & 15) + 1); py -= py % ((mosaic >>> 12 & 15) + 1); }
          if (affine) {
            const cx = px - boxW / 2, cy = py - boxH / 2;
            px = ((signed16(word(oam, matrix + 6)) * cx + signed16(word(oam, matrix + 14)) * cy) >> 8) + width / 2;
            py = ((signed16(word(oam, matrix + 22)) * cx + signed16(word(oam, matrix + 30)) * cy) >> 8) + height / 2;
          } else {
            if (b & 4096) px = width - 1 - px;
            if (b & 8192) py = height - 1 - py;
          }
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          const tile = (tileBase + (py >>> 3) * rowStride + (px >>> 3) * (depth ? 2 : 1)) & 1023;
          const color = this.tile(0x10000 + tile * 32, px & 7, py & 7, depth, palette);
          if (color < 0) continue;
          if (kind === 2) { this.objWindow[x] = 1; continue; }
          if (priority < this.objPriority[x]) {
            this.objColors[x] = color; this.objPriority[x] = priority; this.objAlpha[x] = kind === 1 ? 1 : 0;
          }
        }
      }
    }
    line(line) {
      if (!this.lineReady || this.latchedLine !== line) this.latchLine(line);
      const g = this.game, display = this.lineDisplay, mode = display & 7;
      if (mode > 5) throw new Error(`Mode video GBA reserve : ${mode}.`);
      if (display & 128) {
        g.pixels.fill(255, line * 240 * 4, (line + 1) * 240 * 4);
        this.advanceAffineReferences(line); this.lineReady = false; return;
      }
      this.bgColors.fill(-1);
      for (let bg = 0; bg < 4; bg++) if (display & (0x100 << bg)
        && (mode === 0 || mode === 1 && bg < 3 || mode >= 2 && bg >= 2 && (mode === 2 || bg === 2))) this.background(bg, line, mode);
      this.objects(line, display);
      const blend = g.io16(0x50), alpha = g.io16(0x52), eva = Math.min(16, alpha & 31), evb = Math.min(16, alpha >>> 8 & 31);
      const fade = Math.min(16, g.io16(0x54) & 31), effect = blend >>> 6 & 3;
      for (let x = 0; x < 240; x++) {
        let mask = 63;
        if (display & 0xe000) {
          mask = g.io16(0x4a) & 63;
          if (display & 0x8000 && this.objWindow[x]) mask = g.io16(0x4a) >>> 8 & 63;
          for (let w = 1; w >= 0; w--) if (display & (0x2000 << w)) {
            const hx = g.io16(0x40 + w * 2), vy = g.io16(0x44 + w * 2);
            if (inside(x, Math.min(240, hx >>> 8), Math.min(240, hx & 255))
              && inside(line, Math.min(160, vy >>> 8), Math.min(160, vy & 255))) mask = g.io16(0x48) >>> (w * 8) & 63;
          }
        }
        let top = word(g.palette, 0), second = top, topLayer = 5, secondLayer = 5, priority = 5, secondPriority = 6;
        for (let bg = 0; bg < 4; bg++) {
          const color = this.bgColors[bg * 240 + x], p = g.io16(8 + bg * 2) & 3;
          if (color < 0 || !(mask & 1 << bg)) continue;
          if (p < priority) {
            second = top; secondLayer = topLayer; secondPriority = priority;
            top = color; topLayer = bg; priority = p;
          } else if (p < secondPriority) { second = color; secondLayer = bg; secondPriority = p; }
        }
        if (this.objColors[x] >= 0 && mask & 16) {
          const p = this.objPriority[x];
          if (p <= priority) { second = top; secondLayer = topLayer; top = this.objColors[x]; topLayer = 4; }
          else if (p <= secondPriority) { second = this.objColors[x]; secondLayer = 4; }
        }
        const semi = topLayer === 4 && this.objAlpha[x];
        const enabled = !!(mask & 32), firstTarget = !!(blend & 1 << topLayer), secondTarget = !!(blend & (256 << secondLayer));
        const offset = (line * 240 + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          let value = top >>> (channel * 5) & 31;
          if (enabled && secondTarget && (semi || effect === 1 && firstTarget)) value = Math.min(31, (value * eva + (second >>> (channel * 5) & 31) * evb) >>> 4);
          else if (enabled && firstTarget && effect === 2) value += (31 - value) * fade >>> 4;
          else if (enabled && firstTarget && effect === 3) value -= value * fade >>> 4;
          g.pixels[offset + channel] = value << 3 | value >>> 2;
        }
        g.pixels[offset + 3] = 255;
      }
      this.advanceAffineReferences(line);
      this.lineReady = false;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { Graphics };
  else root.PocketGBAGraphics = Graphics;
})(globalThis);
