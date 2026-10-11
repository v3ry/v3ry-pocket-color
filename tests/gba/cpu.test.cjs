"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GameBoyAdvance } = require("../../gba/emulator.js");
const { makeGBA } = require("./helpers.cjs");

function cpu(program, thumb = false) {
  const game = new GameBoyAdvance(makeGBA({ program, thumb }));
  game.cpu.r[15] = 0x080000c0;
  if (thumb) game.cpu.cpsr |= 32;
  return game.cpu;
}

test("ARM condition evaluation matches all NZCV combinations", () => {
  const c = cpu([]);
  for (let flags = 0; flags < 16; flags++) {
    c.cpsr = 0x1f | flags << 28;
    const [n, z, carry, v] = [!!(flags & 8), !!(flags & 4), !!(flags & 2), !!(flags & 1)];
    const expected = [z, !z, carry, !carry, n, !n, v, !v, carry && !z, !carry || z,
      n === v, n !== v, !z && n === v, z || n !== v, true, false];
    for (let code = 0; code < 16; code++) assert.equal(c.condition(code), expected[code]);
  }
  assert.equal(c.condition(16), undefined);
});

test("ARM arithmetic, logical instructions, conditions and NZCV flags", () => {
  const c = cpu([0xe3a00001, 0xe2901001, 0xe2512003, 0x03a0300a, 0x13a0300b, 0xe3e04000]);
  for (let i = 0; i < 6; i++) c.step();
  assert.equal(c.r[0], 1); assert.equal(c.r[1], 2);
  assert.equal(c.r[2], 0xffffffff); assert.equal(c.r[3], 11); assert.equal(c.r[4], 0xffffffff);
  assert.equal(c.cpsr >>> 28, 8);
  assert.equal(c.add(0x7fffffff, 1), 0x80000000);
  assert.equal(c.cpsr >>> 28, 9);
  assert.equal(c.add(0xffffffff, 0, 1), 0);
  assert.equal(c.cpsr >>> 28, 6);
});

test("ARM barrel shifter boundaries and RRX preserve documented carry", () => {
  const c = cpu([]);
  c.cpsr |= 0x20000000;
  for (const [value, type, amount, register, expected, carry] of [
    [0x80000001, 0, 32, true, 0, 1],
    [0x80000001, 0, 33, true, 0, 0],
    [0x80000001, 1, 0, false, 0, 1],
    [0x80000001, 2, 40, true, 0xffffffff, 1],
    [3, 3, 0, false, 0x80000001, 1],
    [0x80000001, 3, 32, true, 0x80000001, 1],
    [1, 0, 0, true, 1, 1],
  ]) {
    assert.equal(c.shift(value, type, amount, register), expected);
    assert.equal(c.shiftCarry, carry);
  }
});

test("ARM branches, link and BX use ARM/Thumb pipeline PC offsets", () => {
  const c = cpu([0xeb000000, 0xe1a00000, 0xe12fff11]);
  c.step(); assert.equal(c.r[14], 0x080000c4); assert.equal(c.r[15], 0x080000c8);
  c.r[1] = 0x03000001; c.step();
  assert.equal(c.thumb, true); assert.equal(c.r[15], 0x03000000);
});

test("Thumb fetch decodes the upper half of one aligned word and updates open bus", () => {
  const g = new GameBoyAdvance(makeGBA({ program: [0x2001, 0x2102], thumb: true }));
  const c = g.cpu;
  c.r[15] = 0x080000c2; c.cpsr |= 32;
  c.step();
  assert.equal(c.r[1], 2); assert.equal(c.r[15], 0x080000c4);
  assert.equal(g.openBus, 0x21022001);
});

test("ARM load/store, post-index, halfwords, signed bytes and unaligned word rotation", () => {
  const c = cpu([0xe4801004, 0xe5902000, 0xe1d030b0, 0xe1d040d0]);
  c.r[0] = 0x02000000; c.r[1] = 0x44332211;
  c.bus.write32(0x02000004, 0x88776680);
  for (let i = 0; i < 4; i++) c.step();
  assert.equal(c.bus.read32(0x02000000), 0x44332211); assert.equal(c.r[0], 0x02000004);
  assert.equal(c.r[2], 0x88776680); assert.equal(c.r[3], 0x6680); assert.equal(c.r[4], 0xffffff80);
  const rotate = cpu([0xe5901000]); rotate.r[0] = 0x02000001;
  rotate.bus.write32(0x02000000, 0x44332211); rotate.step(); assert.equal(rotate.r[1], 0x11443322);
});

test("ARM multiply and signed/unsigned long multiply retain 64-bit precision", () => {
  const c = cpu([0xe0000291, 0xe0834291, 0xe0c34291]);
  c.r[1] = 0xffffffff; c.r[2] = 0xffffffff;
  c.step(); assert.equal(c.r[0], 1);
  c.step(); assert.equal(c.r[4], 1); assert.equal(c.r[3], 0xfffffffe);
  c.step(); assert.equal(c.r[4], 1); assert.equal(c.r[3], 0);
});

test("ARM block transfers, SWP and status register transfers", () => {
  const c = cpu([0xe8a0000e, 0xe8b4000e, 0xe1005091, 0xe10f6000, 0xe128f007]);
  c.r[0] = c.r[4] = 0x02000000; c.r[1] = 11; c.r[2] = 22; c.r[3] = 33;
  c.step(); c.r[1] = c.r[2] = c.r[3] = 0; c.step();
  assert.deepEqual([...c.r.slice(1, 4)], [11, 22, 33]);
  c.r[0] = 0x02000000; c.r[1] = 99; c.step(); assert.equal(c.r[5], 11);
  assert.equal(c.bus.read32(0x02000000), 99);
  c.step(); assert.equal(c.r[6], 0x1f);
  c.r[7] = 0xa0000000; c.step(); assert.equal(c.cpsr, 0xa000001f);
});

test("CPU banks mode-specific SP/LR and FIQ registers without losing user registers", () => {
  const c = cpu([]);
  c.r[8] = 88; c.r[14] = 99;
  c.status(0x12); assert.equal(c.r[13], 0x03007fa0); c.r[14] = 12;
  c.status(0x11); assert.equal(c.r[8], 0); c.r[8] = 11;
  c.status(0x1f); assert.equal(c.r[8], 88); assert.equal(c.r[14], 99);
  c.status(0x12); assert.equal(c.r[14], 12);
  assert.throws(() => c.status(0), /Mode ARM/);
});

test("ARM register shifts read PC+12 and empty decrementing block lists store PC once", () => {
  const c = cpu([0xe08f021f, 0xe9200000]);
  c.r[0] = 0x02000080; c.r[2] = 0;
  c.step(); assert.equal(c.r[0], 2 * (0x080000c0 + 12));
  c.r[0] = 0x02000080; c.step();
  assert.equal(c.bus.read32(0x0200007c), 0x080000d0);
  assert.equal(c.r[0], 0x02000040);
});

test("Thumb arithmetic, logical operations, shifts, multiply and high registers", () => {
  const c = cpu([0x2005, 0x2102, 0x1842, 0x3a01, 0x434a, 0x4690, 0x4643], true);
  for (let i = 0; i < 7; i++) c.step();
  assert.equal(c.r[2], 12); assert.equal(c.r[8], 12); assert.equal(c.r[3], 12);
});

test("Thumb load/store variants and stack push/pop", () => {
  const c = cpu([0x6001, 0x6802, 0x8001, 0x8803, 0xb40e, 0xbc70], true);
  c.r[0] = 0x02000000; c.r[1] = 0x12345678;
  const stack = c.r[13];
  for (let i = 0; i < 6; i++) c.step();
  assert.equal(c.r[2], 0x12345678); assert.equal(c.r[3], 0x5678);
  assert.deepEqual([...c.r.slice(4, 7)], [0x12345678, 0x12345678, 0x5678]);
  assert.equal(c.r[13], stack);
});

test("Thumb conditional branches and paired BL compute signed destinations", () => {
  const c = cpu([0x2000, 0x2800, 0xd000, 0x2101, 0xf000, 0xf800], true);
  c.step(); c.step(); c.step(); assert.equal(c.r[15], 0x080000c8);
  c.step(); c.step();
  assert.equal(c.r[14], 0x080000cd); assert.equal(c.r[15], 0x080000cc);
});

test("unknown ARM/Thumb instructions and BIOS calls fail explicitly", () => {
  assert.throws(() => cpu([0xee000000]).step(), /Instruction GBA/);
  assert.throws(() => cpu([0xde00], true).step(), /Instruction GBA/);
  assert.throws(() => cpu([0xef2a0000]).step(), /Service BIOS/);
});

test("unsupported stops carry a structured report locating the failure", () => {
  const arm = cpu([0xee000000]);
  assert.throws(() => arm.step(), error => {
    assert.equal(error.kind, "instruction"); assert.equal(error.name, "GBAUnsupportedError");
    assert.equal(error.report.pc, 0x080000c0); assert.equal(error.report.opcode, 0xee000000);
    assert.equal(error.report.thumb, false); assert.equal(error.report.registers.length, 16);
    assert.equal(arm.bus.lastStop, error.report);
    return true;
  });
  const thumb = cpu([0xde00], true);
  assert.throws(() => thumb.step(), error => error.report.thumb === true && error.report.opcode === 0xde00);
  const swi = cpu([0xef2a0000]);
  assert.throws(() => swi.step(), error => error.kind === "swi" && error.report.swi === 0x2a && error.report.pc === 0x080000c0);
});

function resetRegisters(c, thumb) {
  for (let i = 0; i < 13; i++) c.r[i] = 0x02000100 + i * 4;
  c.r[13] = 0x03007000; c.r[14] = 0x08000101; c.address = 0x080000c0; c.r[15] = 0x080000c4;
  c.cpsr = thumb ? 0x3f : 0x1f;
}

test("every Thumb encoding runs except those undefined on the ARM7TDMI", () => {
  const c = cpu([]);
  const undefinedOnARMv4T = op => (op & 0xff80) === 0x4780 || (op & 0xf800) === 0xe800 || op >>> 8 === 0xde
    || [0xb1, 0xb2, 0xb3, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbe, 0xbf].includes(op >>> 8);
  for (let op = 0; op < 65536; op++) {
    resetRegisters(c, true);
    let rejected = false;
    try { c.executeThumb(op); } catch (error) { rejected = error.kind === "instruction"; }
    if (rejected !== undefinedOnARMv4T(op)) assert.fail(`Thumb 0x${op.toString(16)} should ${rejected ? "run" : "be rejected"}`);
  }
});

// Classifies ARMv4T encodings whose decoding does not depend on should-be-zero/one fields.
function armEncoding(op) {
  const group = op >>> 25 & 7, b7 = op >>> 7 & 1, b4 = op >>> 4 & 1, load = op >>> 20 & 1;
  const compareWithoutS = (op >>> 23 & 3) === 2 && !load;
  if (group === 0 && b7 && b4) {
    const halfword = op >>> 5 & 3;
    if (halfword === 0) {
      if ((op >>> 22 & 63) === 0 || (op >>> 23 & 31) === 1) return "defined";
      return (op >>> 23 & 31) === 2 && (op >>> 20 & 3) === 0 ? "unspecified" : "undefined";
    }
    return !load && halfword !== 1 ? "undefined" : "defined";
  }
  if (group <= 1) return compareWithoutS ? "unspecified" : "defined";
  if (group === 2 || group === 4 || group === 5) return "defined";
  if (group === 3) return b4 ? "undefined" : "defined";
  return (op >>> 24 & 15) === 15 ? "unspecified" : "undefined";
}

test("every ARM decode group runs except coprocessor, ARMv5 and reserved encodings", () => {
  const c = cpu([]);
  let seed = 12345;
  for (let high = 0; high < 256; high++) for (let low = 0; low < 16; low++) for (let variant = 0; variant < 4; variant++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const op = (0xe0000000 | high << 20 | low << 4 | seed & 0x000fff0f) >>> 0;
    const expected = armEncoding(op);
    if (expected === "unspecified") continue;
    resetRegisters(c, false);
    let rejected = false;
    try { c.executeARM(op); } catch (error) { rejected = error.kind === "instruction"; }
    if (rejected !== (expected === "undefined")) assert.fail(`ARM 0x${op.toString(16)} should be ${expected}`);
  }
});

test("S-bit PC writes keep CPSR in User/System mode but need a saved SPSR in other modes", () => {
  const system = cpu([0xe1b0f00e]);
  system.r[14] = 0x08000200; system.step();
  assert.equal(system.r[15], 0x08000200); assert.equal(system.cpsr, 0x1f);
  const supervisor = cpu([0xe1b0f00e]);
  supervisor.status(0x13); supervisor.r[14] = 0x08000200;
  assert.throws(() => supervisor.step(), error => error.kind === "state" && /SPSR/.test(error.message));
});
