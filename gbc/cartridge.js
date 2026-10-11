(function (root) {
  "use strict";

  const TYPES = new Map([
    [0x00, "ROM"], [0x08, "ROM"], [0x09, "ROM"],
    [0x01, "MBC1"], [0x02, "MBC1"], [0x03, "MBC1"],
    [0x05, "MBC2"], [0x06, "MBC2"],
    [0x0f, "MBC3"], [0x10, "MBC3"], [0x11, "MBC3"], [0x12, "MBC3"], [0x13, "MBC3"],
    [0x19, "MBC5"], [0x1a, "MBC5"], [0x1b, "MBC5"], [0x1c, "MBC5"], [0x1d, "MBC5"], [0x1e, "MBC5"],
    [0x0b, "MMM01"], [0x0c, "MMM01"], [0x0d, "MMM01"],
    [0x22, "MBC7"], [0xfc, "Camera"], [0xfe, "HUC3"], [0xff, "HUC1"],
  ]);
  const MMM01_TYPES = new Set([0x0b, 0x0c, 0x0d]);
  const RAM_SIZES = [0, 2048, 8192, 32768, 131072, 65536];
  // MMM01 keeps the header of its multi-game menu at the end of the ROM.
  function headerBase(bytes) {
    const base = bytes.length - 0x8000;
    if (base <= 0 || !MMM01_TYPES.has(bytes[base + 0x147])) return 0;
    let checksum = 0;
    for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - bytes[base + i] - 1) & 255;
    return checksum === bytes[base + 0x14d] ? base : 0;
  }
  const CAMERA_WIDTH = 128, CAMERA_SENSOR_HEIGHT = 120, CAMERA_HEIGHT = 112;
  const CAMERA_IMAGE_OFFSET = 0x100;

  class Cartridge {
    constructor(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 0x8000) {
        throw new Error("ROM tronquee : au moins 32 Kio sont necessaires.");
      }
      const header = bytes.subarray(headerBase(bytes));
      const sizeCode = header[0x148];
      const banks = sizeCode <= 8 ? 2 << sizeCode : { 0x52: 72, 0x53: 80, 0x54: 96 }[sizeCode];
      if (!banks || bytes.length !== banks * 0x4000) {
        throw new Error("La taille de la ROM ne correspond pas a son en-tete.");
      }
      let checksum = 0;
      for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - header[i] - 1) & 255;
      if (checksum !== header[0x14d]) throw new Error("En-tete de ROM invalide (checksum).");
      this.type = header[0x147];
      this.mapper = TYPES.get(this.type);
      if (!this.mapper) throw new Error(`Cartouche non prise en charge : type 0x${this.type.toString(16)}.`);
      if (RAM_SIZES[header[0x149]] === undefined) throw new Error("Taille de RAM inconnue.");
      this.isCamera = this.mapper === "Camera";
      this.rom = bytes;
      this.banks = banks;
      this.color = !!(header[0x143] & 0x80);
      const titleEnd = this.color ? 0x13f : 0x144;
      this.title = String.fromCharCode(...header.subarray(0x134, titleEnd)).replace(/\0.*$/, "").trim();
      this.ram = new Uint8Array(this.mapper === "MBC2" ? 512 : this.mapper === "MBC7" ? 256 : RAM_SIZES[header[0x149]]);
      this.ramEnabled = this.mapper === "ROM" || this.mapper === "HUC1";
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
      this.cameraRegisters = new Uint8Array(0x36);
      this.cameraCaptureProvider = null;
      this.cameraBusyCycles = 0;
      if (this.mapper === "MBC7") {
        this.mbc7Gate2 = false;
        this.mbc7Latched = false;
        this.eepromCS = false;
        this.eepromClk = false;
        this.eepromDI = false;
        this.eepromPhase = 0;
        this.eepromCount = 0;
        this.eepromShift = 0;
        this.eepromWriteEnabled = false;
      }
      if (this.mapper === "MMM01") {
        this.mmmControl = 0;
        this.mmmLow = 0;
        this.mmmRam = 0;
        this.mmmMask = 0;
      }
      if (this.mapper === "HUC1") this.irMode = 0;
      if (this.mapper === "HUC3") {
        this.huc3Mode = 0;
        this.huc3Address = 0;
        this.huc3Mailbox = 0;
        this.huc3Result = 0;
      }
      this.huc3Memory = new Uint8Array(this.mapper === "HUC3" ? 256 : 0);
    }
    readROM(address) {
      if (this.mapper === "MMM01") return this.readMMM01(address);
      let bank = 0;
      if (address < 0x4000) {
        if (this.mapper === "MBC1" && this.mode) bank = this.highBank << 5;
      } else bank = this.mapper === "MBC1" ? (this.highBank << 5) | this.bank : this.bank;
      return this.rom[(bank % this.banks) * 0x4000 + (address & 0x3fff)];
    }
    readMMM01(address) {
      if (!(this.mmmControl & 0x40)) {
        return this.rom[(address < 0x4000 ? this.banks - 2 : this.banks - 1) * 0x4000 + (address & 0x3fff)];
      }
      const romMask = (this.mmmMask >> 1) & 0x1f, low = this.mmmLow & 0x1f;
      const base = (((this.mmmRam >> 4) & 3) << 7) | (((this.mmmLow >> 5) & 3) << 5);
      let bank = address < 0x4000 ? base | (low & romMask) : base | low;
      if (address >= 0x4000 && !(low & ~romMask & 0x1f)) bank |= 1;
      return this.rom[(bank % this.banks) * 0x4000 + (address & 0x3fff)];
    }
    controlMMM01(address, value) {
      const mapped = (this.mmmControl & 0x40) !== 0;
      const romMask = (this.mmmMask >> 1) & 0x1f;
      const ramMask = (this.mmmControl >> 4) & 3;
      if (address < 0x2000) {
        this.ramEnabled = (value & 15) === 10;
        if (!mapped) this.mmmControl = value & 0x70;
      } else if (address < 0x4000) {
        const writable = (0x1f & ~romMask) | (mapped ? 0 : 0x60);
        this.mmmLow = (this.mmmLow & ~writable) | (value & writable);
      } else if (address < 0x6000) {
        const writable = (3 & ~ramMask) | (mapped ? 0 : 0x7c);
        this.mmmRam = (this.mmmRam & ~writable) | (value & writable);
      } else {
        const writable = ((this.mmmRam & 0x40) ? 0 : 1) | (mapped ? 0 : 0x3e);
        this.mmmMask = (this.mmmMask & ~writable) | (value & writable);
      }
    }
    mmm01RamBank() {
      const high = (this.mmmRam >> 2) & 3, low = this.mmmRam & 3;
      return (high << 2) | (this.mmmMask & 1 ? low : low & ((this.mmmControl >> 4) & 3));
    }
    control(address, value) {
      if (this.mapper === "ROM") return;
      if (this.mapper === "MMM01") { this.controlMMM01(address, value); return; }
      if (this.mapper === "HUC1") {
        if (address < 0x2000) this.irMode = value === 0x0e ? 1 : 0;
        else if (address < 0x4000) this.bank = value & 0x3f;
        else if (address < 0x6000) this.ramBank = value & 3;
        return;
      }
      if (this.mapper === "HUC3") {
        if (address < 0x2000) this.huc3Mode = value & 15;
        else if (address < 0x4000) this.bank = value & 0x7f;
        else if (address < 0x6000) this.ramBank = value & 3;
        return;
      }
      if (this.mapper === "MBC7") {
        if (address < 0x2000) this.ramEnabled = value === 0x0a;
        else if (address < 0x4000) this.bank = value & 127;
        else if (address < 0x6000) this.mbc7Gate2 = value === 0x40;
        return;
      }
      if (this.mapper === "MBC2") {
        if (address < 0x4000) {
          if (address & 0x100) this.bank = (value & 15) || 1;
          else this.ramEnabled = (value & 15) === 10;
        }
        return;
      }
      if (this.mapper === "Camera") {
        if (address < 0x2000) this.ramEnabled = (value & 15) === 10;
        else if (address < 0x4000) this.bank = value & 0x3f;
        else if (address < 0x6000) this.ramBank = value & 0x1f;
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
    setCameraCaptureProvider(provider) {
      if (provider !== null && typeof provider !== "function") {
        throw new TypeError("La source de capture de la Game Boy Camera doit être une fonction.");
      }
      this.cameraCaptureProvider = provider;
    }
    cameraRegister(address) {
      const index = address & 0x7f;
      if (index === 0) return (this.cameraRegisters[0] & 6) | (this.cameraBusyCycles ? 1 : 0);
      return 0;
    }
    writeCameraRegister(address, value) {
      const index = address & 0x7f;
      if (index >= this.cameraRegisters.length) return;
      if (index === 0) {
        this.cameraRegisters[0] = value & 6;
        if (value & 1) this.captureCameraImage();
        else this.cameraBusyCycles = 0;
        return;
      }
      this.cameraRegisters[index] = value;
    }
    captureCameraImage() {
      if (!this.cameraCaptureProvider) {
        throw new Error("Game Boy Camera : activez la webcam avant de prendre une photo.");
      }
      const pixels = this.cameraCaptureProvider();
      if (!(pixels instanceof Uint8ClampedArray)
        || pixels.length !== CAMERA_WIDTH * CAMERA_SENSOR_HEIGHT * 4) {
        throw new Error("Game Boy Camera : image webcam invalide (128 × 120 pixels requis).");
      }

      const exposure = this.cameraRegisters[2] * 256 + this.cameraRegisters[3];
      const invert = !!(this.cameraRegisters[4] & 8);
      const base = CAMERA_IMAGE_OFFSET;
      this.ram.fill(0, base, base + CAMERA_WIDTH * CAMERA_HEIGHT / 4);
      for (let y = 0; y < CAMERA_HEIGHT; y++) {
        for (let x = 0; x < CAMERA_WIDTH; x++) {
          const source = ((y + 4) * CAMERA_WIDTH + x) * 4;
          let value = Math.round((pixels[source] * 299 + pixels[source + 1] * 587 + pixels[source + 2] * 114) / 1000);
          value = Math.max(0, Math.min(255, 128 + (value * exposure / 0x300 - 128) / 8));
          if (invert) value = 255 - value;

          const matrix = 6 + ((y & 3) * 4 + (x & 3)) * 3;
          let shade = 0;
          if (value >= this.cameraRegisters[matrix]) shade = 1;
          if (value >= this.cameraRegisters[matrix + 1]) shade = 2;
          if (value >= this.cameraRegisters[matrix + 2]) shade = 3;
          const color = 3 - shade;
          const tile = base + ((y >>> 3) * 16 + (x >>> 3)) * 16 + (y & 7) * 2;
          const bit = 1 << (7 - (x & 7));
          if (color & 1) this.ram[tile] |= bit;
          if (color & 2) this.ram[tile + 1] |= bit;
        }
      }
      const nBit = this.cameraRegisters[1] & 0x80;
      this.cameraBusyCycles = 4 * (32446 + (nBit ? 0 : 512) + 16 * exposure);
      this.saveRevision++;
    }
    tick(cycles) {
      if (this.cameraBusyCycles) this.cameraBusyCycles = Math.max(0, this.cameraBusyCycles - cycles);
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
    readHuC3(address) {
      switch (this.huc3Mode) {
        case 0x0: case 0xa: return this.ram.length ? this.ram[this.ramOffset(address)] : 255;
        case 0xc: return (this.huc3Mailbox & 0x70) | this.huc3Result;
        case 0xe: return 0xc0;
        default: return 255;
      }
    }
    writeHuC3(address, value) {
      switch (this.huc3Mode) {
        case 0xa:
          if (this.ram.length) {
            const offset = this.ramOffset(address);
            if (this.ram[offset] !== value) {
              this.ram[offset] = value;
              this.saveRevision++;
            }
          }
          break;
        case 0xb: this.huc3Mailbox = value; break;
        case 0xd: if (!(value & 1)) this.huc3Execute(); break;
      }
    }
    huc3Execute() {
      const command = (this.huc3Mailbox >> 4) & 7, argument = this.huc3Mailbox & 15;
      const address = this.huc3Address, memory = this.huc3Memory;
      switch (command) {
        case 1:
          this.huc3Result = memory[address] & 15;
          this.huc3Address = (address + 1) & 255;
          break;
        case 3:
          memory[address] = argument;
          this.huc3Address = (address + 1) & 255;
          this.saveRevision++;
          break;
        case 4: this.huc3Address = (address & 0xf0) | argument; break;
        case 5: this.huc3Address = (address & 0x0f) | (argument << 4); break;
        case 6: if (argument === 2) this.huc3Result = 1; break;
      }
    }
    ramOffset(address) {
      if (this.mapper === "MBC2") return address & 511;
      const bank = this.mapper === "MBC1" ? this.mode ? this.highBank : 0
        : this.mapper === "MMM01" ? this.mmm01RamBank() : this.ramBank;
      return (bank * 8192 + (address & 8191)) % this.ram.length;
    }
    readRAM(address) {
      if (this.mapper === "MBC7") return this.readMBC7(address);
      if (this.mapper === "Camera") {
        if (this.ramBank & 0x10) return this.cameraRegister(address);
        if (this.cameraBusyCycles) return 0;
        return this.ram.length ? this.ram[this.ramOffset(address)] : 255;
      }
      if (this.mapper === "HUC1" && this.irMode) return 0xc0;
      if (this.mapper === "HUC3") return this.readHuC3(address);
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
      if (this.mapper === "MBC7") { this.writeMBC7(address, value); return; }
      if (this.mapper === "Camera") {
        if (this.ramBank & 0x10) { this.writeCameraRegister(address, value); return; }
        if (!this.ramEnabled || this.cameraBusyCycles || !this.ram.length) return;
        const offset = this.ramOffset(address);
        if (this.ram[offset] !== value) {
          this.ram[offset] = value;
          this.saveRevision++;
        }
        return;
      }
      if (this.mapper === "HUC1" && this.irMode) return;
      if (this.mapper === "HUC3") { this.writeHuC3(address, value); return; }
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
    readMBC7(address) {
      if (!this.ramEnabled || !this.mbc7Gate2 || address >= 0xb000) return 255;
      // No tilt input exists, so the accelerometer always reads its rest position.
      switch ((address >> 4) & 15) {
        case 2: case 4: return this.mbc7Latched ? 0xd0 : 0x00;
        case 3: case 5: return this.mbc7Latched ? 0x81 : 0x80;
        case 6: return 0x00;
        case 8: return (this.eepromCS ? 0x80 : 0) | (this.eepromClk ? 0x40 : 0)
          | (this.eepromDI ? 0x02 : 0) | this.eepromOutput();
        default: return 255;
      }
    }
    writeMBC7(address, value) {
      if (!this.ramEnabled || !this.mbc7Gate2 || address >= 0xb000) return;
      switch ((address >> 4) & 15) {
        case 0: if (value === 0x55) this.mbc7Latched = false; break;
        case 1: if (value === 0xaa) this.mbc7Latched = true; break;
        case 8: this.writeEEPROMPins(value); break;
      }
    }
    eepromOutput() {
      return this.eepromPhase === 2 ? (this.eepromShift >> (15 - this.eepromCount)) & 1 : 1;
    }
    eepromIdle() {
      this.eepromPhase = 0;
      this.eepromCount = 0;
      this.eepromShift = 0;
    }
    writeEEPROMPins(value) {
      const cs = (value & 0x80) !== 0, clk = (value & 0x40) !== 0, di = (value & 0x02) !== 0;
      const rising = clk && !this.eepromClk;
      this.eepromCS = cs;
      this.eepromClk = clk;
      this.eepromDI = di;
      if (!cs) { this.eepromIdle(); return; }
      if (!rising) return;
      if (this.eepromPhase === 0) {
        if (di) { this.eepromIdle(); this.eepromPhase = 1; }
        return;
      }
      if (this.eepromPhase === 2) {
        if (++this.eepromCount === 16) this.eepromIdle();
        return;
      }
      this.eepromShift = (this.eepromShift << 1) | (di ? 1 : 0);
      this.eepromCount++;
      if (this.eepromPhase === 1) {
        if (this.eepromCount < 10) return;
        const op = (this.eepromShift >> 8) & 3, field = this.eepromShift & 0xff;
        if (op === 2) {
          this.eepromShift = this.eepromWord(field & 0x7f);
          this.eepromPhase = 2;
          this.eepromCount = 0;
          return;
        }
        if (op === 1 || (op === 0 && (field >> 6) === 1)) {
          this.eepromPhase = 3;
          return;
        }
        this.eepromIdle();
        this.runEEPROMCommand(op, field >> 6, field & 0x7f, 0);
        return;
      }
      if (this.eepromCount < 26) return;
      const op = (this.eepromShift >>> 24) & 3, field = (this.eepromShift >>> 16) & 0xff;
      const data = this.eepromShift & 0xffff;
      this.eepromIdle();
      this.runEEPROMCommand(op, field >> 6, field & 0x7f, data);
    }
    runEEPROMCommand(op, sub, address, data) {
      if (op === 0) {
        if (sub === 3) this.eepromWriteEnabled = true;
        else if (sub === 0) this.eepromWriteEnabled = false;
        else if (sub === 2) { for (let word = 0; word < 128; word++) this.setEEPROMWord(word, 0xffff); }
        else { for (let word = 0; word < 128; word++) this.setEEPROMWord(word, data); }
      } else if (op === 1) this.setEEPROMWord(address, data);
      else if (op === 3) this.setEEPROMWord(address, 0xffff);
    }
    eepromWord(address) {
      return (this.ram[address * 2] << 8) | this.ram[address * 2 + 1];
    }
    setEEPROMWord(address, value) {
      if (!this.eepromWriteEnabled) return;
      const high = value >> 8, low = value & 0xff;
      if (this.ram[address * 2] === high && this.ram[address * 2 + 1] === low) return;
      this.ram[address * 2] = high;
      this.ram[address * 2 + 1] = low;
      this.saveRevision++;
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
        huc3: this.mapper === "HUC3" ? this.huc3Memory.slice() : null,
      };
    }
    restoreData(data) {
      if (!data || data.version !== 1 || data.type !== this.type
        || !(data.ram instanceof Uint8Array) || data.ram.length !== this.ram.length
        || (this.mapper === "HUC3" ? !(data.huc3 instanceof Uint8Array) || data.huc3.length !== 256
          : (data.huc3 ?? null) !== null)
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
      if (this.mapper === "HUC3") this.huc3Memory.set(data.huc3);
      this.saveRevision++;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { Cartridge };
  else root.PocketCartridge = Cartridge;
})(globalThis);
