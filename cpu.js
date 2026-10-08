(function (root) {
  "use strict";

  const Z = 0x80, N = 0x40, H = 0x20, C = 0x10;

  class CPU {
    constructor(bus, color = false) {
      this.bus = bus;
      this.a = color ? 0x11 : 1;
      this.f = color ? 0x80 : 0xb0;
      this.b = 0; this.c = color ? 0 : 0x13;
      this.d = color ? 0xff : 0; this.e = color ? 0x56 : 0xd8;
      this.h = color ? 0 : 1; this.l = color ? 0x0d : 0x4d;
      this.sp = 0xfffe;
      this.pc = 0x100;
      this.ime = false;
      this.imeDelay = 0;
      this.halted = false;
      this.stopped = false;
      this.haltBug = false;
    }

    read(address) { return this.bus.read(address & 0xffff); }
    write(address, value) { this.bus.write(address & 0xffff, value & 255); }
    fetch() {
      const value = this.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
      return value;
    }
    word() { return this.fetch() | (this.fetch() << 8); }
    get hl() { return (this.h << 8) | this.l; }
    set hl(value) { this.h = (value >> 8) & 255; this.l = value & 255; }
    pair(index, af = false) {
      return [(this.b << 8) | this.c, (this.d << 8) | this.e,
        this.hl, af ? (this.a << 8) | this.f : this.sp][index];
    }
    setPair(index, value, af = false) {
      value &= 0xffff;
      if (index === 0) { this.b = value >> 8; this.c = value & 255; }
      else if (index === 1) { this.d = value >> 8; this.e = value & 255; }
      else if (index === 2) this.hl = value;
      else if (af) { this.a = value >> 8; this.f = value & 0xf0; }
      else this.sp = value;
    }
    reg(index) {
      if (index === 6) return this.read(this.hl);
      return [this.b, this.c, this.d, this.e, this.h, this.l, 0, this.a][index];
    }
    setReg(index, value) {
      value &= 255;
      switch (index) {
        case 0: this.b = value; break;
        case 1: this.c = value; break;
        case 2: this.d = value; break;
        case 3: this.e = value; break;
        case 4: this.h = value; break;
        case 5: this.l = value; break;
        case 6: this.write(this.hl, value); break;
        case 7: this.a = value; break;
      }
    }
    push(value) {
      this.sp = (this.sp - 1) & 0xffff; this.write(this.sp, value >> 8);
      this.sp = (this.sp - 1) & 0xffff; this.write(this.sp, value);
    }
    pop() {
      const low = this.read(this.sp); this.sp = (this.sp + 1) & 0xffff;
      const high = this.read(this.sp); this.sp = (this.sp + 1) & 0xffff;
      return low | (high << 8);
    }
    condition(index) {
      return [!(this.f & Z), !!(this.f & Z), !(this.f & C), !!(this.f & C)][index];
    }
    inc(value) {
      const result = (value + 1) & 255;
      this.f = (this.f & C) | (result === 0 ? Z : 0) | ((value & 15) === 15 ? H : 0);
      return result;
    }
    dec(value) {
      const result = (value - 1) & 255;
      this.f = (this.f & C) | N | (result === 0 ? Z : 0) | ((value & 15) === 0 ? H : 0);
      return result;
    }
    alu(operation, value) {
      const a = this.a, carry = this.f & C ? 1 : 0;
      let result;
      if (operation < 4 || operation === 7) {
        const subtract = operation === 2 || operation === 3 || operation === 7;
        const extra = operation === 1 || operation === 3 ? carry : 0;
        result = subtract ? a - value - extra : a + value + extra;
        this.f = ((result & 255) === 0 ? Z : 0) | (subtract ? N : 0)
          | (subtract ? (a & 15) < (value & 15) + extra ? H : 0
            : (a & 15) + (value & 15) + extra > 15 ? H : 0)
          | (result < 0 || result > 255 ? C : 0);
        if (operation !== 7) this.a = result & 255;
      } else {
        result = operation === 4 ? a & value : operation === 5 ? a ^ value : a | value;
        this.a = result;
        this.f = (result === 0 ? Z : 0) | (operation === 4 ? H : 0);
      }
    }
    rotate(operation, value) {
      const carry = this.f & C ? 1 : 0;
      let bit = 0, result;
      switch (operation) {
        case 0: bit = value >> 7; result = (value << 1) | bit; break;
        case 1: bit = value & 1; result = (value >> 1) | (bit << 7); break;
        case 2: bit = value >> 7; result = (value << 1) | carry; break;
        case 3: bit = value & 1; result = (value >> 1) | (carry << 7); break;
        case 4: bit = value >> 7; result = value << 1; break;
        case 5: bit = value & 1; result = (value >> 1) | (value & 0x80); break;
        case 6: result = (value >> 4) | (value << 4); break;
        case 7: bit = value & 1; result = value >> 1; break;
      }
      result &= 255;
      this.f = (result === 0 ? Z : 0) | (bit ? C : 0);
      return result;
    }
    cb() {
      const opcode = this.fetch(), x = opcode >> 6, y = (opcode >> 3) & 7, z = opcode & 7;
      const value = this.reg(z);
      if (x === 0) this.setReg(z, this.rotate(y, value));
      else if (x === 1) this.f = (this.f & C) | H | (value & (1 << y) ? 0 : Z);
      else this.setReg(z, x === 2 ? value & ~(1 << y) : value | (1 << y));
      return z === 6 ? x === 1 ? 12 : 16 : 8;
    }
    addSP(offset) {
      const signed = offset < 128 ? offset : offset - 256;
      this.f = ((this.sp & 15) + (offset & 15) > 15 ? H : 0)
        | ((this.sp & 255) + offset > 255 ? C : 0);
      return (this.sp + signed) & 0xffff;
    }
    daa() {
      let adjust = 0, carry = !!(this.f & C);
      if (!(this.f & N)) {
        if (carry || this.a > 0x99) { adjust |= 0x60; carry = true; }
        if ((this.f & H) || (this.a & 15) > 9) adjust |= 6;
        this.a = (this.a + adjust) & 255;
      } else {
        if (carry) adjust |= 0x60;
        if (this.f & H) adjust |= 6;
        this.a = (this.a - adjust) & 255;
      }
      this.f = (this.f & N) | (this.a === 0 ? Z : 0) | (carry ? C : 0);
    }
    step() {
      const pending = this.read(0xffff) & this.read(0xff0f) & 31;
      if (pending) {
        this.halted = false;
        this.stopped = false;
        if (this.ime) {
          let bit = 0;
          while (!(pending & (1 << bit))) bit++;
          this.ime = false;
          this.imeDelay = 0;
          this.write(0xff0f, this.read(0xff0f) & ~(1 << bit));
          this.push(this.pc);
          this.pc = 0x40 + bit * 8;
          return 20;
        }
      }
      if (this.halted || this.stopped) return 4;
      const address = this.pc;
      const opcode = this.fetch();
      if (this.haltBug) { this.pc = (this.pc - 1) & 0xffff; this.haltBug = false; }
      const cycles = this.execute(opcode, address);
      if (this.imeDelay && --this.imeDelay === 0) this.ime = true;
      return cycles;
    }
    execute(opcode, address) {
      const x = opcode >> 6, y = (opcode >> 3) & 7, z = opcode & 7;
      const p = y >> 1, q = y & 1;
      let value, target;
      if (x === 0) {
        switch (z) {
          case 0:
            if (y === 0) return 4;
            if (y === 1) {
              target = this.word(); this.write(target, this.sp); this.write(target + 1, this.sp >> 8);
              return 20;
            }
            if (y === 2) {
              this.fetch();
              if (!this.bus.switchSpeed || !this.bus.switchSpeed()) this.stopped = true;
              return 4;
            }
            value = this.fetch(); value = value < 128 ? value : value - 256;
            if (y === 3 || this.condition(y - 4)) { this.pc = (this.pc + value) & 0xffff; return 12; }
            return 8;
          case 1:
            if (!q) { this.setPair(p, this.word()); return 12; }
            value = this.hl + this.pair(p);
            this.f = (this.f & Z) | ((this.hl & 0xfff) + (this.pair(p) & 0xfff) > 0xfff ? H : 0)
              | (value > 0xffff ? C : 0);
            this.hl = value; return 8;
          case 2:
            target = p < 2 ? this.pair(p) : this.hl;
            if (q) this.a = this.read(target);
            else this.write(target, this.a);
            if (p === 2) this.hl++;
            if (p === 3) this.hl--;
            return 8;
          case 3: this.setPair(p, this.pair(p) + (q ? -1 : 1)); return 8;
          case 4: this.setReg(y, this.inc(this.reg(y))); return y === 6 ? 12 : 4;
          case 5: this.setReg(y, this.dec(this.reg(y))); return y === 6 ? 12 : 4;
          case 6: this.setReg(y, this.fetch()); return y === 6 ? 12 : 8;
          case 7:
            if (y < 4) { this.a = this.rotate(y, this.a); this.f &= ~Z; }
            else if (y === 4) this.daa();
            else if (y === 5) { this.a ^= 255; this.f |= N | H; }
            else if (y === 6) this.f = (this.f & Z) | C;
            else this.f = (this.f & Z) | (this.f & C ? 0 : C);
            return 4;
        }
      } else if (x === 1) {
        if (opcode === 0x76) {
          if (!this.ime && (this.read(0xffff) & this.read(0xff0f) & 31)) this.haltBug = true;
          else this.halted = true;
          return 4;
        }
        this.setReg(y, this.reg(z)); return y === 6 || z === 6 ? 8 : 4;
      } else if (x === 2) {
        this.alu(y, this.reg(z)); return z === 6 ? 8 : 4;
      } else {
        switch (z) {
          case 0:
            if (y < 4) {
              if (this.condition(y)) { this.pc = this.pop(); return 20; }
              return 8;
            }
            if (y === 4) { this.write(0xff00 | this.fetch(), this.a); return 12; }
            if (y === 5) { this.sp = this.addSP(this.fetch()); return 16; }
            if (y === 6) { this.a = this.read(0xff00 | this.fetch()); return 12; }
            this.hl = this.addSP(this.fetch()); return 12;
          case 1:
            if (!q) { this.setPair(p, this.pop(), true); return 12; }
            if (p === 0) { this.pc = this.pop(); return 16; }
            if (p === 1) { this.pc = this.pop(); this.ime = true; this.imeDelay = 0; return 16; }
            if (p === 2) { this.pc = this.hl; return 4; }
            this.sp = this.hl; return 8;
          case 2:
            if (y < 4) { target = this.word(); if (this.condition(y)) { this.pc = target; return 16; } return 12; }
            if (y === 4) { this.write(0xff00 | this.c, this.a); return 8; }
            if (y === 5) { this.write(this.word(), this.a); return 16; }
            if (y === 6) { this.a = this.read(0xff00 | this.c); return 8; }
            this.a = this.read(this.word()); return 16;
          case 3:
            if (y === 0) { this.pc = this.word(); return 16; }
            if (y === 1) return this.cb();
            if (y === 6) { this.ime = false; this.imeDelay = 0; return 4; }
            if (y === 7) { if (!this.imeDelay) this.imeDelay = 2; return 4; }
            break;
          case 4:
            if (y < 4) {
              target = this.word();
              if (this.condition(y)) { this.push(this.pc); this.pc = target; return 24; }
              return 12;
            }
            break;
          case 5:
            if (!q) { this.push(this.pair(p, true)); return 16; }
            if (p === 0) { target = this.word(); this.push(this.pc); this.pc = target; return 24; }
            break;
          case 6: this.alu(y, this.fetch()); return 8;
          case 7: this.push(this.pc); this.pc = y * 8; return 16;
        }
      }
      throw new Error(`Opcode invalide 0x${opcode.toString(16)} a 0x${address.toString(16)}.`);
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { CPU };
  else root.PocketCPU = CPU;
})(globalThis);
