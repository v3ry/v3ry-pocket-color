"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { makeGBA } = require("./helpers.cjs");

const game = () => new GameBoyAdvance(makeGBA());

test("muted GBA master clock advances without queuing silent samples", () => {
  const g = game();
  g.apu.tick(16777216 + 123);
  assert.equal(g.apu.samples.length, 0);
  assert.equal(g.apu.sampleClock, 123 * g.apu.sampleRate);
});

test("GBA PSG register writes clock all four channels and return status bits", () => {
  const g = game();
  g.write16(0x04000084, 0x0080);
  g.write16(0x04000080, 0xff77);
  g.write16(0x04000082, 0x0002);
  g.write16(0x04000062, 0xf080); g.write16(0x04000064, 0x8000);
  g.write16(0x04000068, 0xf080); g.write16(0x0400006c, 0x8000);
  g.write16(0x04000070, 0x0080);
  for (let i = 0; i < 16; i++) g.write8(0x04000090 + i, i & 1 ? 0x21 : 0xef);
  g.write16(0x04000072, 0x2000); g.write16(0x04000074, 0x8000);
  g.write16(0x04000078, 0xf03f); g.write16(0x0400007c, 0x8000);
  assert.equal(g.read8(0x04000084) & 0x8f, 0x8f);
  g.apu.tick(16777216 / 8);
  const samples = g.apu.drain();
  assert.equal(samples.length, 48000 / 8 * 2);
  assert.ok(samples.some(sample => sample > 0.001));
  assert.ok(samples.some(sample => sample < -0.001));
  assert.ok(samples.every(Number.isFinite));
  for (let i = 0; i < samples.length; i += 2) assert.equal(samples[i], samples[i + 1]);
  g.write16(0x04000084, 0);
  assert.equal(g.read8(0x04000084), 0);
  assert.equal(g.apu.drain().length, 0);
});

test("Direct Sound mixes signed FIFO samples at the selected timer rate", () => {
  const g = game();
  g.write16(0x04000084, 0x0080);
  g.write16(0x04000080, 0);
  g.write16(0x04000082, 0x0304);
  g.write32(0x040000a0, 0x80c07f40);
  assert.equal(g.apu.fifos[0].length, 4);
  g.apu.timerOverflow(0, 1, () => {});
  assert.equal(g.apu.fifos[0].output, 64);
  g.apu.tick(4096);
  const positive = g.apu.drain();
  assert.ok(positive.some(sample => sample > 0.01));
  assert.ok(positive.every(Number.isFinite));
  for (let i = 0; i < positive.length; i += 2) assert.equal(positive[i], positive[i + 1]);
  g.apu.timerOverflow(0, 1, () => {});
  assert.equal(g.apu.fifos[0].output, 127);
  g.apu.timerOverflow(1, 1, () => {});
  assert.equal(g.apu.fifos[0].output, 127);
  g.apu.timerOverflow(0, 2, () => {});
  assert.equal(g.apu.fifos[0].output, -128);
  g.apu.resetFIFO(0);
  g.write32(0x040000a0, 0x80c07f40);
  g.apu.timerOverflow(0, 3, () => {});
  assert.equal(g.apu.fifos[0].output, -64);
  g.write8(0x04000083, 8);
  assert.equal(g.apu.fifos[0].length, 0);
  assert.equal(g.apu.fifos[0].output, 0);
});

test("Timer overflow refills Direct Sound through repeating DMA1 word transfers", () => {
  const g = game();
  g.write16(0x04000084, 0x0080);
  g.write16(0x04000082, 0x030c);
  for (let i = 0; i < 16; i++) g.write8(0x02000000 + i, i < 4 ? 0x40 + i : 0x70 + i);
  g.write32(0x040000bc, 0x02000000);
  g.write32(0x040000c0, 0x040000a0);
  g.write16(0x040000c4, 1);
  g.write16(0x040000c6, 0xb640);
  g.write16(0x04000100, 0xfffe);
  g.write16(0x04000102, 0x0080);
  g.tick(2);
  assert.equal(g.apu.fifos[0].length, 16);
  assert.equal(g.dma[1].source, 0x02000010);
  assert.equal(g.io16(0xc6) & 0x8000, 0x8000);
  g.write16(0x04000102, 0);
  g.write16(0x04000100, 0xfffe);
  g.write16(0x04000102, 0x0080);
  g.tick(2);
  assert.equal(g.apu.fifos[0].output, 0x40);
  assert.equal(g.apu.fifos[0].length, 31);
  assert.equal(g.dma[1].source, 0x02000020);
});

test("Sound master disable clears channels and Direct Sound FIFO; sample rate is adjustable", () => {
  const g = new GameBoyAdvance(makeGBA(), 44100);
  assert.equal(g.apu.sampleRate, 44100);
  g.apu.sampleRate = 32000;
  assert.equal(g.apu.psg.sampleRate, 32000);
  g.write16(0x04000084, 0x0080);
  g.write32(0x040000a4, 0x12345678);
  g.write16(0x04000070, 0x0080); g.write16(0x04000072, 0x2000); g.write16(0x04000074, 0x8000);
  assert.equal(g.apu.fifos[1].length, 4);
  assert.equal(g.read8(0x04000084) & 0x84, 0x84);
  g.write16(0x04000084, 0);
  assert.equal(g.apu.fifos[1].length, 0);
  assert.equal(g.read8(0x04000084), 0);
  const g2 = game();
  g2.write16(0x04000084, 0x0080); g2.write16(0x04000082, 0x8008);
  assert.equal(g2.apu.fifos[1].length, 0);
  assert.equal(g2.apu.soundControl[3] & 0x80, 0);
});
