"use strict";

const { deflateRawSync } = require("node:zlib");
const { crc32 } = require("../zip.js");
const { SaveStore } = require("../saves.js");
const { webcrypto } = require("node:crypto");

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
  store.writeGame = async (key, data, recovery) => {
    await store.write(key, data);
    if (recovery !== undefined) store.records.set(`backup:${key}`, structuredClone(recovery));
  };
  return store;
}

module.exports = { makeROM, makeDemoROM, makeZIP, memorySaveStore };
