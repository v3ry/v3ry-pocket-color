"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { listROMs, extractROM, crc32, MAX_ARCHIVE } = require("../zip.js");
const { makeROM, makeZIP } = require("./helpers.cjs");

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
