"use strict";

function makeGBA({ program = [0xeafffffe], signature = "", size = 1024, thumb = false } = {}) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xea00002e, true);
  bytes.set(Buffer.from("GBA TEST"), 0xa0); bytes[0xb2] = 0x96;
  let checksum = -0x19;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= bytes[i];
  bytes[0xbd] = checksum & 255;
  program.forEach((op, i) => thumb ? view.setUint16(0xc0 + i * 2, op, true) : view.setUint32(0xc0 + i * 4, op, true));
  if (signature) bytes.set(Buffer.from(signature), size - 32);
  return bytes;
}

function makeGBADemo() {
  const program = [0, 0, 0xe1c010b0, 0, 0, 0, 0xe4801004, 0xe2522001, 0x1afffffc, 0xeafffffe];
  for (const [index, register, value] of [[0, 0, 0x04000000], [1, 1, 0x403],
    [3, 0, 0x06000000], [4, 1, 0x001f001f], [5, 2, 19200]]) {
    const literal = program.length;
    program.push(value);
    program[index] = (0xe59f0000 | register << 12 | (literal - index - 2) * 4) >>> 0;
  }
  return makeGBA({ program, signature: "SRAM_V110" });
}

function eepromCommand(address, bits, data = null) {
  const stream = [1, data ? 0 : 1];
  for (let bit = bits - 1; bit >= 0; bit--) stream.push(address >>> bit & 1);
  if (data) for (const byte of data) for (let bit = 7; bit >= 0; bit--) stream.push(byte >>> bit & 1);
  stream.push(0);
  return stream;
}

function dma3(game, source, destination, count, control = 0x8000) {
  game.write16(0x040000de, 0);
  game.write32(0x040000d4, source); game.write32(0x040000d8, destination);
  game.write16(0x040000dc, count); game.write16(0x040000de, control);
}

module.exports = { makeGBA, makeGBADemo, eepromCommand, dma3 };
