(function (root) {
  "use strict";

  const N = 0x80000000, Z = 0x40000000, C = 0x20000000, V = 0x10000000;
  const rotate = (value, amount) => (value >>> (amount & 31) | value << ((32 - amount) & 31)) >>> 0;
  const signed = (value, bits) => value << (32 - bits) >> (32 - bits);

  // Stop raised for behaviour the core does not emulate; `report` locates it precisely.
  class UnsupportedError extends Error {
    constructor(kind, message, report) {
      super(message);
      this.name = "GBAUnsupportedError";
      this.kind = kind;
      this.report = report;
    }
  }

  class CPU {
    constructor(bus) {
      this.bus = bus;
      this.r = new Uint32Array(16);
      this.cpsr = 0x1f;
      this.banks = new Map();
      this.saved = new Map();
      this.r[13] = 0x03007f00;
      this.r[15] = 0x08000000;
      this.banks.set(0x12, new Uint32Array([0x03007fa0, 0]));
      this.banks.set(0x13, new Uint32Array([0x03007fe0, 0]));
      this.userHigh = new Uint32Array(5);
      this.fiqHigh = new Uint32Array(5);
      this.address = this.r[15];
      this.irqFrames = [];
    }
    get thumb() { return !!(this.cpsr & 32); }
    reg(index, extra = 0) { return index === 15 ? (this.address + (this.thumb ? 4 : 8) + extra) >>> 0 : this.r[index]; }
    branch(value, exchange = false) {
      if (exchange) this.cpsr = value & 1 ? this.cpsr | 32 : this.cpsr & ~32;
      this.r[15] = (value & (this.thumb ? ~1 : ~3)) >>> 0;
    }
    status(value) {
      const oldMode = this.cpsr & 31, nextMode = value & 31;
      if (![0x10, 0x11, 0x12, 0x13, 0x17, 0x1b, 0x1f].includes(nextMode)) {
        throw this.fail("state", `Mode ARM invalide : 0x${nextMode.toString(16)}.`);
      }
      const bank = mode => mode === 0x1f ? 0x10 : mode;
      if (bank(oldMode) !== bank(nextMode)) {
        this.banks.set(bank(oldMode), this.r.slice(13, 15));
        const next = this.banks.get(bank(nextMode)) || new Uint32Array(2);
        this.r.set(next, 13);
      }
      if ((oldMode === 0x11) !== (nextMode === 0x11)) {
        (oldMode === 0x11 ? this.fiqHigh : this.userHigh).set(this.r.subarray(8, 13));
        this.r.set(nextMode === 0x11 ? this.fiqHigh : this.userHigh, 8);
      }
      this.cpsr = value >>> 0;
    }
    restoreStatus() {
      const mode = this.cpsr & 31, saved = this.saved.get(mode);
      // User and System modes have no SPSR: the S bit leaves CPSR unchanged.
      if (mode === 0x10 || mode === 0x1f) return;
      if (saved === undefined) {
        throw this.fail("state", `Retour d'exception ARM sans SPSR a 0x${this.address.toString(16)}.`);
      }
      this.status(saved);
    }
    snapshot() {
      return { pc: this.address, thumb: this.thumb, cpsr: this.cpsr, registers: Array.from(this.r), frame: this.bus.frames };
    }
    fail(kind, message, extra = {}) {
      const report = { kind, ...this.snapshot(), ...extra };
      this.bus.lastStop = report;
      return new UnsupportedError(kind, message, report);
    }
    irq() {
      const handler = this.bus.read32(0x03007ffc);
      if (!handler) throw this.fail("interrupt", "Interruption GBA sans gestionnaire BIOS installe.");
      const returnAddress = this.r[15];
      this.irqFrames.push({
        returnAddress, cpsr: this.cpsr, registers: this.r.slice(0, 4), r12: this.r[12],
        irqLR: (this.cpsr & 31) === 0x12 ? this.r[14] : null, saved: this.saved.get(0x12),
        waiting: !!this.bus.waitMask
      });
      this.saved.set(0x12, this.cpsr);
      this.status((this.cpsr & ~63) | 0x92);
      this.r[14] = returnAddress + 4;
      this.r[0] = 0x04000000;
      this.r[14] = 0x00000138;
      this.branch(handler);
    }
    condition(code) {
      if (code === 14) return true;
      if (code === 15) return false;
      const flags = this.cpsr;
      const n = !!(flags & N), z = !!(flags & Z), c = !!(flags & C), v = !!(flags & V);
      switch (code) {
        case 0: return z;
        case 1: return !z;
        case 2: return c;
        case 3: return !c;
        case 4: return n;
        case 5: return !n;
        case 6: return v;
        case 7: return !v;
        case 8: return c && !z;
        case 9: return !c || z;
        case 10: return n === v;
        case 11: return n !== v;
        case 12: return !z && n === v;
        case 13: return z || n !== v;
      }
    }
    nz(value) { this.cpsr = ((this.cpsr & ~(N | Z)) | (value & N) | (value === 0 ? Z : 0)) >>> 0; }
    add(a, b, carry = 0, flags = true) {
      const sum = a + b + carry, result = sum >>> 0;
      if (flags) {
        this.nz(result);
        const signedSum = (a | 0) + (b | 0) + carry;
        this.cpsr = ((this.cpsr & ~(C | V)) | (sum > 0xffffffff ? C : 0)
          | (signedSum > 0x7fffffff || signedSum < -0x80000000 ? V : 0)) >>> 0;
      }
      return result;
    }
    shift(value, type, amount, register = false) {
      const carry = this.cpsr & C ? 1 : 0;
      if (register && amount === 0) { this.shiftCarry = carry; return value; }
      if (!register && amount === 0) {
        if (type === 0) { this.shiftCarry = carry; return value; }
        if (type === 3) { this.shiftCarry = value & 1; return (value >>> 1 | carry << 31) >>> 0; }
        amount = 32;
      }
      if (type === 0) {
        this.shiftCarry = amount <= 32 ? value >>> (32 - amount) & 1 : 0;
        return amount < 32 ? value << amount >>> 0 : 0;
      }
      if (type === 1) {
        this.shiftCarry = amount <= 32 ? value >>> (amount - 1) & 1 : 0;
        return amount < 32 ? value >>> amount : 0;
      }
      if (type === 2) {
        this.shiftCarry = value >>> Math.min(amount - 1, 31) & 1;
        return (value >> Math.min(amount, 31)) >>> 0;
      }
      this.shiftCarry = value >>> ((amount - 1) & 31) & 1;
      return rotate(value, amount);
    }
    logicalFlags(result, carry) { this.nz(result); this.cpsr = ((this.cpsr & ~C) | (carry ? C : 0)) >>> 0; }
    operand(op) {
      if (op & 0x02000000) {
        const amount = (op >>> 8 & 15) * 2, result = rotate(op & 255, amount);
        this.shiftCarry = amount ? result >>> 31 : this.cpsr & C ? 1 : 0;
        return result;
      }
      const byRegister = !!(op & 16);
      const amount = byRegister ? this.reg(op >>> 8 & 15) & 255 : op >>> 7 & 31;
      return this.shift(this.reg(op & 15, byRegister ? 4 : 0), op >>> 5 & 3, amount, byRegister);
    }
    writeReg(index, value, restore = false) {
      if (index !== 15) this.r[index] = value;
      else {
        if (restore) this.restoreStatus();
        this.branch(value);
      }
    }
    step() {
      this.address = this.r[15];
      if (this.address === 0x138 && (this.cpsr & 31) === 0x12 && this.irqFrames.length) {
        const frame = this.irqFrames.pop();
        this.r.set(frame.registers, 0); this.r[12] = frame.r12;
        this.status(frame.cpsr);
        if (frame.irqLR !== null) this.r[14] = frame.irqLR;
        if (frame.saved === undefined) this.saved.delete(0x12); else this.saved.set(0x12, frame.saved);
        this.branch(frame.returnAddress);
        if (frame.waiting && this.bus.waitMask) this.bus.halted = true;
        return 6;
      }
      if (this.address < 0x4000) {
        // The reset vector restarts the console; any other BIOS address is not emulated.
        if (this.address === 0) { this.bus.reset(this.r[14]); return 1; }
        throw this.fail("bios", `Execution BIOS GBA non prise en charge : 0x${this.address.toString(16)}.`);
      }
      const instruction = this.bus.read32(this.address);
      this.bus.openBus = instruction;
      if (this.thumb) {
        const op = this.address & 2 ? instruction >>> 16 : instruction & 0xffff;
        this.r[15] += 2;
        return this.executeThumb(op);
      }
      this.r[15] += 4;
      if (!this.condition(instruction >>> 28)) return 1;
      return this.executeARM(instruction);
    }
    executeARM(op) {
      const rd = op >>> 12 & 15, rn = op >>> 16 & 15;
      if ((op & 0x0ffffff0) === 0x012fff10) { this.branch(this.reg(op & 15), true); return 3; }
      if ((op & 0x0f000000) === 0x0f000000) { this.bus.swi(op >>> 16 & 255); return 3; }
      if ((op & 0x0e000000) === 0x0a000000) {
        if (op & 0x01000000) this.r[14] = this.address + 4;
        this.branch(this.address + 8 + (signed(op & 0xffffff, 24) << 2)); return 3;
      }
      if ((op & 0x0fbf0fff) === 0x010f0000) {
        this.r[rd] = op & 0x400000 ? this.saved.get(this.cpsr & 31) ?? this.cpsr : this.cpsr; return 1;
      }
      if ((op & 0x0db0f000) === 0x0120f000 && (op & 0x02000000 || !(op & 0xff0))) {
        const value = op & 0x02000000 ? this.operand(op) : this.reg(op & 15);
        let mask = 0;
        for (let i = 0; i < 4; i++) if (op & (1 << (16 + i))) mask |= 255 << (i * 8);
        if ((this.cpsr & 31) === 0x10) mask &= 0xff000000;
        if (op & 0x400000) {
          const mode = this.cpsr & 31;
          if (![0x10, 0x1f].includes(mode)) this.saved.set(mode, ((this.saved.get(mode) || 0) & ~mask | value & mask) >>> 0);
        } else this.status((this.cpsr & ~mask | value & mask) >>> 0);
        return 1;
      }
      if ((op & 0x0f8000f0) === 0x00800090) {
        const hi = rn, lo = rd, rs = op >>> 8 & 15, rm = op & 15, isSigned = !!(op & 0x400000);
        let result = BigInt(isSigned ? this.reg(rm) | 0 : this.reg(rm))
          * BigInt(isSigned ? this.reg(rs) | 0 : this.reg(rs));
        if (op & 0x200000) result += BigInt(this.r[hi]) << 32n | BigInt(this.r[lo]);
        result = BigInt.asUintN(64, result);
        this.r[lo] = Number(result & 0xffffffffn); this.r[hi] = Number(result >> 32n);
        if (op & 0x100000) this.cpsr = ((this.cpsr & ~(N | Z)) | (this.r[hi] & N) | (result === 0n ? Z : 0)) >>> 0;
        return 4;
      }
      if ((op & 0x0fc000f0) === 0x00000090) {
        const result = (Math.imul(this.reg(op & 15), this.reg(op >>> 8 & 15))
          + (op & 0x200000 ? this.reg(rd) : 0)) >>> 0;
        this.r[rn] = result; if (op & 0x100000) this.nz(result); return 3;
      }
      if ((op & 0x0fb00ff0) === 0x01000090) {
        const address = this.reg(rn), byte = !!(op & 0x400000);
        const value = byte ? this.bus.read8(address) : rotate(this.bus.read32(address & ~3), (address & 3) * 8);
        if (byte) this.bus.write8(address, this.reg(op & 15)); else this.bus.write32(address & ~3, this.reg(op & 15));
        this.writeReg(rd, value); return 4;
      }
      if ((op & 0x0e000090) === 0x00000090) {
        const offset = op & 0x400000 ? (op >>> 4 & 0xf0) | (op & 15) : this.reg(op & 15);
        const base = this.reg(rn), next = (base + (op & 0x800000 ? offset : -offset)) >>> 0;
        const address = op & 0x1000000 ? next : base, kind = op >>> 5 & 3;
        if (op & 0x100000) {
          let value;
          if (kind === 1) value = rotate(this.bus.read16(address & ~1), (address & 1) * 8);
          else if (kind === 2 || (kind === 3 && address & 1)) value = signed(this.bus.read8(address), 8);
          else if (kind === 3) value = signed(this.bus.read16(address), 16);
          else return this.unsupported(op);
          this.writeReg(rd, value);
        } else if (kind === 1) this.bus.write16(address & ~1, this.reg(rd, rd === 15 ? 4 : 0));
        else return this.unsupported(op);
        if (!(op & 0x1000000) || op & 0x200000) if (rn !== rd || !(op & 0x100000)) this.r[rn] = next;
        return 3;
      }
      if ((op & 0x0c000000) === 0x04000000) {
        if ((op & 0x02000010) === 0x02000010) return this.unsupported(op);
        const offset = op & 0x02000000 ? this.shift(this.reg(op & 15), op >>> 5 & 3, op >>> 7 & 31) : op & 4095;
        const base = this.reg(rn), next = (base + (op & 0x800000 ? offset : -offset)) >>> 0;
        const address = op & 0x1000000 ? next : base, load = !!(op & 0x100000), byte = !!(op & 0x400000);
        if (load) this.writeReg(rd, byte ? this.bus.read8(address) : rotate(this.bus.read32(address & ~3), (address & 3) * 8));
        else if (byte) this.bus.write8(address, this.reg(rd, rd === 15 ? 4 : 0));
        else this.bus.write32(address & ~3, this.reg(rd, rd === 15 ? 4 : 0));
        if (!(op & 0x1000000) || op & 0x200000) if (!load || rn !== rd) this.r[rn] = next;
        return 3;
      }
      if ((op & 0x0e000000) === 0x08000000) {
        let list = op & 65535, count = 0;
        for (let i = 0; i < 16; i++) if (list & 1 << i) count++;
        const empty = count === 0;
        if (empty) { list = 0x8000; count = 16; }
        const up = !!(op & 0x800000), pre = !!(op & 0x1000000), load = !!(op & 0x100000);
        const base = this.reg(rn), next = (base + (up ? count * 4 : -count * 4)) >>> 0;
        const transferCount = empty ? 1 : count;
        let address = up ? base + (pre ? 4 : 0) : base - transferCount * 4 + (pre ? 0 : 4);
        const user = !!(op & 0x400000) && !(load && list & 0x8000);
        const mode = this.cpsr & 31;
        if (user) this.status((this.cpsr & ~31) | 0x1f);
        let target = null;
        for (let i = 0; i < 16; i++) if (list & 1 << i) {
          if (load) {
            const value = this.bus.read32(address & ~3);
            if (i === 15) target = value; else this.r[i] = value;
          } else this.bus.write32(address & ~3, i === rn && op & 0x200000 && i !== Math.log2(list & -list)
            ? next : this.reg(i, i === 15 ? 4 : 0));
          address += 4;
        }
        if (user) this.status((this.cpsr & ~31) | mode);
        if (op & 0x200000 && !(load && list & 1 << rn)) this.r[rn] = next;
        if (target !== null) this.writeReg(15, target, !!(op & 0x400000));
        return count + 2;
      }
      if ((op & 0x0c000000) === 0) {
        const code = op >>> 21 & 15, flags = !!(op & 0x100000), a = this.reg(rn, op & 16 && !(op & 0x02000000) ? 4 : 0);
        const b = this.operand(op), carry = this.shiftCarry, c = this.cpsr & C ? 1 : 0;
        let result;
        switch (code) {
          case 0: case 8: result = a & b; break;
          case 1: case 9: result = a ^ b; break;
          case 2: case 10: result = this.add(a, ~b >>> 0, 1, flags); break;
          case 3: result = this.add(b, ~a >>> 0, 1, flags); break;
          case 4: case 11: result = this.add(a, b, 0, flags); break;
          case 5: result = this.add(a, b, c, flags); break;
          case 6: result = this.add(a, ~b >>> 0, c, flags); break;
          case 7: result = this.add(b, ~a >>> 0, c, flags); break;
          case 12: result = a | b; break;
          case 13: result = b; break;
          case 14: result = a & ~b; break;
          case 15: result = ~b; break;
        }
        result >>>= 0;
        if (flags && [0, 1, 8, 9, 12, 13, 14, 15].includes(code)) this.logicalFlags(result, carry);
        if (code < 8 || code > 11) this.writeReg(rd, result, flags && rd === 15);
        return op & 16 && !(op & 0x02000000) ? 2 : 1;
      }
      return this.unsupported(op);
    }
    executeThumb(op) {
      const rd = op & 7, rs = op >>> 3 & 7;
      if ((op & 0xe000) === 0) {
        if ((op & 0x1800) !== 0x1800) {
          const value = this.shift(this.r[rs], op >>> 11 & 3, op >>> 6 & 31), carry = this.shiftCarry;
          this.r[rd] = value; this.logicalFlags(value, carry);
        } else {
          const b = op & 0x400 ? op >>> 6 & 7 : this.r[op >>> 6 & 7];
          this.r[rd] = op & 0x200 ? this.add(this.r[rs], ~b >>> 0, 1) : this.add(this.r[rs], b);
        }
        return 1;
      }
      if ((op & 0xe000) === 0x2000) {
        const d = op >>> 8 & 7, value = op & 255;
        switch (op >>> 11 & 3) {
          case 0: this.r[d] = value; this.nz(value); break;
          case 1: this.add(this.r[d], ~value >>> 0, 1); break;
          case 2: this.r[d] = this.add(this.r[d], value); break;
          case 3: this.r[d] = this.add(this.r[d], ~value >>> 0, 1); break;
        }
        return 1;
      }
      if ((op & 0xfc00) === 0x4000) {
        const code = op >>> 6 & 15, a = this.r[rd], b = this.r[rs], carry = this.cpsr & C ? 1 : 0;
        let result;
        switch (code) {
          case 0: case 8: result = a & b; break;
          case 1: result = a ^ b; break;
          case 2: case 3: case 4: case 7: {
            result = this.shift(a, code === 7 ? 3 : code - 2, b & 255, true);
            this.logicalFlags(result, this.shiftCarry); break;
          }
          case 5: result = this.add(a, b, carry); break;
          case 6: result = this.add(a, ~b >>> 0, carry); break;
          case 9: result = this.add(0, ~b >>> 0, 1); break;
          case 10: this.add(a, ~b >>> 0, 1); return 1;
          case 11: this.add(a, b); return 1;
          case 12: result = a | b; break;
          case 13: result = Math.imul(a, b) >>> 0; break;
          case 14: result = a & ~b; break;
          case 15: result = ~b; break;
        }
        result >>>= 0;
        if ([0, 1, 8, 12, 13, 14, 15].includes(code)) this.nz(result);
        if (code !== 8) this.r[rd] = result;
        return code === 13 ? 3 : 1;
      }
      if ((op & 0xfc00) === 0x4400) {
        const d = rd | (op >>> 4 & 8), s = op >>> 3 & 15, code = op >>> 8 & 3;
        if (code === 0) this.writeReg(d, this.reg(d) + this.reg(s));
        if (code === 1) this.add(this.reg(d), ~this.reg(s) >>> 0, 1);
        if (code === 2) this.writeReg(d, this.reg(s));
        if (code === 3) {
          if (op & 0x80) return this.unsupported(op);
          this.branch(this.reg(s), true);
        }
        return d === 15 || code === 3 ? 3 : 1;
      }
      if ((op & 0xf800) === 0x4800) {
        this.r[op >>> 8 & 7] = this.bus.read32(((this.address + 4) & ~3) + ((op & 255) << 2)); return 3;
      }
      if ((op & 0xf000) === 0x5000) {
        const address = (this.r[rs] + this.r[op >>> 6 & 7]) >>> 0;
        switch (op >>> 9 & 7) {
          case 0: this.bus.write32(address & ~3, this.r[rd]); break;
          case 1: this.bus.write16(address & ~1, this.r[rd]); break;
          case 2: this.bus.write8(address, this.r[rd]); break;
          case 3: this.r[rd] = signed(this.bus.read8(address), 8); break;
          case 4: this.r[rd] = rotate(this.bus.read32(address & ~3), (address & 3) * 8); break;
          case 5: this.r[rd] = rotate(this.bus.read16(address & ~1), (address & 1) * 8); break;
          case 6: this.r[rd] = this.bus.read8(address); break;
          case 7: this.r[rd] = address & 1 ? signed(this.bus.read8(address), 8) : signed(this.bus.read16(address), 16); break;
        }
        return 3;
      }
      if ((op & 0xe000) === 0x6000 || (op & 0xf000) === 0x8000) {
        const half = (op & 0xf000) === 0x8000, byte = !half && !!(op & 0x1000);
        const address = (this.r[rs] + ((op >>> 6 & 31) * (half ? 2 : byte ? 1 : 4))) >>> 0;
        if (op & 0x800) this.r[rd] = half ? rotate(this.bus.read16(address & ~1), (address & 1) * 8)
          : byte ? this.bus.read8(address) : rotate(this.bus.read32(address & ~3), (address & 3) * 8);
        else if (half) this.bus.write16(address & ~1, this.r[rd]);
        else if (byte) this.bus.write8(address, this.r[rd]);
        else this.bus.write32(address & ~3, this.r[rd]);
        return 3;
      }
      if ((op & 0xf000) === 0x9000) {
        const d = op >>> 8 & 7, address = this.r[13] + ((op & 255) << 2);
        if (op & 0x800) this.r[d] = this.bus.read32(address & ~3); else this.bus.write32(address & ~3, this.r[d]);
        return 3;
      }
      if ((op & 0xf000) === 0xa000) {
        this.r[op >>> 8 & 7] = (op & 0x800 ? this.r[13] : (this.address + 4) & ~3) + ((op & 255) << 2); return 1;
      }
      if ((op & 0xff00) === 0xb000) {
        this.r[13] += (op & 0x80 ? -1 : 1) * ((op & 127) << 2); return 1;
      }
      if ((op & 0xf600) === 0xb400) {
        const pop = !!(op & 0x800), list = op & 255, registers = [];
        for (let i = 0; i < 8; i++) if (list & 1 << i) registers.push(i);
        if (op & 0x100) registers.push(pop ? 15 : 14);
        if (!pop) this.r[13] -= registers.length * 4;
        let address = this.r[13];
        for (const i of registers) {
          if (pop) this.writeReg(i, this.bus.read32(address & ~3));
          else this.bus.write32(address & ~3, this.r[i]);
          address += 4;
        }
        if (pop) this.r[13] = address;
        return registers.length + 2;
      }
      if ((op & 0xf000) === 0xc000) {
        const baseReg = op >>> 8 & 7, load = !!(op & 0x800);
        let address = this.r[baseReg], list = op & 255;
        if (!list) {
          if (load) this.branch(this.bus.read32(address & ~3)); else this.bus.write32(address & ~3, this.address + 6);
          this.r[baseReg] += 64; return 3;
        }
        let count = 0;
        for (let i = 0; i < 8; i++) if (list & 1 << i) {
          if (load) this.r[i] = this.bus.read32(address & ~3);
          else this.bus.write32(address & ~3, i === baseReg && count ? this.r[baseReg] + 4 * ((op & 255).toString(2).replace(/0/g, "").length) : this.r[i]);
          address += 4; count++;
        }
        if (!load || !(list & 1 << baseReg)) this.r[baseReg] = address;
        return count + 2;
      }
      if ((op & 0xf000) === 0xd000) {
        const condition = op >>> 8 & 15;
        if (condition === 15) { this.bus.swi(op & 255); return 3; }
        if (condition === 14) return this.unsupported(op);
        if (this.condition(condition)) { this.branch(this.address + 4 + (signed(op & 255, 8) << 1)); return 3; }
        return 1;
      }
      if ((op & 0xf800) === 0xe000) { this.branch(this.address + 4 + (signed(op & 2047, 11) << 1)); return 3; }
      if ((op & 0xf800) === 0xf000) { this.r[14] = this.address + 4 + (signed(op & 2047, 11) << 12); return 1; }
      if ((op & 0xf800) === 0xf800) {
        const target = this.r[14] + ((op & 2047) << 1); this.r[14] = (this.address + 2) | 1; this.branch(target); return 3;
      }
      return this.unsupported(op);
    }
    unsupported(op) {
      throw this.fail("instruction", `Instruction GBA non prise en charge : 0x${op.toString(16)} a 0x${this.address.toString(16)}.`,
        { opcode: op >>> 0 });
    }
  }
  CPU.UnsupportedError = UnsupportedError;
  const api = { CPU, UnsupportedError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketGBACPU = CPU;
})(globalThis);
