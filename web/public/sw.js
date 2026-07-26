// BoxingPro service worker — the gym has no wifi.
//
// Strategy per path:
//   /_next/static/*  content-hashed        → cache-first (immutable)
//   /models/*        pose model, static    → cache-first (9MB, cache once)
//   /mediapipe/*     runtime wasm, static  → cache-first
//   everything else  HTML, /core wasm (NOT hashed between deploys)
//                                          → network-first, cache fallback
// Bump CACHE to invalidate everything at once.
const CACHE = "bp-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) {
        if (k !== CACHE) await caches.delete(k);
      }
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const p = url.pathname;
  if (
    p.startsWith("/_next/static/") ||
    p.startsWith("/models/") ||
    p.startsWith("/mediapipe/")
  ) {
    e.respondWith(cacheFirst(e.request));
  } else {
    e.respondWith(networkFirst(e.request));
  }
});
