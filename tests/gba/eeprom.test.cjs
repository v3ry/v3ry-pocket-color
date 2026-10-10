"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { SaveSession } = require("../../gbc/saves.js");
const { memorySaveStore } = require("../gbc/helpers.cjs");
const { makeGBA, eepromCommand, dma3 } = require("./helpers.cjs");
const game = () => new GameBoyAdvance(makeGBA({ signature: "EEPROM_V124" }));
const port = 0x0d000000;

function command(g, stream, destination = port) {
  stream.forEach((bit, index) => g.write16(0x02000000 + index * 2, 0xfffe | bit));
  dma3(g, 0x02000000, destination, stream.length);
}
function readBlock(g, address, bits, source = port) {
  command(g, eepromCommand(address, bits), source);
  dma3(g, source, 0x03000000, 68);
  for (let bit = 0; bit < 4; bit++) assert.equal(g.read16(0x03000000 + bit * 2), 0);
  return Uint8Array.from({ length: 8 }, (_, byte) => {
    let value = 0;
    for (let bit = 0; bit < 8; bit++) value = value << 1 | g.read16(0x03000008 + byte * 16 + bit * 2);
    return value;
  });
}

test("512-byte EEPROM writes and reads complete 64-bit blocks through halfword DMA3", () => {
  const g = game(), data = Uint8Array.of(0x80, 1, 2, 0x55, 0xaa, 0xff, 0, 0x42);
  assert.equal(g.read16(port), 1);
  assert.deepEqual(readBlock(g, 0, 6), new Uint8Array(8).fill(255));
  command(g, eepromCommand(63, 6, data));
  assert.equal(g.cartridge.ram.length, 512);
  assert.equal(g.read16(port), 0);
  g.tick(108367); assert.equal(g.read16(port), 0);
  g.tick(1); assert.equal(g.read16(port), 1);
  assert.deepEqual(readBlock(g, 63, 6), data);
  assert.deepEqual(g.cartridge.exportRAM().slice(504), data);
  assert.deepEqual(readBlock(g, 62, 6), new Uint8Array(8).fill(255));
  const revision = g.cartridge.saveRevision;
  command(g, eepromCommand(63, 6, data));
  assert.equal(g.cartridge.saveRevision, revision);
  assert.throws(() => command(g, eepromCommand(63, 6)), /occupee/);
});

test("8-KiB EEPROM autodetects 17/81-bit packets and uses only the lower ten address bits", () => {
  for (const readFirst of [false, true]) {
    const g = game(), data = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
    if (readFirst) assert.deepEqual(readBlock(g, 1023, 14), new Uint8Array(8).fill(255));
    command(g, eepromCommand(0x3fff, 14, data));
    assert.equal(g.cartridge.ram.length, 8192); g.tick(108368);
    assert.deepEqual(readBlock(g, 1023, 14), data);
    assert.deepEqual(readBlock(g, 0, 14), new Uint8Array(8).fill(255));
    assert.deepEqual(g.cartridge.exportRAM().slice(8184), data);
    assert.throws(() => command(g, eepromCommand(0, 6)), /Taille EEPROM/);
  }
});

test("EEPROM mapping preserves ROM data for large cartridges and SRAM is not aliased", () => {
  for (const size of [0x1000000, 0x1000004, 0x2000000]) {
    const g = new GameBoyAdvance(makeGBA({ signature: "EEPROM_V124", size }));
    assert.equal(g.cartridge.isEEPROM(0x0d000000), size <= 0x1000000);
    assert.equal(g.cartridge.isEEPROM(0x0dffff00), true);
    assert.equal(g.cartridge.isEEPROM(0x0cffff00), false);
    if (size > 0x1000000) {
      g.cartridge.rom.set([0x34, 0x12], 0x1000000);
      assert.equal(g.read16(port), 0x1234);
    }
    const data = Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2);
    command(g, eepromCommand(0, 6, data), 0x0dffff00); g.tick(108368);
    assert.deepEqual(readBlock(g, 0, 6, 0x0dffff00), data);
    g.write8(0x0e000000, 0x11);
    assert.equal(g.read8(0x0e000000), 255); assert.equal(g.cartridge.ram[0], 9);
  }
  const g = new GameBoyAdvance(makeGBA({ signature: "SRAM_V110" }));
  assert.equal(g.cartridge.isEEPROM(port), false);
  assert.equal(g.read16(port), g.cartridge.readROM(port) | g.cartridge.readROM(port + 1) << 8);
});

test("EEPROM malformed packets and unsupported DMA modes fail without committing partial saves", () => {
  const g = game(), original = g.cartridge.exportRAM(), data = new Uint8Array(8).fill(0x55);
  assert.throws(() => dma3(g, port, 0x03000000, 68), /Lecture EEPROM/);
  assert.throws(() => command(g, [1, 1, 0]), /Commande EEPROM/);
  for (const index of [0, 1]) {
    const packet = eepromCommand(0, 6, data); packet[index] ^= 1;
    assert.throws(() => command(g, packet), /Trame EEPROM/);
    assert.equal(g.dmaBusy, false); assert.equal(g.cartridge.eepromInput, null);
  }
  assert.throws(() => dma3(g, 0x02000000, port, 73, 0x8400), /DMA3 16 bits/);
  assert.throws(() => dma3(g, port, port, 68), /DMA3 16 bits/);
  g.write32(0x040000bc, port); g.write32(0x040000c0, 0x03000000);
  g.write16(0x040000c4, 68);
  assert.throws(() => g.write16(0x040000c6, 0x8000), /DMA3 16 bits/);
  g.write16(port, 1); g.write16(port, 0);
  assert.equal(g.read16(port), 1);
  assert.deepEqual(g.cartridge.exportRAM(), original); assert.equal(g.cartridge.saveRevision, 0);
});

test("EEPROM ignores the final serial stop bit in real cartridge command frames", () => {
  const g = game(), data = Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0);
  const read = eepromCommand(1, 6); read[read.length - 1] = 1;
  assert.deepEqual(read, [1, 1, 0, 0, 0, 0, 0, 1, 1]);
  command(g, read);
  assert.deepEqual(g.cartridge.eepromOutput, new Uint8Array(8).fill(255));
  const write = eepromCommand(1, 6, data); write[write.length - 1] = 1;
  command(g, write);
  assert.deepEqual(g.cartridge.ram.slice(8, 16), data);
  g.tick(108368);
  const reread = eepromCommand(1, 6); reread[reread.length - 1] = 1;
  command(g, reread);
  dma3(g, port, 0x03000000, 68);
  for (let bit = 0; bit < 4; bit++) assert.equal(g.read16(0x03000000 + bit * 2), 0);
  const result = Uint8Array.from({ length: 8 }, (_, byte) => {
    let value = 0;
    for (let bit = 0; bit < 8; bit++) value = value << 1 | g.read16(0x03000008 + byte * 16 + bit * 2);
    return value;
  });
  assert.deepEqual(result, data);
});

test("EEPROM imports accept only 512 or 8192 bytes and reset protocol state without aliasing input", () => {
  const g = game(), c = g.cartridge;
  for (const length of [512, 8192]) {
    const bytes = new Uint8Array(length).fill(0x42);
    c.importRAM(bytes); bytes[0] = 0;
    assert.equal(c.ram[0], 0x42); assert.equal(c.ram.length, length);
    assert.deepEqual(readBlock(g, 0, length === 512 ? 6 : 14), new Uint8Array(8).fill(0x42));
    c.restoreData(c.saveData()); assert.equal(c.eepromBusy, 0);
  }
  assert.throws(() => c.importRAM(new Uint8Array(513)), /512 ou 8192/);
  assert.throws(() => c.restoreData({ version: 1, type: c.type, ram: new Uint8Array(1) }), /incompatible/);
  assert.throws(() => c.restoreData({ version: 1, type: "GBA:SRAM_V", ram: new Uint8Array(512) }), /incompatible/);
  assert.equal(c.ram.length, 8192);
});

test("EEPROM saves persist across fresh boots and size changes keep transactional history", async () => {
  const g = game(), store = memorySaveStore(), key = `gba:${await store.keyFor(g.cartridge.rom)}`;
  const session = new SaveSession(store, key, g.cartridge);
  await session.restore();
  const data = Uint8Array.of(8, 7, 6, 5, 4, 3, 2, 1);
  command(g, eepromCommand(1023, 14, data)); await session.flush();
  assert.equal(store.records.get(key).ram.length, 8192);
  assert.equal(store.records.get(`history:${key}`)[0].data.ram.length, 512);
  const next = game(), restored = new SaveSession(store, key, next.cartridge);
  assert.equal(await restored.restore(), true);
  assert.deepEqual(readBlock(next, 1023, 14), data);
  next.cartridge.importRAM(new Uint8Array(512).fill(255));
  await restored.flush();
  assert.equal(restored.lastWriteKind, "ram");
  assert.equal(store.records.get(key).ram.length, 512);
  assert.equal(store.records.get(`history:${key}`)[0].data.ram.length, 8192);
  assert.equal(store.records.get(`backup:${key}`).ram.length, 8192);
});
