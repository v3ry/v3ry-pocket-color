(function (root) {
  "use strict";

  const FORMAT = "v3ry-pocket-color-gba-state";
  const VERSION = 1;
  const MAX_SIZE = 4 * 1024 * 1024;
  const MAX_TYPED_BYTES = 1024 * 1024;
  const MAX_ARRAY = 4096;
  const MAX_STRING = 65536;
  const MAX_DEPTH = 8;
  const TYPED = new Map([Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Uint8ClampedArray]
    .map(Ctor => [Ctor.name, Ctor]));
  // Diagnostics and derived references stay out of the state; the ROM and the output buffers are rebuilt on load.
  const MACHINE_EXCLUDE = new Set(["cartridge", "cpu", "graphics", "apu", "lastStop", "resets"]);
  const CPU_EXCLUDE = new Set(["bus", "shiftCarry"]);
  const CARTRIDGE_EXCLUDE = new Set(["rom", "title", "saveRevision"]);
  const GRAPHICS_EXCLUDE = new Set(["game"]);
  const APU_EXCLUDE = new Set(["_sampleRate", "psg", "samples"]);
  const PSG_EXCLUDE = new Set(["sampleRate", "samples"]);
  const MACHINE_RANGES = {
    line: [0, 227], dot: [0, 1231], buttons: [0, 1023], frames: [0, Number.MAX_SAFE_INTEGER],
    dmaStall: [0, Number.MAX_SAFE_INTEGER], waitMask: [0, 0xffffffff],
  };
  const IDENTITY = ["system", "width", "height", "clock"];

  function check(condition, message = "Donnees d'etat invalides.") {
    if (!condition) throw new Error(message);
  }
  function integer(value, min, max) {
    check(Number.isSafeInteger(value) && value >= min && value <= max, "Valeur d'etat hors limites.");
  }
  function plainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && !ArrayBuffer.isView(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  }
  function toBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function fromBase64(text) {
    let binary;
    try { binary = atob(text); } catch (error) { throw new Error("Donnees d'etat invalides.", { cause: error }); }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function encodeValue(value, depth = 0) {
    check(depth <= MAX_DEPTH, "Etat trop profond.");
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number") { check(Number.isFinite(value), "Valeur d'etat non finie."); return value; }
    if (ArrayBuffer.isView(value)) {
      check(TYPED.get(value.constructor.name) === value.constructor, "Type de memoire non pris en charge.");
      return { $: value.constructor.name, b: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    }
    if (Array.isArray(value)) return value.map(item => encodeValue(item, depth + 1));
    if (value instanceof Map) {
      return { $: "Map", e: [...value].map(([key, item]) => [encodeValue(key, depth + 1), encodeValue(item, depth + 1)]) };
    }
    if (value instanceof Set) return { $: "Set", e: [...value].map(item => encodeValue(item, depth + 1)) };
    if (plainObject(value)) return { $: "Object", v: encodeFields(value, new Set(), depth + 1) };
    throw new Error("Type d'etat non pris en charge.");
  }
  function encodeFields(source, exclude, depth = 0) {
    const fields = {};
    for (const key of Object.keys(source)) {
      if (!exclude.has(key) && source[key] !== undefined) fields[key] = encodeValue(source[key], depth + 1);
    }
    return fields;
  }
  function typedFrom(name, text) {
    const Ctor = TYPED.get(name), bytes = fromBase64(text);
    check(bytes.length <= MAX_TYPED_BYTES && bytes.length % Ctor.BYTES_PER_ELEMENT === 0);
    return new Ctor(bytes.buffer);
  }
  function decodeValue(data, depth = 0) {
    check(depth <= MAX_DEPTH);
    if (data === null || typeof data === "boolean") return data;
    if (typeof data === "number") { check(Number.isFinite(data) && Math.abs(data) <= Number.MAX_SAFE_INTEGER); return data; }
    if (typeof data === "string") { check(data.length <= MAX_STRING); return data; }
    if (Array.isArray(data)) { check(data.length <= MAX_ARRAY); return data.map(item => decodeValue(item, depth + 1)); }
    check(plainObject(data));
    if (data.$ === "Map") {
      check(Array.isArray(data.e) && data.e.length <= MAX_ARRAY);
      return new Map(data.e.map(entry => {
        check(Array.isArray(entry) && entry.length === 2);
        return [decodeValue(entry[0], depth + 1), decodeValue(entry[1], depth + 1)];
      }));
    }
    if (data.$ === "Set") {
      check(Array.isArray(data.e) && data.e.length <= MAX_ARRAY);
      return new Set(data.e.map(item => decodeValue(item, depth + 1)));
    }
    if (data.$ === "Object") { check(plainObject(data.v)); return decodeFields(data.v, depth + 1); }
    check(TYPED.has(data.$) && typeof data.b === "string");
    return typedFrom(data.$, data.b);
  }
  function decodeFields(source, depth = 0) {
    check(plainObject(source));
    const fields = {};
    for (const key of Object.keys(source)) {
      check(key !== "__proto__");
      fields[key] = decodeValue(source[key], depth + 1);
    }
    return fields;
  }

  function matchValue(template, value, lengths = null) {
    if (template === null) {
      check(value === null || Array.isArray(value) || ArrayBuffer.isView(value));
    } else if (ArrayBuffer.isView(template)) {
      check(ArrayBuffer.isView(value) && value.constructor === template.constructor
        && (lengths ? lengths.includes(value.length) : value.length === template.length), "Taille de memoire d'etat invalide.");
    } else if (typeof template === "number" || typeof template === "boolean" || typeof template === "string") {
      check(typeof value === typeof template, "Champ d'etat invalide.");
    } else if (template instanceof Map) {
      check(value instanceof Map, "Champ d'etat invalide.");
    } else if (template instanceof Set) {
      check(value instanceof Set, "Champ d'etat invalide.");
    } else if (Array.isArray(template)) {
      check(Array.isArray(value) && (template.length === 0 || value.length === template.length), "Champ d'etat invalide.");
      template.forEach((item, index) => matchValue(item, value[index]));
    } else {
      matchFields(template, value, new Set());
    }
  }
  function matchFields(template, value, exclude, sizes = {}) {
    check(plainObject(value), "Champs d'etat invalides.");
    const keys = Object.keys(template).filter(key => !exclude.has(key) && template[key] !== undefined);
    check(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)),
      "Champs d'etat invalides.");
    for (const key of keys) matchValue(template[key], value[key], sizes[key] ?? null);
  }
  function applyFields(target, values) {
    for (const key of Object.keys(values)) {
      const current = target[key], next = values[key];
      if (ArrayBuffer.isView(current) && current.length === next.length) current.set(next);
      else target[key] = next;
    }
  }

  function capture(game, romKey) {
    check(typeof romKey === "string" && romKey.length > 0 && romKey.length <= 128, "Identite ROM invalide.");
    return {
      format: FORMAT, version: VERSION, romKey, createdAt: Date.now(),
      machine: encodeFields(game, MACHINE_EXCLUDE),
      cpu: encodeFields(game.cpu, CPU_EXCLUDE),
      cartridge: encodeFields(game.cartridge, CARTRIDGE_EXCLUDE),
      graphics: encodeFields(game.graphics, GRAPHICS_EXCLUDE),
      apu: encodeFields(game.apu, APU_EXCLUDE),
      psg: encodeFields(game.apu.psg, PSG_EXCLUDE),
    };
  }
  function restore(game, data, romKey) {
    check(plainObject(data) && data.format === FORMAT && data.version === VERSION,
      "Format ou version de sauvegarde d'etat incompatible.");
    check(data.romKey === romKey, "Cet etat appartient a une autre ROM. Chargez exactement le meme jeu.");
    integer(data.createdAt, 0, Number.MAX_SAFE_INTEGER);
    const sections = {
      machine: decodeFields(data.machine), cpu: decodeFields(data.cpu), cartridge: decodeFields(data.cartridge),
      graphics: decodeFields(data.graphics), apu: decodeFields(data.apu), psg: decodeFields(data.psg),
    };

    // Validate every section against the freshly built game before the running machine is touched.
    matchFields(game, sections.machine, MACHINE_EXCLUDE);
    for (const key of IDENTITY) check(sections.machine[key] === game[key], "Cet etat appartient a une autre machine.");
    for (const [key, [min, max]] of Object.entries(MACHINE_RANGES)) integer(sections.machine[key], min, max);
    matchFields(game.cpu, sections.cpu, CPU_EXCLUDE);
    matchFields(game.cartridge, sections.cartridge, CARTRIDGE_EXCLUDE, { ram: game.cartridge.ramSizes });
    check(sections.cartridge.kind === game.cartridge.kind && sections.cartridge.type === game.cartridge.type,
      "Cet etat appartient a une autre cartouche.");
    matchFields(game.graphics, sections.graphics, GRAPHICS_EXCLUDE);
    matchFields(game.apu, sections.apu, APU_EXCLUDE);
    matchFields(game.apu.psg, sections.psg, PSG_EXCLUDE);
    integer(sections.psg.frameStep, 0, 7);

    applyFields(game, sections.machine);
    applyFields(game.cpu, sections.cpu);
    applyFields(game.cartridge, sections.cartridge);
    applyFields(game.graphics, sections.graphics);
    applyFields(game.apu, sections.apu);
    applyFields(game.apu.psg, sections.psg);
    // Pending audio belongs to the previous timeline; the output rate comes from the current audio context.
    game.apu.samples.length = 0;
    game.apu.psg.samples.length = 0;
    game.cartridge.saveRevision++;
  }
  function encode(data) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    if (blob.size > MAX_SIZE) throw new Error("Etat trop volumineux.");
    return blob;
  }
  async function decode(file) {
    if (!file.size || file.size > MAX_SIZE) throw new Error("Fichier d'etat vide ou trop volumineux (4 Mio maximum).");
    try { return JSON.parse(await file.text()); }
    catch (error) { throw new Error("Fichier d'etat JSON illisible.", { cause: error }); }
  }

  const api = { FORMAT, MAX_SIZE, capture, restore, encode, decode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketGBAStates = api;
})(globalThis);
