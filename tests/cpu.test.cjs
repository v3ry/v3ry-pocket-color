"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CPU } = require("../cpu.js");

function cpuWith(program) {
  const memory = new Uint8Array(65536);
  memory.set(program, 0x100);
  const cpu = new CPU({ read: (address) => memory[address], write: (address, value) => { memory[address] = value; } });
  return { cpu, memory };
}

test("all legal opcodes execute, illegal opcodes fail explicitly", () => {
  const illegal = [0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd];
  for (let opcode = 0; opcode < 256; opcode++) {
    const { cpu } = cpuWith([opcode, 0, 0]);
    if (illegal.includes(opcode)) assert.throws(() => cpu.step(), /Opcode invalide/);
    else {
      const cycles = cpu.step();
      assert.ok(cycles >= 4 && cycles <= 24 && cycles % 4 === 0, `opcode ${opcode.toString(16)}`);
      assert.equal(cpu.f & 15, 0);
    }
  }
});

test("8-bit arithmetic and flags are exhaustive for ADD ADC SUB SBC CP", () => {
  const { cpu } = cpuWith([]);
  for (const operation of [0, 1, 2, 3, 7]) {
    for (let a = 0; a < 256; a++) for (let value = 0; value < 256; value++) for (let carry = 0; carry < 2; carry++) {
      cpu.a = a; cpu.f = carry ? 0x10 : 0;
      cpu.alu(operation, value);
      const sub = operation === 2 || operation === 3 || operation === 7;
      const extra = operation === 1 || operation === 3 ? carry : 0;
      const result = a + (sub ? -value - extra : value + extra);
      const half = sub ? (a & 15) - (value & 15) - extra < 0 : (a & 15) + (value & 15) + extra > 15;
      const expected = ((result & 255) === 0 ? 128 : 0) | (sub ? 64 : 0)
        | (half ? 32 : 0) | (result < 0 || result > 255 ? 16 : 0);
      assert.equal(cpu.f, expected);
      assert.equal(cpu.a, operation === 7 ? a : result & 255);
    }
  }
});

test("INC/DEC preserve carry; logical operations and DAA", () => {
  const { cpu } = cpuWith([]);
  cpu.f = 16; assert.equal(cpu.inc(255), 0); assert.equal(cpu.f, 0xb0);
  assert.equal(cpu.dec(0), 255); assert.equal(cpu.f, 0x70);
  cpu.a = 0x0f; cpu.alu(4, 0xf0); assert.equal(cpu.a, 0); assert.equal(cpu.f, 0xa0);
  cpu.a = 0x45; cpu.alu(0, 0x38); cpu.daa(); assert.equal(cpu.a, 0x83); assert.equal(cpu.f, 0);
  cpu.a = 0x99; cpu.alu(0, 1); cpu.daa(); assert.equal(cpu.a, 0); assert.equal(cpu.f, 0x90);
  cpu.a = 0x13; cpu.alu(2, 6); cpu.daa(); assert.equal(cpu.a, 7); assert.equal(cpu.f, 0x40);
});

test("CB bit operations, rotations, and memory timing", () => {
  for (let opcode = 0; opcode < 256; opcode++) {
    const { cpu, memory } = cpuWith([0xcb, opcode]);
    cpu.hl = 0xc000; memory[0xc000] = 0x81;
    cpu.b = cpu.c = cpu.d = cpu.e = cpu.a = 0x81; cpu.f = 16;
    const z = opcode & 7, x = opcode >> 6, y = (opcode >> 3) & 7;
    const before = cpu.reg(z);
    const cycles = cpu.step();
    assert.equal(cycles, z === 6 ? x === 1 ? 12 : 16 : 8);
    if (x === 1) {
      assert.equal(cpu.reg(z), before);
      assert.equal(cpu.f, 0x30 | (before & (1 << y) ? 0 : 0x80));
    }
    if (x === 2) assert.equal(cpu.reg(z), before & ~(1 << y));
    if (x === 3) assert.equal(cpu.reg(z), before | (1 << y));
    if (x === 0 && z !== 4 && z !== 5) {
      const results = [3, 0xc0, 3, 0xc0, 2, 0xc0, 0x18, 0x40];
      assert.equal(cpu.reg(z), results[y]);
    }
  }
});

test("stack, calls, returns, relative branches, and POP AF masking", () => {
  const { cpu, memory } = cpuWith([0xcd, 0x00, 0x02, 0x18, 0xfe]);
  memory[0x200] = 0xc9;
  assert.equal(cpu.step(), 24); assert.equal(cpu.pc, 0x200); assert.equal(cpu.sp, 0xfffc);
  assert.equal(memory[0xfffc], 3); assert.equal(memory[0xfffd], 1);
  assert.equal(cpu.step(), 16); assert.equal(cpu.pc, 0x103);
  assert.equal(cpu.step(), 12); assert.equal(cpu.pc, 0x103);
  cpu.push(0xffff); memory[0x103] = 0xf1; cpu.step();
  assert.equal(cpu.a, 255); assert.equal(cpu.f, 0xf0);
});

test("EI is delayed, interrupt priority and RETI work", () => {
  const { cpu, memory } = cpuWith([0xfb, 0x00, 0x00]);
  memory[0xffff] = 5; memory[0xff0f] = 5; memory[0x40] = 0xd9;
  cpu.step(); assert.equal(cpu.ime, false);
  cpu.step(); assert.equal(cpu.ime, true);
  assert.equal(cpu.step(), 20); assert.equal(cpu.pc, 0x40);
  assert.equal(memory[0xff0f], 4); assert.equal(cpu.ime, false);
  cpu.step(); assert.equal(cpu.pc, 0x102); assert.equal(cpu.ime, true);
});

test("HALT wakes on an interrupt and HALT bug repeats the opcode byte", () => {
  const { cpu, memory } = cpuWith([0x76, 0x3e, 0x12]);
  memory[0xffff] = 1;
  cpu.step(); assert.equal(cpu.halted, true);
  cpu.step(); assert.equal(cpu.pc, 0x101);
  memory[0xff0f] = 1; cpu.step(); assert.equal(cpu.a, 0x12);
  cpu.pc = 0x100; cpu.step(); cpu.step();
  assert.equal(cpu.a, 0x3e); assert.equal(cpu.pc, 0x102);
});

test("signed SP operations, 16-bit addition and conditional cycles", () => {
  const { cpu } = cpuWith([0xe8, 0xff, 0xf8, 0x01, 0x20, 0x02]);
  cpu.sp = 1; assert.equal(cpu.step(), 16); assert.equal(cpu.sp, 0); assert.equal(cpu.f, 0x30);
  cpu.step(); assert.equal(cpu.hl, 1); assert.equal(cpu.f, 0);
  assert.equal(cpu.step(), 12); assert.equal(cpu.pc, 0x108);
  cpu.pc = 0x104; cpu.f = 0x80; assert.equal(cpu.step(), 8); assert.equal(cpu.pc, 0x106);
});

test("DAA matches every pair of two-digit BCD additions and subtractions", () => {
  const { cpu } = cpuWith([]);
  const bcd = value => ((Math.floor(value / 10) << 4) | (value % 10));
  for (let a = 0; a < 100; a++) for (let b = 0; b < 100; b++) {
    cpu.a = bcd(a); cpu.f = 0; cpu.alu(0, bcd(b)); cpu.daa();
    assert.equal(cpu.a, bcd((a + b) % 100));
    assert.equal(cpu.f & 16, a + b >= 100 ? 16 : 0);
    cpu.a = bcd(a); cpu.f = 0; cpu.alu(2, bcd(b)); cpu.daa();
    assert.equal(cpu.a, bcd((a - b + 100) % 100));
    assert.equal(cpu.f & 16, a < b ? 16 : 0);
  }
});

test("indirect loads, HL post-increment/decrement and 16-bit wrap", () => {
  const { cpu, memory } = cpuWith([
    0x21, 0xff, 0xff, 0x3e, 0x42, 0x22, 0x2a, 0x32,
    0x01, 0xff, 0x0f, 0x09, 0x11, 0xff, 0xff, 0x13,
  ]);
  cpu.step(); cpu.step(); cpu.step();
  assert.equal(memory[0xffff], 0x42); assert.equal(cpu.hl, 0);
  memory[0] = 0x77; cpu.step(); assert.equal(cpu.a, 0x77); assert.equal(cpu.hl, 1);
  cpu.step(); assert.equal(memory[1], 0x77); assert.equal(cpu.hl, 0);
  cpu.step(); cpu.hl = 1; cpu.f = 0x80; cpu.step();
  assert.equal(cpu.hl, 0x1000); assert.equal(cpu.f, 0xa0);
  cpu.step(); cpu.step(); assert.equal(cpu.pair(1), 0);
});

test("conditional jumps, calls and returns have correct taken and untaken timing", () => {
  for (let condition = 0; condition < 4; condition++) for (const taken of [false, true]) {
    const flags = condition < 2 ? 0x80 : 0x10;
    const f = (condition & 1) === Number(taken) ? flags : 0;
    for (const [base, immediate, expected] of [
      [0xc2, [0x00, 0x02], taken ? 16 : 12],
      [0xc4, [0x00, 0x02], taken ? 24 : 12],
      [0xc0, [], taken ? 20 : 8],
    ]) {
      const { cpu } = cpuWith([base + condition * 8, ...immediate]);
      cpu.f = f; if (base === 0xc0) cpu.push(0x200);
      assert.equal(cpu.step(), expected, `${base.toString(16)} condition ${condition}`);
      assert.equal(cpu.pc, taken ? 0x200 : 0x101 + immediate.length);
    }
  }
});
