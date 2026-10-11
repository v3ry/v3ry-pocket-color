"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const States = require("../../gba/states.js");
const { makeGBADemo, makeGBA } = require("./helpers.cjs");

const SIODATA32 = 0x04000120, SIODATA8 = 0x0400012a, SIOCNT = 0x04000128, RCNT = 0x04000134;
const IF = 0x202;
const SERIAL_IRQ = 0x80;
const NORMAL_8 = 0x0081, NORMAL_32 = 0x1081, NORMAL_8_FAST = 0x0083;
const NORMAL_8_EXTERNAL = 0x0080;
const MULTI_115200 = 0x2083, UART = 0x3000;
const IRQ = 0x4000;
// The serial clock divides the 16.78 MHz system clock: 256 kHz is /64 and 2 MHz is /8.
const CYCLES_8 = 512, CYCLES_8_FAST = 64, CYCLES_32 = 2048, CYCLES_MULTI_115200 = 2330;

const game = () => new GameBoyAdvance(makeGBA());
const busy = g => (g.io16(0x128) & 0x80) !== 0;
const keyOf = rom => crypto.createHash("sha256").update(rom).digest("hex");

test("serial registers keep their written values and SIODATA32 reads back through both halves", () => {
  const g = game();
  g.write16(RCNT, 0x8003);
  assert.equal(g.read16(RCNT), 0x8003);
  g.write32(SIODATA32, 0x12345678);
  assert.equal(g.read32(SIODATA32), 0x12345678);
  assert.equal(g.read16(SIODATA32 + 2), 0x1234);
  g.write16(SIODATA8, 0xab);
  assert.equal(g.read16(SIODATA8), 0xab);
});

test("an 8-bit internal-clock transfer at 256 kHz takes 512 cycles, then clears Start and receives all ones", () => {
  const g = game();
  g.write16(SIODATA8, 0x5a);
  g.write16(SIOCNT, NORMAL_8);
  assert.ok(busy(g));
  g.tick(CYCLES_8 - 1);
  assert.ok(busy(g));
  g.tick(1);
  assert.equal(busy(g), false);
  assert.equal(g.io[0x12a], 0xff);
});

test("a 32-bit transfer takes 2048 cycles and leaves all ones in SIODATA32", () => {
  const g = game();
  g.write16(SIOCNT, NORMAL_32);
  g.tick(CYCLES_32 - 1);
  assert.ok(busy(g));
  g.tick(1);
  assert.equal(busy(g), false);
  assert.equal(g.read32(SIODATA32), 0xffffffff);
});

test("the 2 MHz speed bit shortens an 8-bit transfer to 64 cycles", () => {
  const g = game();
  g.write16(SIOCNT, NORMAL_8_FAST);
  g.tick(CYCLES_8_FAST - 1);
  assert.ok(busy(g));
  g.tick(1);
  assert.equal(busy(g), false);
});

test("serial completion raises IF bit 7 only when the IRQ enable bit of SIOCNT is set", () => {
  const quiet = game();
  quiet.write16(SIOCNT, NORMAL_8);
  quiet.tick(CYCLES_8);
  assert.equal(quiet.io16(IF) & SERIAL_IRQ, 0);

  const loud = game();
  loud.write16(SIOCNT, NORMAL_8 | IRQ);
  loud.tick(CYCLES_8);
  assert.equal(loud.io16(IF) & SERIAL_IRQ, SERIAL_IRQ);
});

test("the external clock waits for a clock that never comes, so the transfer stays busy", () => {
  const g = game();
  g.write16(SIOCNT, NORMAL_8_EXTERNAL | IRQ);
  g.tick(1000000);
  assert.ok(busy(g));
  assert.equal(g.io16(IF) & SERIAL_IRQ, 0);
});

test("the SI input reads high in normal mode because no cable is attached", () => {
  const g = game();
  g.write16(SIOCNT, NORMAL_8);
  assert.equal(g.read16(SIOCNT) & 4, 4);
});

test("multiplayer without a cable sends the local word and reports an error with all other slots empty", () => {
  const g = game();
  g.write16(SIODATA8, 0x1234);
  g.write16(SIOCNT, MULTI_115200 | IRQ);
  assert.ok(busy(g));
  g.tick(CYCLES_MULTI_115200 - 1);
  assert.ok(busy(g));
  g.tick(1);
  assert.equal(busy(g), false);
  assert.equal(g.read16(SIODATA32), 0x1234);
  assert.equal(g.read16(SIODATA32 + 2), 0xffff);
  assert.equal(g.read16(SIODATA32 + 4), 0xffff);
  assert.equal(g.read16(SIODATA32 + 6), 0xffff);
  assert.equal(g.read16(SIOCNT) & 0x40, 0x40);
  assert.equal(g.read16(SIOCNT) >>> 4 & 3, 0);
  assert.equal(g.io16(IF) & SERIAL_IRQ, SERIAL_IRQ);
});

test("UART mode only exposes registers and never starts a transfer", () => {
  const g = game();
  g.write16(SIOCNT, UART | IRQ);
  g.tick(100000);
  assert.equal(g.io16(IF) & SERIAL_IRQ, 0);
  assert.equal(g.read16(SIOCNT) >>> 12 & 3, 3);
});

test("a RAM reset of the serial registers cancels a transfer in progress", () => {
  const g = game();
  g.write16(SIOCNT, NORMAL_8 | IRQ);
  g.tick(100);
  g.registerRamReset(32);
  assert.equal(g.read16(SIOCNT), 0);
  g.tick(CYCLES_8);
  assert.equal(g.io16(IF) & SERIAL_IRQ, 0);
});

test("a transfer in progress survives a save state and completes at the same cycle", async () => {
  const rom = makeGBADemo(), key = keyOf(rom);
  const original = new GameBoyAdvance(rom);
  original.write16(SIOCNT, NORMAL_32 | IRQ);
  original.tick(1000);
  const restored = new GameBoyAdvance(rom);
  States.restore(restored, await States.decode(States.encode(States.capture(original, key))), key);
  assert.ok(busy(restored));
  original.tick(CYCLES_32 - 1000);
  restored.tick(CYCLES_32 - 1000);
  assert.equal(busy(original), false);
  assert.equal(busy(restored), false);
  assert.equal(restored.io16(IF) & SERIAL_IRQ, SERIAL_IRQ);
  assert.deepEqual(restored.io, original.io);
});

test("states without a serial section restore with no transfer in progress", async () => {
  const rom = makeGBADemo(), key = keyOf(rom);
  const original = new GameBoyAdvance(rom);
  original.write16(SIOCNT, NORMAL_8 | IRQ);
  const data = JSON.parse(JSON.stringify(States.capture(original, key)));
  delete data.serial;
  const restored = new GameBoyAdvance(rom);
  States.restore(restored, data, key);
  assert.equal(busy(restored), false);
  restored.tick(CYCLES_8 * 2);
  assert.equal(restored.io16(IF) & SERIAL_IRQ, 0);
});

test("states with an impossible serial transfer are refused without touching the machine", async () => {
  const rom = makeGBADemo(), key = keyOf(rom);
  const source = new GameBoyAdvance(rom);
  source.write16(SIOCNT, NORMAL_8);
  source.tick(10);
  const data = JSON.parse(JSON.stringify(States.capture(source, key)));
  const target = new GameBoyAdvance(rom);
  target.write16(SIOCNT, 0);
  const snapshot = () => {
    const { createdAt, ...rest } = States.capture(target, key);
    return JSON.stringify(rest);
  };
  const before = snapshot();
  for (const remaining of [-1, 1.5, 1 << 25]) {
    data.serial = { remaining };
    assert.throws(() => States.restore(target, data, key));
    assert.equal(snapshot(), before);
  }
});
