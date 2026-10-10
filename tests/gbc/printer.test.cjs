"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyPrinter, STATUS } = require("../../gbc/printer.js");
const { GameBoy } = require("../../gbc/emulator.js");
const { makeROM } = require("./helpers.cjs");

function sendPacket(printer, command, data = [], compression = 0, corruptChecksum = false) {
  const bytes = [0x88, 0x33, command, compression, data.length & 255, data.length >> 8, ...data];
  const checksum = bytes.slice(2).reduce((sum, value) => (sum + value) & 0xffff, 0);
  bytes.push((checksum & 255) ^ Number(corruptChecksum), checksum >> 8);
  for (const byte of bytes) assert.equal(printer.transfer(byte), 0);
  return { ack: printer.transfer(0), status: printer.transfer(0) };
}

function stripe(color = 1) {
  const data = new Uint8Array(20 * 16);
  for (let tile = 0; tile < 20; tile++) {
    for (let row = 0; row < 8; row++) {
      data[tile * 16 + row * 2] = color & 1 ? 255 : 0;
      data[tile * 16 + row * 2 + 1] = color & 2 ? 255 : 0;
    }
  }
  return data;
}

test("printer parses checksummed packets and replies with ACK and status", () => {
  const printer = new GameBoyPrinter();
  let reply = sendPacket(printer, 0x01);
  assert.deepEqual(reply, { ack: 0x81, status: 0 });
  reply = sendPacket(printer, 0x04, [0x80, 0x42], 1);
  assert.deepEqual(reply, { ack: 0x81, status: 0x08 });
  assert.deepEqual(printer.buffer, [0x42, 0x42]);
  assert.equal(sendPacket(printer, 0x0f).status, 0x08);
  assert.equal(sendPacket(printer, 0x01).status, 0);
  assert.deepEqual(printer.buffer, []);
});

test("printer handshake travels over the Game Boy serial port", () => {
  const printer = new GameBoyPrinter();
  const game = new GameBoy(makeROM({ color: true }));
  game.setSerialDevice(printer);
  const bytes = [0x88, 0x33, 0x01, 0, 0, 0, 1, 0];
  function transfer(value) {
    game.write(0xff01, value);
    game.write(0xff02, 0x83);
    game.tick(128);
    return game.read(0xff01);
  }
  for (const byte of bytes) assert.equal(transfer(byte), 0);
  assert.equal(transfer(0), 0x81);
  assert.equal(transfer(0), 0);
  assert.equal(printer.status, 0);
});

test("printer converts 2bpp tile strips, palette and margins into a print job", () => {
  const jobs = [];
  const printer = new GameBoyPrinter({ onPrint: job => jobs.push(job) });
  sendPacket(printer, 0x04, stripe());
  const reply = sendPacket(printer, 0x02, [1, 0x13, 0xe4, 0x40]);

  assert.deepEqual(reply, { ack: 0x81, status: 0x08 });
  assert.equal(printer.status, STATUS.PRINTING | STATUS.IMAGE_FULL);
  assert.equal(jobs.length, 1);
  assert.deepEqual(
    { width: jobs[0].width, height: jobs[0].height, imageHeight: jobs[0].imageHeight,
      top: jobs[0].top, bottom: jobs[0].bottom, copies: jobs[0].copies },
    { width: 160, height: 40, imageHeight: 8, top: 8, bottom: 24, copies: 1 },
  );
  assert.deepEqual([...jobs[0].pixels.slice(0, 4)], [247, 244, 226, 255]);
  assert.ok(jobs[0].pixels[(8 * 160) * 4] < 247);
  printer.finishPrinting();
  assert.equal(printer.status, STATUS.IMAGE_FULL);
  assert.equal(sendPacket(printer, 0x0f).status, STATUS.IMAGE_FULL);
});

test("printer reports malformed checksums, compressed runs and image-buffer overflow", () => {
  const printer = new GameBoyPrinter();
  assert.equal(sendPacket(printer, 0x01, [], 0, true).status, STATUS.CHECKSUM_ERROR);
  assert.equal(sendPacket(printer, 0x04, [0x00], 1).status & STATUS.PACKET_ERROR, STATUS.PACKET_ERROR);

  const ready = new GameBoyPrinter();
  const chunk = new Uint8Array(0x280);
  for (let index = 0; index < 12; index++) sendPacket(ready, 0x04, chunk);
  sendPacket(ready, 0x04, new Uint8Array(320));
  assert.equal(ready.buffer.length, 8000);
  assert.equal(sendPacket(ready, 0x04, [0xaa]).status & STATUS.IMAGE_FULL, STATUS.IMAGE_FULL);

  const oversized = new GameBoyPrinter();
  assert.equal(sendPacket(oversized, 0x04, new Uint8Array(0x281)).status & STATUS.PACKET_ERROR,
    STATUS.PACKET_ERROR);
  assert.deepEqual(oversized.buffer, []);
});
