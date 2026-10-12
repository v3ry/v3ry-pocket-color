"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { listROMs, extractROM, crc32, MAX_ARCHIVE } = require("../zip.js");
const { makeROM, makeZIP } = require("./gbc/helpers.cjs");
const { makeGBADemo } = require("./gba/helpers.cjs");

test("CRC32 reference vector", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

for (const method of [0, 8]) for (const descriptor of [false, true]) {
  test(`ZIP extraction method ${method}, data descriptor ${descriptor}`, async () => {
    const rom = makeROM({ color: true });
    const bytes = makeZIP([{ name: "games/démo.GBC", data: rom }], { method, descriptor, comment: "test ZIP" });
    const archive = listROMs(bytes);
    assert.equal(archive.entries[0].name, "games/démo.GBC");
    assert.deepEqual(await extractROM(archive, archive.entries[0]), rom);
  });
}

test("multiple ROMs, nested paths, non-ROM files and resource forks", () => {
  const archive = listROMs(makeZIP([
    { name: "README.txt", data: [1] }, { name: "__MACOSX/._game.gbc", data: [1] },
    { name: "first.gb", data: makeROM() }, { name: "dir/second.gbc", data: makeROM({ color: true }) },
  ]));
  assert.deepEqual(archive.entries.map((entry) => entry.name), ["first.gb", "dir/second.gbc"]);
});

test("empty, truncated, malformed and oversized archives fail", () => {
  assert.throws(() => listROMs(new Uint8Array()), /invalide/);
  assert.throws(() => listROMs(makeZIP([{ name: "notes.txt", data: [1] }])), /aucun fichier/);
  assert.throws(() => listROMs(makeZIP([{ name: "a.gb", data: [1] }]).slice(0, -1)), /invalide/);
  assert.throws(() => listROMs(new Uint8Array(MAX_ARCHIVE + 1)), /volumineux/);
  const bytes = makeZIP([{ name: "a.gb", data: [1] }]);
  const view = new DataView(bytes.buffer); view.setUint32(bytes.length - 6, 0xffffff00, true);
  assert.throws(() => listROMs(bytes), /Repertoire ZIP/);
});

test("bytes after the end record are ignored, but a comment longer than the file is rejected", async () => {
  const rom = makeROM();
  const archiveBytes = makeZIP([{ name: "a.gb", data: rom }], { method: 8 });
  const withMarker = Buffer.concat([archiveBytes, Buffer.from("TORRENTZIPPED-EDFE10B7")]);
  const archive = listROMs(withMarker);
  assert.deepEqual(await extractROM(archive, archive.entries[0]), rom);
  const badComment = new Uint8Array(archiveBytes);
  new DataView(badComment.buffer).setUint16(badComment.length - 2, 5, true);
  assert.throws(() => listROMs(badComment), /invalide/);
});

test("CRC, metadata, encryption and compression errors are explicit", async () => {
  const bytes = makeZIP([{ name: "a.gb", data: makeROM() }]);
  bytes[34] ^= 1;
  const corrupt = listROMs(bytes);
  await assert.rejects(extractROM(corrupt, corrupt.entries[0]), /CRC/);
  const valid = listROMs(makeZIP([{ name: "a.gb", data: [1] }]));
  valid.entries[0].flags |= 1;
  await assert.rejects(extractROM(valid, valid.entries[0]), /chiffres/);
  valid.entries[0].flags &= ~1; valid.entries[0].method = 12;
  await assert.rejects(extractROM(valid, valid.entries[0]), /Compression/);
  valid.entries[0].method = 0; valid.entries[0].compressedSize++;
  await assert.rejects(extractROM(valid, valid.entries[0]), /incoherentes/);
});

test("inflated data cannot exceed the announced output size", async () => {
  const bytes = makeZIP([{ name: "bomb.gb", data: new Uint8Array(100000) }], { method: 8, descriptor: true });
  const archive = listROMs(bytes);
  archive.entries[0].uncompressedSize = 10;
  await assert.rejects(extractROM(archive, archive.entries[0]), /depasse/);
});

for (const method of [0, 8]) test(`GBA ZIPs extract with method ${method}, CRC and mixed-console selection`, async () => {
  const rom = makeGBADemo();
  const archive = listROMs(makeZIP([{ name: "nested/DEMO.GBA", data: rom }, { name: "old.gb", data: makeROM() },
    { name: "__MACOSX/._DEMO.GBA", data: [1] }], { method, descriptor: true }));
  assert.deepEqual(archive.entries.map(entry => entry.name), ["nested/DEMO.GBA", "old.gb"]);
  assert.deepEqual(await extractROM(archive, archive.entries[0]), rom);
});

test("ZIP ROM limits retain 8 MiB for GB and accept exactly 32 MiB for GBA", async () => {
  const rom = new Uint8Array(32 * 1024 * 1024);
  const archive = listROMs(makeZIP([{ name: "large.gba", data: rom }], { method: 8 }));
  assert.equal((await extractROM(archive, archive.entries[0])).length, rom.length);
  const bytes = makeZIP([{ name: "large.gba", data: [1] }]);
  const archive2 = listROMs(bytes);
  const entry = archive2.entries[0], directory = archive2.directoryOffset;
  new DataView(bytes.buffer).setUint32(directory + 24, rom.length + 1, true);
  assert.throws(() => listROMs(bytes), /volumineuse/);
  const gb = makeZIP([{ name: "large.gb", data: [1] }]);
  const gbArchive = listROMs(gb);
  new DataView(gb.buffer).setUint32(gbArchive.directoryOffset + 24, 8 * 1024 * 1024 + 1, true);
  assert.throws(() => listROMs(gb), /volumineuse/);
  bytes[30 + entry.nameBytes.length] ^= 1;
  await assert.rejects(extractROM(archive2, entry), /CRC/);
});
