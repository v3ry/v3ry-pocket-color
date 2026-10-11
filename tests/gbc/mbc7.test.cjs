"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Cartridge } = require("../../gbc/cartridge.js");
const { makeROM } = require("./helpers.cjs");

const CS = 0x80, CLK = 0x40, DI = 0x02;

function mbc7() {
  return new Cartridge(makeROM({ type: 0x22, sizeCode: 2 }));
}

function unlock(cart) {
  cart.control(0x0000, 0x0a);
  cart.control(0x4000, 0x40);
}

function bitsOf(value, count) {
  return Array.from({ length: count }, (_, index) => (value >> (count - 1 - index)) & 1);
}

function commandBits(op, field, data) {
  const bits = [1, ...bitsOf(op, 2), ...bitsOf(field, 8)];
  if (data !== undefined) bits.push(...bitsOf(data, 16));
  return bits;
}

function sendBits(cart, bits) {
  for (const bit of bits) {
    const di = bit ? DI : 0;
    cart.writeRAM(0xa080, CS | di);
    cart.writeRAM(0xa080, CS | CLK | di);
  }
  cart.writeRAM(0xa080, CS);
}

function sendCommand(cart, op, field, data) {
  cart.writeRAM(0xa080, 0);
  sendBits(cart, commandBits(op, field, data));
}

function readWord(cart) {
  let word = 0;
  for (let index = 0; index < 16; index++) {
    if (index) {
      cart.writeRAM(0xa080, CS);
      cart.writeRAM(0xa080, CS | CLK);
    }
    word = (word << 1) | (cart.readRAM(0xa080) & 1);
  }
  cart.writeRAM(0xa080, 0);
  return word;
}

function read(cart, address) {
  sendCommand(cart, 2, address);
  return readWord(cart);
}

test("MBC7 cartridges have a 256-byte EEPROM and a 7-bit ROM bank", () => {
  const cart = mbc7();
  assert.equal(cart.mapper, "MBC7");
  assert.equal(cart.ram.length, 256);
  cart.control(0x2000, 5);
  assert.equal(cart.readROM(0x4000), 5);
  cart.control(0x2000, 0x85);
  assert.equal(cart.readROM(0x4000), 5);
});

test("MBC7 RAM needs both enable gates, with the exact gate values", () => {
  const cart = mbc7();
  cart.control(0x0000, 0x0a);
  assert.equal(cart.readRAM(0xa060), 0xff);
  cart.control(0x4000, 0x40);
  assert.equal(cart.readRAM(0xa060), 0x00);
  cart.control(0x0000, 0x1a);
  assert.equal(cart.readRAM(0xa060), 0xff);
  cart.control(0x0000, 0x0a);
  cart.control(0x4000, 0x00);
  assert.equal(cart.readRAM(0xa060), 0xff);
});

test("MBC7 writes need both enable gates", () => {
  const cart = mbc7();
  cart.control(0x0000, 0x0a);
  cart.writeRAM(0xa010, 0xaa);
  cart.control(0x4000, 0x40);
  assert.equal(cart.readRAM(0xa020), 0x00);
  cart.control(0x0000, 0x00);
  cart.writeRAM(0xa010, 0xaa);
  cart.control(0x0000, 0x0a);
  assert.equal(cart.readRAM(0xa020), 0x00);
});

test("MBC7 accelerometer reads rest after latching and erases on 0x55", () => {
  const cart = mbc7();
  unlock(cart);
  assert.equal(cart.readRAM(0xa020), 0x00);
  assert.equal(cart.readRAM(0xa030), 0x80);
  cart.writeRAM(0xa010, 0xaa);
  assert.equal(cart.readRAM(0xa020), 0xd0);
  assert.equal(cart.readRAM(0xa030), 0x81);
  assert.equal(cart.readRAM(0xa040), 0xd0);
  assert.equal(cart.readRAM(0xa050), 0x81);
  assert.equal(cart.readRAM(0xa320), 0xd0);
  assert.equal(cart.readRAM(0xa060), 0x00);
  assert.equal(cart.readRAM(0xa070), 0xff);
  assert.equal(cart.readRAM(0xa000), 0xff);
  assert.equal(cart.readRAM(0xa010), 0xff);
  assert.equal(cart.readRAM(0xa090), 0xff);
  assert.equal(cart.readRAM(0xb000), 0xff);
  cart.writeRAM(0xa000, 0xaa);
  assert.equal(cart.readRAM(0xa020), 0xd0);
  cart.writeRAM(0xa000, 0x55);
  assert.equal(cart.readRAM(0xa020), 0x00);
  assert.equal(cart.readRAM(0xa030), 0x80);
});

test("MBC7 accelerometer ignores erase writes while the second gate is closed", () => {
  const cart = mbc7();
  unlock(cart);
  cart.writeRAM(0xa010, 0xaa);
  cart.control(0x4000, 0x00);
  cart.writeRAM(0xa000, 0x55);
  cart.control(0x4000, 0x40);
  assert.equal(cart.readRAM(0xa020), 0xd0);
});

test("MBC7 EEPROM ignores writes until EWEN and round-trips 16-bit words", () => {
  const cart = mbc7();
  unlock(cart);
  assert.equal(read(cart, 5), 0);
  sendCommand(cart, 1, 5, 0xbeef);
  assert.equal(read(cart, 5), 0);
  sendCommand(cart, 0, 0xc0);
  sendCommand(cart, 1, 5, 0xbeef);
  assert.equal(read(cart, 5), 0xbeef);
  assert.equal(cart.ram[10], 0xbe);
  assert.equal(cart.ram[11], 0xef);
  sendCommand(cart, 0, 0x00);
  sendCommand(cart, 1, 6, 0x1234);
  assert.equal(read(cart, 6), 0);
});

test("MBC7 EEPROM ERASE, ERAL, WRAL and EWDS honour write enable", () => {
  const cart = mbc7();
  unlock(cart);
  sendCommand(cart, 0, 0xc0);
  sendCommand(cart, 1, 5, 0x1111);
  sendCommand(cart, 1, 7, 0x2222);
  sendCommand(cart, 3, 5);
  assert.equal(read(cart, 5), 0xffff);
  assert.equal(read(cart, 7), 0x2222);
  sendCommand(cart, 0, 0x40, 0x00aa);
  assert.equal(read(cart, 0), 0x00aa);
  assert.equal(read(cart, 127), 0x00aa);
  sendCommand(cart, 0, 0x80);
  assert.equal(read(cart, 0), 0xffff);
  assert.equal(read(cart, 127), 0xffff);
  sendCommand(cart, 0, 0x00);
  sendCommand(cart, 1, 7, 0x3333);
  sendCommand(cart, 3, 7);
  assert.equal(read(cart, 7), 0xffff);
  sendCommand(cart, 0, 0xc0);
  sendCommand(cart, 1, 7, 0x3333);
  assert.equal(read(cart, 7), 0x3333);
});

test("MBC7 EEPROM ignores leading zero bits before the start bit", () => {
  const cart = mbc7();
  unlock(cart);
  cart.writeRAM(0xa080, 0);
  sendBits(cart, [0, 0, 0, ...commandBits(0, 0xc0)]);
  sendCommand(cart, 1, 9, 0xcafe);
  assert.equal(read(cart, 9), 0xcafe);
});

test("MBC7 save data round-trips and rejects a wrong size", () => {
  const cart = mbc7();
  cart.importRAM(new Uint8Array(256).fill(7));
  assert.throws(() => cart.importRAM(new Uint8Array(128)), /Taille/);
  unlock(cart);
  assert.equal(read(cart, 0), 0x0707);
  const other = mbc7();
  other.restoreData(cart.saveData());
  unlock(other);
  assert.equal(read(other, 127), 0x0707);
  assert.throws(() => other.restoreData({ ...cart.saveData(), ram: new Uint8Array(16) }), /invalide/);
});
