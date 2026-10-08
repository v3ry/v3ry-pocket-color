"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Cartridge } = require("../cartridge.js");
const { SaveStore, SaveSession } = require("../saves.js");
const { makeROM, memorySaveStore } = require("./helpers.cjs");

test("ROM content keys are stable and distinct even with equal titles", async () => {
  const store = memorySaveStore(), rom = makeROM();
  const key = await store.keyFor(rom);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(await store.keyFor(rom.slice()), key);
  rom[0x200] ^= 1;
  assert.notEqual(await store.keyFor(rom), key);
});

test("missing storage and crypto fail explicitly", async () => {
  await assert.rejects(new SaveStore(null, null).open(), /IndexedDB/);
  await assert.rejects(new SaveStore(null, null).keyFor(new Uint8Array()), /Identification/);
});

test("main RAM and recovery share one transaction and resolve only after commit", async () => {
  const store = new SaveStore(null, null), writes = [];
  let transaction, count = 0;
  store.database = {
    transaction(name, mode) {
      count++;
      assert.equal(name, "games");
      assert.equal(mode, "readwrite");
      transaction = { objectStore: () => ({ put: (data, key) => writes.push({ data, key }) }) };
      return transaction;
    },
  };
  const main = { ram: new Uint8Array([2]) }, backup = { ram: new Uint8Array([1]) };
  let resolved = false;
  const commit = store.writeGame("key", main, backup).then(() => { resolved = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 1);
  assert.deepEqual(writes, [{ data: main, key: "key" }, { data: backup, key: "backup:key" }]);
  assert.equal(resolved, false);
  transaction.oncomplete();
  await commit;
  assert.equal(resolved, true);
  const failed = store.writeGame("key", main, backup);
  await new Promise(resolve => setImmediate(resolve));
  transaction.error = new Error("Quota exceeded");
  transaction.onabort();
  await assert.rejects(failed, /Quota exceeded/);
});

test("SAV import/export copies RAM, validates before mutation and masks MBC2 nibbles", () => {
  for (const type of [3, 6, 0x10, 0x1b]) {
    const cart = new Cartridge(makeROM({ type, ramSize: 3 }));
    const bytes = new Uint8Array(cart.ram.length).fill(0xab);
    cart.importRAM(bytes);
    assert.equal(cart.ram[0], type === 6 ? 11 : 0xab);
    bytes.fill(0);
    const output = cart.exportRAM(); output.fill(0);
    assert.notEqual(cart.ram[0], 0);
    const before = cart.exportRAM();
    assert.throws(() => cart.importRAM(new Uint8Array(cart.ram.length + 1)), /Taille/);
    assert.deepEqual(cart.ram, before);
  }
});

test("RTC restores elapsed real time, halt and day overflow", () => {
  const cart = new Cartridge(makeROM({ type: 0x10, ramSize: 3 }));
  const data = cart.saveData();
  data.rtc.set([59, 59, 23, 255, 1]);
  data.lastRTC = Date.now() - 2100;
  cart.restoreData(data);
  assert.equal(cart.rtc[0], 1); assert.equal(cart.rtc[3], 0); assert.equal(cart.rtc[4], 0x80);
  data.rtc.set([12, 34, 5, 6, 0x40]); data.lastRTC = Date.now() - 100000;
  cart.restoreData(data);
  assert.deepEqual([...cart.rtc], [12, 34, 5, 6, 0x40]);
});

test("corrupt save schema, RAM or RTC cannot partially overwrite a cartridge", () => {
  const cart = new Cartridge(makeROM({ type: 0x10, ramSize: 3 }));
  cart.ram.fill(7);
  for (const patch of [
    { version: 2 }, { type: 3 }, { ram: new Uint8Array(10) }, { ram: [1, 2] },
    { rtc: new Uint8Array(4) }, { rtc: new Uint8Array([0, 0, 0, 0, 2]) },
    { lastRTC: NaN }, { lastRTC: -1 }, { lastRTC: "now" },
  ]) {
    const data = { ...cart.saveData(), ...patch };
    assert.throws(() => cart.restoreData(data), /invalide/);
    assert.equal(cart.ram[0], 7);
  }
});

test("only changed RAM marks a cartridge dirty", () => {
  const cart = new Cartridge(makeROM({ type: 3, ramSize: 2 }));
  cart.writeRAM(0xa000, 8); assert.equal(cart.saveRevision, 0);
  cart.control(0, 10); cart.writeRAM(0xa000, 8); assert.equal(cart.saveRevision, 1);
  cart.writeRAM(0xa000, 8); assert.equal(cart.saveRevision, 1);
});

test("snapshots are detached, commits are serialized and writes during a commit remain dirty", async () => {
  const store = memorySaveStore(), cart = new Cartridge(makeROM({ type: 3, ramSize: 2 }));
  const session = new SaveSession(store, "key", cart);
  await session.restore();
  cart.importRAM(new Uint8Array(8192).fill(1));
  let release, captured, count = 0;
  store.write = async (_, data) => {
    count++; captured = data;
    await new Promise(resolve => { release = resolve; });
  };
  const first = session.flush();
  await new Promise(resolve => setImmediate(resolve));
  cart.importRAM(new Uint8Array(8192).fill(2));
  assert.equal(captured.ram[0], 1);
  const second = session.flush();
  assert.equal(count, 1);
  release(); await first;
  assert.equal(session.dirty, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 2); assert.equal(captured.ram[0], 2);
  release(); await second;
  assert.equal(session.dirty, false);
});

test("failed commits stay dirty and retry; unchanged RAM does not rewrite", async () => {
  const store = memorySaveStore(), cart = new Cartridge(makeROM({ type: 3, ramSize: 2 }));
  const session = new SaveSession(store, "key", cart);
  assert.equal(await session.restore(), false);
  assert.equal(await session.flush(), false);
  cart.importRAM(new Uint8Array(8192).fill(8));
  const write = store.write;
  store.write = async () => { throw new Error("Quota"); };
  await assert.rejects(session.flush(), /Quota/); assert.equal(session.dirty, true);
  store.write = write;
  assert.equal(await session.flush(), true); assert.equal(session.dirty, false);
  assert.equal(await session.flush(), false);
  const fresh = new Cartridge(makeROM({ type: 3, ramSize: 2 }));
  const restored = new SaveSession(store, "key", fresh);
  assert.equal(await restored.restore(), true);
  assert.equal(fresh.ram[0], 8);
});

test("IndexedDB put resolves on transaction completion, not request success; abort rejects", async () => {
  const store = new SaveStore();
  let transaction, request;
  store.database = { transaction() {
    request = { result: undefined };
    transaction = { objectStore: () => ({ put: () => request, get: () => request }) };
    return transaction;
  } };
  let committed = false;
  const writing = store.write("key", { value: 42 }).then(() => { committed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(committed, false);
  transaction.oncomplete(); await writing;
  assert.equal(committed, true);
  const failed = store.write("key", {});
  await new Promise(resolve => setImmediate(resolve));
  transaction.error = new Error("Quota"); transaction.onabort();
  await assert.rejects(failed, /Quota/);
});

test("RTC-only flushes are classified separately and preserve the RAM snapshot", async () => {
  const store = memorySaveStore(), cart = new Cartridge(makeROM({ type: 0x10, ramSize: 3 }));
  const session = new SaveSession(store, "rtc", cart);
  await session.restore();
  cart.lastRTC -= 2100;
  assert.equal(await session.flush(), true);
  assert.equal(session.lastWriteKind, "rtc");
  assert.ok(store.records.get("rtc").ram.every(byte => byte === 0));
  cart.importRAM(new Uint8Array(32768).fill(7));
  await session.flush();
  assert.equal(session.lastWriteKind, "ram");
});

test("the restored RAM is retained once per session before writes, not rotated by RTC or repeated RAM writes", async () => {
  const store = memorySaveStore(), rom = makeROM({ type: 0x10, ramSize: 3 });
  const cart = new Cartridge(rom);
  cart.importRAM(new Uint8Array(32768).fill(0x55));
  await store.write("game", cart.saveData());
  const session = new SaveSession(store, "game", new Cartridge(rom));
  await session.restore();
  session.cartridge.lastRTC -= 2100; await session.flush();
  assert.equal(store.records.has("backup:game"), false);
  session.cartridge.importRAM(new Uint8Array(32768).fill(0));
  await session.flush();
  assert.equal(store.records.get("backup:game").ram[0], 0x55);
  session.cartridge.importRAM(new Uint8Array(32768).fill(0x33));
  await session.flush();
  assert.equal(store.records.get("backup:game").ram[0], 0x55);
  assert.equal(store.records.get("game").ram[0], 0x33);
});
