(function (root) {
  "use strict";

  const commonJS = typeof module !== "undefined" && module.exports;
  const CPU = commonJS ? require("./cpu.js").CPU : root.PocketGBACPU;
  const Cartridge = commonJS ? require("./cartridge.js").Cartridge : root.PocketGBACartridge;
  const Graphics = commonJS ? require("./graphics.js").Graphics : root.PocketGBAGraphics;
  const APU = commonJS ? require("./audio.js").APU : root.PocketGBAAPU;
  const SINE = Array.from({ length: 256 }, (_, angle) => Math.trunc(Math.sin(angle * Math.PI / 128) * 16384));

  class GameBoyAdvance {
    constructor(bytes, sampleRate = 48000) {
      this.cartridge = new Cartridge(bytes);
      this.system = "gba";
      this.width = 240; this.height = 160; this.clock = 16777216;
      this.ewram = new Uint8Array(0x40000); this.iwram = new Uint8Array(0x8000);
      this.io = new Uint8Array(0x400); this.palette = new Uint8Array(1024);
      this.vram = new Uint8Array(0x18000); this.oam = new Uint8Array(1024);
      this.pixels = new Uint8ClampedArray(240 * 160 * 4);
      this.pixels.fill(255);
      this.framePixels = new Uint8ClampedArray(240 * 160 * 4);
      this.framePixels.fill(255);
      this.cpu = new CPU(this);
      this.graphics = new Graphics(this);
      this.apu = new APU(sampleRate);
      this.frames = 0; this.line = 0; this.dot = 0;
      this.buttons = 0x3ff; this.halted = false; this.waitMask = 0;
      this.stopped = false;
      this.dma = Array.from({ length: 4 }, () => ({ source: 0, destination: 0, initialDestination: 0, count: 0 }));
      this.timers = Array.from({ length: 4 }, () => ({ counter: 0, reload: 0, phase: 0 }));
      this.dmaStall = 0; this.dmaBusy = false;
      this.lastStop = null;
      this.resets = [];
      this.setIO16(0, 128); this.setIO16(0x130, 0x3ff);
      this.setIO16(4, 4);
      for (const offset of [0x20, 0x26, 0x30, 0x36]) this.setIO16(offset, 256);
    }
    io16(offset) { return this.io[offset] | this.io[offset + 1] << 8; }
    io32(offset) { return (this.io16(offset) | this.io16(offset + 2) << 16) >>> 0; }
    setIO16(offset, value) { this.io[offset] = value & 255; this.io[offset + 1] = value >>> 8 & 255; }
    memory(address) {
      switch (address >>> 24) {
        case 2: return [this.ewram, address & 0x3ffff];
        case 3: return [this.iwram, address & 0x7fff];
        case 4: return address < 0x04000400 ? [this.io, address & 1023] : null;
        case 5: return [this.palette, address & 1023];
        case 6: {
          let offset = address & 0x1ffff;
          if (offset >= 0x18000) offset -= 0x8000;
          return [this.vram, offset];
        }
        case 7: return [this.oam, address & 1023];
        default: return null;
      }
    }
    refillAudioFIFO(address) {
      for (const index of [1, 2]) {
        const control = this.io16(0xba + index * 12);
        if ((control >>> 12 & 3) === 3 && this.dma[index].destination === address) this.transfer(index);
      }
    }
    read8(address) {
      address >>>= 0;
      const region = address >>> 24;
      if (region >= 8 && region <= 13) return this.cartridge.readROM(address);
      if (region === 14 || region === 15) return this.cartridge.readRAM(address);
      if (region === 4 && address >= 0x04000100 && address < 0x04000110) {
        const offset = address - 0x04000100;
        if ((offset & 3) < 2) return this.timers[offset >>> 2].counter >>> ((offset & 1) * 8) & 255;
      }
      if (region === 4 && address >= 0x04000084 && address < 0x04000086) {
        return this.apu.readRegister(address - 0x04000000);
      }
      const memory = this.memory(address);
      return memory ? memory[0][memory[1]] : (this.openBus || 0) >>> ((address & 3) * 8) & 255;
    }
    read16(address) {
      if (this.cartridge.isEEPROM(address)) return this.cartridge.readEEPROM();
      if ((address >>> 24) === 14 || (address >>> 24) === 15) return this.read8(address) * 0x101;
      address &= ~1;
      const region = address >>> 24;
      if (region >= 8 && region <= 13) {
        return this.cartridge.readROM(address) | this.cartridge.readROM(address + 1) << 8;
      }
      let memory, offset;
      if (region === 2) { memory = this.ewram; offset = address & 0x3ffff; }
      else if (region === 3) { memory = this.iwram; offset = address & 0x7fff; }
      else if (region === 5) { memory = this.palette; offset = address & 1023; }
      else if (region === 6) {
        memory = this.vram; offset = address & 0x1ffff;
        if (offset >= 0x18000) offset -= 0x8000;
      } else if (region === 7) { memory = this.oam; offset = address & 1023; }
      if (memory) {
        return memory[offset] | memory[offset + 1] << 8;
      }
      return this.read8(address) | this.read8(address + 1) << 8;
    }
    read32(address) {
      if ((address >>> 24) === 14 || (address >>> 24) === 15) return (this.read8(address) * 0x01010101) >>> 0;
      address &= ~3;
      const region = address >>> 24;
      if (region >= 8 && region <= 13 && !this.cartridge.isEEPROM(address)
        && !this.cartridge.isEEPROM(address + 2)) {
        return (this.cartridge.readROM(address) | this.cartridge.readROM(address + 1) << 8
          | this.cartridge.readROM(address + 2) << 16 | this.cartridge.readROM(address + 3) << 24) >>> 0;
      }
      let memory, offset;
      if (region === 2) { memory = this.ewram; offset = address & 0x3fffc; }
      else if (region === 3) { memory = this.iwram; offset = address & 0x7ffc; }
      else if (region === 5) { memory = this.palette; offset = address & 1020; }
      else if (region === 6) {
        memory = this.vram; offset = address & 0x1ffff;
        if (offset >= 0x18000) offset -= 0x8000;
      } else if (region === 7) { memory = this.oam; offset = address & 1020; }
      if (memory) {
        return (memory[offset] | memory[offset + 1] << 8
          | memory[offset + 2] << 16 | memory[offset + 3] << 24) >>> 0;
      }
      return (this.read16(address) | this.read16(address + 2) << 16) >>> 0;
    }
    write8(address, value) {
      address >>>= 0; value &= 255;
      const region = address >>> 24;
      if (region === 14 || region === 15) { this.cartridge.writeRAM(address, value); return; }
      if (region === 4) { this.writeIO(address - 0x04000000, value); return; }
      const memory = this.memory(address);
      if (!memory || region === 7) return;
      if (region === 5 || region === 6) {
        const limit = (this.io16(0) & 7) < 3 ? 0x10000 : 0x14000;
        if (region === 6 && memory[1] >= limit) return;
        memory[0][memory[1] & ~1] = memory[0][memory[1] | 1] = value;
      } else memory[0][memory[1]] = value;
    }
    write16(address, value) {
      address &= ~1;
      if (this.cartridge.isEEPROM(address)) { this.cartridge.writeEEPROM(value); return; }
      if ((address >>> 24) >= 14) { this.cartridge.writeRAM(address, value >>> ((address & 1) * 8)); return; }
      if ((address >>> 24) === 4) {
        this.writeIO(address - 0x04000000, value & 255); this.writeIO(address - 0x04000000 + 1, value >>> 8 & 255); return;
      }
      const memory = this.memory(address);
      if (!memory) return;
      memory[0][memory[1]] = value & 255; memory[0][memory[1] + 1] = value >>> 8 & 255;
    }
    write32(address, value) {
      address &= ~3;
      if ((address >>> 24) >= 14) { this.cartridge.writeRAM(address, value & 255); return; }
      this.write16(address, value); this.write16(address + 2, value >>> 16);
    }
    writeIO(offset, value) {
      if (offset < 0 || offset >= 1024 || offset === 6 || offset === 7 || offset === 0x130 || offset === 0x131) return;
      if (offset >= 0xa0 && offset <= 0xa7) {
        this.apu.writeFIFO(offset, value);
        return;
      }
      if (offset >= 0x60 && offset <= 0x9f) value = this.apu.writeRegister(offset, value);
      if (offset === 0x202 || offset === 0x203) { this.io[offset] &= ~value; return; }
      if (offset === 0x301) {
        this.halted = true; this.stopped = !!(value & 128); return;
      }
      if (offset === 4) value = (value & 0xf8) | (this.io[4] & 7);
      const previous = this.io[offset]; this.io[offset] = value;
      if (offset >= 0x28 && offset < 0x30 || offset >= 0x38 && offset < 0x40) {
        this.graphics.affineReferenceWrite(offset);
      }
      if (offset >= 0x100 && offset < 0x110) {
        const timer = this.timers[(offset - 0x100) >>> 2], part = offset & 3;
        if (part < 2) timer.reload = this.io16(offset & ~3);
        if (part === 2 && !(previous & 128) && value & 128) { timer.counter = timer.reload; timer.phase = 0; }
      }
      for (let i = 0; i < 4; i++) {
        const base = 0xb0 + i * 12;
        if (offset === base + 11 && !(previous & 128) && value & 128) {
          const dma = this.dma[i];
          dma.source = this.io32(base) & (i === 0 ? 0x07ffffff : 0x0fffffff);
          dma.initialDestination = dma.destination = this.io32(base + 4) & (i === 3 ? 0x0fffffff : 0x07ffffff);
          dma.count = this.io16(base + 8) & (i === 3 ? 65535 : 16383);
          if (!dma.count) dma.count = i === 3 ? 65536 : 16384;
          const timing = value >>> 4 & 3;
          if (timing === 0) this.transfer(i);
        }
      }
      if (offset === 0x132 || offset === 0x133) this.checkKeys();
    }
    transfer(index) {
      const base = 0xb0 + index * 12, control = this.io16(base + 10), dma = this.dma[index];
      if (!(control & 0x8000) || this.dmaBusy) return;
      // Special timing is the sound FIFO on DMA1/DMA2 only; DMA3 capture runs once per scanline.
      const sound = (control >>> 12 & 3) === 3 && (index === 1 || index === 2);
      if (sound && ![0x040000a0, 0x040000a4].includes(dma.destination)) {
        throw this.cpu.fail("dma", "DMA audio GBA avec destination invalide.", { channel: index, destination: dma.destination });
      }
      const size = sound || control & 1024 ? 4 : 2, count = sound ? 4 : dma.count;
      // Source control 3 is reserved; the hardware increments the address.
      const srcMode = control >>> 7 & 3, dstMode = sound ? 2 : control >>> 5 & 3;
      const eepromRead = this.cartridge.isEEPROM(dma.source), eepromWrite = this.cartridge.isEEPROM(dma.destination);
      if (eepromRead || eepromWrite) {
        if (index !== 3 || size !== 2 || eepromRead && eepromWrite) {
          throw this.cpu.fail("dma", "EEPROM GBA : transfert DMA3 16 bits requis.", { channel: index, source: dma.source, destination: dma.destination });
        }
        this.cartridge.beginEEPROMTransfer(count, eepromRead);
      }
      this.dmaBusy = true;
      try {
        for (let i = 0; i < count; i++) {
          const src = dma.source & ~(size - 1), dst = dma.destination & ~(size - 1);
          if (size === 4) this.write32(dst, this.read32(src)); else this.write16(dst, this.read16(src));
          dma.source = (dma.source + [size, -size, 0, size][srcMode]) >>> 0;
          dma.destination = (dma.destination + [size, -size, 0, size][dstMode]) >>> 0;
        }
        if (eepromRead || eepromWrite) this.cartridge.finishEEPROMTransfer();
      } finally {
        this.dmaBusy = false;
        this.cartridge.eepromInput = null; this.cartridge.eepromReading = false;
      }
      this.dmaStall += count * 2;
      if (control & 0x4000) this.interrupt(1 << (8 + index));
      if (!sound && (!(control & 512) || !(control & 0x3000))) this.setIO16(base + 10, control & ~0x8000);
      else if (dstMode === 3) dma.destination = dma.initialDestination;
    }
    triggerDMA(timing) {
      for (let i = 0; i < 4; i++) if ((this.io16(0xba + i * 12) >>> 12 & 3) === timing) this.transfer(i);
    }
    captureDMA(line) {
      const control = this.io16(0xde);
      if ((control >>> 12 & 3) !== 3) return;
      if (line >= 162) this.setIO16(0xde, control & ~0x8000);
      else if (line >= 2) this.transfer(3);
    }
    interrupt(mask) {
      this.setIO16(0x202, this.io16(0x202) | mask);
      if (this.waitMask & mask & this.io16(0x200)) {
        this.waitMask = 0; this.halted = false;
      }
    }
    tickTimers(cycles) {
      let cascaded = 0;
      for (let i = 0; i < 4; i++) {
        const timer = this.timers[i], control = this.io16(0x102 + i * 4);
        if (!(control & 128)) { cascaded = 0; continue; }
        let ticks;
        if (i && control & 4) ticks = cascaded;
        else {
          const scale = [1, 64, 256, 1024][control & 3];
          timer.phase += cycles; ticks = Math.floor(timer.phase / scale); timer.phase %= scale;
        }
        cascaded = 0;
        const total = timer.counter + ticks;
        if (total > 65535) {
          const period = 65536 - timer.reload;
          cascaded = 1 + Math.floor((total - 65536) / period);
          timer.counter = timer.reload + (total - 65536) % period;
          if (control & 64) this.interrupt(1 << (3 + i));
          this.apu.timerOverflow(i, cascaded, address => this.refillAudioFIFO(address));
        } else timer.counter = total;
      }
    }
    tick(cycles) {
      if (this.stopped) return;
      this.cartridge.tick(cycles);
      this.apu.tick(cycles);
      this.tickTimers(cycles);
      while (cycles > 0) {
        const end = this.dot < 960 ? 960 : 1232, step = Math.min(cycles, end - this.dot);
        this.dot += step; cycles -= step;
        if (this.dot === 960) {
          if (this.line < 160) this.graphics.line(this.line);
          this.io[4] |= 2;
          if (this.io[4] & 16) this.interrupt(2);
          if (this.line < 160) this.triggerDMA(2);
          if (this.line >= 2 && this.line < 162) this.captureDMA(this.line);
        } else if (this.dot === 1232) {
          this.dot = 0; this.line = (this.line + 1) % 228;
          this.io[4] &= ~2; this.setIO16(6, this.line);
          if (this.line === 162) this.captureDMA(162);
          if (this.line === 160) {
            this.frames++; this.framePixels.set(this.pixels); this.io[4] |= 1;
            if (this.io[4] & 8) this.interrupt(1);
            this.triggerDMA(1);
          }
          if (this.line === 227) this.io[4] &= ~1;
          if (this.line === this.io[5]) { this.io[4] |= 4; if (this.io[4] & 32) this.interrupt(4); }
          else this.io[4] &= ~4;
          if (this.line < 160) this.graphics.latchLine(this.line);
        }
      }
    }
    runCycles(budget) {
      let elapsed = 0;
      while (elapsed < budget) {
        let cycles;
        const pending = this.io16(0x200) & this.io16(0x202);
        if (pending && !this.waitMask) this.halted = false;
        if (pending && this.io16(0x208) & 1 && !(this.cpu.cpsr & 128)) {
          this.write16(0x03007ff8, this.read16(0x03007ff8) | pending);
          this.cpu.irq(); this.halted = false;
        }
        if (this.dmaStall) { cycles = Math.min(this.dmaStall, 64); this.dmaStall -= cycles; }
        else if (this.halted) cycles = Math.min(64, Math.ceil(budget - elapsed));
        else cycles = this.cpu.step();
        this.tick(cycles); elapsed += cycles;
      }
      return elapsed;
    }
    checkKeys() {
      const control = this.io16(0x132), mask = control & 1023, pressed = ~this.buttons & 1023;
      if (control & 0x4000 && (control & 0x8000 ? mask !== 0 && (pressed & mask) === mask : !!(pressed & mask))) this.interrupt(0x1000);
    }
    setButton(index, pressed) {
      const bit = [4, 5, 6, 7, 0, 1, 2, 3, 9, 8][index];
      if (bit === undefined) throw new Error("Commande GBA inconnue.");
      if (pressed) this.buttons &= ~(1 << bit); else this.buttons |= 1 << bit;
      if (pressed && this.stopped) { this.stopped = false; this.halted = false; }
      this.setIO16(0x130, this.buttons); this.checkKeys();
    }
    releaseButtons() { this.buttons = 1023; this.setIO16(0x130, this.buttons); }
    // Console restart (jump to the reset vector, SWI 0x26): the BIOS start-up clears memory and registers, then boots the ROM.
    reset(caller = 0) {
      if (this.resets.length < 16) this.resets.push({ frame: this.frames, caller: caller >>> 0 });
      this.registerRamReset(255);
      this.iwram.fill(0, 0x7e00);
      this.halted = false; this.stopped = false; this.waitMask = 0;
      this.cpu = new CPU(this); this.cpu.branch(0x08000000);
    }
    registerRamReset(flags) {
      if (flags & 1) this.ewram.fill(0);
      if (flags & 2) this.iwram.fill(0, 0, 0x7e00);
      if (flags & 4) this.palette.fill(0);
      if (flags & 8) this.vram.fill(0);
      if (flags & 16) this.oam.fill(0);
      if (flags & 32) { this.io.fill(0, 0x120, 0x130); this.io.fill(0, 0x134, 0x15a); }
      if (flags & 64) {
        this.io.fill(0, 0x60, 0xa8);
        this.apu.writeRegister(0x84, 0); this.apu.resetFIFO(0); this.apu.resetFIFO(1);
      }
      if (flags & 128) {
        this.io.fill(0, 0, 0x60); this.io.fill(0, 0xb0, 0x120); this.io.fill(0, 0x200, 0x20c);
        this.dmaStall = 0;
        for (const dma of this.dma) Object.assign(dma, { source: 0, destination: 0, initialDestination: 0, count: 0 });
        for (const timer of this.timers) Object.assign(timer, { counter: 0, reload: 0, phase: 0 });
        for (const offset of [0x20, 0x26, 0x30, 0x36]) this.setIO16(offset, 256);
        this.setIO16(6, this.line);
        this.io[4] = (this.line >= 160 && this.line < 227 ? 1 : 0) | (this.dot >= 960 ? 2 : 0)
          | (this.line === 0 ? 4 : 0);
      }
      this.setIO16(0, 128);
    }
    swi(number) {
      const r = this.cpu.r;
      if (number === 0) {
        const destination = this.read8(0x03007ffa) ? 0x02000000 : 0x08000000;
        this.iwram.fill(0, 0x7e00); this.cpu = new CPU(this); this.cpu.branch(destination); return;
      }
      if (number === 1) { this.registerRamReset(r[0]); return; }
      if (number === 2) { this.halted = true; return; }
      if (number === 3) { this.halted = true; this.stopped = true; return; }
      if (number === 4 || number === 5) {
        const mask = number === 5 ? 1 : r[1] & 0x3fff;
        if (!mask) throw this.cpu.fail("swi", "IntrWait GBA sans interruption selectionnee.", { swi: number });
        const flags = this.read16(0x03007ff8);
        if (number === 4 && !r[0] && flags & mask) { this.write16(0x03007ff8, flags & ~mask); return; }
        this.write16(0x03007ff8, flags & ~mask);
        this.setIO16(0x208, 1); this.waitMask = mask; this.halted = true; return;
      }
      if (number === 6 || number === 7) {
        const numerator = r[number === 6 ? 0 : 1] | 0, denominator = r[number === 6 ? 1 : 0] | 0;
        if (!denominator) throw this.cpu.fail("swi", "Division BIOS GBA par zero.", { swi: number });
        const result = Math.trunc(numerator / denominator);
        r[0] = result; r[1] = numerator % denominator; r[3] = Math.abs(result); return;
      }
      if (number === 8) { r[0] = Math.floor(Math.sqrt(r[0])); return; }
      if (number === 9) {
        const tangent = r[0] << 16 >> 16;
        r[0] = Math.trunc(Math.atan(tangent / 16384) * 32768 / Math.PI);
        return;
      }
      if (number === 0x0a) {
        const x = r[0] << 16 >> 16, y = r[1] << 16 >> 16;
        const angle = Math.atan2(y, x) * 32768 / Math.PI;
        r[0] = Math.trunc(angle + (angle < 0 ? 65536 : 0)) & 0xffff;
        return;
      }
      if (number === 0x0b || number === 0x0c) {
        const size = number === 0x0c || r[2] & 0x04000000 ? 4 : 2;
        let count = r[2] & 0x1fffff;
        if (number === 0x0c) count = Math.ceil(count / 8) * 8;
        let src = r[0] & ~(size - 1), dst = r[1] & ~(size - 1);
        const fill = !!(r[2] & 0x01000000);
        for (let i = 0; i < count; i++) {
          if (size === 4) this.write32(dst, this.read32(src)); else this.write16(dst, this.read16(src));
          if (!fill) src += size; dst += size;
        }
        this.dmaStall += count * 2; return;
      }
      if ([0x11, 0x12, 0x14, 0x15].includes(number)) {
        this.decompress(number); return;
      }
      if (number === 0x10) { this.bitUnpack(); return; }
      if (number === 0x13) { this.huffman(); return; }
      if (number === 0x16 || number === 0x17 || number === 0x18) { this.differenceFilter(number); return; }
      if (number === 0x0e || number === 0x0f) { this.affine(number); return; }
      if (number === 0x0d) { r[0] = 0xbaae187f; return; }
      if (number === 0x19) {
        // The BIOS steps SOUNDBIAS to the target level; only the final level is reproduced.
        this.setIO16(0x88, (this.io16(0x88) & ~0x3fe) | (r[0] ? 0x200 : 0));
        return;
      }
      if (number === 0x1f) {
        const frequency = this.read32(r[0] + 4), key = r[1] & 255, fine = r[2] & 255;
        r[0] = Math.trunc(frequency / 2 ** ((180 - key - fine / 256) / 12));
        return;
      }
      if (number === 0x26) { this.reset(this.cpu.r[14]); return; }
      if (number === 0x27) { this.write8(0x04000301, r[2] & 255); return; }
      throw this.cpu.fail("swi", `Service BIOS GBA non pris en charge : SWI 0x${number.toString(16)} a 0x${this.cpu.address.toString(16)}.`,
        { swi: number });
    }
    affine(number) {
      const r = this.cpu.r, background = number === 0x0e, stride = background ? 2 : r[3];
      let src = r[0], dst = r[1];
      for (let i = 0; i < r[2]; i++) {
        const scale = src + (background ? 12 : 0);
        const sx = this.read16(scale) << 16 >> 16, sy = this.read16(scale + 2) << 16 >> 16;
        const angle = this.read16(scale + 4) >>> 8, sin = SINE[angle], cos = SINE[(angle + 64) & 255];
        const pa = cos * sx >> 14, pb = -(sin * sx >> 14), pc = sin * sy >> 14, pd = cos * sy >> 14;
        for (const [index, value] of [pa, pb, pc, pd].entries()) this.write16(dst + index * stride, value);
        if (background) {
          const x = this.read16(src + 8) << 16 >> 16, y = this.read16(src + 10) << 16 >> 16;
          this.write32(dst + 8, (this.read32(src) | 0) - pa * x - pb * y);
          this.write32(dst + 12, (this.read32(src + 4) | 0) - pc * x - pd * y);
        }
        src += background ? 20 : 8; dst += background ? 16 : stride * 4;
      }
      this.dmaStall += r[2] * 32;
    }
    bitUnpack() {
      const r = this.cpu.r, source = r[0], destination = r[1], info = r[2];
      const length = this.read16(info), sourceWidth = this.read8(info + 2), destinationWidth = this.read8(info + 3);
      const packedOffset = this.read32(info + 4), zeroOffset = !!(packedOffset & 0x80000000);
      const offset = packedOffset & 0x7fffffff;
      if (![1, 2, 4, 8].includes(sourceWidth) || ![1, 2, 4, 8, 16, 32].includes(destinationWidth)
        || destinationWidth < sourceWidth || length > 0xffff) {
        throw new Error("Parametres BIOS BitUnPack GBA invalides.");
      }
      const units = length * 8 / sourceWidth;
      const perWord = 32 / destinationWidth, words = Math.ceil(units / perWord);
      const mask = destinationWidth === 32 ? 0xffffffff : 2 ** destinationWidth - 1;
      for (let word = 0; word < words; word++) {
        let value = 0;
        for (let item = 0; item < perWord; item++) {
          const index = word * perWord + item;
          if (index >= units) break;
          const bit = index * sourceWidth, raw = this.read8(source + (bit >>> 3)) >>> (bit & 7) & (2 ** sourceWidth - 1);
          const unpacked = raw || zeroOffset ? raw + offset : raw;
          value = (value | ((unpacked & mask) << (item * destinationWidth))) >>> 0;
        }
        this.write32(destination + word * 4, value);
      }
      this.dmaStall += words * 2;
    }
    huffman() {
      let source = this.cpu.r[0], destination = this.cpu.r[1];
      const header = this.read32(source), length = header >>> 8, width = header & 15;
      if ((header & 0xf0) !== 0x20 || ![4, 8].includes(width) || !length || length > 0x40000) {
        throw new Error("Flux Huffman BIOS GBA invalide.");
      }
      const treeSize = this.read8(source + 4), tree = source + 5;
      const bitstream = tree + (treeSize + 1) * 2;
      const output = new Uint8Array(length), symbols = length * 8 / width;
      let node = tree, bitIndex = 0, outputBits = 0;
      for (let symbol = 0; symbol < symbols; symbol++) {
        let value = -1, traversals = 0;
        while (value < 0) {
          if (++traversals > 64 || bitIndex >= length * 512) throw new Error("Arbre Huffman GBA invalide.");
          const address = bitstream + (bitIndex >>> 5) * 4;
          const bits = (this.read8(address) | this.read8(address + 1) << 8
            | this.read8(address + 2) << 16 | this.read8(address + 3) << 24) >>> 0;
          const branch = bits >>> (31 - (bitIndex & 31)) & 1;
          bitIndex++;
          const entry = this.read8(node), child = (node & ~1) + (entry & 63) * 2 + 2 + branch;
          const leaf = !!(entry & (branch ? 64 : 128));
          if (leaf) value = this.read8(child) & (2 ** width - 1);
          else node = child;
          if (leaf) node = tree;
        }
        output[outputBits >>> 3] |= value << (outputBits & 7);
        outputBits += width;
      }
      for (let offset = 0; offset < length; offset += 4) {
        this.write32(destination + offset, (output[offset] | output[offset + 1] << 8
          | output[offset + 2] << 16 | output[offset + 3] << 24) >>> 0);
      }
      this.dmaStall += Math.ceil(length / 4) * 2;
    }
    differenceFilter(number) {
      let source = this.cpu.r[0], destination = this.cpu.r[1];
      const header = this.read32(source), length = header >>> 8, wide = number === 0x18;
      if ((header & 255) !== (wide ? 0x81 : 0x80) || !length || length > 0x40000 || wide && length & 1) {
        throw new Error("Flux BIOS DiffFilter GBA invalide.");
      }
      source += 4;
      const output = new Uint8Array(length), unit = wide ? 2 : 1;
      let accumulator = 0;
      for (let offset = 0; offset < length; offset += unit) {
        const delta = wide ? this.read16(source + offset) : this.read8(source + offset);
        accumulator = wide ? (accumulator + delta) & 0xffff : (accumulator + delta) & 255;
        if (wide) { output[offset] = accumulator & 255; output[offset + 1] = accumulator >>> 8; }
        else output[offset] = accumulator;
      }
      if (number === 0x17) {
        for (let offset = 0; offset < length; offset += 2) this.write16(destination + offset, output[offset] | (output[offset + 1] || 0) << 8);
      } else {
        for (let offset = 0; offset < length; offset += unit) {
          if (wide) this.write16(destination + offset, output[offset] | output[offset + 1] << 8);
          else this.write8(destination + offset, output[offset]);
        }
      }
      this.dmaStall += Math.ceil(length / 4) * 2;
    }
    decompress(number) {
      let src = this.cpu.r[0], dst = this.cpu.r[1];
      const header = this.read32(src), length = header >>> 8, lz = number === 0x11 || number === 0x12;
      if ((header & 0xf0) !== (lz ? 0x10 : 0x30) || !length || length > 0x40000) throw new Error("Flux BIOS GBA compresse invalide.");
      src += 4;
      const output = new Uint8Array(length);
      let written = 0, reads = 0;
      const read = () => {
        if (++reads > length * 2 + 16) throw new Error("Flux BIOS GBA compresse tronque.");
        return this.read8(src++);
      };
      while (written < length) {
        const flag = read();
        if (lz) {
          for (let bit = 7; bit >= 0 && written < length; bit--) {
            if (flag & 1 << bit) {
              const a = read(), b = read(), count = (a >>> 4) + 3, distance = ((a & 15) << 8 | b) + 1;
              if (distance > written) throw new Error("Reference LZ77 GBA invalide.");
              for (let i = 0; i < count && written < length; i++, written++) output[written] = output[written - distance];
            } else output[written++] = read();
          }
        } else {
          const count = (flag & 127) + (flag & 128 ? 3 : 1), value = flag & 128 ? read() : null;
          for (let i = 0; i < count && written < length; i++) output[written++] = value === null ? read() : value;
        }
      }
      if (number === 0x12 || number === 0x15) for (let i = 0; i < length; i += 2) this.write16(dst + i, output[i] | (output[i + 1] || 0) << 8);
      else for (const value of output) this.write8(dst++, value);
      this.dmaStall += length;
    }
  }
  if (commonJS) module.exports = { GameBoyAdvance };
  else root.PocketGameBoyAdvance = GameBoyAdvance;
})(globalThis);
