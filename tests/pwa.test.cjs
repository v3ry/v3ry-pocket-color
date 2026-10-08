"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

function worker() {
  const events = {}, storage = new Map(), network = [], deleted = [];
  const scope = "https://example.test/pocket/";
  const cache = {
    async addAll(requests) {
      for (const request of requests) storage.set(request.url, { url: request.url, cached: true });
    },
    async match(key) { return storage.get(key); },
  };
  const context = vm.createContext({
    URL, Request,
    self: { registration: { scope }, clients: { async claim() {} }, addEventListener: (name, callback) => { events[name] = callback; } },
    caches: {
      async open() { return cache; },
      async keys() { return ["unrelated-cache", ...Array.from({ length: 20 }, (_, i) => `v3ry-pocket-color-app-v${i + 1}`)]; },
      async delete(name) { deleted.push(name); },
    },
    async fetch(request) { network.push(request.url); return { network: true }; },
  });
  vm.runInContext(source("sw.js"), context);
  async function lifecycle(name) { let pending; events[name]({ waitUntil(value) { pending = value; } }); await pending; }
  async function request(url, method = "GET") {
    let response;
    events.fetch({ request: new Request(url, { method }), respondWith(value) { response = value; } });
    return response ? await response : null;
  }
  return { events, storage, network, deleted, lifecycle, request, scope };
}

test("service worker precaches only existing application assets and serves offline routes", async () => {
  const w = worker();
  await w.lifecycle("install");
  assert.equal(w.storage.size, 21);
  for (const url of w.storage.keys()) assert.ok(fs.existsSync(path.join(__dirname, "..", new URL(url).pathname.slice("/pocket/".length))));
  assert.equal((await w.request(w.scope)).url, w.scope + "index.html");
  assert.equal((await w.request(w.scope + "app.js?version=1")).cached, true);
  assert.equal(w.network.length, 0);
  await w.lifecycle("activate");
  assert.deepEqual(w.deleted, Array.from({ length: 19 }, (_, i) => `v3ry-pocket-color-app-v${i + 1}`));
});

test("service worker never intercepts ROM, ZIP, saves, cross-origin or write requests", async () => {
  const w = worker();
  await w.lifecycle("install");
  for (const name of ["roms/game.gbc", "game.gb", "game.zip", "game.sav", "game.state", "other.html"]) {
    assert.equal(await w.request(w.scope + name), null);
  }
  assert.equal(await w.request("https://other.test/pocket/app.js"), null);
  assert.equal(await w.request(w.scope + "app.js", "POST"), null);
  assert.equal(w.storage.size, 21);
  assert.equal(w.network.length, 0);
});

test("manifest resolves correctly under subdirectory hosting and PNG icons have required dimensions", () => {
  const manifest = JSON.parse(source("manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(new URL(manifest.start_url, "https://example.test/pocket/").pathname, "/pocket/index.html");
  for (const size of [192, 512]) {
    const png = fs.readFileSync(path.join(__dirname, "..", `icon-${size}.png`));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

function ui({ protocol = "https:", secure = true, fail = false, waiting = false } = {}) {
  const events = {}, install = { hidden: true, addEventListener(name, callback) { this[name] = callback; } };
  const status = { textContent: "", classList: { toggle() {} } }, errors = [], calls = [];
  const registration = { waiting, addEventListener(name, callback) { this[name] = callback; } };
  const context = vm.createContext({
    document: { querySelector: selector => selector === "#pwa-status" ? status : install },
    window: { location: { protocol }, isSecureContext: secure, addEventListener: (name, callback) => { events[name] = callback; } },
    navigator: { serviceWorker: { controller: true, ready: Promise.resolve(registration),
      async register(...args) { calls.push(args); if (fail) throw new Error("offline setup failed"); return registration; } } },
    console: { error(error) { errors.push(error); } },
  });
  vm.runInContext(source("pwa.js"), context);
  return { events, install, status, errors, calls, registration };
}

test("PWA UI explains file and insecure hosting, registers securely and reports failures", async () => {
  for (const options of [{ protocol: "file:" }, { secure: false }]) {
    const h = ui(options);
    assert.equal(h.calls.length, 0);
    assert.match(h.status.textContent, /HTTPS ou localhost/);
  }
  const good = ui();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(good.status.textContent, /prête hors ligne/);
  assert.equal(good.calls[0][0], "./sw.js");
  const bad = ui({ fail: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(bad.status.textContent, /impossible/);
  assert.equal(bad.errors.length, 1);
});

test("PWA installation requires a user click and updates never force-reload an active game", async () => {
  const h = ui({ waiting: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.status.textContent, /fermez tous les onglets/);
  let prompts = 0;
  h.events.beforeinstallprompt({ preventDefault() {}, async prompt() { prompts++; }, userChoice: Promise.resolve({ outcome: "dismissed" }) });
  assert.equal(prompts, 0);
  assert.equal(h.install.hidden, false);
  await h.install.click();
  assert.equal(prompts, 1);
  assert.equal(h.install.hidden, true);
  assert.match(h.status.textContent, /annulée/);
  h.events.appinstalled();
  assert.match(h.status.textContent, /installée/);
});

test("PWA installation errors and worker cache failures are visible", async () => {
  const h = ui();
  await new Promise(resolve => setImmediate(resolve));
  h.events.beforeinstallprompt({ preventDefault() {}, async prompt() { throw new Error("denied"); } });
  await h.install.click();
  assert.match(h.status.textContent, /Installation impossible/);
  assert.equal(h.errors.length, 1);
  const worker = { state: "installing", addEventListener(name, callback) { this[name] = callback; } };
  h.registration.installing = worker;
  h.registration.updatefound();
  worker.state = "redundant";
  worker.statechange();
  assert.match(h.status.textContent, /échouée/);
});
