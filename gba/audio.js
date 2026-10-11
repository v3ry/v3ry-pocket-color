(function (root) {
  "use strict";

  const commonJS = typeof module !== "undefined" && module.exports;
  const PSG = commonJS ? require("../gbc/audio.js").APU : root.PocketAPU;
  const CLOCK = 16777216;
  const PSG_CLOCK = 32768;
  const FIFO_ADDRESSES = [0x040000a0, 0x040000a4];
  const PSG_VOLUME = [0.25, 0.5, 1, 0];

  class APU {
    constructor(sampleRate = 48000) {
      this.psg = new PSG(sampleRate);
      this.sampleRate = sampleRate;
      this.samples = [];
      this.sampleClock = 0;
      this.frameClock = 0;
      this.fifos = Array.from({ length: 2 }, () => ({
        data: new Int8Array(32), head: 0, length: 0, output: 0,
      }));
      this.highpass = [0, 0];
      this.sampleLeft = 0;
      this.sampleRight = 0;
      this.master = false;
      this.soundControl = new Uint8Array(6);
      this.waveRAM = new Uint8Array(32);
      this.wavePosition = 0;
      this.wavePhase = 0;
    }
    get sampleRate() { return this._sampleRate; }
    set sampleRate(value) {
      this._sampleRate = value;
      if (this.psg) this.psg.sampleRate = value;
    }
    readRegister(offset) {
      if (offset === 0x84) return (this.master ? 128 : 0)
        | this.psg.channels.reduce((mask, channel, index) => mask | (channel.enabled ? 1 << index : 0), 0);
      if (offset === 0x85) return 0;
      return this.soundControl[offset - 0x80] || 0;
    }
    writeRegister(offset, value) {
      value &= 255;
      if (offset >= 0x80 && offset <= 0x85) {
        if (offset === 0x83) {
          if (value & 8) this.resetFIFO(0);
          if (value & 128) this.resetFIFO(1);
          value &= ~0x88;
        } else if (offset === 0x84) {
          const enabled = !!(value & 128);
          if (!enabled && this.master) {
            this.psg.write(0xff26, 0);
            this.resetFIFO(0); this.resetFIFO(1);
            this.soundControl.fill(0);
          } else if (enabled && !this.master) this.psg.write(0xff26, 128);
          this.master = enabled;
          value &= 128;
        }
        this.soundControl[offset - 0x80] = value;
        return value;
      }
      if (offset >= 0x90 && offset <= 0x9f) {
        const bank = this.psg.registers[10] & 32 ? 16 : 0;
        this.waveRAM[bank + offset - 0x90] = value;
        this.psg.registers[0x20 + offset - 0x90] = value;
        return value;
      }
      const registers = [
        [0x60, 0xff10], [0x62, 0xff11], [0x63, 0xff12], [0x64, 0xff13], [0x65, 0xff14],
        [0x68, 0xff16], [0x69, 0xff17], [0x6c, 0xff18], [0x6d, 0xff19],
        [0x70, 0xff1a], [0x72, 0xff1b], [0x73, 0xff1c], [0x74, 0xff1d], [0x75, 0xff1e],
        [0x78, 0xff20], [0x79, 0xff21], [0x7c, 0xff22], [0x7d, 0xff23],
      ];
      const register = registers.find(([address]) => address === offset);
      if (register && this.master) this.psg.write(register[1], value);
      return value;
    }
    resetFIFO(index) {
      const fifo = this.fifos[index];
      fifo.head = 0; fifo.length = 0; fifo.output = 0;
    }
    writeFIFO(offset, value) {
      const fifo = this.fifos[offset < 0xa4 ? 0 : 1];
      if (fifo.length === 32) return;
      fifo.data[(fifo.head + fifo.length) & 31] = value << 24 >> 24;
      fifo.length++;
    }
    timerOverflow(timer, count, requestDMA) {
      for (let index = 0; index < this.fifos.length; index++) {
        const control = this.soundControl[2] | this.soundControl[3] << 8;
        if ((control >>> (index ? 14 : 10) & 1) !== timer) continue;
        const fifo = this.fifos[index];
        for (let tick = 0; tick < count; tick++) {
          if (fifo.length) {
            fifo.output = fifo.data[fifo.head];
            fifo.head = (fifo.head + 1) & 31;
            fifo.length--;
          }
          if (fifo.length <= 16) requestDMA(FIFO_ADDRESSES[index]);
        }
      }
    }
    waveSample() {
      const control = this.psg.registers[10], dimension = control & 64 ? 64 : 32;
      const frequency = this.psg.frequency(2);
      if (frequency === 2048) return 0;
      this.wavePhase = (this.wavePhase + 65536 / (2048 - frequency) / this.sampleRate) % 1;
      const index = Math.floor(this.wavePhase * dimension);
      const bank = dimension === 64 ? index >>> 5 : control & 32 ? 1 : 0;
      const position = dimension === 64 ? index & 31 : index & 31;
      const packed = this.waveRAM[bank * 16 + (position >>> 1)];
      const nibble = position & 1 ? packed & 15 : packed >>> 4;
      const volume = this.psg.registers[12] >>> 5 & 3;
      return volume ? (nibble / 7.5 - 1) / (1 << (volume - 1)) : 0;
    }
    sample() {
      const control = this.soundControl[0] | this.soundControl[1] << 8;
      const direct = this.soundControl[2] | this.soundControl[3] << 8;
      const psgVolume = PSG_VOLUME[direct & 3];
      const channel0 = this.psg.sampleChannel(0), channel1 = this.psg.sampleChannel(1);
      const channel2 = this.waveSample(), channel3 = this.psg.sampleChannel(3);
      for (let side = 0; side < 2; side++) {
        const left = side === 0;
        const shift = left ? 12 : 8, volume = left ? control >>> 4 & 7 : control & 7;
        let mixed = 0, psg = 0;
        if (control & 1 << shift) psg += channel0;
        if (control & 1 << (shift + 1)) psg += channel1;
        if (control & 1 << (shift + 2)) psg += channel2;
        if (control & 1 << (shift + 3)) psg += channel3;
        mixed += psg * psgVolume * (volume + 1) / 28;
        for (let index = 0; index < 2; index++) {
          const routeBit = (index ? 12 : 8) + (left ? 1 : 0);
          if (!(direct & 1 << routeBit)) continue;
          const scale = direct & (1 << (2 + index)) ? 1 : 0.5;
          mixed += this.fifos[index].output / 128 * scale * 0.25;
        }
        if (left) this.sampleLeft = mixed;
        else this.sampleRight = mixed;
      }
    }
    tick(cycles) {
      if (this.master) {
        this.frameClock += cycles;
        while (this.frameClock >= PSG_CLOCK) {
          this.frameClock -= PSG_CLOCK;
          this.psg.sequencer();
        }
      } else {
        this.sampleClock = (this.sampleClock + cycles * this.sampleRate) % CLOCK;
        return;
      }
      this.sampleClock += cycles * this.sampleRate;
      while (this.sampleClock >= CLOCK) {
        this.sampleClock -= CLOCK;
        this.sample();
        const left = this.sampleLeft - this.highpass[0];
        this.highpass[0] = this.sampleLeft - left * 0.999;
        this.samples.push(left);
        const right = this.sampleRight - this.highpass[1];
        this.highpass[1] = this.sampleRight - right * 0.999;
        this.samples.push(right);
      }
    }
    drain() {
      const samples = new Float32Array(this.samples);
      this.samples.length = 0;
      return samples;
    }
  }

  if (commonJS) module.exports = { APU };
  else root.PocketGBAAPU = APU;
})(globalThis);
