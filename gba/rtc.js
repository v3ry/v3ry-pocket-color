(function (root) {
  "use strict";

  const commonJS = typeof module !== "undefined" && module.exports;
  const SCK = 1, SIO = 2, CS = 4;
  const PORT = 0xc4, DIRECTION = 0xc6, CONTROL = 0xc8;
  const DEFAULT_STATUS = 0x40;
  const COMMAND_LOW_NIBBLE = 0x6;
  const STATUS = 1, DATE = 7, TIME = 3;

  function toBCD(value) { return (Math.floor(value / 10) << 4) | (value % 10); }
  function fromBCD(value) {
    const tens = value >>> 4, ones = value & 15;
    return tens > 9 || ones > 9 ? -1 : tens * 10 + ones;
  }
  // 24-hour mode uses bits 0-5; 12-hour mode uses bits 0-4 with bit 7 meaning PM.
  function hourFromByte(byte, status) {
    if (status & 64) {
      const hour = fromBCD(byte & 63);
      return hour > 23 ? -1 : hour;
    }
    const hour = fromBCD(byte & 31);
    return hour < 1 || hour > 12 ? -1 : hour % 12 + (byte & 128 ? 12 : 0);
  }

  // Seiko S-3511A clock behind the GBA cartridge GPIO port. The clock follows the host time plus an offset that the
  // game can change; the offset and the control register are the only data kept between sessions.
  class RTC {
    constructor({ clock = () => Date.now(), onChange = () => {} } = {}) {
      this.clock = clock;
      this.onChange = onChange;
      this.offset = 0;
      this.status = DEFAULT_STATUS;
      this.portControl = 0; this.direction = 0; this.latch = 0;
      this.sck = 0; this.cs = 0; this.sioOut = 1;
      this.phase = "idle"; this.bits = 0; this.value = 0; this.bytes = []; this.index = 0;
      this.length = 0; this.target = 0;
    }
    now() { return new Date(this.clock() + this.offset); }
    readRegister(address) {
      if (address === PORT) return this.portControl ? (this.latch & this.direction) | (this.direction & SIO ? 0 : this.sioOut << 1) : 0;
      if (address === DIRECTION) return this.direction;
      if (address === CONTROL) return this.portControl;
      return 0;
    }
    writeRegister(address, value) {
      if (address === PORT) { this.latch = value & 15; this.drive(); }
      else if (address === DIRECTION) this.direction = value & 15;
      else if (address === CONTROL) this.portControl = value & 1;
    }
    drive() {
      const sck = this.latch & SCK ? 1 : 0, cs = this.latch & CS ? 1 : 0, sio = this.latch >> 1 & 1;
      if (cs && !this.cs) this.begin();
      else if (!cs && this.cs) this.finish();
      else if (cs && sck !== this.sck) {
        if (sck) this.rise(sio);
        else this.fall();
      }
      this.sck = sck; this.cs = cs;
    }
    begin() {
      this.phase = "command"; this.bits = 0; this.value = 0; this.bytes = []; this.index = 0; this.sioOut = 1;
    }
    finish() { this.phase = "idle"; this.sioOut = 1; }
    rise(sio) {
      if (this.phase === "read") {
        if (++this.bits < 8) return;
        this.bits = 0;
        if (++this.index === this.bytes.length) { this.phase = "idle"; this.sioOut = 1; }
        return;
      }
      if (this.phase !== "command" && this.phase !== "write") return;
      this.value |= sio << this.bits;
      if (++this.bits < 8) return;
      const byte = this.value;
      this.value = 0; this.bits = 0;
      if (this.phase === "command") this.command(byte);
      else this.receive(byte);
    }
    fall() {
      if (this.phase === "read") this.sioOut = this.bytes[this.index] >> this.bits & 1;
    }
    command(byte) {
      this.phase = "idle";
      if ((byte & 15) !== COMMAND_LOW_NIBBLE) return;
      const code = byte >> 4 & 7, reading = (byte & 128) !== 0;
      if (code === 0) { this.status = DEFAULT_STATUS; return; }
      if (code !== 1 && code !== 2 && code !== 6) return;
      this.target = code;
      this.length = code === 1 ? STATUS : code === 2 ? DATE : TIME;
      if (!reading) { this.phase = "write"; return; }
      if (code === 1) this.bytes = [this.takeStatus()];
      else if (code === 2) this.bytes = this.clockBytes();
      else this.bytes = this.clockBytes().slice(4);
      this.phase = "read";
    }
    // Reading the control register clears the power-off flag, as on the hardware.
    takeStatus() {
      const status = this.status;
      this.status &= 0x7f;
      return status;
    }
    clockBytes() {
      const date = this.now(), hour = date.getHours();
      const hourByte = this.status & 64 ? toBCD(hour) : toBCD(hour % 12 || 12) | (hour >= 12 ? 128 : 0);
      return [toBCD(date.getFullYear() % 100), toBCD(date.getMonth() + 1), toBCD(date.getDate()), date.getDay(),
        hourByte, toBCD(date.getMinutes()), toBCD(date.getSeconds())];
    }
    receive(byte) {
      this.bytes.push(byte);
      if (this.bytes.length < this.length) return;
      this.phase = "idle"; this.sioOut = 1;
      this.apply(this.target, this.bytes);
    }
    // Invalid date or time bytes are ignored as a whole, so the clock never lands on an impossible value.
    apply(code, bytes) {
      if (code === 1) {
        if (bytes[0] !== this.status) { this.status = bytes[0]; this.onChange(); }
        return;
      }
      const time = code === 2 ? bytes.slice(4) : bytes;
      const hour = hourFromByte(time[0], this.status);
      const minute = fromBCD(time[1] & 127), second = fromBCD(time[2] & 127);
      if (hour < 0 || minute < 0 || minute > 59 || second < 0 || second > 59) return;
      if (code === 2) {
        const year = fromBCD(bytes[0]), month = fromBCD(bytes[1] & 31), day = fromBCD(bytes[2] & 63);
        if (year < 0 || month < 1 || month > 12 || day < 1 || day > 31) return;
        const next = new Date(2000 + year, month - 1, day, hour, minute, second);
        if (next.getMonth() !== month - 1 || next.getDate() !== day) return;
        this.setClock(next);
      } else {
        const next = this.now();
        next.setHours(hour, minute, second, 0);
        this.setClock(next);
      }
    }
    setClock(date) {
      const offset = date.getTime() - this.clock();
      if (offset === this.offset) return;
      this.offset = offset;
      this.onChange();
    }
    // Clears the serial transfer in progress; used when a state without clock data is loaded.
    resetLink() {
      Object.assign(this, { sck: 0, cs: 0, sioOut: 1, latch: 0, phase: "idle", bits: 0, value: 0, bytes: [], index: 0, length: 0, target: 0 });
    }
    saveData() { return { offset: this.offset, status: this.status }; }
    restoreData(data) {
      if (!data || !Number.isSafeInteger(data.offset) || !Number.isInteger(data.status) || data.status < 0 || data.status > 255) {
        throw new Error("Horloge RTC GBA incompatible ou corrompue.");
      }
      this.offset = data.offset; this.status = data.status;
    }
  }

  const api = { RTC };
  if (commonJS) module.exports = api;
  else root.PocketGBARTC = api;
})(globalThis);
