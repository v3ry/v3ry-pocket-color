(function (root) {
  "use strict";

  const WIDTH = 160;
  const MAX_PACKET_SIZE = 0x280;
  const MAX_IMAGE_SIZE = 8000;
  const STATUS = {
    CHECKSUM_ERROR: 0x01,
    PRINTING: 0x02,
    IMAGE_FULL: 0x04,
    UNPROCESSED: 0x08,
    PACKET_ERROR: 0x10,
  };

  function decodeRLE(data) {
    const decoded = [];
    for (let offset = 0; offset < data.length;) {
      const control = data[offset++];
      if (control & 0x80) {
        if (offset === data.length) return null;
        const count = (control & 0x7f) + 2;
        const value = data[offset++];
        for (let index = 0; index < count; index++) decoded.push(value);
      } else {
        const count = control + 1;
        if (offset + count > data.length) return null;
        for (let index = 0; index < count; index++) decoded.push(data[offset++]);
      }
      if (decoded.length > MAX_PACKET_SIZE) return null;
    }
    return decoded;
  }

  function makeImage(data, options) {
    const tileRows = Math.ceil(data.length / (20 * 16));
    const imageHeight = tileRows * 8;
    const top = (options.margins >> 4) * 8;
    const bottom = (options.margins & 15) * 8;
    const height = Math.max(1, top + imageHeight + bottom);
    const pixels = new Uint8ClampedArray(WIDTH * height * 4);
    const paper = [247, 244, 226], ink = [30, 29, 26];
    const shadeLevels = [0, 0.28, 0.62, 1];
    const exposure = 0.75 + options.exposure / 256;
    const shades = Array.from({ length: 4 }, (_, color) => {
      const darkness = Math.min(1, shadeLevels[(options.palette >> (color * 2)) & 3] * exposure);
      return paper.map((value, channel) => Math.round(value + (ink[channel] - value) * darkness));
    });

    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      pixels[pixel] = paper[0];
      pixels[pixel + 1] = paper[1];
      pixels[pixel + 2] = paper[2];
      pixels[pixel + 3] = 255;
    }
    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const tile = Math.floor(y / 8) * 20 + Math.floor(x / 8);
        const offset = tile * 16 + (y & 7) * 2;
        if (offset + 1 >= data.length) continue;
        const bit = 7 - (x & 7);
        const color = ((data[offset] >> bit) & 1) | (((data[offset + 1] >> bit) & 1) << 1);
        const rgb = shades[color], pixel = ((top + y) * WIDTH + x) * 4;
        pixels[pixel] = rgb[0];
        pixels[pixel + 1] = rgb[1];
        pixels[pixel + 2] = rgb[2];
        pixels[pixel + 3] = 255;
      }
    }
    return { width: WIDTH, height, imageHeight, top, bottom, copies: options.copies, pixels };
  }

  class GameBoyPrinter {
    constructor({ onPrint = () => {}, onStatus = () => {} } = {}) {
      if (typeof onPrint !== "function" || typeof onStatus !== "function") {
        throw new TypeError("Les gestionnaires de l’imprimante Game Boy doivent être des fonctions.");
      }
      this.onPrint = onPrint;
      this.onStatus = onStatus;
      this.status = 0;
      this.buffer = [];
      this.responses = [];
      this.resetParser();
    }
    resetParser() {
      this.parser = "magic";
      this.packet = null;
      this.dataRemaining = 0;
      this.receivedChecksum = 0;
    }
    transfer(value) {
      value &= 255;
      if (this.responses.length) return this.responses.shift();
      this.consume(value);
      return 0;
    }
    consume(value) {
      if (this.parser === "magic") {
        if (value === 0x88) this.parser = "magic-end";
        return;
      }
      if (this.parser === "magic-end") {
        if (value === 0x33) {
          this.packet = { command: 0, compression: 0, length: 0, data: [], sum: 0, invalid: false };
          this.parser = "command";
        } else {
          this.status |= STATUS.PACKET_ERROR;
          this.notifyStatus();
          this.resetParser();
          if (value === 0x88) this.parser = "magic-end";
        }
        return;
      }

      const packet = this.packet;
      if (this.parser === "command") {
        packet.command = value;
        packet.sum = value;
        this.parser = "compression";
      } else if (this.parser === "compression") {
        packet.compression = value;
        packet.sum = (packet.sum + value) & 0xffff;
        this.parser = "length-low";
      } else if (this.parser === "length-low") {
        packet.length = value;
        packet.sum = (packet.sum + value) & 0xffff;
        this.parser = "length-high";
      } else if (this.parser === "length-high") {
        packet.length |= value << 8;
        packet.sum = (packet.sum + value) & 0xffff;
        packet.invalid = packet.length > MAX_PACKET_SIZE;
        this.dataRemaining = packet.length;
        this.parser = this.dataRemaining ? "data" : "checksum-low";
      } else if (this.parser === "data") {
        packet.sum = (packet.sum + value) & 0xffff;
        if (!packet.invalid) packet.data.push(value);
        if (--this.dataRemaining === 0) this.parser = "checksum-low";
      } else if (this.parser === "checksum-low") {
        this.receivedChecksum = value;
        this.parser = "checksum-high";
      } else if (this.parser === "checksum-high") {
        this.receivedChecksum |= value << 8;
        this.completePacket(packet);
      }
    }
    completePacket(packet) {
      const checksumValid = packet.sum === this.receivedChecksum;
      this.resetParser();
      this.status &= ~(STATUS.CHECKSUM_ERROR | STATUS.PACKET_ERROR);
      let statusForReply;
      if (!checksumValid) this.status |= STATUS.CHECKSUM_ERROR;
      else if (packet.invalid) this.status |= STATUS.PACKET_ERROR;
      else statusForReply = this.handlePacket(packet);
      this.responses.push(0x81, statusForReply ?? this.status);
      this.notifyStatus();
    }
    handlePacket(packet) {
      if (packet.compression > 1) {
        this.status |= STATUS.PACKET_ERROR;
        return this.status;
      }
      let data = packet.data;
      if (packet.compression === 1) {
        data = decodeRLE(data);
        if (!data) {
          this.status |= STATUS.PACKET_ERROR;
          return this.status;
        }
      }
      if (packet.command === 0x01) {
        if (data.length) this.status |= STATUS.PACKET_ERROR;
        else {
          this.buffer = [];
          this.status = 0;
        }
      } else if (packet.command === 0x04) {
        if (this.status & STATUS.PRINTING) {
          this.status |= STATUS.PACKET_ERROR;
        } else {
          if (this.status & STATUS.IMAGE_FULL) {
            this.buffer = [];
            this.status &= ~STATUS.IMAGE_FULL;
          }
          if (this.buffer.length + data.length > MAX_IMAGE_SIZE) {
            this.status |= STATUS.IMAGE_FULL;
          } else {
            this.buffer.push(...data);
            this.status |= STATUS.UNPROCESSED;
          }
        }
      } else if (packet.command === 0x02) {
        if (data.length !== 4 || packet.compression !== 0) {
          this.status |= STATUS.PACKET_ERROR;
        } else if (this.status & STATUS.UNPROCESSED) {
          const settings = { copies: data[0], margins: data[1], palette: data[2], exposure: data[3] };
          const replyStatus = this.status;
          if (settings.copies) {
            const job = makeImage(this.buffer, settings);
            this.status = (this.status & ~STATUS.UNPROCESSED) | STATUS.IMAGE_FULL | STATUS.PRINTING;
            this.onPrint(job);
          } else {
            this.status &= ~STATUS.UNPROCESSED;
          }
          return replyStatus;
        }
      } else if (packet.command !== 0x0f || data.length) {
        this.status |= STATUS.PACKET_ERROR;
      }
      return this.status;
    }
    finishPrinting() {
      if (!(this.status & STATUS.PRINTING)) return;
      this.status = (this.status & ~STATUS.PRINTING) | STATUS.IMAGE_FULL;
      this.notifyStatus();
    }
    notifyStatus() {
      this.onStatus(this.status);
    }
  }

  root.PocketGameBoyPrinter = GameBoyPrinter;
  if (typeof module !== "undefined" && module.exports) module.exports = { GameBoyPrinter, STATUS };
})(typeof globalThis !== "undefined" ? globalThis : this);
