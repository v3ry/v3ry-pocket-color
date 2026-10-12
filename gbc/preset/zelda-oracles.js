(function (root) {
  "use strict";

  function inactive(reason) {
    return { active: false, reason };
  }

  function regionReason(game) {
    const ram = game.wram, io = game.io;
    if (!(io[0x40] & 128)) return "Écran LCD éteint";
    const room = ram[0xc30];
    const distance = Math.abs((room >> 4) - 8) + Math.abs((room & 15) - 10);
    if (ram[0xc2d] !== 0 || ram[0xc31] !== 1 || distance > 4
      || ram[0xc2e] !== 0 || ram[0xd0a] !== 20 || ram[0xd0b] !== 16) {
      return "Extérieurs proches du départ uniquement · vue 2D conservée ailleurs";
    }
    // Live scroll registers also describe the HUD raster split, not just room transitions.
    if (ram[0xd00] !== 1
      || ram[0xc2f] !== room || ram[0x4ab] !== 0) {
      return "Transition de salle en cours · vue 2D conservée";
    }
    return null;
  }

  function terrain(game) {
    const depths = new Float32Array(1024), hidden = new Uint8Array(1024);
    const reason = regionReason(game);
    if (reason) return { ...inactive(reason), depths, hidden };

    const collisions = game.wram;
    for (let row = 0; row < 16; row++) for (let column = 0; column < 20; column++) {
      const block = collisions[0xe00 + (row >> 1) * 16 + (column >> 1)];
      if (block >= 0x10) continue;
      const bit = (1 - (row & 1)) * 2 + (1 - (column & 1));
      if (block & (1 << bit)) depths[row * 32 + column] = 8;
    }
    return { active: true, depths, hidden, scrollX: 0, scrollY: 240, mapOffset: 0x1800,
      reason: "Extérieurs du départ · relief des collisions" };
  }

  function world(game) {
    const reason = regionReason(game);
    if (reason) return inactive(reason);

    const tiles = new Uint16Array(20 * 16), surfaces = [];
    const map = 0x1800; // The room map is at $9800 even if the live LCDC selector changes.
    for (let row = 0; row < 16; row++) for (let column = 0; column < 20; column++) {
      const index = map + row * 32 + column;
      const tile = game.vram[index], attributes = game.vram[8192 + index];
      tiles[row * 20 + column] = tile | (attributes << 8);

      const block = game.wram[0xe00 + (row >> 1) * 16 + (column >> 1)];
      const bit = (1 - (row & 1)) * 2 + (1 - (column & 1));
      const depth = block < 0x10 && (block & (1 << bit)) ? 14 : 0;
      surfaces.push({ x: column * 8, y: row * 8, depth, size: 8, sculpted: depth > 0 });
    }
    return {
      active: true,
      generic: true,
      procedural: true,
      texturedGround: true,
      luminanceRelief: true,
      canopyRelief: true,
      vegetationRelief: true,
      modeledFoliage: true,
      foundationDepth: 8,
      objects: [],
      name: `Zelda Oracle of Ages · extérieur ${game.wram[0xc30].toString(16).toUpperCase()}`,
      width: 5,
      height: 4,
      tileColumns: 20,
      tileRows: 16,
      wideTiles: true,
      unsignedTiles: false,
      tiles,
      surfaces,
      originX: 0,
      originY: -16,
      zoomFactor: 0.9,
      pitchOffset: 25,
      clearColor: [0.16, 0.23, 0.18, 1],
    };
  }

  const preset = {
    id: "zelda-oracle-of-ages-start-room",
    name: "Zelda Oracle of Ages · extérieurs du départ",
    label: "Zelda Oracle of Ages",
    match: { title: "ZELDA NAYRU", color: true, cartridgeType: 0x1b, checksum: 0xa664 },
    camera: { yaw: -12, pitch: -25, zoom: 0.9 },
    backgroundDepth: 0,
    spriteDepth: 1,
    thickness: 8,
    light: 0.25,
    tileDepths: {},
    raisedSprites: true,
    terrain,
    world,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = preset;
  else {
    root.PocketPresets = root.PocketPresets || [];
    root.PocketPresets.push(preset);
  }
})(globalThis);
