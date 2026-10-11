(function (root) {
  "use strict";

  const createGen1Engine = typeof module !== "undefined" && module.exports ? require("./gen1-engine.js") : root.Gen1Engine;
  // Pokémon Yellow revision 0: WRAM offsets are one byte below Red's for the map variables and the block grid stays at 0x06e8.
  const engine = createGen1Engine({ gameName: "Jaune", ram: {
    map: 0x1362, anchor: 0x1363, tileset: 0x136b, height: 0x136c, width: 0x136d, bank: 0x152f, definitions: 0x1530,
    collision: 0x1534, bgAnchor: 0x152a, blocks: 0x6e8, battle: 0x105b, blockY: 0x1367, blockX: 0x1368 } });

  const preset = { id: "pokemon-yellow-0", name: "Pokémon Jaune · Kanto", label: "Pokémon Jaune",
    match: { title: "POKEMON YEL", color: true, cartridgeType: 0x1b, revision: 0, checksum: 0xb7c1 },
    camera: { yaw: 0, pitch: -20, zoom: 0.9 }, thickness: 14, light: 0.73,
    backgroundDepth: 0, spriteDepth: 1, tileDepths: {}, raisedSprites: true, terrain: engine.terrain, world: engine.world };
  if (typeof module !== "undefined" && module.exports) module.exports = preset;
  else { root.PocketPresets = root.PocketPresets || []; root.PocketPresets.push(preset); }
})(globalThis);
