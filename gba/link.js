"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketGBALink = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const SIOMULTI0 = 0x120, SIOCNT = 0x128, SIODATA8 = 0x12a;
  const MAX_UNITS = 4;
  const START = 0x80, ERROR = 0x40, IRQ = 0x4000;
  const READ_ONLY = 0x7c;

  // Each unit is a GameBoyAdvance. The first connected unit is the parent; the others are children in connection order.
  class LinkCable {
    constructor() {
      this.units = [];
    }

    connect(gba) {
      if (gba.link) throw new Error("Cette console GBA est deja branchee sur un cable.");
      if (this.units.length >= MAX_UNITS) throw new Error("Un cable GBA accepte au plus 4 consoles.");
      this.units.push(gba);
      gba.link = this;
      gba.linkId = this.units.length - 1;
      this.refresh();
    }

    disconnect(gba) {
      const index = this.units.indexOf(gba);
      if (index < 0) return;
      this.units.splice(index, 1);
      gba.link = null;
      gba.linkId = 0;
      gba.setIO16(SIOCNT, gba.io16(SIOCNT) & ~START);
      this.refresh();
    }

    // Parent start: children become busy until the parent's transfer completes.
    begin(parent) {
      for (const unit of this.units) {
        unit.io.fill(0xff, SIOMULTI0, SIOMULTI0 + 8);
        if (unit !== parent) unit.setIO16(SIOCNT, unit.io16(SIOCNT) | START);
      }
    }

    // Parent transfer end: collects the words of the chain, then writes the same result into every unit.
    complete() {
      const slots = [0xffff, 0xffff, 0xffff, 0xffff];
      let chainOpen = true, error = this.units.length < 2;
      this.units.forEach((unit, slot) => {
        if (!chainOpen) return;
        if (!participates(unit)) {
          chainOpen = false;
          error = true;
          return;
        }
        slots[slot] = unit.io16(SIODATA8);
      });
      for (const unit of this.units) {
        slots.forEach((word, i) => unit.setIO16(SIOMULTI0 + i * 2, word));
        const control = (unit.io16(SIOCNT) & ~(READ_ONLY | START)) | status(unit) | (error ? ERROR : 0);
        unit.setIO16(SIOCNT, control);
        if (control & IRQ) unit.interrupt(0x80);
      }
    }

    refresh() {
      for (const unit of this.units) {
        unit.setIO16(SIOCNT, (unit.io16(SIOCNT) & ~(0x0c | 0x30)) | status(unit));
      }
    }
  }

  function participates(unit) {
    return (unit.io16(SIOCNT) >>> 12 & 3) === 2;
  }

  // SI is set on children, SD is set while the cable is connected, and the ID is the unit's place on the cable.
  function status(unit) {
    return (unit.linkId ? 0x04 : 0) | 0x08 | (unit.linkId << 4);
  }

  return { LinkCable };
});
