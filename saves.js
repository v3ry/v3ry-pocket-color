(function (root) {
  "use strict";

  class SaveStore {
    constructor(factory = root.indexedDB, crypto = root.crypto) {
      this.factory = factory;
      this.crypto = crypto;
      this.database = null;
    }
    async keyFor(bytes) {
      if (!this.crypto?.subtle) throw new Error("Identification des ROM indisponible : utilisez HTTPS, localhost ou un navigateur recent.");
      const hash = new Uint8Array(await this.crypto.subtle.digest("SHA-256", bytes));
      return [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("");
    }
    open() {
      if (this.database) return Promise.resolve(this.database);
      if (!this.factory) return Promise.reject(new Error("IndexedDB indisponible : les sauvegardes locales ne sont pas accessibles."));
      return new Promise((resolve, reject) => {
        const request = this.factory.open("v3ry-pocket-color-saves", 1);
        let blocked = false;
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("games")) request.result.createObjectStore("games");
        };
        request.onerror = () => reject(request.error || new Error("Ouverture des sauvegardes impossible."));
        request.onblocked = () => {
          blocked = true;
          reject(new Error("Stockage bloque par un autre onglet. Fermez les autres onglets de l'application."));
        };
        request.onsuccess = () => {
          const database = request.result;
          if (blocked) { database.close(); return; }
          this.database = database;
          database.onversionchange = () => { database.close(); this.database = null; };
          database.onclose = () => { if (this.database === database) this.database = null; };
          resolve(database);
        };
      });
    }
    async transaction(key, data, write) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction("games", write ? "readwrite" : "readonly");
        const store = transaction.objectStore("games");
        const request = write ? store.put(data, key) : store.get(key);
        transaction.oncomplete = () => resolve(write ? undefined : request.result);
        transaction.onabort = () => reject(transaction.error || request.error || new Error("Transaction de sauvegarde annulee."));
      });
    }
    read(key) { return this.transaction(key, undefined, false); }
    write(key, data) { return this.transaction(key, data, true); }
  }

  class SaveSession {
    constructor(store, key, cartridge) {
      this.store = store;
      this.key = key;
      this.cartridge = cartridge;
      this.savedRevision = cartridge.saveRevision;
      this.pending = Promise.resolve();
    }
    async restore() {
      const data = await this.store.read(this.key);
      if (data !== undefined) this.cartridge.restoreData(data);
      this.savedRevision = this.cartridge.saveRevision;
      return data !== undefined;
    }
    flush() {
      const persist = async () => {
        if (this.cartridge.hasRTC) this.cartridge.updateRTC();
        if (this.savedRevision === this.cartridge.saveRevision) return false;
        const data = this.cartridge.saveData(), revision = this.cartridge.saveRevision;
        await this.store.write(this.key, data);
        this.savedRevision = revision;
        return true;
      };
      // Serialize writes, including retries; a failed commit never marks RAM as saved.
      this.pending = this.pending.then(persist, persist);
      return this.pending;
    }
    get dirty() { return this.savedRevision !== this.cartridge.saveRevision; }
  }

  const api = { SaveStore, SaveSession };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketSaves = api;
})(globalThis);
