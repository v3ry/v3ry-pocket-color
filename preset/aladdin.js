(function (root) {
  "use strict";
  const preset = {
    id: "aladdin-gbc",
    name: "Aladdin GBC · scène latérale",
    match: { title: "ALADDIN", color: true, cartridgeType: 0x19 },
    camera: { yaw: -18, pitch: 10, zoom: 0.9 },
    backgroundDepth: -12,
    spriteDepth: 2,
    thickness: 4,
    // Keys are "VRAM bank:tile ID"; no semantic tile classification is assumed.
    tileDepths: {},
  };
  if (typeof module !== "undefined" && module.exports) module.exports = preset;
  else {
    root.PocketPresets = root.PocketPresets || [];
    root.PocketPresets.push(preset);
  }
})(globalThis);
