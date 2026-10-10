"use strict";

const { deflateRawSync } = require("node:zlib");
const { crc32 } = require("../../zip.js");
const { SaveStore } = require("../../gbc/saves.js");
const { webcrypto } = require("node:crypto");
const { GameBoy } = require("../../gbc/emulator.js");

function makeROM({ color = false, type = 0, sizeCode = 0, ramSize = 0, program = [] } = {}) {
  const rom = new Uint8Array((2 << sizeCode) * 0x4000);
  for (let bank = 0; bank < rom.length / 0x4000; bank++) rom.fill(bank & 255, bank * 0x4000, (bank + 1) * 0x4000);
  rom.fill(0, 0x100, 0x150);
  rom.set([0xc3, 0x50, 0x01], 0x100);
  rom.set(Buffer.from("POCKET TEST"), 0x134);
  rom[0x143] = color ? 0x80 : 0;
  rom[0x147] = type; rom[0x148] = sizeCode; rom[0x149] = ramSize;
  let checksum = 0;
  for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - rom[i] - 1) & 255;
  rom[0x14d] = checksum;
  rom.set(program, 0x150);
  return rom;
}

function makeDemoROM(color = true) {
  const program = [
    0xf3, 0xaf, 0xe0, 0x40,
    0x21, 0x00, 0x80, 0x06, 8,
    0x3e, 0xff, 0x22, 0xaf, 0x22, 0x05, 0x20, 0xf7,
  ];
  if (color) {
    program.push(0x3e, 0x80, 0xe0, 0x68);
    for (const byte of [0xff, 0x7f, 0x1f, 0, 0xe0, 3, 0, 0x7c]) program.push(0x3e, byte, 0xe0, 0x69);
  } else program.push(0x3e, 0xe4, 0xe0, 0x47);
  program.push(
    0x3e, 0x91, 0xe0, 0x40,
    0x3e, 1, 0xea, 0xff, 0xff,
    0xaf, 0xe0, 0x0f, 0xfb, 0x00,
    0x76, 0x18, 0xfd,
  );
  const rom = makeROM({ color, program });
  rom[0x40] = 0xd9;
  return rom;
}

function makeRedBattle({ type = 2, fullWindow = true, moveInfo = false } = {}) {
  const game = new GameBoy(makeROM({ type: 0x1b, sizeCode: 5, ramSize: 3 }));
  game.cartridge.title = "POKEMON RED";
  game.cartridge.rom[0x14e] = 0x7a; game.cartridge.rom[0x14f] = 0xfc;
  game.wram[0x105c] = type;
  game.io[0x40] = fullWindow ? 0xe3 : 0x83;
  game.io[0x43] = fullWindow ? 2 : 0;
  game.io[0x4a] = 0; game.io[0x4b] = 7; game.io[0x47] = 0xe4;
  game.vram.fill(0x7f, 0x1800, 0x2000);
  const base = fullWindow ? 0x1c00 : 0x1800;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    game.vram[base + y * 32 + 12 + x] = x * 7 + y;
    game.vram[base + (5 + y) * 32 + 1 + x] = 49 + x * 7 + y;
  }
  for (let y = 12; y < 18; y++) for (let x = 0; x < 20; x++) {
    game.vram[base + y * 32 + x] = y === 12 || y === 17 ? 122 : x === 0 || x === 19 ? 124 : 127;
  }
  for (const [x, y, tile] of [[0, 12, 121], [19, 12, 123], [0, 17, 125], [19, 17, 126],
    [1, 3, 116], [10, 3, 120], [9, 11, 111], [18, 11, 119], [1, 0, 128], [10, 7, 129]]) {
    game.vram[base + y * 32 + x] = tile;
  }
  if (moveInfo) {
    for (let y = 8; y <= 12; y++) for (let x = 0; x <= 10; x++) {
      game.vram[base + y * 32 + x] = y === 8 || y === 12 ? 122 : x === 0 || x === 10 ? 124 : 127;
    }
    for (const [x, y, tile] of [[0, 8, 121], [10, 8, 123], [0, 12, 125], [10, 12, 126], [1, 9, 128]]) {
      game.vram[base + y * 32 + x] = tile;
    }
  }
  for (let tile = 0; tile < 98; tile++) for (let y = 1; y < 7; y++) {
    game.vram[0x1000 + tile * 16 + y * 2] = y === 1 || y === 6 ? 0x7e : 0x42;
  }
  for (let tile = 98; tile <= 129; tile++) {
    if (tile !== 127) game.vram.fill(0xaa, 0x1000 + (tile < 128 ? tile : tile - 256) * 16,
      0x1000 + (tile < 128 ? tile : tile - 256) * 16 + 16);
  }
  game.setVideoCapture(true); game.tick(70224);
  return game;
}

function makeZIP(files, { method = 0, descriptor = false, comment = "" } = {}) {
  const parts = [], directory = [];
  let offset = 0;
  for (const { name, data } of files) {
    const filename = Buffer.from(name), source = Buffer.from(data);
    const compressed = method === 8 ? deflateRawSync(source) : source;
    const flags = 0x800 | (descriptor ? 8 : 0), crc = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!descriptor) {
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22);
    }
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    const trailer = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor) {
      trailer.writeUInt32LE(0x08074b50);
      trailer.writeUInt32LE(crc, 4); trailer.writeUInt32LE(compressed.length, 8); trailer.writeUInt32LE(source.length, 12);
    }
    parts.push(local, filename, compressed, trailer);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length + trailer.length;
  }
  const centralBytes = Buffer.concat(directory), commentBytes = Buffer.from(comment), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return new Uint8Array(Buffer.concat([...parts, centralBytes, end, commentBytes]));
}

function memorySaveStore() {
  const store = new SaveStore(undefined, webcrypto);
  store.records = new Map();
  store.read = async key => structuredClone(store.records.get(key));
  store.write = async (key, data) => { store.records.set(key, structuredClone(data)); };
  store.writeGame = async (key, data, recovery, previous) => {
    await store.write(key, data);
    if (recovery !== undefined) store.records.set(`backup:${key}`, structuredClone(recovery));
    if (previous !== undefined) {
      const history = store.records.get(`history:${key}`) || [];
      store.records.set(`history:${key}`, structuredClone([{ savedAt: Date.now(), data: previous }, ...history].slice(0, 3)));
    }
  };
  return store;
}

module.exports = { makeROM, makeDemoROM, makeRedBattle, makeZIP, memorySaveStore };
