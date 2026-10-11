const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { makeGBA } = require("./helpers.cjs");

const DRIVER = 0x03000000, PLAYER = 0x02000200, SONG = 0x02000300;
const END = [0, 0, 0, 0, 0];

function game() {
  const g = new GameBoyAdvance(makeGBA());
  g.cpu.r[0] = DRIVER; g.swi(0x1a);
  return g;
}

function call(g, number, ...args) {
  args.forEach((value, index) => { g.cpu.r[index] = value; });
  g.swi(number);
}

function writeSong(g, address, events) {
  events.forEach(([type, channel, key, velocity, frames], index) => {
    const at = address + index * 8;
    g.write8(at, type); g.write8(at + 1, channel); g.write8(at + 2, key); g.write8(at + 3, velocity); g.write16(at + 4, frames);
  });
}

function open(g) {
  call(g, 0x20, PLAYER);
}

test("sound driver Init validates its work area and enables the PSG master", () => {
  const g = new GameBoyAdvance(makeGBA());
  g.cpu.r[0] = DRIVER; g.swi(0x1a);
  assert.equal(g.soundDriver.area, DRIVER);
  assert.equal(g.apu.master, true);
  assert.equal(g.apu.soundControl[0], 0x77);
  assert.equal(g.apu.soundControl[1], 0xff);
  assert.equal(g.apu.soundControl[2], 0x02);
  assert.equal(g.apu.psg.channels[0].enabled, false);
  g.cpu.r[0] = 0x08000000;
  assert.throws(() => g.swi(0x1a), error => error.kind === "swi" && error.report.swi === 0x1a);
});

test("sound driver Mode and VSync record bookkeeping without touching the PSG", () => {
  const g = game();
  call(g, 0x1b, 5);
  assert.equal(g.soundDriver.mode, 5);
  call(g, 0x1d); call(g, 0x1d);
  assert.equal(g.soundDriver.vsyncCount, 2);
  call(g, 0x28); assert.equal(g.soundDriver.vsync, false);
  call(g, 0x29); assert.equal(g.soundDriver.vsync, true);
  assert.equal(g.apu.psg.channels[0].enabled, false);
});

test("sound driver plays a synthetic song one event per frame, then stops at its end event", () => {
  const g = game();
  writeSong(g, SONG, [[1, 0, 69, 15, 2], [2, 0, 0, 0, 1], [1, 1, 81, 8, 1], END]);
  open(g);
  call(g, 0x21, PLAYER, SONG);
  const first = g.apu.psg.channels[0];
  assert.equal(first.enabled, true); assert.equal(first.volume, 15);
  assert.equal(g.apu.psg.frequency(0), 1750);

  g.swi(0x1c);
  assert.equal(g.apu.psg.channels[0].enabled, true);

  g.swi(0x1c);
  assert.equal(g.apu.psg.channels[0].enabled, false);

  g.swi(0x1c);
  assert.equal(g.apu.psg.channels[1].enabled, true);
  assert.equal(g.apu.psg.channels[1].volume, 8);
  assert.equal(g.apu.psg.frequency(1), 1899);

  g.swi(0x1c);
  assert.equal(g.apu.psg.channels[1].enabled, false);
  assert.equal(g.read32(PLAYER + 4), 1);
});

test("sound driver Stop silences the player and Continue resumes the sounding note", () => {
  const g = game();
  writeSong(g, SONG, [[1, 0, 69, 15, 4], END]);
  open(g);
  call(g, 0x21, PLAYER, SONG);
  g.swi(0x1c);
  call(g, 0x22, PLAYER);
  assert.equal(g.apu.psg.channels[0].enabled, false);
  assert.equal(g.read32(PLAYER + 4), 1);
  g.swi(0x1c);
  assert.equal(g.read32(PLAYER + 12), 3);
  call(g, 0x23, PLAYER);
  assert.equal(g.read32(PLAYER + 4), 2);
  assert.equal(g.apu.psg.channels[0].enabled, true);
  assert.equal(g.apu.psg.frequency(0), 1750);
});

test("sound driver FadeOut ramps the voice volume down and stops exactly when the fade ends", () => {
  const g = game();
  writeSong(g, SONG, [[1, 0, 69, 12, 60], END]);
  open(g);
  call(g, 0x21, PLAYER, SONG);
  call(g, 0x24, PLAYER, 4);
  assert.equal(g.apu.psg.channels[0].volume, 12);
  g.swi(0x1c); assert.equal(g.apu.psg.channels[0].volume, 9);
  g.swi(0x1c); assert.equal(g.apu.psg.channels[0].volume, 6);
  g.swi(0x1c); assert.equal(g.apu.psg.channels[0].volume, 3);
  g.swi(0x1c);
  assert.equal(g.apu.psg.channels[0].enabled, false);
  assert.equal(g.read32(PLAYER + 4), 1);
});

test("sound driver ChannelClear stops every player and cannot resume them", () => {
  const g = game();
  writeSong(g, SONG, [[1, 0, 69, 15, 4], END]);
  open(g);
  call(g, 0x21, PLAYER, SONG);
  call(g, 0x1e);
  assert.equal(g.apu.psg.channels[0].enabled, false);
  assert.equal(g.read32(PLAYER + 4), 1);
  call(g, 0x23, PLAYER);
  assert.equal(g.read32(PLAYER + 4), 1);
  assert.equal(g.apu.psg.channels[0].enabled, false);
});

test("sound driver stops a player whose event names a channel outside the square pair", () => {
  const g = game();
  writeSong(g, SONG, [[1, 2, 69, 15, 4], END]);
  open(g);
  call(g, 0x21, PLAYER, SONG);
  assert.equal(g.read32(PLAYER + 4), 1);
  assert.equal(g.apu.psg.channels[0].enabled, false);
  assert.equal(g.apu.psg.channels[1].enabled, false);
});

test("sound driver rejects player and song pointers outside work RAM", () => {
  const g = game();
  assert.throws(() => call(g, 0x20, 0x08000000), error => error.kind === "swi" && error.report.swi === 0x20);
  open(g);
  assert.throws(() => call(g, 0x21, PLAYER, 0x08000000), error => error.kind === "swi" && error.report.swi === 0x21);
});

test("sound driver SoundGetJumpList stays unsupported", () => {
  const g = game();
  assert.throws(() => g.swi(0x2a), /Service BIOS/);
});
