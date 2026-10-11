(function (root) {
  "use strict";

  class LinkCable {
    constructor() {
      this.ports = [];
    }
    connect(gameBoy) {
      if (typeof gameBoy?.externalSerialExchange !== "function") {
        throw new TypeError("Le câble ne peut relier que des GameBoy.");
      }
      if (this.ports.some((port) => port.gameBoy === gameBoy)) return;
      if (this.ports.length === 2) throw new Error("Un câble relie deux consoles au maximum.");
      const port = { gameBoy, previous: gameBoy.serialDevice, transfer: (value) => this.transfer(port, value) };
      this.ports.push(port);
      gameBoy.setSerialDevice(port);
    }
    disconnect(gameBoy) {
      const index = this.ports.findIndex((port) => port.gameBoy === gameBoy);
      if (index < 0) return;
      const [port] = this.ports.splice(index, 1);
      gameBoy.setSerialDevice(port.previous);
    }
    transfer(sender, value) {
      const peer = this.ports.find((port) => port !== sender);
      return peer?.gameBoy.externalSerialExchange(value) ?? 0xff;
    }
    // Advances the linked consoles in step, always running the one that is furthest behind,
    // so that a slave armed by one console is seen by the other in time.
    run(budget) {
      const clocks = this.ports.map((port) => ({ gameBoy: port.gameBoy, elapsed: 0 }));
      for (;;) {
        const next = clocks.filter((clock) => clock.elapsed < budget).sort((x, y) => x.elapsed - y.elapsed)[0];
        if (!next) return;
        next.elapsed += next.gameBoy.step();
      }
    }
  }

  const api = { LinkCable };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketLink = api;
})(globalThis);
