"use strict";

// Bump this version whenever a cached application file changes.
const CACHE = "v3ry-pocket-color-app-v73";
const ASSETS = ["index.html", "styles.css", "gbc/cpu.js", "gbc/cartridge.js", "gbc/audio.js",
  "gbc/emulator.js", "gbc/printer.js", "zip.js", "gbc/saves.js", "gbc/states.js", "gbc/graphics.js", "app.js", "pwa.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "gbc/preset/aladdin.js",
  "gbc/preset/pokemon-crystal.js", "gbc/preset/gen1-engine.js", "gbc/preset/pokemon-red.js", "gbc/preset/pokemon-yellow.js",
  "gbc/preset/zelda-oracles.js", "gbc/world.js", "gbc/scene.js",
  "gba/cpu.js", "gba/rtc.js", "gba/cartridge.js", "gba/audio.js", "gba/graphics.js", "gba/emulator.js", "gba/states.js"];
const urls = new Set(ASSETS.map(name => new URL(name, self.registration.scope).href));
const indexURL = new URL("index.html", self.registration.scope).href;
const rootURL = self.registration.scope;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(name => new Request(new URL(name, rootURL), { cache: "reload" })));
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("v3ry-pocket-color-app-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.search = "";
  const key = url.href === rootURL ? indexURL : url.href;
  if (!urls.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const response = await cache.match(key);
    return response || fetch(request);
  })());
});
