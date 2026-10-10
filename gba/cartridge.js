(function (root) {
  "use strict";

  const MAX_ROM = 32 * 1024 * 1024;
  class Cartridge {
    constructor(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 192 || bytes.length > MAX_ROM) {
        throw new Error("ROM GBA invalide (192 octets a 32 Mio attendus).");
      }
      let checksum = 0;
      for (let i = 0xa0; i <= 0xbc; i++) checksum -= bytes[i];
      if (bytes[0xb2] !== 0x96 || ((checksum - 0x19) & 255) !== bytes[0xbd]) {
        throw new Error("En-tete GBA invalide : identifiant ou checksum incorrect.");
      }
      this.rom = bytes.slice();
      this.title = String.fromCharCode(...bytes.subarray(0xa0, 0xac)).replace(/\0.*$/, "").trim();
      const signatures = ["SRAM_V", "SRAM_F_V", "FLASH_V", "FLASH512_V", "FLASH1M_V", "EEPROM_V"];
      let found = null;
      for (let i = 0xc0; i < bytes.length && !found; i++) {
        if (![69, 70, 83].includes(bytes[i])) continue;
        found = signatures.find(signature => [...signature].every((char, j) => bytes[i + j] === char.charCodeAt(0))) || null;
      }
      this.kind = !found ? "NONE" : found === "EEPROM_V" ? "EEPROM" : found.startsWith("SRAM") ? "SRAM" : "FLASH";
      this.type = `GBA:${found || "NONE"}`;
      this.ram = new Uint8Array(this.kind === "EEPROM" ? 512 : this.kind === "SRAM" ? 32768 : this.kind === "FLASH" ? found === "FLASH1M_V" ? 131072 : 65536 : 0);
      this.ram.fill(255);
      this.hasRTC = false;
      this.saveRevision = 0;
      this.flashBank = 0;
      this.flashState = 0;
      this.flashID = false;
      this.erase = false;
      this.eepromBits = 0;
      this.resetEEPROM();
    }
    get ramSizes() { return this.kind === "EEPROM" ? [512, 8192] : [this.ram.length]; }
    resetEEPROM() {
      this.eepromInput = null; this.eepromOutput = null;
      this.eepromReading = false; this.eepromPosition = 0; this.eepromBusy = 0;
    }
    isEEPROM(address) {
      return this.kind === "EEPROM" && address >>> 24 === 13
        && (this.rom.length <= 0x1000000 || (address & 0xffffff) >= 0xffff00);
    }
    beginEEPROMTransfer(count, reading) {
      if (this.eepromBusy) throw new Error("EEPROM GBA occupee : attendez la fin de la programmation.");
      if (reading) {
        if (count !== 68 || !this.eepromOutput) throw new Error("Lecture EEPROM GBA invalide : commande de lecture puis 68 bits requis.");
        this.eepromPosition = 0; this.eepromReading = true; return;
      }
      const bits = [9, 73].includes(count) ? 6 : [17, 81].includes(count) ? 14 : 0;
      if (!bits) throw new Error("Commande EEPROM GBA invalide : 9, 17, 73 ou 81 bits requis.");
      if (this.eepromBits && this.eepromBits !== bits) throw new Error("Taille EEPROM GBA incompatible avec la sauvegarde ou les commandes precedentes.");
      this.eepromCount = count; this.eepromInput = [];
    }
    writeEEPROM(value) { if (this.eepromInput) this.eepromInput.push(value & 1); }
    readEEPROM() {
      if (!this.eepromReading) return this.eepromBusy ? 0 : 1;
      const position = this.eepromPosition++;
      if (position < 4) return 0;
      return this.eepromOutput[(position - 4) >>> 3] >>> (7 - ((position - 4) & 7)) & 1;
    }
    finishEEPROMTransfer() {
      if (this.eepromReading) { this.eepromOutput = null; return; }
      const input = this.eepromInput, count = this.eepromCount, bits = count === 9 || count === 73 ? 6 : 14;
      const reading = count === 9 || count === 17;
      if (!input || input.length !== count || input[0] !== 1 || input[1] !== Number(reading)) {
        throw new Error("Trame EEPROM GBA invalide : commande de debut ou mode lecture/ecriture incorrect.");
      }
      // Some cartridges leave the final serial bit high; it is not part of the command or payload.
      if (!this.eepromBits) {
        this.eepromBits = bits;
        if (bits === 14) {
          const ram = new Uint8Array(8192).fill(255); ram.set(this.ram);
          this.ram = ram; this.saveRevision++;
        }
      }
      let address = 0;
      for (let i = 0; i < bits; i++) address = address << 1 | input[i + 2];
      const offset = (address & (bits === 6 ? 63 : 1023)) * 8;
      if (reading) this.eepromOutput = this.ram.slice(offset, offset + 8);
      else {
        for (let byte = 0; byte < 8; byte++) {
          let value = 0;
          for (let bit = 0; bit < 8; bit++) value = value << 1 | input[2 + bits + byte * 8 + bit];
          this.setRAM(offset + byte, value);
        }
        this.eepromOutput = null; this.eepromBusy = 108368;
      }
    }
    tick(cycles) { this.eepromBusy = Math.max(0, this.eepromBusy - cycles); }
    readROM(address) {
      const offset = address & 0x01ffffff;
      return offset < this.rom.length ? this.rom[offset] : (offset >>> 1 >>> ((offset & 1) * 8)) & 255;
    }
    readRAM(address) {
      if (!this.ram.length || this.kind === "EEPROM") return 255;
      const offset = address & 65535;
      if (this.flashID && offset < 2) return offset === 0 ? this.ram.length > 65536 ? 0x62 : 0x32 : this.ram.length > 65536 ? 0x13 : 0x1b;
      return this.ram[(offset + this.flashBank * 65536) % this.ram.length];
    }
    setRAM(offset, value) {
      if (this.ram[offset] !== value) { this.ram[offset] = value; this.saveRevision++; }
    }
    writeRAM(address, value) {
      if (!this.ram.length || this.kind === "EEPROM") return;
      const offset = address & 65535; value &= 255;
      if (this.kind === "SRAM") { this.setRAM(offset & 32767, value); return; }
      if (this.flashState === 3) {
        this.setRAM(offset + this.flashBank * 65536, this.ram[offset + this.flashBank * 65536] & value);
        this.flashState = 0; return;
      }
      if (this.flashState === 4) { if (offset === 0 && this.ram.length > 65536) this.flashBank = value & 1; this.flashState = 0; return; }
      if (value === 0xf0) { this.flashID = false; this.flashState = 0; this.erase = false; return; }
      if (this.flashState === 0) { if (offset === 0x5555 && value === 0xaa) this.flashState = 1; return; }
      if (this.flashState === 1) { this.flashState = offset === 0x2aaa && value === 0x55 ? 2 : 0; return; }
      this.flashState = 0;
      if (this.erase) {
        if (value === 0x10 && offset === 0x5555) {
          this.ram.fill(255); this.saveRevision++;
        } else if (value === 0x30) {
          const start = (offset & ~4095) + this.flashBank * 65536;
          this.ram.fill(255, start, start + 4096); this.saveRevision++;
        }
        this.erase = false; return;
      }
      if (offset !== 0x5555) return;
      if (value === 0x90) this.flashID = true;
      if (value === 0x80) this.erase = true;
      if (value === 0xa0) this.flashState = 3;
      if (value === 0xb0) this.flashState = 4;
    }
    exportRAM() { return this.ram.slice(); }
    importRAM(bytes) {
      if (!(bytes instanceof Uint8Array) || !this.ram.length || !this.ramSizes.includes(bytes.length)) {
        throw new Error(`Taille .sav GBA invalide : ${this.ramSizes.join(" ou ")} octets attendus.`);
      }
      if (this.kind === "EEPROM") {
        this.ram = bytes.slice(); this.eepromBits = bytes.length === 512 ? 6 : 14;
        this.resetEEPROM(); this.saveRevision++; return;
      }
      this.ram.set(bytes); this.saveRevision++;
    }
    saveData() { return { version: 1, type: this.type, ram: this.exportRAM() }; }
    restoreData(data) {
      if (!data || data.version !== 1 || data.type !== this.type || !(data.ram instanceof Uint8Array) || !this.ramSizes.includes(data.ram.length)) {
        throw new Error("Sauvegarde de cartouche GBA incompatible ou corrompue.");
      }
      if (this.kind === "EEPROM") this.importRAM(data.ram);
      else { this.ram.set(data.ram); this.saveRevision++; }
    }
  }
  const api = { Cartridge, MAX_ROM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketGBACartridge = Cartridge;
})(globalThis);
