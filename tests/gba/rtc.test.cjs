"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { RTC } = require("../../gba/rtc.js");
const { makeGBA } = require("./helpers.cjs");

const GPIO = 0x080000c4, DIRECTION = 0x080000c6, CONTROL = 0x080000c8;
const READ_STATUS = 0x96, WRITE_STATUS = 0x16, READ_DATE = 0xa6, WRITE_DATE = 0x26, READ_TIME = 0xe6, WRITE_TIME = 0x66;
const fixed = new Date(2026, 4, 17, 13, 5, 9).getTime();
const game = (clock = fixed) => {
  const g = new GameBoyAdvance(makeGBA({ signature: "SIIRTC_V" }));
  g.cartridge.rtc.clock = () => clock;
  return g;
};
const bcd = value => Math.floor(value / 10) << 4 | value % 10;

function sendByte(g, byte) {
  for (let bit = 0; bit < 8; bit++) {
    const sio = byte >>> bit & 1;
    g.write16(GPIO, 4 | sio << 1);
    g.write16(GPIO, 5 | sio << 1);
  }
}
function readByte(g) {
  let byte = 0;
  for (let bit = 0; bit < 8; bit++) {
    g.write16(GPIO, 4);
    byte |= (g.read16(GPIO) >> 1 & 1) << bit;
    g.write16(GPIO, 5);
  }
  return byte;
}
// One chip-select transaction: a command byte, then either bytes sent by the game or bytes read back.
function transaction(g, command, { send = [], read = 0 } = {}) {
  g.write16(CONTROL, 1);
  g.write16(DIRECTION, 7);
  g.write16(GPIO, 0); g.write16(GPIO, 4);
  sendByte(g, command);
  for (const byte of send) sendByte(g, byte);
  g.write16(DIRECTION, 5);
  const out = Array.from({ length: read }, () => readByte(g));
  g.write16(GPIO, 0);
  return out;
}

test("SIIRTC_V in the ROM enables the RTC; other cartridges have none", () => {
  assert.ok(game().cartridge.rtc instanceof RTC);
  assert.equal(game().cartridge.hasRTC, true);
  const plain = new GameBoyAdvance(makeGBA({ signature: "FLASH1M_V103" }));
  assert.equal(plain.cartridge.rtc, null);
  assert.equal(plain.cartridge.hasRTC, false);
  assert.equal(plain.read16(GPIO), plain.cartridge.readROM(GPIO) | plain.cartridge.readROM(GPIO + 1) << 8);
});

test("reads date and time in BCD through the GPIO port", () => {
  const g = game();
  assert.deepEqual(transaction(g, READ_DATE, { read: 7 }), [
    bcd(26), bcd(5), bcd(17), new Date(fixed).getDay(), bcd(13), bcd(5), bcd(9)]);
  assert.deepEqual(transaction(g, READ_TIME, { read: 3 }), [bcd(13), bcd(5), bcd(9)]);
});

test("24-hour mode is the default and 12-hour mode uses bit 7 for PM", () => {
  const g = game();
  assert.equal(transaction(g, READ_TIME, { read: 3 })[0], bcd(13));
  transaction(g, WRITE_STATUS, { send: [0x00] });
  assert.equal(transaction(g, READ_TIME, { read: 3 })[0], bcd(1) | 0x80);
  transaction(g, WRITE_STATUS, { send: [0x40] });
  assert.equal(transaction(g, READ_TIME, { read: 3 })[0], bcd(13));
});

test("writing the date and time moves the clock while host time keeps running", () => {
  let now = fixed;
  const g = game(); g.cartridge.rtc.clock = () => now;
  transaction(g, WRITE_DATE, { send: [bcd(31), bcd(12), bcd(31), 0, bcd(23), bcd(59), bcd(58)] });
  const expected = new Date(2031, 11, 31, 23, 59, 58).getTime();
  assert.equal(g.cartridge.rtc.now().getTime(), expected);
  now += 1000;
  assert.deepEqual(transaction(g, READ_TIME, { read: 3 }), [bcd(23), bcd(59), bcd(59)]);
  transaction(g, WRITE_TIME, { send: [bcd(7), bcd(30), bcd(0)] });
  assert.equal(g.cartridge.rtc.now().getHours(), 7);
  assert.equal(g.cartridge.rtc.now().getMinutes(), 30);
  assert.equal(g.cartridge.rtc.now().getFullYear(), 2031);
});

test("invalid BCD or impossible dates are ignored as a whole", () => {
  const g = game(); const before = g.cartridge.rtc.offset;
  transaction(g, WRITE_DATE, { send: [bcd(26), 0x13, bcd(1), 0, bcd(10), bcd(0), bcd(0)] });
  transaction(g, WRITE_DATE, { send: [bcd(26), bcd(2), bcd(30), 0, bcd(10), bcd(0), bcd(0)] });
  transaction(g, WRITE_TIME, { send: [bcd(24), bcd(0), bcd(0)] });
  assert.equal(g.cartridge.rtc.offset, before);
});

test("the control register reads back and clears the power-off flag when read", () => {
  const g = game();
  g.cartridge.rtc.status = 0x82;
  assert.deepEqual(transaction(g, READ_STATUS, { read: 1 }), [0x82]);
  assert.deepEqual(transaction(g, READ_STATUS, { read: 1 }), [0x02]);
});

test("GPIO writes are only taken with 16-bit accesses and the port needs control enabled", () => {
  const g = game();
  g.write8(GPIO, 4);
  assert.equal(g.cartridge.rtc.latch, 0);
  g.write16(CONTROL, 0);
  g.write16(GPIO, 4);
  assert.equal(g.read16(GPIO), 0);
  g.write16(CONTROL, 1);
  g.write16(DIRECTION, 5);
  assert.equal(g.read16(GPIO) & 4, 4);
});

test("32-bit reads of the GPIO block return the port and direction registers", () => {
  const g = game();
  g.write16(CONTROL, 1);
  g.write16(DIRECTION, 0x5); g.write16(GPIO, 0x6);
  assert.equal(g.read32(GPIO), (0x5 << 16 | 0x6) >>> 0);
});

test("the offset and control register survive a save and restore, and changes raise the save revision", () => {
  const g = game();
  transaction(g, WRITE_DATE, { send: [bcd(30), bcd(6), bcd(1), 0, bcd(8), bcd(0), bcd(0)] });
  const revision = g.cartridge.saveRevision;
  const data = g.cartridge.saveData();
  assert.equal(data.rtc.offset, g.cartridge.rtc.offset);
  transaction(g, READ_DATE, { read: 7 });
  assert.equal(g.cartridge.saveRevision, revision);
  const next = game(fixed + 3600000);
  next.cartridge.restoreData(data);
  assert.equal(next.cartridge.rtc.offset, g.cartridge.rtc.offset);
  assert.equal(next.cartridge.rtc.now().getFullYear(), 2030);
  assert.throws(() => next.cartridge.restoreData({ ...data, rtc: { offset: 1.5, status: 0 } }), /RTC/);
});
