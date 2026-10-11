"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { LinkCable } = require("../../gba/link.js");
const States = require("../../gba/states.js");
const { makeGBA, makeGBADemo } = require("./helpers.cjs");

const SIOMULTI0 = 0x04000120, SIODATA8 = 0x0400012a, SIOCNT = 0x04000128;
const IF = 0x202;
const SERIAL_IRQ = 0x80;
const NORMAL_8 = 0x0081;
// Multi-player mode at 115200 bps; MULTI_START also sets the start bit.
const MULTI = 0x2003, MULTI_START = 0x2083;
const IRQ = 0x4000, START = 0x80, ERROR = 0x40, SI = 0x04, SD = 0x08;

const unit = () => new GameBoyAdvance(makeGBA());
const busy = g => (g.io16(0x128) & START) !== 0;
const words = g => [0, 1, 2, 3].map(i => g.read16(SIOMULTI0 + i * 2));
const idOf = g => g.io16(0x128) >>> 4 & 3;

// Runs the parent's transfer until it ends, so the test does not depend on the exact cycle count.
function runTransfer(parent) {
  for (let i = 0; i < 1000 && busy(parent); i++) parent.tick(16);
  assert.equal(busy(parent), false, "the parent transfer must end");
}

// Every unit joins the cable already in multi-player mode, as a game would set it up before a transfer.
function cable(count) {
  const link = new LinkCable();
  const units = Array.from({ length: count }, () => unit());
  for (const g of units) link.connect(g);
  for (const g of units) g.write16(SIOCNT, MULTI);
  return { link, units };
}

test("two linked units exchange their words and every unit reads both", () => {
  const { units: [parent, child] } = cable(2);
  parent.write16(SIODATA8, 0x1111);
  child.write16(SIODATA8, 0x2222);
  parent.write16(SIOCNT, MULTI_START | IRQ);
  assert.ok(busy(parent));
  assert.ok(busy(child));
  runTransfer(parent);
  for (const g of [parent, child]) {
    assert.deepEqual(words(g), [0x1111, 0x2222, 0xffff, 0xffff]);
    assert.equal(g.read16(SIOCNT) & ERROR, 0);
  }
});

test("IDs and SI/SD status bits describe each unit's place on the cable", () => {
  const { units: [parent, child] } = cable(2);
  assert.equal(idOf(parent), 0);
  assert.equal(parent.read16(SIOCNT) & SI, 0);
  assert.equal(idOf(child), 1);
  assert.equal(child.read16(SIOCNT) & SI, SI);
  assert.equal(parent.read16(SIOCNT) & SD, SD);
  assert.equal(child.read16(SIOCNT) & SD, SD);
  parent.write16(SIODATA8, 1);
  child.write16(SIODATA8, 2);
  parent.write16(SIOCNT, MULTI_START);
  runTransfer(parent);
  assert.equal(idOf(parent), 0);
  assert.equal(idOf(child), 1);
  assert.equal(child.read16(SIOCNT) & SI, SI);
});

test("four units fill all four slots and every unit gets IDs 0 to 3", () => {
  const { units } = cable(4);
  units.forEach((g, i) => g.write16(SIODATA8, 0x100 + i));
  units[0].write16(SIOCNT, MULTI_START | IRQ);
  runTransfer(units[0]);
  for (const g of units) {
    assert.deepEqual(words(g), [0x100, 0x101, 0x102, 0x103]);
    assert.equal(g.read16(SIOCNT) & ERROR, 0);
  }
  assert.deepEqual(units.map(idOf), [0, 1, 2, 3]);
});

test("a child cannot start a transfer, and it is busy while the parent transfer runs", () => {
  const { units: [parent, child] } = cable(2);
  child.write16(SIOCNT, MULTI_START | IRQ);
  assert.equal(busy(child), false);
  parent.write16(SIODATA8, 0xaaaa);
  child.write16(SIODATA8, 0xbbbb);
  parent.write16(SIOCNT, MULTI);
  assert.equal(busy(child), false);
  parent.write16(SIOCNT, MULTI_START);
  assert.ok(busy(child));
  child.write16(SIOCNT, MULTI | IRQ);
  assert.ok(busy(child), "a child cannot clear its own busy bit");
  runTransfer(parent);
  assert.equal(busy(child), false);
  assert.deepEqual(words(child), [0xaaaa, 0xbbbb, 0xffff, 0xffff]);
});

test("every unit with the IRQ bit set gets the serial interrupt, others do not", () => {
  const { units: [parent, child] } = cable(2);
  parent.write16(SIOCNT, MULTI_START | IRQ);
  child.write16(SIOCNT, MULTI);
  runTransfer(parent);
  assert.equal(parent.io16(IF) & SERIAL_IRQ, SERIAL_IRQ);
  assert.equal(child.io16(IF) & SERIAL_IRQ, 0);
});

test("a child in another serial mode breaks the chain: error is set and later slots stay empty", () => {
  const { units: [parent, middle, last] } = cable(3);
  parent.write16(SIODATA8, 0x1);
  middle.write16(SIOCNT, 0);
  middle.write16(SIODATA8, 0x2);
  last.write16(SIODATA8, 0x3);
  parent.write16(SIOCNT, MULTI_START);
  runTransfer(parent);
  for (const g of [parent, middle, last]) {
    assert.deepEqual(words(g), [0x1, 0xffff, 0xffff, 0xffff]);
    assert.equal(g.read16(SIOCNT) & ERROR, ERROR);
  }
});

test("a lone unit on a cable reports an error, like an empty serial port", () => {
  const { units: [parent] } = cable(1);
  parent.write16(SIODATA8, 0x1234);
  parent.write16(SIOCNT, MULTI_START | IRQ);
  runTransfer(parent);
  assert.deepEqual(words(parent), [0x1234, 0xffff, 0xffff, 0xffff]);
  assert.equal(parent.read16(SIOCNT) & ERROR, ERROR);
  assert.equal(parent.io16(IF) & SERIAL_IRQ, SERIAL_IRQ);
});

test("a disconnected unit goes back to a standalone serial port", () => {
  const { link, units: [parent, child] } = cable(2);
  link.disconnect(child);
  assert.equal(child.link, null);
  assert.equal(parent.link, link);
  assert.equal(idOf(parent), 0);
  parent.write16(SIODATA8, 0x42);
  parent.write16(SIOCNT, MULTI_START | IRQ);
  runTransfer(parent);
  assert.deepEqual(words(parent), [0x42, 0xffff, 0xffff, 0xffff]);
  assert.equal(parent.read16(SIOCNT) & ERROR, ERROR);
});

test("a cable accepts at most four units and never the same unit twice", () => {
  const { link, units } = cable(4);
  assert.throws(() => link.connect(unit()), /4/);
  assert.throws(() => link.connect(units[0]));
});

test("the cable stays out of save states, so a linked unit saves and restores like a standalone one", () => {
  const rom = makeGBADemo(), key = crypto.createHash("sha256").update(rom).digest("hex");
  const link = new LinkCable();
  const parent = new GameBoyAdvance(rom), child = new GameBoyAdvance(rom);
  link.connect(parent);
  link.connect(child);
  parent.write16(SIOCNT, NORMAL_8);
  const data = JSON.parse(JSON.stringify(States.capture(parent, key)));
  assert.equal(Object.hasOwn(data.machine, "link"), false);
  assert.equal(Object.hasOwn(data.machine, "linkId"), false);
  const restored = new GameBoyAdvance(rom);
  const restoredLink = new LinkCable();
  restoredLink.connect(restored);
  States.restore(restored, data, key);
  assert.equal(restored.link, restoredLink);
  assert.equal(restored.io16(0x128) & START, parent.io16(0x128) & START);
});
