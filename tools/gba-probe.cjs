#!/usr/bin/env node
"use strict";
// Runs a GBA ROM without a display and reports the first unsupported instruction, BIOS call or DMA mode.
const fs = require("node:fs");
const { GameBoyAdvance } = require("../gba/emulator.js");
const zip = require("../zip.js");

const FRAME_CYCLES = 1232 * 228;
const hex = value => "0x" + (value >>> 0).toString(16);

async function loadROM(file) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  if (!/\.zip$/i.test(file)) return bytes;
  const archive = zip.listROMs(bytes);
  const entry = archive.entries.find(item => /\.gba$/i.test(item.name));
  if (!entry) throw new Error("Aucune ROM .gba dans cette archive.");
  return zip.extractROM(archive, entry);
}

// Taps A and Start periodically so that title screens do not hide later code paths.
function tapButtons(game, frame) {
  const phase = frame % 120;
  if (phase === 40) game.setButton(4, true);
  if (phase === 45) game.setButton(4, false);
  if (phase === 100) game.setButton(7, true);
  if (phase === 110) game.setButton(7, false);
}

function probe(bytes, { frames = 1800, input = true } = {}) {
  const game = new GameBoyAdvance(bytes);
  const services = new Map();
  const swi = game.swi.bind(game);
  game.swi = number => { services.set(number, (services.get(number) || 0) + 1); return swi(number); };
  let stop = null;
  try {
    for (let frame = 0; frame < frames; frame++) {
      if (input) tapButtons(game, frame);
      game.runCycles(FRAME_CYCLES);
    }
  } catch (error) {
    stop = { ...(error.report || { kind: "error", ...game.cpu.snapshot() }), message: error.message };
  }
  return { frames: game.frames, stop, resets: game.resets, services: new Map([...services].sort((a, b) => a[0] - b[0])) };
}

function format(result) {
  const { stop } = result;
  return JSON.stringify({
    frames: result.frames,
    stop: stop && {
      kind: stop.kind, message: stop.message, frame: stop.frame, pc: hex(stop.pc), thumb: stop.thumb,
      opcode: stop.opcode === undefined ? undefined : hex(stop.opcode), swi: stop.swi === undefined ? undefined : hex(stop.swi),
      cpsr: hex(stop.cpsr), registers: stop.registers.map(hex)
    },
    resets: result.resets.map(reset => ({ frame: reset.frame, caller: hex(reset.caller) })),
    services: Object.fromEntries([...result.services].map(([number, count]) => [hex(number), count]))
  }, null, 2);
}

async function main(args) {
  const input = !args.includes("--no-input");
  const [file, frames = "1800"] = args.filter(arg => !arg.startsWith("--"));
  if (!file || !(Number(frames) > 0)) {
    console.error("Usage : node tools/gba-probe.cjs <rom.gba|archive.zip> [images=1800] [--no-input]");
    return 2;
  }
  const result = probe(await loadROM(file), { frames: Number(frames), input });
  console.log(format(result));
  return result.stop ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

module.exports = { probe, format, loadROM };
