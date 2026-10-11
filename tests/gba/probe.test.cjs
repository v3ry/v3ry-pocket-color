"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { probe, format } = require("../../tools/gba-probe.cjs");
const { makeGBA, makeGBADemo } = require("./helpers.cjs");

test("probe reports the first unsupported instruction with its address and registers", () => {
  const result = probe(makeGBA({ program: [0xe3a00007, 0xee000000] }), { frames: 3 });
  assert.equal(result.stop.kind, "instruction");
  assert.equal(result.stop.pc, 0x080000c4); assert.equal(result.stop.opcode, 0xee000000);
  assert.equal(result.stop.registers[0], 7);
  const report = JSON.parse(format(result));
  assert.equal(report.stop.pc, "0x80000c4"); assert.equal(report.stop.opcode, "0xee000000");
});

test("probe counts BIOS services and names the first unsupported one", () => {
  const result = probe(makeGBA({ program: [0xef0b0000, 0xef1a0000] }), { frames: 3 });
  assert.equal(result.stop.kind, "swi"); assert.equal(result.stop.swi, 0x1a);
  assert.deepEqual([...result.services], [[0x0b, 1], [0x1a, 1]]);
  assert.deepEqual(JSON.parse(format(result)).services, { "0xb": 1, "0x1a": 1 });
});

test("probe runs a supported ROM to the requested frame without a stop", () => {
  const result = probe(makeGBADemo(), { frames: 2 });
  assert.equal(result.stop, null); assert.equal(result.frames, 2);
  assert.equal(JSON.parse(format(result)).stop, null);
});

test("probe reports console restarts triggered by a jump to the reset vector", () => {
  const result = probe(makeGBA({ program: [0xe3a0e0ab, 0xe3a0f000] }), { frames: 1 });
  assert.equal(result.stop, null);
  assert.equal(result.resets[0].frame, 0); assert.equal(result.resets[0].caller, 0xab);
  assert.equal(result.resets.length, 16);
  assert.deepEqual(JSON.parse(format(result)).resets[0], { frame: 0, caller: "0xab" });
});
