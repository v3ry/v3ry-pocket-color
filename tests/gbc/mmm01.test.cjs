"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Cartridge } = require("../../gbc/cartridge.js");
const { makeROM } = require("./helpers.cjs");

function makeMMM01({ type = 0x0b, sizeCode = 7, ramSize = 3 } = {}) {
  const rom = makeROM({ type: 0x01, sizeCode, ramSize: 0 });
  rom.set(Buffer.from("GAME BANK0"), 0x134);
  const menu = makeROM({ type, sizeCode, ramSize });
  rom.set(menu.subarray(0x100, 0x150), rom.length - 0x8000 + 0x100);
  return rom;
}

function mmm01(options) {
  return new Cartridge(makeMMM01(options));
}

function huc1() {
  return new Cartridge(makeROM({ type: 0xff, sizeCode: 7, ramSize: 3 }));
}

function huc3() {
  return new Cartridge(makeROM({ type: 0xfe, sizeCode: 7, ramSize: 3 }));
}

function huc3Command(cart, mailbox) {
  cart.control(0x0000, 0x0b);
  cart.writeRAM(0xa000, mailbox);
  cart.control(0x0000, 0x0d);
  cart.writeRAM(0xa000, 0x00);
}

function huc3Result(cart) {
  cart.control(0x0000, 0x0c);
  return cart.readRAM(0xa000);
}

test("MMM01 reads its header from the menu at the end of the ROM", () => {
  const cart = mmm01({ type: 0x0d, ramSize: 3 });
  assert.equal(cart.mapper, "MMM01");
  assert.equal(cart.type, 0x0d);
  assert.equal(cart.banks, 256);
  assert.equal(cart.title, "POCKET TEST");
  assert.equal(cart.ram.length, 32768);
});

test("MMM01 starts unmapped and shows the menu whatever the registers", () => {
  const cart = mmm01();
  assert.equal(cart.readROM(0x0000), 254);
  assert.equal(cart.readROM(0x4000), 255);
  cart.control(0x2000, 0x05);
  cart.control(0x4000, 0x30);
  cart.control(0x6000, 0x7f);
  assert.equal(cart.readROM(0x0000), 254);
  assert.equal(cart.readROM(0x4000), 255);
});

test("MMM01 mapping enable switches to the selected game banks", () => {
  const cart = mmm01();
  cart.control(0x4000, 0x10);
  cart.control(0x2000, 0x03);
  cart.control(0x0000, 0x40);
  assert.equal(cart.readROM(0x0000), 128);
  assert.equal(cart.readROM(0x4000), 131);
});

test("MMM01 game select bits are locked after mapping", () => {
  const cart = mmm01();
  cart.control(0x4000, 0x10);
  cart.control(0x2000, 0x20);
  cart.control(0x0000, 0x40);
  cart.control(0x4000, 0x00);
  cart.control(0x2000, 0x00);
  assert.equal(cart.readROM(0x0000), 160);
  assert.equal(cart.readROM(0x4000), 161);
  cart.control(0x2000, 0x03);
  assert.equal(cart.readROM(0x4000), 163);
});

test("MMM01 ROM mask locks the low bits used for game selection", () => {
  const cart = mmm01();
  cart.control(0x2000, 0x0c);
  cart.control(0x6000, 0x3e);
  cart.control(0x0000, 0x40);
  cart.control(0x2000, 0x05);
  assert.equal(cart.readROM(0x0000), 12);
  assert.equal(cart.readROM(0x4000), 13);
});

test("MMM01 remaps a zero game bank to bank 1 in the switchable region", () => {
  const cart = mmm01();
  cart.control(0x4000, 0x10);
  cart.control(0x2000, 0x00);
  cart.control(0x0000, 0x40);
  assert.equal(cart.readROM(0x4000), 129);
});

test("MMM01 RAM mask and mode select the RAM bank", () => {
  const cart = mmm01();
  cart.control(0x0000, 0x5a);
  cart.control(0x4000, 0x02);
  cart.writeRAM(0xa000, 0x77);
  cart.control(0x6000, 0x01);
  assert.equal(cart.readRAM(0xa000), 0x00);
  cart.writeRAM(0xa000, 0x55);
  cart.control(0x6000, 0x00);
  assert.equal(cart.readRAM(0xa000), 0x77);
});

test("MMM01 mode lock prevents the mode select from changing", () => {
  const cart = mmm01();
  cart.control(0x0000, 0x0a);
  cart.control(0x4000, 0x42);
  cart.writeRAM(0xa000, 0x77);
  cart.control(0x6000, 0x01);
  assert.equal(cart.readRAM(0xa000), 0x77);
});

test("MMM01 save data round trips RAM", () => {
  const cart = mmm01();
  cart.control(0x0000, 0x0a);
  cart.writeRAM(0xa010, 0x9c);
  const restored = mmm01();
  restored.restoreData(cart.saveData());
  restored.control(0x0000, 0x0a);
  assert.equal(restored.readRAM(0xa010), 0x9c);
});

test("A normal MBC1 ROM is not detected as MMM01", () => {
  const cart = new Cartridge(makeROM({ type: 0x01, sizeCode: 3 }));
  assert.equal(cart.mapper, "MBC1");
});

test("HuC1 is detected and switches ROM and RAM banks", () => {
  const cart = huc1();
  assert.equal(cart.mapper, "HUC1");
  cart.control(0x2000, 0x45);
  assert.equal(cart.readROM(0x4000), 5);
  cart.writeRAM(0xa000, 0x77);
  assert.equal(cart.readRAM(0xa000), 0x77);
  cart.control(0x4000, 0x03);
  assert.equal(cart.readRAM(0xa000), 0x00);
  cart.writeRAM(0xa000, 0x5a);
  cart.control(0x4000, 0x00);
  assert.equal(cart.readRAM(0xa000), 0x77);
  cart.control(0x4000, 0x03);
  assert.equal(cart.readRAM(0xa000), 0x5a);
});

test("HuC1 IR mode reads no light and ignores writes", () => {
  const cart = huc1();
  cart.writeRAM(0xa000, 0x77);
  cart.control(0x0000, 0x0e);
  assert.equal(cart.readRAM(0xa000), 0xc0);
  cart.writeRAM(0xa000, 0x12);
  cart.control(0x0000, 0x0a);
  assert.equal(cart.readRAM(0xa000), 0x77);
});

test("HuC3 is detected and RAM access depends on the mode", () => {
  const cart = huc3();
  assert.equal(cart.mapper, "HUC3");
  cart.control(0x0000, 0x0a);
  cart.writeRAM(0xa000, 0x3c);
  assert.equal(cart.readRAM(0xa000), 0x3c);
  cart.control(0x0000, 0x00);
  cart.writeRAM(0xa000, 0x11);
  assert.equal(cart.readRAM(0xa000), 0x3c);
  cart.control(0x0000, 0x0f);
  assert.equal(cart.readRAM(0xa000), 0xff);
});

test("HuC3 mailbox commands access the nybble memory and address", () => {
  const cart = huc3();
  huc3Command(cart, 0x45);
  huc3Command(cart, 0x37);
  huc3Command(cart, 0x45);
  huc3Command(cart, 0x10);
  assert.equal(huc3Result(cart), 0x17);
});

test("HuC3 semaphore reads ready and status command reports 1", () => {
  const cart = huc3();
  cart.control(0x0000, 0x0d);
  assert.equal(cart.readRAM(0xa000), 0xff);
  huc3Command(cart, 0x62);
  assert.equal(huc3Result(cart), 0x61);
});

test("HuC3 save data round trips the command memory", () => {
  const cart = huc3();
  huc3Command(cart, 0x52);
  huc3Command(cart, 0x40);
  huc3Command(cart, 0x39);
  const restored = huc3();
  restored.restoreData(cart.saveData());
  huc3Command(restored, 0x52);
  huc3Command(restored, 0x40);
  huc3Command(restored, 0x10);
  assert.equal(huc3Result(restored), 0x19);
});
