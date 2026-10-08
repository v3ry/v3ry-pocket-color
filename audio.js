(function (root) {
  "use strict";

  const CLOCK = 4194304;
  const DUTY = [0.125, 0.25, 0.5, 0.75];
  const MASKS = [0x80, 0x3f, 0, 0xff, 0xbf, 0xff, 0x3f, 0, 0xff, 0xbf,
    0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff, 0xff, 0, 0, 0xbf, 0, 0, 0x70];

  class APU {
    constructor(sampleRate = 48000) {
      this.sampleRate = sampleRate;
      this.registers = new Uint8Array(0x30);
      this.registers[0x16] = 0x80;
      this.registers[0x14] = 0x77;
      this.registers[0x15] = 0xf3;
      this.channels = Array.from({ length: 4 }, () => ({
        enabled: false, length: 0, volume: 0, envelope: 0, phase: 0,
        lfsr: 0x7fff, sweep: 0, shadow: 0,
      }));
      this.sampleClock = 0;
      this.frameClock = 0;
      this.frameStep = 0;
      this.samples = [];
      this.highpass = [0, 0];
    }
    read(address) {
      const index = address - 0xff10;
      if (index >= 0x17 && index < 0x20) return 255;
      if (index === 0x16) return (this.registers[index] & 0x80) | 0x70
        | this.channels.reduce((mask, channel, i) => mask | (channel.enabled ? 1 << i : 0), 0);
      return this.registers[index] | (MASKS[index] || 0);
    }
    write(address, value) {
      const index = address - 0xff10;
      if (index >= 0x17 && index < 0x20) return;
      if (index >= 0x20) { this.registers[index] = value; return; }
      if (index === 0x16) {
        if (!(value & 0x80)) {
          this.registers.fill(0, 0, 0x17);
          this.channels.forEach((channel) => { channel.enabled = false; });
          this.frameStep = 0;
        }
        this.registers[index] = value & 0x80;
        return;
      }
      if (!(this.registers[0x16] & 0x80)) return;
      this.registers[index] = value;
      const lengthIndices = [1, 6, 11, 16];
      const envelopeIndices = [2, 7, 10, 17];
      const triggerIndices = [4, 9, 14, 19];
      for (let i = 0; i < 4; i++) {
        const channel = this.channels[i];
        if (index === lengthIndices[i]) channel.length = (i === 2 ? 256 : 64) - (value & (i === 2 ? 255 : 63));
        if (index === envelopeIndices[i] && !(value & (i === 2 ? 0x80 : 0xf8))) channel.enabled = false;
        if (index === triggerIndices[i] && (value & 0x80)) {
          channel.enabled = !!(this.registers[envelopeIndices[i]] & (i === 2 ? 0x80 : 0xf8));
          if (!channel.length) channel.length = i === 2 ? 256 : 64;
          channel.phase = 0;
          channel.volume = this.registers[envelopeIndices[i]] >> 4;
          channel.envelope = (this.registers[envelopeIndices[i]] & 7) || 8;
          channel.lfsr = 0x7fff;
          if (i === 0) {
            channel.shadow = this.frequency(0);
            channel.sweep = ((this.registers[0] >> 4) & 7) || 8;
            if ((this.registers[0] & 7) && this.sweepFrequency() > 2047) channel.enabled = false;
          }
        }
      }
    }
    frequency(index) {
      const low = index === 0 ? 3 : index === 1 ? 8 : 13;
      return this.registers[low] | ((this.registers[low + 1] & 7) << 8);
    }
    sweepFrequency() {
      const channel = this.channels[0], setting = this.registers[0];
      const delta = channel.shadow >> (setting & 7);
      return channel.shadow + (setting & 8 ? -delta : delta);
    }
    sequencer() {
      const triggerIndices = [4, 9, 14, 19], envelopeIndices = [2, 7, 0, 17];
      if (!(this.frameStep & 1)) {
        this.channels.forEach((channel, i) => {
          if ((this.registers[triggerIndices[i]] & 0x40) && channel.length > 0 && --channel.length === 0) {
            channel.enabled = false;
          }
        });
      }
      if (this.frameStep === 2 || this.frameStep === 6) {
        const channel = this.channels[0], setting = this.registers[0];
        if (--channel.sweep <= 0) {
          channel.sweep = ((setting >> 4) & 7) || 8;
          if (setting & 0x70) {
            const frequency = this.sweepFrequency();
            if (frequency > 2047) channel.enabled = false;
            else if (setting & 7) {
              channel.shadow = frequency;
              this.registers[3] = frequency & 255;
              this.registers[4] = (this.registers[4] & 0xf8) | (frequency >> 8);
              if (this.sweepFrequency() > 2047) channel.enabled = false;
            }
          }
        }
      }
      if (this.frameStep === 7) {
        this.channels.forEach((channel, i) => {
          if (i === 2 || !channel.enabled) return;
          const setting = this.registers[envelopeIndices[i]];
          if (--channel.envelope <= 0) {
            channel.envelope = (setting & 7) || 8;
            if (setting & 7) {
              const next = channel.volume + (setting & 8 ? 1 : -1);
              if (next >= 0 && next <= 15) channel.volume = next;
            }
          }
        });
      }
      this.frameStep = (this.frameStep + 1) & 7;
    }
    clockDivider() {
      if (this.registers[0x16] & 128) this.sequencer();
    }
    sampleChannel(index) {
      const channel = this.channels[index];
      if (!channel.enabled) return 0;
      if (index < 2) {
        const frequency = 131072 / (2048 - this.frequency(index));
        channel.phase = (channel.phase + frequency / this.sampleRate) % 1;
        const duty = DUTY[this.registers[index === 0 ? 1 : 6] >> 6];
        return (channel.phase < duty ? 1 : -1) * channel.volume / 15;
      }
      if (index === 2) {
        channel.phase = (channel.phase + 65536 / (2048 - this.frequency(2)) / this.sampleRate) % 1;
        const position = Math.floor(channel.phase * 32);
        const byte = this.registers[0x20 + (position >> 1)];
        const nibble = position & 1 ? byte & 15 : byte >> 4;
        const volume = (this.registers[12] >> 5) & 3;
        return volume ? ((nibble >> (volume - 1)) / 7.5 - 1) : 0;
      }
      const setting = this.registers[18];
      const divisor = [8, 16, 32, 48, 64, 80, 96, 112][setting & 7];
      channel.phase += CLOCK / (divisor * (1 << (setting >> 4))) / this.sampleRate;
      while (channel.phase >= 1) {
        channel.phase--;
        const bit = (channel.lfsr ^ (channel.lfsr >> 1)) & 1;
        channel.lfsr = (channel.lfsr >> 1) | (bit << 14);
        if (setting & 8) channel.lfsr = (channel.lfsr & ~0x40) | (bit << 6);
      }
      return (channel.lfsr & 1 ? -1 : 1) * channel.volume / 15;
    }
    tick(cycles, dividerClocked = false) {
      this.frameClock += cycles;
      while (this.frameClock >= 8192) {
        this.frameClock -= 8192;
        if (!dividerClocked) this.clockDivider();
      }
      this.sampleClock += cycles * this.sampleRate;
      while (this.sampleClock >= CLOCK) {
        this.sampleClock -= CLOCK;
        const channels = this.channels.map((_, i) => this.sampleChannel(i));
        const route = this.registers[21], volume = this.registers[20];
        for (let side = 0; side < 2; side++) {
          const shift = (1 - side) * 4;
          let sum = 0;
          for (let i = 0; i < 4; i++) if (route & (1 << (i + shift))) sum += channels[i];
          const output = sum * (((volume >> shift) & 7) + 1) / 64;
          const filtered = output - this.highpass[side];
          this.highpass[side] = output - filtered * 0.999;
          this.samples.push(filtered);
        }
      }
    }
    drain() {
      const samples = new Float32Array(this.samples);
      this.samples.length = 0;
      return samples;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { APU };
  else root.PocketAPU = APU;
})(globalThis);
