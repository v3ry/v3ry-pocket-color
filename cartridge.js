(function (root) {
  "use strict";

  const TYPES = new Map([
    [0x00, "ROM"], [0x08, "ROM"], [0x09, "ROM"],
    [0x01, "MBC1"], [0x02, "MBC1"], [0x03, "MBC1"],
    [0x05, "MBC2"], [0x06, "MBC2"],
    [0x0f, "MBC3"], [0x10, "MBC3"], [0x11, "MBC3"], [0x12, "MBC3"], [0x13, "MBC3"],
    [0x19, "MBC5"], [0x1a, "MBC5"], [0x1b, "MBC5"], [0x1c, "MBC5"], [0x1d, "MBC5"], [0x1e, "MBC5"],
  ]);
  const RAM_SIZES = [0, 2048, 8192, 32768, 131072, 65536];

  class Cartridge {
    constructor(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 0x8000) {
        throw new Error("ROM tronquee : au moins 32 Kio sont necessaires.");
      }
      const sizeCode = bytes[0x148];
      const banks = sizeCode <= 8 ? 2 << sizeCode : { 0x52: 72, 0x53: 80, 0x54: 96 }[sizeCode];
      if (!banks || bytes.length !== banks * 0x4000) {
        throw new Error("La taille de la ROM ne correspond pas a son en-tete.");
      }
      let checksum = 0;
      for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - bytes[i] - 1) & 255;
      if (checksum !== bytes[0x14d]) throw new Error("En-tete de ROM invalide (checksum).");
      this.type = bytes[0x147];
      this.mapper = TYPES.get(this.type);
      if (!this.mapper) throw new Error(`Cartouche non prise en charge : type 0x${this.type.toString(16)}.`);
      if (RAM_SIZES[bytes[0x149]] === undefined) throw new Error("Taille de RAM inconnue.");
      this.rom = bytes;
      this.banks = banks;
      this.color = !!(bytes[0x143] & 0x80);
      const titleEnd = this.color ? 0x13f : 0x144;
      this.title = String.fromCharCode(...bytes.subarray(0x134, titleEnd)).replace(/\0.*$/, "").trim();
      this.ram = new Uint8Array(this.mapper === "MBC2" ? 512 : RAM_SIZES[bytes[0x149]]);
      this.ramEnabled = this.mapper === "ROM";
      this.bank = 1;
      this.highBank = 0;
      this.ramBank = 0;
      this.mode = 0;
      this.hasRTC = this.type === 0x0f || this.type === 0x10;
      this.rtc = new Uint8Array(5);
      this.latchedRTC = new Uint8Array(5);
      this.rtcLatched = false;
      this.latch = 0;
      this.lastRTC = Date.now();
      this.saveRevision = 0;
    }
    readROM(address) {
      let bank = 0;
      if (address < 0x4000) {
        if (this.mapper === "MBC1" && this.mode) bank = this.highBank << 5;
      } else bank = this.mapper === "MBC1" ? (this.highBank << 5) | this.bank : this.bank;
      return this.rom[(bank % this.banks) * 0x4000 + (address & 0x3fff)];
    }
    control(address, value) {
      if (this.mapper === "ROM") return;
      if (this.mapper === "MBC2") {
        if (address < 0x4000) {
          if (address & 0x100) this.bank = (value & 15) || 1;
          else this.ramEnabled = (value & 15) === 10;
        }
        return;
      }
      if (address < 0x2000) this.ramEnabled = (value & 15) === 10;
      else if (address < 0x4000) {
        if (this.mapper === "MBC5") {
          this.bank = address < 0x3000 ? (this.bank & 0x100) | value : (this.bank & 255) | ((value & 1) << 8);
        } else this.bank = (value & (this.mapper === "MBC1" ? 31 : 127)) || 1;
      } else if (address < 0x6000) {
        if (this.mapper === "MBC1") this.highBank = value & 3;
        else this.ramBank = this.mapper === "MBC5" ? value & (this.type >= 0x1c ? 7 : 15) : value;
      } else if (this.mapper === "MBC1") this.mode = value & 1;
      else if (this.mapper === "MBC3") {
        if (this.hasRTC && this.latch === 0 && value === 1) {
          this.updateRTC(); this.latchedRTC.set(this.rtc); this.rtcLatched = true;
        }
        this.latch = value;
      }
    }
    updateRTC() {
      const now = Date.now();
      const elapsed = Math.floor((now - this.lastRTC) / 1000);
      if (this.rtc[4] & 0x40) { this.lastRTC = now; return; }
      if (elapsed <= 0) return;
      this.lastRTC += elapsed * 1000;
      let seconds = this.rtc[0] + this.rtc[1] * 60 + this.rtc[2] * 3600
        + (this.rtc[3] | ((this.rtc[4] & 1) << 8)) * 86400 + elapsed;
      const days = Math.floor(seconds / 86400);
      seconds %= 86400;
      this.rtc[0] = seconds % 60;
      this.rtc[1] = Math.floor(seconds / 60) % 60;
      this.rtc[2] = Math.floor(seconds / 3600);
      this.rtc[3] = days & 255;
      this.rtc[4] = (this.rtc[4] & 0xc0) | ((days >> 8) & 1) | (days > 511 ? 0x80 : 0);
      this.saveRevision++;
    }
    ramOffset(address) {
      if (this.mapper === "MBC2") return address & 511;
      const bank = this.mapper === "MBC1" ? this.mode ? this.highBank : 0 : this.ramBank;
      return (bank * 8192 + (address & 8191)) % this.ram.length;
    }
    readRAM(address) {
      if (!this.ramEnabled) return 255;
      if (this.mapper === "MBC3" && this.ramBank >= 8 && this.ramBank <= 12) {
        if (!this.hasRTC) return 255;
        this.updateRTC();
        return (this.rtcLatched ? this.latchedRTC : this.rtc)[this.ramBank - 8];
      }
      if (this.mapper === "MBC3" && this.ramBank > 3) return 255;
      if (!this.ram.length) return 255;
      const value = this.ram[this.ramOffset(address)];
      return this.mapper === "MBC2" ? value | 0xf0 : value;
    }
    writeRAM(address, value) {
      if (!this.ramEnabled) return;
      if (this.mapper === "MBC3" && this.ramBank >= 8 && this.ramBank <= 12) {
        if (this.hasRTC) {
          this.updateRTC();
          const index = this.ramBank - 8;
          this.rtc[index] = value & [63, 63, 31, 255, 0xc1][index];
          this.lastRTC = Date.now();
          this.saveRevision++;
        }
        return;
      }
      if (this.mapper === "MBC3" && this.ramBank > 3) return;
      if (this.ram.length) {
        const offset = this.ramOffset(address), next = this.mapper === "MBC2" ? value & 15 : value;
        if (this.ram[offset] !== next) {
          this.ram[offset] = next;
          this.saveRevision++;
        }
      }
    }
    exportRAM() { return this.ram.slice(); }
    importRAM(bytes) {
      if (!(bytes instanceof Uint8Array) || !this.ram.length || bytes.length !== this.ram.length) {
        throw new Error(`Taille .sav invalide : ${this.ram.length} octets attendus.`);
      }
      this.ram.set(bytes);
      if (this.mapper === "MBC2") {
        for (let i = 0; i < this.ram.length; i++) this.ram[i] &= 15;
      }
      this.saveRevision++;
    }
    saveData() {
      if (this.hasRTC) this.updateRTC();
      return {
        version: 1, type: this.type, ram: this.exportRAM(),
        rtc: this.hasRTC ? this.rtc.slice() : null,
        lastRTC: this.hasRTC ? this.lastRTC : null,
      };
    }
    restoreData(data) {
      if (!data || data.version !== 1 || data.type !== this.type
        || !(data.ram instanceof Uint8Array) || data.ram.length !== this.ram.length
        || (this.hasRTC ? !(data.rtc instanceof Uint8Array) || data.rtc.length !== 5
          || !Number.isSafeInteger(data.lastRTC) || data.lastRTC < 0
          || data.rtc[0] > 63 || data.rtc[1] > 63 || data.rtc[2] > 31
          || (data.rtc[4] & ~0xc1) !== 0 : data.rtc !== null || data.lastRTC !== null)) {
        throw new Error("Sauvegarde locale invalide ou incompatible avec cette cartouche.");
      }
      this.ram.set(data.ram);
      if (this.mapper === "MBC2") {
        for (let i = 0; i < this.ram.length; i++) this.ram[i] &= 15;
      }
      if (this.hasRTC) {
        this.rtc.set(data.rtc);
        this.lastRTC = data.lastRTC;
        this.rtcLatched = false;
        this.updateRTC();
      }
      this.saveRevision++;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { Cartridge };
  else root.PocketCartridge = Cartridge;
})(globalThis);
