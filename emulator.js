(function (root) {
  "use strict";

  const CPU = typeof module !== "undefined" && module.exports ? require("./cpu.js").CPU : root.PocketCPU;
  const Cartridge = typeof module !== "undefined" && module.exports ? require("./cartridge.js").Cartridge : root.PocketCartridge;
  const APU = typeof module !== "undefined" && module.exports ? require("./audio.js").APU : root.PocketAPU;
  const SHADES = [[232, 240, 208], [136, 176, 112], [52, 104, 86], [16, 40, 40]];

  class GameBoy {
    constructor(bytes, sampleRate = 48000) {
      this.cartridge = new Cartridge(bytes);
      this.color = this.cartridge.color;
      this.vram = new Uint8Array(0x4000);
      this.wram = new Uint8Array(0x8000);
      this.oam = new Uint8Array(160);
      this.io = new Uint8Array(128);
      this.hram = new Uint8Array(127);
      this.bgPalette = new Uint8Array(64).fill(255);
      this.objPalette = new Uint8Array(64).fill(255);
      this.pixels = new Uint8ClampedArray(160 * 144 * 4);
      this.pixels.fill(255);
      this.cpu = new CPU(this, this.color);
      this.apu = new APU(sampleRate);
      this.ie = 0;
      this.div = 0xabcc;
      this.timerDelay = 0;
      this.dot = 0;
      this.ly = 0;
      this.windowLine = 0;
      this.statLine = false;
      this.frames = 0;
      this.doubleSpeed = false;
      this.speedPhase = 0;
      this.stall = 0;
      this.buttons = 0;
      this.serialCycles = 0;
      this.serialOutput = "";
      this.hdmaBlocks = 0;
      this.hdmaSource = 0;
      this.hdmaDestination = 0;
      this.hdmaActive = false;
      this.io[0] = 0x30;
      this.io[0x0f] = 1;
      this.io[0x40] = 0x91;
      this.io[0x47] = 0xfc;
      this.io[0x48] = this.io[0x49] = 255;
      this.io[0x55] = 255;
      this.io[0x70] = 1;
      this.updateSTAT();
    }
    interrupt(bit) { this.io[0x0f] |= 1 << bit; }
    joypad() {
      let value = 15;
      if (!(this.io[0] & 0x10)) value &= ~(this.buttons & 15);
      if (!(this.io[0] & 0x20)) value &= ~((this.buttons >> 4) & 15);
      return 0xc0 | this.io[0] | value;
    }
    setButton(index, pressed) {
      const before = this.joypad();
      if (pressed) this.buttons |= 1 << index;
      else this.buttons &= ~(1 << index);
      if (before & ~this.joypad() & 15) this.interrupt(4);
      if (pressed) this.cpu.stopped = false;
    }
    releaseButtons() { this.buttons = 0; }
    wramBank() { return this.color ? (this.io[0x70] & 7) || 1 : 1; }
    read(address, cpuAccess = true) {
      address &= 0xffff;
      if (address < 0x8000) return this.cartridge.readROM(address);
      if (address < 0xa000) {
        if (cpuAccess && this.mode() === 3) return 255;
        return this.vram[(address & 0x1fff) + (this.color ? (this.io[0x4f] & 1) * 8192 : 0)];
      }
      if (address < 0xc000) return this.cartridge.readRAM(address);
      if (address < 0xd000) return this.wram[address & 0xfff];
      if (address < 0xe000) return this.wram[this.wramBank() * 4096 + (address & 0xfff)];
      if (address < 0xfe00) return this.read(address - 0x2000, cpuAccess);
      if (address < 0xfea0) {
        if (cpuAccess && this.mode() >= 2) return 255;
        return this.oam[address - 0xfe00];
      }
      if (address < 0xff00) return 255;
      if (address < 0xff80) return this.readIO(address & 127);
      if (address < 0xffff) return this.hram[address - 0xff80];
      return this.ie;
    }
    readIO(index) {
      if (index === 0) return this.joypad();
      if (index === 2) return this.io[index] | (this.color ? 0x7c : 0x7e);
      if (index === 3 || (index >= 8 && index <= 14)) return 255;
      if (index === 4) return this.div >> 8;
      if (index === 7) return this.io[index] | 0xf8;
      if (index === 0x0f) return this.io[index] | 0xe0;
      if (index >= 0x10 && index <= 0x3f) return this.apu.read(0xff00 | index);
      if (index === 0x41) return 0x80 | (this.io[index] & 0x78) | (this.lcdLine() === this.io[0x45] ? 4 : 0) | this.mode();
      if (index === 0x44) return this.lcdLine();
      if (index === 0x4d) return this.color ? 0x7e | (this.doubleSpeed ? 128 : 0) | (this.io[index] & 1) : 255;
      if (index === 0x4f) return this.color ? 0xfe | (this.io[index] & 1) : 255;
      if (index >= 0x51 && index <= 0x54) return 255;
      if (index >= 0x51 && index <= 0x55 && !this.color) return 255;
      if (index === 0x68 || index === 0x6a) return this.color ? this.io[index] | 0x40 : 255;
      if (index === 0x69) return this.color && this.mode() !== 3 ? this.bgPalette[this.io[0x68] & 63] : 255;
      if (index === 0x6b) return this.color && this.mode() !== 3 ? this.objPalette[this.io[0x6a] & 63] : 255;
      if (index === 0x6c) return this.color ? this.io[index] | 0xfe : 255;
      if (index === 0x70) return this.color ? this.io[index] | 0xf8 : 255;
      if ([0x4c, 0x4e, 0x50, 0x56, 0x57].includes(index)
        || (index >= 0x58 && index <= 0x67) || index === 0x6d || index === 0x6e || index === 0x6f
        || index >= 0x71) return 255;
      return this.io[index];
    }
    write(address, value) {
      address &= 0xffff; value &= 255;
      if (address < 0x8000) this.cartridge.control(address, value);
      else if (address < 0xa000) {
        if (this.mode() !== 3) this.vram[(address & 0x1fff) + (this.color ? (this.io[0x4f] & 1) * 8192 : 0)] = value;
      }
      else if (address < 0xc000) this.cartridge.writeRAM(address, value);
      else if (address < 0xd000) this.wram[address & 0xfff] = value;
      else if (address < 0xe000) this.wram[this.wramBank() * 4096 + (address & 0xfff)] = value;
      else if (address < 0xfe00) this.write(address - 0x2000, value);
      else if (address < 0xfea0) {
        if (this.mode() < 2) this.oam[address - 0xfe00] = value;
      }
      else if (address < 0xff00) return;
      else if (address < 0xff80) this.writeIO(address & 127, value);
      else if (address < 0xffff) this.hram[address - 0xff80] = value;
      else this.ie = value;
    }
    timerSignal() {
      return !!((this.io[7] & 4) && (this.div & (1 << [9, 3, 5, 7][this.io[7] & 3])));
    }
    incrementTimer() {
      if (this.timerDelay) return;
      this.io[5] = (this.io[5] + 1) & 255;
      if (this.io[5] === 0) this.timerDelay = 4;
    }
    writeIO(index, value) {
      if (index >= 0x10 && index <= 0x3f) { this.apu.write(0xff00 | index, value); return; }
      if (index === 0) {
        const before = this.joypad();
        this.io[0] = value & 0x30;
        if (before & ~this.joypad() & 15) this.interrupt(4);
        return;
      }
      if (index === 4 || index === 7) {
        const before = this.timerSignal();
        if (index === 4) this.div = 0;
        else this.io[7] = value & 7;
        if (before && !this.timerSignal() && (index === 4 || !this.color || (value & 4))) this.incrementTimer();
        return;
      }
      if (index === 5) { this.io[5] = value; this.timerDelay = 0; return; }
      if (index === 0x0f) { this.io[index] = value & 31; return; }
      if (index === 0x41) { this.io[index] = value & 0x78; this.updateSTAT(); return; }
      if (index === 0x44) return;
      if (index === 0x40) {
        const enabled = !!(this.io[index] & 128);
        this.io[index] = value;
        if (enabled !== !!(value & 128)) {
          this.dot = this.ly = this.windowLine = 0;
          this.statLine = false;
          if (!(value & 128)) this.pixels.fill(255);
          this.updateSTAT();
        }
        return;
      }
      if (index === 0x45) { this.io[index] = value; this.updateSTAT(); return; }
      if (index === 0x46) {
        this.io[index] = value;
        for (let i = 0; i < 160; i++) this.oam[i] = this.read((value << 8) + i, false);
        this.stall += 640;
        return;
      }
      if ([0x4d, 0x4f, 0x70, 0x68, 0x69, 0x6a, 0x6b, 0x6c].includes(index) && !this.color) return;
      if (index === 0x4d) { this.io[index] = value & 1; return; }
      if (index === 0x4f) { this.io[index] = value & 1; return; }
      if (index === 0x70) { this.io[index] = value & 7; return; }
      if (index === 0x69 || index === 0x6b) {
        const control = index - 1;
        const palette = index === 0x69 ? this.bgPalette : this.objPalette;
        if (this.mode() !== 3) palette[this.io[control] & 63] = value;
        if (this.io[control] & 128) this.io[control] = 128 | ((this.io[control] + 1) & 63);
        return;
      }
      if (index >= 0x51 && index <= 0x55) {
        if (!this.color) return;
        if (index !== 0x55) { this.io[index] = value; return; }
        if (this.hdmaActive && !(value & 128)) {
          this.hdmaActive = false;
          this.io[0x55] = 128 | (this.hdmaBlocks - 1);
          return;
        }
        this.hdmaSource = (this.io[0x51] << 8) | (this.io[0x52] & 0xf0);
        this.hdmaDestination = ((this.io[0x53] & 31) << 8) | (this.io[0x54] & 0xf0);
        this.hdmaBlocks = (value & 127) + 1;
        this.hdmaActive = !!(value & 128) && !!(this.io[0x40] & 128);
        this.io[0x55] = this.hdmaBlocks - 1;
        if (!this.hdmaActive) while (this.hdmaBlocks) this.transferBlock();
        else if (this.mode() === 0) this.transferBlock();
        return;
      }
      if (index === 2) this.serialCycles = 0;
      this.io[index] = value;
    }
    transferBlock() {
      const bank = (this.io[0x4f] & 1) * 8192;
      for (let i = 0; i < 16; i++) {
        this.vram[bank + ((this.hdmaDestination + i) & 8191)] = this.read((this.hdmaSource + i) & 0xffff, false);
      }
      this.hdmaSource = (this.hdmaSource + 16) & 0xffff;
      this.hdmaDestination = (this.hdmaDestination + 16) & 8191;
      this.io[0x51] = this.hdmaSource >> 8;
      this.io[0x52] = this.hdmaSource & 0xf0;
      this.io[0x53] = this.hdmaDestination >> 8;
      this.io[0x54] = this.hdmaDestination & 0xf0;
      this.io[0x55] = --this.hdmaBlocks ? this.hdmaBlocks - 1 : 255;
      if (!this.hdmaBlocks) this.hdmaActive = false;
      this.stall += this.doubleSpeed ? 64 : 32;
    }
    switchSpeed() {
      if (!this.color || !(this.io[0x4d] & 1)) return false;
      this.doubleSpeed = !this.doubleSpeed;
      this.io[0x4d] = 0;
      this.div = 0;
      return true;
    }
    lcdLine() {
      // LY resets early on the last VBlank line; the PPU remains in mode 1.
      return this.ly === 153 && this.dot >= 4 ? 0 : this.ly;
    }
    mode() {
      if (!(this.io[0x40] & 128)) return 0;
      if (this.ly >= 144) return 1;
      return this.dot < 80 ? 2 : this.dot < 252 ? 3 : 0;
    }
    updateSTAT() {
      const stat = this.io[0x41], mode = this.mode();
      const active = !!(this.io[0x40] & 128) && (
        (this.lcdLine() === this.io[0x45] && (stat & 64))
        || (mode === 0 && (stat & 8)) || (mode === 1 && (stat & 16)) || (mode === 2 && (stat & 32)));
      if (active && !this.statLine) this.interrupt(1);
      this.statLine = !!active;
    }
    tick(cycles) {
      let baseCycles = 0;
      for (let i = 0; i < cycles; i++) {
        if (this.timerDelay && --this.timerDelay === 0) {
          this.io[5] = this.io[6]; this.interrupt(2);
        }
        const timerBefore = this.timerSignal();
        this.div = (this.div + 1) & 0xffff;
        if (timerBefore && !this.timerSignal()) this.incrementTimer();
        if ((this.io[2] & 0x81) === 0x81) {
          const period = this.color && (this.io[2] & 2) ? 128 : 4096;
          if (++this.serialCycles >= period) {
            this.serialOutput += String.fromCharCode(this.io[1]);
            this.io[1] = 255; this.io[2] &= ~128; this.interrupt(3);
          }
        }
        if (this.doubleSpeed && (this.speedPhase ^= 1)) continue;
        baseCycles++;
        if (this.io[0x40] & 128) {
          this.dot++;
          if (this.ly === 153 && this.dot === 4) this.updateSTAT();
          if (this.dot === 80) this.updateSTAT();
          if (this.dot === 252 && this.ly < 144) {
            this.renderLine();
            if (this.hdmaActive) this.transferBlock();
            this.updateSTAT();
          }
          if (this.dot === 456) {
            this.dot = 0;
            this.ly++;
            if (this.ly === 144) { this.interrupt(0); this.frames++; }
            if (this.ly === 154) { this.ly = 0; this.windowLine = 0; }
            this.updateSTAT();
          }
        }
      }
      this.apu.tick(baseCycles);
      return baseCycles;
    }
    step() {
      let cycles;
      if (this.stall) { cycles = this.stall; this.stall = 0; }
      else cycles = this.cpu.step();
      return this.tick(cycles);
    }
    runCycles(budget) {
      let elapsed = 0;
      while (elapsed < budget) elapsed += this.step();
      return elapsed;
    }
    tilePixel(tile, attributes, x, y, unsigned) {
      if (attributes & 0x20) x = 7 - x;
      if (attributes & 0x40) y = 7 - y;
      const offset = unsigned ? tile * 16 : 0x1000 + (tile < 128 ? tile : tile - 256) * 16;
      const bank = this.color && (attributes & 8) ? 8192 : 0;
      const low = this.vram[bank + offset + y * 2], high = this.vram[bank + offset + y * 2 + 1];
      return ((low >> (7 - x)) & 1) | (((high >> (7 - x)) & 1) << 1);
    }
    paint(x, color, palette, object = false) {
      const offset = (this.ly * 160 + x) * 4;
      if (this.color) {
        const data = object ? this.objPalette : this.bgPalette, index = palette * 8 + color * 2;
        const rgb = data[index] | (data[index + 1] << 8);
        this.pixels[offset] = Math.round((rgb & 31) * 255 / 31);
        this.pixels[offset + 1] = Math.round(((rgb >> 5) & 31) * 255 / 31);
        this.pixels[offset + 2] = Math.round(((rgb >> 10) & 31) * 255 / 31);
      } else {
        const register = object ? this.io[palette ? 0x49 : 0x48] : this.io[0x47];
        const shade = SHADES[(register >> (color * 2)) & 3];
        this.pixels.set(shade, offset);
      }
      this.pixels[offset + 3] = 255;
    }
    renderLine() {
      const lcd = this.io[0x40], bgColors = new Uint8Array(160), bgPriority = new Uint8Array(160);
      const windowX = this.io[0x4b] - 7;
      const windowVisible = !!(lcd & 0x20) && (this.color || !!(lcd & 1))
        && this.ly >= this.io[0x4a] && windowX < 160;
      for (let x = 0; x < 160; x++) {
        const window = windowVisible && x >= windowX;
        const px = window ? x - windowX : (x + this.io[0x43]) & 255;
        const py = window ? this.windowLine : (this.ly + this.io[0x42]) & 255;
        const map = (window ? lcd & 0x40 : lcd & 8) ? 0x1c00 : 0x1800;
        const tileIndex = map + (py >> 3) * 32 + (px >> 3);
        const attributes = this.color ? this.vram[8192 + tileIndex] : 0;
        const color = this.color || (lcd & 1)
          ? this.tilePixel(this.vram[tileIndex], attributes, px & 7, py & 7, !!(lcd & 16)) : 0;
        bgColors[x] = color;
        bgPriority[x] = attributes & 128;
        this.paint(x, color, attributes & 7);
      }
      if (windowVisible) this.windowLine++;
      if (!(lcd & 2)) return;
      const sprites = [], height = lcd & 4 ? 16 : 8;
      for (let i = 0; i < 40 && sprites.length < 10; i++) {
        const y = this.oam[i * 4] - 16;
        if (this.ly >= y && this.ly < y + height) sprites.push(i);
      }
      if (!this.color || (this.io[0x6c] & 1)) {
        sprites.sort((a, b) => this.oam[a * 4 + 1] - this.oam[b * 4 + 1] || a - b);
      }
      const covered = new Uint8Array(160);
      for (const i of sprites) {
        const offset = i * 4, left = this.oam[offset + 1] - 8, attr = this.oam[offset + 3];
        let row = this.ly - (this.oam[offset] - 16);
        if (attr & 0x40) row = height - 1 - row;
        const tile = height === 16 ? (this.oam[offset + 2] & 0xfe) + (row >> 3) : this.oam[offset + 2];
        for (let dx = 0; dx < 8; dx++) {
          const x = left + dx;
          if (x < 0 || x >= 160 || covered[x]) continue;
          const color = this.tilePixel(tile, attr & ~0x40, dx, row & 7, true);
          if (!color) continue;
          covered[x] = 1;
          if (bgColors[x] && (!this.color || (lcd & 1)) && ((attr & 128) || bgPriority[x])) continue;
          this.paint(x, color, this.color ? attr & 7 : (attr >> 4) & 1, true);
        }
      }
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { GameBoy };
  else root.PocketGameBoy = GameBoy;
})(globalThis);
