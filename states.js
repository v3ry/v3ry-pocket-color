(function (root) {
  "use strict";

  const FORMAT = "v3ry-pocket-color-state";
  const MAX_SIZE = 4 * 1024 * 1024;
  const MEMORY = ["vram", "wram", "oam", "io", "hram", "bgPalette", "objPalette", "pixels"];
  const CART_ARRAYS = ["ram", "rtc", "latchedRTC"];
  const CART_EXCLUDE = new Set(["rom", "banks", "color", "title", "mapper", "type", "hasRTC", "saveRevision", ...CART_ARRAYS]);
  const MACHINE_EXCLUDE = new Set(["cartridge", "cpu", "apu", "color", ...MEMORY]);
  const APU_EXCLUDE = new Set(["registers", "channels", "samples", "highpass"]);

  function scalarCopy(target, exclude) {
    const result = {};
    for (const key of Object.keys(target)) if (!exclude.has(key)) result[key] = target[key];
    return result;
  }
  function validateScalars(data, template, exclude) {
    const expected = scalarCopy(template, exclude);
    if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).length !== Object.keys(expected).length) throw new Error("Champs d'etat invalides.");
    for (const key of Object.keys(expected)) {
      const value = data[key], type = typeof expected[key];
      if (typeof value !== type
        || (type === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))
        || (type === "string" && value.length > 65536)
        || !["number", "boolean", "string"].includes(type)) throw new Error(`Champ d'etat invalide : ${key}.`);
    }
    return data;
  }
  function integer(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Valeur d'etat hors limites.");
  }
  function byteArray(data, length) {
    if (!Array.isArray(data) || data.length !== length) throw new Error("Taille de memoire d'etat invalide.");
    for (const byte of data) integer(byte, 0, 255);
    return data;
  }
  function capture(game, romKey) {
    if (!/^[0-9a-f]{64}$/.test(romKey)) throw new Error("Identite ROM invalide.");
    if (game.cartridge.hasRTC) game.cartridge.updateRTC();
    return {
      format: FORMAT, version: 1, romKey, createdAt: Date.now(), color: game.color,
      cpu: scalarCopy(game.cpu, new Set(["bus"])),
      machine: scalarCopy(game, MACHINE_EXCLUDE),
      memory: Object.fromEntries(MEMORY.map(key => [key, Array.from(game[key])])),
      cartridge: {
        type: game.cartridge.type,
        scalars: scalarCopy(game.cartridge, CART_EXCLUDE),
        ...Object.fromEntries(CART_ARRAYS.map(key => [key, Array.from(game.cartridge[key])])),
      },
      audio: {
        scalars: scalarCopy(game.apu, APU_EXCLUDE),
        registers: Array.from(game.apu.registers),
        channels: game.apu.channels.map(channel => ({ ...channel })),
        highpass: [...game.apu.highpass],
      },
    };
  }
  function restore(game, data, romKey) {
    if (!data || data.format !== FORMAT || data.version !== 1) throw new Error("Format ou version de sauvegarde d'etat incompatible.");
    if (data.romKey !== romKey || data.color !== game.color || data.cartridge?.type !== game.cartridge.type) {
      throw new Error("Cet etat appartient a une autre ROM. Chargez exactement le meme jeu.");
    }
    integer(data.createdAt, 0, Number.MAX_SAFE_INTEGER);
    const cpu = validateScalars(data.cpu, game.cpu, new Set(["bus"]));
    for (const key of ["a", "f", "b", "c", "d", "e", "h", "l"]) integer(cpu[key], 0, 255);
    if (cpu.f & 15) throw new Error("Flags CPU invalides.");
    integer(cpu.pc, 0, 65535); integer(cpu.sp, 0, 65535); integer(cpu.imeDelay, 0, 2);
    const machine = validateScalars(data.machine, game, MACHINE_EXCLUDE);
    const ranges = {
      ie: 255, div: 65535, timerDelay: 4, dot: 455, ly: 153, windowLine: 144,
      frames: Number.MAX_SAFE_INTEGER, speedPhase: 1, stall: 1000000, buttons: 255,
      serialCycles: 4096, hdmaBlocks: 128, hdmaSource: 65535, hdmaDestination: 8191,
    };
    for (const [key, max] of Object.entries(ranges)) integer(machine[key], 0, max);
    for (const key of MEMORY) byteArray(data.memory?.[key], game[key].length);
    const cart = validateScalars(data.cartridge.scalars, game.cartridge, CART_EXCLUDE);
    for (const [key, max] of Object.entries({ bank: 511, highBank: 3, ramBank: 255, mode: 1, latch: 255 })) {
      integer(cart[key], 0, max);
    }
    integer(cart.lastRTC, 0, Number.MAX_SAFE_INTEGER);
    for (const key of CART_ARRAYS) byteArray(data.cartridge[key], game.cartridge[key].length);
    for (const key of ["rtc", "latchedRTC"]) {
      const rtc = data.cartridge[key];
      if (rtc[0] > 63 || rtc[1] > 63 || rtc[2] > 31 || (rtc[4] & ~0xc1)) throw new Error("Horloge d'etat invalide.");
    }
    const audio = validateScalars(data.audio?.scalars, game.apu, APU_EXCLUDE);
    integer(audio.sampleRate, 8000, 384000);
    integer(audio.sampleClock, 0, 4194303); integer(audio.frameClock, 0, 8191); integer(audio.frameStep, 0, 7);
    byteArray(data.audio.registers, game.apu.registers.length);
    if (!Array.isArray(data.audio.channels) || data.audio.channels.length !== 4) throw new Error("Canaux audio invalides.");
    data.audio.channels.forEach((channel, index) => {
      validateScalars(channel, game.apu.channels[index], new Set());
      for (const [key, min, max] of [
        ["length", 0, 256], ["volume", 0, 15], ["envelope", -Number.MAX_SAFE_INTEGER, 8],
        ["lfsr", 0, 32767], ["sweep", -Number.MAX_SAFE_INTEGER, 8], ["shadow", 0, 2047],
      ]) integer(channel[key], min, max);
      if (channel.phase < 0 || channel.phase >= 1) throw new Error("Phase audio invalide.");
    });
    if (!Array.isArray(data.audio.highpass) || data.audio.highpass.length !== 2
      || !data.audio.highpass.every(value => Number.isFinite(value) && Math.abs(value) <= 2)) {
      throw new Error("Filtre audio invalide.");
    }

    // Validate the entire snapshot before touching the running machine.
    Object.assign(game.cpu, cpu);
    Object.assign(game, machine);
    for (const key of MEMORY) game[key].set(data.memory[key]);
    Object.assign(game.cartridge, cart);
    for (const key of CART_ARRAYS) game.cartridge[key].set(data.cartridge[key]);
    // A state rewinds the RTC; elapsed wall time is not applied to the restored instant.
    if (game.cartridge.hasRTC) game.cartridge.lastRTC = Date.now();
    game.cartridge.saveRevision++;
    Object.assign(game.apu, audio);
    game.apu.registers.set(data.audio.registers);
    game.apu.channels.forEach((channel, index) => Object.assign(channel, data.audio.channels[index]));
    game.apu.highpass = [...data.audio.highpass];
    game.apu.samples.length = 0;
  }
  function encode(data) {
    const text = JSON.stringify(data);
    const blob = new Blob([text], { type: "application/json" });
    if (blob.size > MAX_SIZE) throw new Error("Etat trop volumineux.");
    return blob;
  }
  async function decode(file) {
    if (!file.size || file.size > MAX_SIZE) throw new Error("Fichier d'etat vide ou trop volumineux (4 Mio maximum).");
    try { return JSON.parse(await file.text()); }
    catch (error) { throw new Error("Fichier d'etat JSON illisible.", { cause: error }); }
  }
  const api = { capture, restore, encode, decode, MAX_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketStates = api;
})(globalThis);
