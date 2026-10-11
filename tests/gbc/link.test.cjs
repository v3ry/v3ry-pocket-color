"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { LinkCable } = require("../../gbc/link.js");
const { GameBoy } = require("../../gbc/emulator.js");
const { makeROM } = require("./helpers.cjs");

function pair({ color = false } = {}) {
  const a = new GameBoy(makeROM({ color })), b = new GameBoy(makeROM({ color }));
  const cable = new LinkCable();
  cable.connect(a);
  cable.connect(b);
  return { a, b, cable };
}

test("a link cable exchanges bytes between a master and an armed slave", () => {
  const { a, b, cable } = pair();
  a.write(0xff01, 0x35); b.write(0xff01, 0x9a);
  b.write(0xff02, 0x80); a.write(0xff02, 0x81);
  cable.run(4200);
  assert.equal(a.read(0xff01), 0x9a);
  assert.equal(b.read(0xff01), 0x35);
  assert.equal(a.read(0xff02) & 0x80, 0);
  assert.equal(b.read(0xff02) & 0x80, 0);
  assert.equal(a.io[0x0f] & 8, 8);
  assert.equal(b.io[0x0f] & 8, 8);
  assert.equal(a.serialOutput, "");
  assert.equal(b.serialOutput, "");
});

test("a master gets 0xFF when the other console is not waiting for a clock", () => {
  const { a, b, cable } = pair();
  a.write(0xff01, 0x35); b.write(0xff01, 0x9a);
  a.write(0xff02, 0x81);
  cable.run(4200);
  assert.equal(a.read(0xff01), 0xff);
  assert.equal(b.read(0xff01), 0x9a);
  assert.equal(b.io[0x0f] & 8, 0);
});

test("an armed slave keeps waiting while no master clocks it", () => {
  const { b, cable } = pair();
  b.write(0xff01, 0x9a); b.write(0xff02, 0x80);
  cable.run(10000);
  assert.equal(b.read(0xff02) & 0x80, 0x80);
  assert.equal(b.read(0xff01), 0x9a);
  assert.equal(b.io[0x0f] & 8, 0);
});

test("consecutive exchanges each need the slave to be armed again", () => {
  const { a, b, cable } = pair();
  const received = [];
  for (const value of [0x01, 0x02, 0x03]) {
    a.write(0xff01, value);
    b.write(0xff02, 0x80);
    a.write(0xff02, 0x81);
    cable.run(4200);
    received.push(b.read(0xff01));
  }
  assert.deepEqual(received, [0x01, 0x02, 0x03]);
});

test("a fast CGB clock exchanges bytes with the shorter period", () => {
  const { a, b, cable } = pair({ color: true });
  a.write(0xff01, 0x5c); b.write(0xff01, 0xa3);
  b.write(0xff02, 0x80); a.write(0xff02, 0x83);
  cable.run(300);
  assert.equal(a.read(0xff01), 0xa3);
  assert.equal(b.read(0xff01), 0x5c);
});

test("disconnecting a console stops the exchange and restores its previous device", () => {
  const { a, b, cable } = pair();
  cable.disconnect(b);
  assert.equal(b.serialDevice, null);
  b.write(0xff01, 0x9a); b.write(0xff02, 0x80);
  a.write(0xff01, 0x35); a.write(0xff02, 0x81);
  cable.run(4200);
  assert.equal(a.read(0xff01), 0xff);
  assert.equal(b.read(0xff01), 0x9a);
});

test("disconnecting restores a device that was attached before the cable", () => {
  const cable = new LinkCable();
  const gb = new GameBoy(makeROM());
  const printer = { transfer: () => 0 };
  gb.setSerialDevice(printer);
  cable.connect(gb);
  assert.notEqual(gb.serialDevice, printer);
  cable.disconnect(gb);
  assert.equal(gb.serialDevice, printer);
});

test("a cable links exactly two consoles", () => {
  const { cable } = pair();
  assert.throws(() => cable.connect(new GameBoy(makeROM())), /deux consoles/);
  assert.throws(() => new LinkCable().connect({}), /GameBoy/);
});
