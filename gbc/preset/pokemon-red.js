(function (root) {
  "use strict";

  const createGen1Engine = typeof module !== "undefined" && module.exports ? require("./gen1-engine.js") : root.Gen1Engine;
  // French Red revision 0: physical WRAM offsets, verified in the running cartridge.
  const engine = createGen1Engine({ gameName: "Rouge", ram: {
    map: 0x1363, anchor: 0x1364, tileset: 0x136c, height: 0x136d, width: 0x136e, bank: 0x1530, definitions: 0x1531,
    collision: 0x1535, bgAnchor: 0x152b, blocks: 0x6e8, battle: 0x105c, blockY: 0x1368, blockX: 0x1369 } });

  const preset = { id: "pokemon-red-fr-0", name: "Pokémon Rouge français · Kanto", label: "Pokémon Rouge FR",
    match: { title: "POKEMON RED", color: false, cartridgeType: 0x1b, revision: 0, checksum: 0x7afc },
    camera: { yaw: 0, pitch: -20, zoom: 0.9 }, thickness: 14, light: 0.73,
    backgroundDepth: 0, spriteDepth: 1, tileDepths: {}, raisedSprites: true, terrain: engine.terrain, world: engine.world };
  if (typeof module !== "undefined" && module.exports) module.exports = preset;
  else { root.PocketPresets = root.PocketPresets || []; root.PocketPresets.push(preset); }
})(globalThis);
